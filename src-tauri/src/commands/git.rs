//! Git operations for the review, history and branch views. Everything shells out
//! to the `git` binary except a few reads served by `git2`.

use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::process::Command;
use git2::{Repository, BranchType};
use crate::commands::git_error::GitError;
use serde::Serialize;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// One line of a hunk.
#[derive(Serialize, Clone)]
pub struct DiffLine {
    pub kind: String, // "add" | "remove" | "context"
    pub content: String,
}

#[derive(Serialize, Clone)]
/// A hunk with its raw `@@` header.
pub struct GitDiffHunk {
    pub header: String,
    pub lines: Vec<DiffLine>,
}

#[derive(Serialize, Clone)]
/// Every hunk of one file in a diff.
pub struct GitFileDiff {
    #[serde(rename = "filePath")]
    pub file_path: String,
    pub hunks: Vec<GitDiffHunk>,
}

/// A commit as listed in the history view.
#[derive(Serialize)]
pub struct GitCommit {
    pub hash: String,
    #[serde(rename = "shortHash")]
    pub short_hash: String,
    pub author: String,
    pub date: String,
    pub message: String,
    #[serde(rename = "onCurrentBranch")]
    pub on_current_branch: bool,
}

#[derive(Serialize)]
/// `user.name` / `user.email` as configured for the worktree.
pub struct GitIdentity {
    pub name: String,
    pub email: String,
}

#[derive(Serialize)]
/// Divergence from the upstream branch; all counts are zero when `has_upstream` is false.
pub struct RemoteStatus {
    #[serde(rename = "ahead")]
    pub ahead: usize,
    #[serde(rename = "behind")]
    pub behind: usize,
    #[serde(rename = "remote")]
    pub remote: String,
    #[serde(rename = "hasUpstream")]
    pub has_upstream: bool,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Resolves a leading `~` so paths coming from the frontend work as typed.
fn expand(path: &str) -> String {
    shellexpand::tilde(path).into_owned()
}

/// A `git` invocation rooted in the worktree, with the locale pinned to C.
fn git_cmd(worktree: &str) -> Command {
    let mut cmd = Command::new("git");
    cmd.current_dir(worktree);
    // Error classification matches git's English messages, so the locale is
    // pinned rather than inherited from the user's environment.
    cmd.env("LC_ALL", "C").env("LANG", "C");
    cmd
}

/// Runs the command and returns stdout, turning a non-zero exit into a classified `GitError`.
fn run(cmd: &mut Command) -> Result<String, GitError> {
    let output = cmd.output()?;
    if !output.status.success() {
        return Err(GitError::from_process(&output));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Rejects a value starting with `-`, which git would otherwise read as an
/// option. Used for refs and for the file paths passed to `git rm`.
fn reject_option_like(name: &str) -> Result<(), GitError> {
    if name.starts_with('-') {
        return Err(GitError::new("invalid_ref", format!("Invalid git reference: {name}"))
            .with_context(name));
    }
    Ok(())
}

/// Parses unified diff text into per-file hunks. The path is taken from the `+++ b/`
/// line when present, so renames and quoted paths resolve to the destination.
fn parse_diff(raw: &str) -> Vec<GitFileDiff> {
    let mut files: Vec<GitFileDiff> = Vec::new();
    let mut current_file: Option<GitFileDiff> = None;
    let mut current_hunk: Option<GitDiffHunk> = None;

    for line in raw.lines() {
        if line.starts_with("diff --git ") {
            // Flush previous hunk/file
            if let Some(hunk) = current_hunk.take()
                && let Some(ref mut f) = current_file {
                    f.hunks.push(hunk);
                }
            if let Some(f) = current_file.take() {
                files.push(f);
            }

            let path = line
                .split(" b/")
                .last()
                .unwrap_or("")
                .to_string();
            current_file = Some(GitFileDiff { file_path: path, hunks: Vec::new() });
        } else if line.starts_with("@@ ") {
            if let Some(hunk) = current_hunk.take()
                && let Some(ref mut f) = current_file {
                    f.hunks.push(hunk);
                }
            current_hunk = Some(GitDiffHunk {
                header: line.to_string(),
                lines: Vec::new(),
            });
        } else if current_hunk.is_none() {
            if let (Some(f), Some(path)) = (current_file.as_mut(), line.strip_prefix("+++ b/")) {
                f.file_path = path.to_string();
            }
        } else if line.starts_with('\\') {
            // "\ No newline at end of file" marker inside a hunk: not a real line.
        } else if let Some(ref mut hunk) = current_hunk {
            let kind = if line.starts_with('+') {
                "add"
            } else if line.starts_with('-') {
                "remove"
            } else {
                "context"
            };
            let content = if line.is_empty() { "" } else { &line[1..] };
            hunk.lines.push(DiffLine { kind: kind.to_string(), content: content.to_string() });
        }
    }

    // Flush last hunk/file
    if let Some(hunk) = current_hunk.take()
        && let Some(ref mut f) = current_file {
            f.hunks.push(hunk);
        }
    if let Some(f) = current_file.take() {
        files.push(f);
    }

    files
}

// ---------------------------------------------------------------------------
// Existing commands
// ---------------------------------------------------------------------------

#[tauri::command]
/// Local branch names.
pub async fn list_branches(project_path: String) -> Result<Vec<String>, GitError> {
    let expanded = expand(&project_path);
    let repo = Repository::open(&expanded)?;
    let branches = repo.branches(Some(BranchType::Local))?;
    let names = branches
        .filter_map(|b| b.ok())
        .filter_map(|(b, _)| b.name().ok().flatten().map(|n| n.to_string()))
        .collect();
    Ok(names)
}

/// Local and remote branch names, `origin/HEAD` excluded.
#[derive(Serialize)]
pub struct BranchList {
    pub local: Vec<String>,
    pub remote: Vec<String>,
}

#[tauri::command]
/// Local and remote branches, for pickers that offer a remote base.
pub async fn list_branches_detailed(project_path: String) -> Result<BranchList, GitError> {
    let expanded = expand(&project_path);
    let repo = Repository::open(&expanded)?;

    let local = repo
        .branches(Some(BranchType::Local))?
        .filter_map(|b| b.ok())
        .filter_map(|(b, _)| b.name().ok().flatten().map(|n| n.to_string()))
        .collect();

    let remote = repo
        .branches(Some(BranchType::Remote))?
        .filter_map(|b| b.ok())
        .filter_map(|(b, _)| b.name().ok().flatten().map(|n| n.to_string()))
        // `origin/HEAD` is a symbolic pointer, not a real base branch.
        .filter(|n| !n.ends_with("/HEAD"))
        .collect();

    Ok(BranchList { local, remote })
}

#[tauri::command]
/// Resolves the path to its worktree root, rejecting missing paths and bare repositories.
pub async fn validate_git_repo(path: String) -> Result<String, GitError> {
    let expanded = expand(&path);
    let repo_path = std::path::PathBuf::from(&expanded);

    if !repo_path.exists() {
        return Err(GitError::new("path_missing", format!("Path does not exist: {}", path))
            .with_context(&path));
    }
    if !repo_path.is_dir() {
        return Err(GitError::new("path_not_directory", format!("Path is not a directory: {}", path))
            .with_context(&path));
    }

    Repository::discover(&repo_path)
        .map_err(|_| {
            GitError::new("not_a_repository", format!("Not a git repository: {}", path))
                .with_context(&path)
        })
        .and_then(|repo| {
            repo.workdir()
                .ok_or_else(|| {
                    GitError::new("bare_repository", "Bare repositories are not supported")
                        .with_context(&path)
                })
                .map(|p| p.to_string_lossy().trim_end_matches('/').to_string())
        })
}

/// True only when the path is itself a worktree root, not merely nested in a parent repository.
fn is_repo_root(expanded: &str) -> Result<bool, GitError> {
    if !Path::new(expanded).is_dir() {
        return Ok(false);
    }

    let output = git_cmd(expanded)
        .args(["rev-parse", "--show-toplevel"])
        .output()?;

    if !output.status.success() {
        return Ok(false);
    }

    let toplevel = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if toplevel.is_empty() {
        return Ok(false);
    }

    // The path is a repository only when it is the repo/worktree root itself,
    // not merely nested inside a parent repository (git walks up by default).
    match (fs::canonicalize(expanded), fs::canonicalize(&toplevel)) {
        (Ok(a), Ok(b)) => Ok(a == b),
        _ => Ok(false),
    }
}

#[tauri::command]
/// Whether the path is a worktree root.
pub async fn is_git_repo(worktree_path: String) -> Result<bool, GitError> {
    is_repo_root(&expand(&worktree_path))
}

#[tauri::command]
/// Porcelain status mapped to one category per file (untracked, deleted, conflicted,
/// staged-*, modified). Renames are reported under their destination path.
pub async fn git_status(worktree_path: String) -> Result<HashMap<String, String>, GitError> {
    let expanded = expand(&worktree_path);
    let output = git_cmd(&expanded)
        .args(["status", "--porcelain", "-u"])
        .output()?;

    if !output.status.success() {
        return Ok(HashMap::new());
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let mut map = HashMap::new();

    for line in text.lines() {
        if line.len() < 4 { continue; }
        let x = line.chars().next().unwrap_or(' ');
        let y = line.chars().nth(1).unwrap_or(' ');
        let path = line[3..].trim_end().to_string();
        let file_path = if path.contains(" -> ") {
            path.split(" -> ").last().unwrap_or(&path).to_string()
        } else {
            path
        };

        let is_conflict = x == 'U'
            || y == 'U'
            || (x == 'A' && y == 'A')
            || (x == 'D' && y == 'D');

        let category = if is_conflict {
            "conflicted"
        } else if x == '?' && y == '?' {
            "untracked"
        } else if y == 'D' {
            "deleted"
        } else if y != ' ' {
            "modified"
        } else if x != ' ' && x != '?' {
            match x {
                'A' => "staged-added",
                'D' => "staged-deleted",
                'R' => "staged-renamed",
                'C' => "staged-copied",
                _   => "staged-modified",
            }
        } else {
            "modified"
        };

        map.insert(file_path, category.to_string());
    }

    Ok(map)
}

#[tauri::command]
/// Subset of the given paths that git ignores.
pub async fn git_check_ignore(worktree_path: String, paths: Vec<String>) -> Result<Vec<String>, GitError> {
    if paths.is_empty() {
        return Ok(Vec::new());
    }
    let expanded = expand(&worktree_path);
    let mut cmd = git_cmd(&expanded);
    cmd.arg("check-ignore").arg("--");
    for p in &paths {
        cmd.arg(p);
    }
    let out = cmd.output()?;
    let text = String::from_utf8_lossy(&out.stdout);
    Ok(text.lines().filter(|l| !l.is_empty()).map(|l| l.trim_end().to_string()).collect())
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

#[tauri::command]
/// Worktree changes against the index.
pub async fn git_diff_unstaged(worktree_path: String) -> Result<Vec<GitFileDiff>, GitError> {
    let expanded = expand(&worktree_path);
    let raw = run(git_cmd(&expanded).args(["diff", "--no-color", "--unified=3"]))?;
    Ok(parse_diff(&raw))
}

#[tauri::command]
/// Index changes against HEAD.
pub async fn git_diff_staged(worktree_path: String) -> Result<Vec<GitFileDiff>, GitError> {
    let expanded = expand(&worktree_path);
    let raw = run(git_cmd(&expanded).args(["diff", "--cached", "--no-color", "--unified=3"]))?;
    Ok(parse_diff(&raw))
}

#[tauri::command]
/// File contents at HEAD, `None` when it does not exist there (a new file).
pub async fn git_file_at_head(
    worktree_path: String,
    file_path: String,
) -> Result<Option<String>, GitError> {
    let expanded = expand(&worktree_path);
    let output = git_cmd(&expanded)
        .args(["show", &format!("HEAD:{}", file_path)])
        .output()?;
    if !output.status.success() {
        if !is_repo_root(&expanded)? {
            return Err(GitError::from_process(&output));
        }
        return Ok(None);
    }
    Ok(Some(String::from_utf8_lossy(&output.stdout).to_string()))
}

#[tauri::command]
/// Staged contents of the file, `None` when it is not in the index.
pub async fn git_file_in_index(
    worktree_path: String,
    file_path: String,
) -> Result<Option<String>, GitError> {
    let expanded = expand(&worktree_path);
    let output = git_cmd(&expanded)
        .args(["show", &format!(":{}", file_path)])
        .output()?;
    if !output.status.success() {
        if !is_repo_root(&expanded)? {
            return Err(GitError::from_process(&output));
        }
        return Ok(None);
    }
    Ok(Some(String::from_utf8_lossy(&output.stdout).to_string()))
}

#[tauri::command]
/// Hunks for a single file, staged or unstaged.
pub async fn git_diff_file(worktree_path: String, file_path: String, staged: bool) -> Result<Vec<GitDiffHunk>, GitError> {
    let expanded = expand(&worktree_path);
    let mut args = vec!["diff", "--unified=3"];
    if staged { args.push("--cached"); }
    args.push("--");
    args.push(&file_path);
    let raw = run(git_cmd(&expanded).args(&args))?;
    let files = parse_diff(&raw);
    Ok(files.into_iter().next().map(|f| f.hunks).unwrap_or_default())
}

// ---------------------------------------------------------------------------
// Staging
// ---------------------------------------------------------------------------

#[tauri::command]
/// Stages one path.
pub async fn git_stage_file(worktree_path: String, file_path: String) -> Result<(), GitError> {
    let expanded = expand(&worktree_path);
    let out = git_cmd(&expanded).args(["add", "--", &file_path]).output()?;
    if !out.status.success() {
        return Err(GitError::from_process(&out));
    }
    Ok(())
}

#[tauri::command]
/// Unstages one path, falling back to `rm --cached` in a repo without commits.
pub async fn git_unstage_file(worktree_path: String, file_path: String) -> Result<(), GitError> {
    let expanded = expand(&worktree_path);
    let out = git_cmd(&expanded).args(["restore", "--staged", "--", &file_path]).output()?;
    if !out.status.success() {
        // Fallback for repos with no commits yet
        let out2 = git_cmd(&expanded).args(["rm", "--cached", "--", &file_path]).output()?;
        if !out2.status.success() {
            return Err(GitError::from_process(&out2));
        }
    }
    Ok(())
}

#[tauri::command]
/// Stages every change, deletions included.
pub async fn git_stage_all(worktree_path: String) -> Result<(), GitError> {
    let expanded = expand(&worktree_path);
    let out = git_cmd(&expanded).args(["add", "-A"]).output()?;
    if !out.status.success() {
        return Err(GitError::from_process(&out));
    }
    Ok(())
}

#[tauri::command]
/// Unstages everything, falling back to `rm --cached` in a repo without commits.
pub async fn git_unstage_all(worktree_path: String) -> Result<(), GitError> {
    let expanded = expand(&worktree_path);
    let out = git_cmd(&expanded).args(["restore", "--staged", "."]).output()?;
    if !out.status.success() {
        // Fallback for repos with no commits yet
        let out2 = git_cmd(&expanded).args(["rm", "--cached", "-r", "."]).output()?;
        if !out2.status.success() {
            return Err(GitError::from_process(&out2));
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

#[tauri::command]
/// Configured author identity; missing values come back empty rather than failing.
pub async fn git_get_identity(worktree_path: String) -> Result<GitIdentity, GitError> {
    let expanded = expand(&worktree_path);
    let name = git_cmd(&expanded)
        .args(["config", "user.name"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();
    let email = git_cmd(&expanded)
        .args(["config", "user.email"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();
    Ok(GitIdentity { name, email })
}

#[tauri::command]
/// Commits the index, optionally overriding the author.
pub async fn git_commit(
    worktree_path: String,
    message: String,
    no_verify: bool,
    sign_off: bool,
    allow_empty: bool,
    author_name: String,
    author_email: String,
) -> Result<String, GitError> {
    let expanded = expand(&worktree_path);
    let mut cmd = git_cmd(&expanded);
    cmd.arg("commit").arg("-m").arg(&message);
    if no_verify   { cmd.arg("--no-verify"); }
    if sign_off    { cmd.arg("--signoff"); }
    if allow_empty { cmd.arg("--allow-empty"); }
    if !author_name.is_empty() && !author_email.is_empty() {
        cmd.arg(format!("--author={} <{}>", author_name, author_email));
    }
    let out = cmd.output()?;
    if !out.status.success() {
        return Err(GitError::from_process(&out));
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

#[tauri::command]
/// Rewrites HEAD with the new message and the current index.
pub async fn git_amend_commit(
    worktree_path: String,
    message: String,
    no_verify: bool,
    sign_off: bool,
    author_name: String,
    author_email: String,
) -> Result<String, GitError> {
    let expanded = expand(&worktree_path);
    let mut cmd = git_cmd(&expanded);
    cmd.arg("commit").arg("--amend").arg("-m").arg(&message);
    if no_verify { cmd.arg("--no-verify"); }
    if sign_off  { cmd.arg("--signoff"); }
    if !author_name.is_empty() && !author_email.is_empty() {
        cmd.arg(format!("--author={} <{}>", author_name, author_email));
    }
    let out = cmd.output()?;
    if !out.status.success() {
        return Err(GitError::from_process(&out));
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

#[tauri::command]
/// Full HEAD commit message; empty when the repo has no commit yet.
pub async fn git_head_message(worktree_path: String) -> Result<String, GitError> {
    let expanded = expand(&worktree_path);
    let output = git_cmd(&expanded)
        .args(["log", "-1", "--format=%B"])
        .output()?;
    if !output.status.success() {
        return Ok(String::new());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim_end().to_string())
}

// ---------------------------------------------------------------------------
// Branches
// ---------------------------------------------------------------------------

#[tauri::command]
/// Checked-out branch name, empty on a detached HEAD.
pub async fn git_current_branch(worktree_path: String) -> Result<String, GitError> {
    let expanded = expand(&worktree_path);
    let raw = run(git_cmd(&expanded).args(["branch", "--show-current"]))?;
    Ok(raw.trim().to_string())
}

#[tauri::command]
/// Switches branch.
pub async fn git_checkout_branch(worktree_path: String, branch_name: String) -> Result<(), GitError> {
    reject_option_like(&branch_name)?;
    let expanded = expand(&worktree_path);
    let out = git_cmd(&expanded).args(["checkout", &branch_name]).output()?;
    if !out.status.success() {
        return Err(GitError::from_process(&out));
    }
    Ok(())
}

#[tauri::command]
/// Creates a branch from `from_branch` and checks it out.
pub async fn git_create_branch(worktree_path: String, branch_name: String, from_branch: String) -> Result<(), GitError> {
    reject_option_like(&branch_name)?;
    reject_option_like(&from_branch)?;
    let expanded = expand(&worktree_path);
    let out = git_cmd(&expanded).args(["checkout", "-b", &branch_name, &from_branch]).output()?;
    if !out.status.success() {
        return Err(GitError::from_process(&out));
    }
    Ok(())
}

#[tauri::command]
/// Deletes a branch, refusing if it is not merged.
pub async fn git_delete_branch(worktree_path: String, branch_name: String) -> Result<(), GitError> {
    reject_option_like(&branch_name)?;
    let expanded = expand(&worktree_path);
    let out = git_cmd(&expanded).args(["branch", "-d", "--", &branch_name]).output()?;
    if !out.status.success() {
        return Err(GitError::from_process(&out));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Remote
// ---------------------------------------------------------------------------

#[tauri::command]
/// Pushes, blocking on the network. Force uses `--force-with-lease`; stdout and
/// stderr are merged because git reports progress on stderr.
pub async fn git_push(worktree_path: String, set_upstream: bool, branch: String, force: bool) -> Result<String, GitError> {
    reject_option_like(&branch)?;
    let expanded = expand(&worktree_path);
    let mut args = vec!["push"];

    if force {
        args.push("--force-with-lease");
    }
    if set_upstream {
        args.extend(["--set-upstream", "origin", branch.as_str()]);
    }
    let out = git_cmd(&expanded).args(&args).output()?;
    let combined = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    if !out.status.success() {
        return Err(GitError::from_output(combined).with_context(branch));
    }
    Ok(combined)
}

#[tauri::command]
/// Pulls with rebase; conflicts come back as a non-ok result rather than an error.
pub async fn git_pull(worktree_path: String) -> Result<GitOpResult, GitError> {
    let expanded = expand(&worktree_path);
    let out = git_cmd(&expanded)
        .env("GIT_EDITOR", "true")
        .args(["pull", "--rebase"])
        .output()?;
    finish_op(&expanded, out)
}

#[tauri::command]
/// Fetches and prunes deleted remote branches.
pub async fn git_fetch(worktree_path: String) -> Result<(), GitError> {
    let expanded = expand(&worktree_path);
    let out = git_cmd(&expanded).args(["fetch", "--prune"]).output()?;
    if !out.status.success() {
        return Err(GitError::from_process(&out));
    }
    Ok(())
}

/// Recovery for the `lock_exists` error: removes `.git/index.lock` left behind
/// by a git process that died. Refuses while another git process is alive so a
/// running operation is never corrupted.
#[tauri::command]
pub async fn git_remove_index_lock(worktree_path: String) -> Result<(), GitError> {
    let expanded = expand(&worktree_path);
    let lock = git_path(&expanded, "index.lock")
        .ok_or_else(|| GitError::new("not_a_repository", "Cannot locate the git directory"))?;
    if !lock.exists() {
        return Ok(());
    }
    if operation_kind(&expanded) != "none" {
        return Err(GitError::new(
            "operation_in_progress",
            "A merge or rebase is in progress: the lock is not stale",
        ));
    }
    fs::remove_file(&lock)?;
    Ok(())
}

#[tauri::command]
/// Ahead/behind counts against the upstream branch.
pub async fn git_remote_status(worktree_path: String) -> Result<RemoteStatus, GitError> {
    let expanded = expand(&worktree_path);

    // Get upstream tracking branch
    let upstream_out = git_cmd(&expanded)
        .args(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])
        .output()?;

    if !upstream_out.status.success() {
        return Ok(RemoteStatus { ahead: 0, behind: 0, remote: String::new(), has_upstream: false });
    }

    let remote = String::from_utf8_lossy(&upstream_out.stdout).trim().to_string();

    let counts = run(git_cmd(&expanded).args(["rev-list", "--left-right", "--count", "HEAD...@{u}"]))?;
    let parts: Vec<&str> = counts.split_whitespace().collect();
    let ahead = parts.first().and_then(|s| s.parse().ok()).unwrap_or(0);
    let behind = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0);

    Ok(RemoteStatus { ahead, behind, remote, has_upstream: true })
}

#[tauri::command]
/// URL of `origin`, empty when there is no remote.
pub async fn git_remote_url(worktree_path: String) -> Result<String, GitError> {
    let expanded = expand(&worktree_path);
    let out = git_cmd(&expanded).args(["remote", "get-url", "origin"]).output()?;
    if !out.status.success() {
        return Ok(String::new());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Divergence from a base branch; `base_ref` is empty when the base was not found.
#[derive(Serialize)]
pub struct BranchDivergence {
    pub ahead: usize,
    pub behind: usize,
    #[serde(rename = "baseRef")]
    pub base_ref: String,
}

#[tauri::command]
/// Ahead/behind against `base`, preferring `origin/<base>` over the local branch.
pub async fn git_branch_divergence(worktree_path: String, base: String) -> Result<BranchDivergence, GitError> {
    reject_option_like(&base)?;
    let expanded = expand(&worktree_path);

    let candidates = [format!("refs/remotes/origin/{base}"), format!("refs/heads/{base}")];
    let base_ref = candidates.iter().find(|candidate| {
        git_cmd(&expanded)
            .args(["rev-parse", "--verify", "--quiet", candidate])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    });

    let Some(base_ref) = base_ref else {
        return Ok(BranchDivergence { ahead: 0, behind: 0, base_ref: String::new() });
    };

    let range = format!("HEAD...{base_ref}");
    let counts = run(git_cmd(&expanded).args(["rev-list", "--left-right", "--count", &range]))?;
    let parts: Vec<&str> = counts.split_whitespace().collect();
    let ahead = parts.first().and_then(|s| s.parse().ok()).unwrap_or(0);
    let behind = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0);

    let display = base_ref
        .strip_prefix("refs/remotes/")
        .or_else(|| base_ref.strip_prefix("refs/heads/"))
        .unwrap_or(base_ref)
        .to_string();

    Ok(BranchDivergence { ahead, behind, base_ref: display })
}

// ---------------------------------------------------------------------------
// Rebase / Merge / Conflicts
// ---------------------------------------------------------------------------

/// Outcome of a merge, rebase or pull. `ok: false` with `has_conflicts` is an
/// expected stop, not a failure.
#[derive(Serialize)]
pub struct GitOpResult {
    pub ok: bool,
    #[serde(rename = "hasConflicts")]
    pub has_conflicts: bool,
    #[serde(rename = "conflictedFiles")]
    pub conflicted_files: Vec<String>,
    pub output: String,
}

/// The merge or rebase currently in progress, if any.
#[derive(Serialize)]
pub struct GitOperationState {
    pub kind: String, // "rebase" | "merge" | "none"
    #[serde(rename = "conflictedFiles")]
    pub conflicted_files: Vec<String>,
    // Subset of conflictedFiles that are delete/add conflicts (no inline markers).
    #[serde(rename = "structuralFiles")]
    pub structural_files: Vec<String>,
    pub head: String,
    pub current: usize,
    pub total: usize,
}

/// Resolves a name inside the git directory, which is not `.git/` in a worktree.
fn git_path(worktree: &str, name: &str) -> Option<std::path::PathBuf> {
    let out = git_cmd(worktree).args(["rev-parse", "--git-path", name]).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let raw = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if raw.is_empty() {
        return None;
    }
    let path = Path::new(&raw);
    Some(if path.is_absolute() { path.to_path_buf() } else { Path::new(worktree).join(path) })
}

/// Whether a rebase or a merge is in progress, detected from the git directory.
fn operation_kind(worktree: &str) -> String {
    let exists = |name: &str| git_path(worktree, name).map(|p| p.exists()).unwrap_or(false);
    if exists("rebase-merge") || exists("rebase-apply") {
        return "rebase".to_string();
    }
    if exists("MERGE_HEAD") {
        return "merge".to_string();
    }
    "none".to_string()
}

/// Trimmed contents of a file in the git directory, `None` if absent.
fn read_git_file(worktree: &str, name: &str) -> Option<String> {
    let path = git_path(worktree, name)?;
    fs::read_to_string(path).ok().map(|s| s.trim().to_string())
}

/// Branch being rebased plus the step counters shown while it runs.
fn rebase_progress(worktree: &str) -> (String, usize, usize) {
    let head = read_git_file(worktree, "rebase-merge/head-name")
        .map(|h| h.trim_start_matches("refs/heads/").to_string())
        .unwrap_or_default();
    let current = read_git_file(worktree, "rebase-merge/msgnum")
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let total = read_git_file(worktree, "rebase-merge/end")
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    (head, current, total)
}

/// Paths left unmerged.
fn conflicted_files(worktree: &str) -> Vec<String> {
    let out = git_cmd(worktree).args(["diff", "--name-only", "--diff-filter=U"]).output();
    match out {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout)
            .lines()
            .filter(|l| !l.is_empty())
            .map(String::from)
            .collect(),
        _ => Vec::new(),
    }
}

// (path, is_structural). Content conflicts (UU/AA) carry inline markers; every
// other unmerged state (delete/add) is structural and resolved by keep/remove.
fn conflict_entries(worktree: &str) -> Vec<(String, bool)> {
    let out = match git_cmd(worktree).args(["status", "--porcelain"]).output() {
        Ok(o) if o.status.success() => o,
        _ => return Vec::new(),
    };
    let text = String::from_utf8_lossy(&out.stdout);
    let mut entries = Vec::new();
    for line in text.lines() {
        if line.len() < 4 {
            continue;
        }
        let x = line.chars().next().unwrap_or(' ');
        let y = line.chars().nth(1).unwrap_or(' ');
        let unmerged =
            x == 'U' || y == 'U' || (x == 'A' && y == 'A') || (x == 'D' && y == 'D');
        if !unmerged {
            continue;
        }
        let path = line[3..].trim_end().to_string();
        let is_content = (x == 'U' && y == 'U') || (x == 'A' && y == 'A');
        entries.push((path, !is_content));
    }
    entries
}

/// Classifies a merge/rebase/pull result: success, an expected conflict stop, or a real error.
fn finish_op(worktree: &str, out: std::process::Output) -> Result<GitOpResult, GitError> {
    let output = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    if out.status.success() {
        return Ok(GitOpResult { ok: true, has_conflicts: false, conflicted_files: Vec::new(), output });
    }
    let conflicts = conflicted_files(worktree);
    if operation_kind(worktree) != "none" || !conflicts.is_empty() {
        return Ok(GitOpResult { ok: false, has_conflicts: true, conflicted_files: conflicts, output });
    }
    Err(GitError::from_output(output))
}

#[tauri::command]
/// State of the in-progress operation, with its conflicts split into content and structural ones.
pub async fn git_operation_state(worktree_path: String) -> Result<GitOperationState, GitError> {
    let expanded = expand(&worktree_path);
    let kind = operation_kind(&expanded);
    if kind == "none" {
        return Ok(GitOperationState {
            kind,
            conflicted_files: Vec::new(),
            structural_files: Vec::new(),
            head: String::new(),
            current: 0,
            total: 0,
        });
    }
    let entries = conflict_entries(&expanded);
    let conflicted_files: Vec<String> = entries.iter().map(|(p, _)| p.clone()).collect();
    let structural_files: Vec<String> = entries
        .iter()
        .filter(|(_, structural)| *structural)
        .map(|(p, _)| p.clone())
        .collect();
    let (head, current, total) = if kind == "rebase" {
        rebase_progress(&expanded)
    } else {
        (String::new(), 0, 0)
    };
    Ok(GitOperationState {
        kind,
        conflicted_files,
        structural_files,
        head,
        current,
        total,
    })
}

#[tauri::command]
/// Removes the file from the worktree and the index, used to resolve a delete conflict.
pub async fn git_rm(worktree_path: String, file_path: String) -> Result<(), GitError> {
    reject_option_like(&file_path)?;
    let expanded = expand(&worktree_path);
    let out = git_cmd(&expanded)
        .args(["rm", "-f", "--", &file_path])
        .output()?;
    if !out.status.success() {
        return Err(GitError::from_process(&out));
    }
    Ok(())
}

#[tauri::command]
/// Merges a branch without opening an editor.
pub async fn git_merge(worktree_path: String, branch: String) -> Result<GitOpResult, GitError> {
    reject_option_like(&branch)?;
    let expanded = expand(&worktree_path);
    let out = git_cmd(&expanded)
        .args(["merge", "--no-edit", "--", &branch])
        .output()?;
    finish_op(&expanded, out)
}

#[tauri::command]
/// Resumes the merge once conflicts are resolved and staged.
pub async fn git_merge_continue(worktree_path: String) -> Result<GitOpResult, GitError> {
    let expanded = expand(&worktree_path);
    let out = git_cmd(&expanded)
        .env("GIT_EDITOR", "true")
        .args(["merge", "--continue"])
        .output()?;
    finish_op(&expanded, out)
}

#[tauri::command]
/// Aborts the merge and restores the pre-merge state.
pub async fn git_merge_abort(worktree_path: String) -> Result<(), GitError> {
    let expanded = expand(&worktree_path);
    let out = git_cmd(&expanded).args(["merge", "--abort"]).output()?;
    if !out.status.success() {
        return Err(GitError::from_process(&out));
    }
    Ok(())
}

#[tauri::command]
/// Rebases the current branch onto `onto`.
pub async fn git_rebase(worktree_path: String, onto: String) -> Result<GitOpResult, GitError> {
    reject_option_like(&onto)?;
    let expanded = expand(&worktree_path);
    let out = git_cmd(&expanded)
        .env("GIT_EDITOR", "true")
        .args(["rebase", "--", &onto])
        .output()?;
    finish_op(&expanded, out)
}

#[tauri::command]
/// Resumes the rebase once the current step is resolved and staged.
pub async fn git_rebase_continue(worktree_path: String) -> Result<GitOpResult, GitError> {
    let expanded = expand(&worktree_path);
    let out = git_cmd(&expanded)
        .env("GIT_EDITOR", "true")
        .args(["rebase", "--continue"])
        .output()?;
    finish_op(&expanded, out)
}

#[tauri::command]
/// Drops the conflicting commit and moves to the next step.
pub async fn git_rebase_skip(worktree_path: String) -> Result<GitOpResult, GitError> {
    let expanded = expand(&worktree_path);
    let out = git_cmd(&expanded)
        .env("GIT_EDITOR", "true")
        .args(["rebase", "--skip"])
        .output()?;
    finish_op(&expanded, out)
}

#[tauri::command]
/// Aborts the rebase and restores the original branch.
pub async fn git_rebase_abort(worktree_path: String) -> Result<(), GitError> {
    let expanded = expand(&worktree_path);
    let out = git_cmd(&expanded).args(["rebase", "--abort"]).output()?;
    if !out.status.success() {
        return Err(GitError::from_process(&out));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------

/// A commit for the graph view, with its parents and the refs pointing at it.
#[derive(Serialize)]
pub struct GitGraphCommit {
    pub hash: String,
    #[serde(rename = "shortHash")]
    pub short_hash: String,
    pub message: String,
    pub author: String,
    pub date: String,
    pub parents: Vec<String>,
    pub refs: Vec<String>,
}

#[tauri::command]
/// One page of commits across all refs, topologically ordered, for the graph view.
pub async fn git_graph(worktree_path: String, limit: usize, offset: usize) -> Result<Vec<GitGraphCommit>, GitError> {
    let expanded = expand(&worktree_path);
    let raw = run(git_cmd(&expanded).args([
        "log", "--all", "--topo-order",
        &format!("--skip={}", offset),
        &format!("-{}", limit),
        "--format=%H\x1f%h\x1f%P\x1f%an\x1f%aI\x1f%D\x1f%s",
    ]))?;
    let commits = raw.lines().filter(|l| !l.is_empty()).map(|line| {
        let p: Vec<&str> = line.splitn(7, '\x1f').collect();
        let parents = p.get(2).unwrap_or(&"")
            .split_whitespace().filter(|s| !s.is_empty()).map(String::from).collect();
        let refs = p.get(5).unwrap_or(&"")
            .split(',').map(|s| s.trim()).filter(|s| !s.is_empty()).map(String::from).collect();
        GitGraphCommit {
            hash:        p.first()  .unwrap_or(&"").to_string(),
            short_hash:  p.get(1)   .unwrap_or(&"").to_string(),
            parents,
            author:      p.get(3)   .unwrap_or(&"").to_string(),
            date:        p.get(4)   .unwrap_or(&"").to_string(),
            refs,
            message:     p.get(6).map(|s| s.trim_end()).unwrap_or("").to_string(),
        }
    }).collect();
    Ok(commits)
}

// ---------------------------------------------------------------------------
// Commit diff
// ---------------------------------------------------------------------------

#[tauri::command]
/// Diff introduced by a commit.
pub async fn git_diff_commit(worktree_path: String, commit_hash: String) -> Result<Vec<GitFileDiff>, GitError> {
    reject_option_like(&commit_hash)?;
    let expanded = expand(&worktree_path);
    let raw = run(git_cmd(&expanded).args([
        "show", "--format=", "--no-color", "--unified=3", &commit_hash,
    ]))?;
    Ok(parse_diff(&raw))
}

#[tauri::command]
/// Commit message body, subject excluded.
pub async fn git_commit_body(worktree_path: String, commit_hash: String) -> Result<String, GitError> {
    reject_option_like(&commit_hash)?;
    let expanded = expand(&worktree_path);
    let raw = run(git_cmd(&expanded).args([
        "show", "-s", "--format=%b", &commit_hash,
    ]))?;
    Ok(raw.trim_end().to_string())
}

// ---------------------------------------------------------------------------
// Stash
// ---------------------------------------------------------------------------

/// A stash entry; `index` is its position in the stack, which shifts on drop.
#[derive(Serialize)]
pub struct GitStash {
    pub index: usize,
    pub name: String,
    pub message: String,
    pub branch: String,
    pub date: String,
    #[serde(rename = "fileCount")]
    pub file_count: usize,
}

/// Splits a stash reflog subject into branch and message, handling both the
/// generated "WIP on" form and the "On" form of a named stash.
fn parse_stash_subject(subject: &str) -> (String, String) {
    if let Some(rest) = subject.strip_prefix("WIP on ")
        && let Some(colon_pos) = rest.find(": ") {
            let branch = rest[..colon_pos].to_string();
            let after_colon = &rest[colon_pos + 2..];
            // WIP stashes look like "<hash> <message>": drop the leading short
            // hash. When only a hash is present there is no message to show.
            let msg = after_colon
                .split_once(' ')
                .map(|(_hash, rest)| rest.to_string())
                .unwrap_or_default();
            return (branch, msg);
        }
    if let Some(rest) = subject.strip_prefix("On ")
        && let Some(colon_pos) = rest.find(": ") {
            let branch = rest[..colon_pos].to_string();
            let msg = rest[colon_pos + 2..].to_string();
            return (branch, msg);
        }
    (String::new(), subject.to_string())
}

#[tauri::command]
/// The stash stack, newest first. The file count of each entry costs one extra git call.
pub async fn git_stash_list(worktree_path: String) -> Result<Vec<GitStash>, GitError> {
    let expanded = expand(&worktree_path);
    // %gs (reflog subject) is what native `git stash list` shows and, unlike %s
    // (commit subject), reflects a rename done via `git stash store -m`.
    let raw = run(git_cmd(&expanded).args([
        "stash", "list", "--format=%gd\x1f%gs\x1f%aI",
    ]))?;
    let stashes = raw.lines()
        .filter(|l| !l.is_empty())
        .enumerate()
        .map(|(i, line)| {
            let parts: Vec<&str> = line.splitn(3, '\x1f').collect();
            let name = parts.first().unwrap_or(&"").to_string();
            let subject = parts.get(1).unwrap_or(&"").to_string();
            let date = parts.get(2).unwrap_or(&"").trim().to_string();
            let (branch, message) = parse_stash_subject(&subject);
            let file_count = run(git_cmd(&expanded).args([
                "stash", "show", "--name-only", &format!("stash@{{{i}}}"),
            ]))
            .map(|out| out.lines().filter(|l| !l.trim().is_empty()).count())
            .unwrap_or(0);
            GitStash { index: i, name, message, branch, date, file_count }
        })
        .collect();
    Ok(stashes)
}

#[tauri::command]
/// Stashes the given paths, or everything when `paths` is empty.
pub async fn git_stash_push(
    worktree_path: String,
    message: String,
    include_untracked: bool,
    keep_index: bool,
    paths: Vec<String>,
) -> Result<(), GitError> {
    let expanded = expand(&worktree_path);
    let mut cmd = git_cmd(&expanded);
    cmd.arg("stash").arg("push");
    if include_untracked { cmd.arg("--include-untracked"); }
    if keep_index { cmd.arg("--keep-index"); }
    if !message.is_empty() { cmd.args(["-m", &message]); }
    if !paths.is_empty() {
        cmd.arg("--");
        for path in &paths { cmd.arg(path); }
    }
    let out = cmd.output()?;
    if !out.status.success() {
        return Err(GitError::from_process(&out));
    }
    Ok(())
}

#[tauri::command]
/// Applies a stash and drops it.
pub async fn git_stash_pop(worktree_path: String, index: usize) -> Result<(), GitError> {
    let expanded = expand(&worktree_path);
    let stash_ref = format!("stash@{{{}}}", index);
    let out = git_cmd(&expanded).args(["stash", "pop", &stash_ref]).output()?;
    if !out.status.success() {
        return Err(GitError::from_process(&out));
    }
    Ok(())
}

#[tauri::command]
/// Applies a stash, keeping it in the stack.
pub async fn git_stash_apply(worktree_path: String, index: usize) -> Result<(), GitError> {
    let expanded = expand(&worktree_path);
    let stash_ref = format!("stash@{{{}}}", index);
    let out = git_cmd(&expanded).args(["stash", "apply", &stash_ref]).output()?;
    if !out.status.success() {
        return Err(GitError::from_process(&out));
    }
    Ok(())
}

#[tauri::command]
/// Drops a stash without applying it.
pub async fn git_stash_drop(worktree_path: String, index: usize) -> Result<(), GitError> {
    let expanded = expand(&worktree_path);
    let stash_ref = format!("stash@{{{}}}", index);
    let out = git_cmd(&expanded).args(["stash", "drop", &stash_ref]).output()?;
    if !out.status.success() {
        return Err(GitError::from_process(&out));
    }
    Ok(())
}

#[tauri::command]
/// Diff a stash would apply.
pub async fn git_stash_show(worktree_path: String, index: usize) -> Result<Vec<GitFileDiff>, GitError> {
    let expanded = expand(&worktree_path);
    let stash_ref = format!("stash@{{{}}}", index);
    let raw = run(git_cmd(&expanded).args([
        "stash", "show", "-p", "--no-color", "--unified=3", &stash_ref,
    ]))?;
    Ok(parse_diff(&raw))
}

#[tauri::command]
/// Drops every stash.
pub async fn git_stash_clear(worktree_path: String) -> Result<(), GitError> {
    let expanded = expand(&worktree_path);
    let out = git_cmd(&expanded).args(["stash", "clear"]).output()?;
    if !out.status.success() {
        return Err(GitError::from_process(&out));
    }
    Ok(())
}

#[tauri::command]
/// Relabels a stash by dropping it and re-storing the same commit; the commit is
/// put back unlabelled if the store step fails, so the stash cannot be lost.
pub async fn git_stash_rename(worktree_path: String, index: usize, message: String) -> Result<(), GitError> {
    let expanded = expand(&worktree_path);
    let stash_ref = format!("stash@{{{}}}", index);

    let sha_out = git_cmd(&expanded).args(["rev-parse", &stash_ref]).output()?;
    if !sha_out.status.success() {
        return Err(GitError::from_process(&sha_out));
    }
    let sha = String::from_utf8_lossy(&sha_out.stdout).trim().to_string();

    let drop_out = git_cmd(&expanded).args(["stash", "drop", &stash_ref]).output()?;
    if !drop_out.status.success() {
        return Err(GitError::from_process(&drop_out));
    }
    let store_out = git_cmd(&expanded).args(["stash", "store", "-m", &message, &sha]).output()?;
    if !store_out.status.success() {
        // Recovery: put the stash commit back so the rename can't lose it.
        let _ = git_cmd(&expanded).args(["stash", "store", &sha]).output();
        return Err(GitError::from_process(&store_out));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Discard
// ---------------------------------------------------------------------------

#[tauri::command]
/// Reverts a tracked file to the index, or deletes it outright when untracked.
pub async fn git_discard_file(worktree_path: String, file_path: String) -> Result<(), GitError> {
    let expanded = expand(&worktree_path);

    let tracked = git_cmd(&expanded)
        .args(["ls-files", "--error-unmatch", "--", &file_path])
        .output()?
        .status
        .success();

    if tracked {
        let out = git_cmd(&expanded)
            .args(["restore", "--worktree", "--", &file_path])
            .output()?;
        if !out.status.success() {
            return Err(GitError::from_process(&out));
        }
    } else {
        let full = Path::new(&expanded).join(&file_path);
        if full.is_dir() {
            fs::remove_dir_all(&full)?;
        } else if full.exists() {
            fs::remove_file(&full)?;
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Revert
// ---------------------------------------------------------------------------

#[tauri::command]
/// Creates a commit undoing the given one.
pub async fn git_revert_commit(worktree_path: String, commit_hash: String) -> Result<String, GitError> {
    reject_option_like(&commit_hash)?;
    let expanded = expand(&worktree_path);
    let out = git_cmd(&expanded)
        .args(["revert", "--no-edit", &commit_hash])
        .output()?;
    if !out.status.success() {
        return Err(GitError::from_process(&out));
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

#[tauri::command]
/// One page of history across all refs, each commit flagged for whether it is reachable from HEAD.
pub async fn git_log(worktree_path: String, limit: usize, offset: usize) -> Result<Vec<GitCommit>, GitError> {
    let expanded = expand(&worktree_path);

    let head_raw = run(git_cmd(&expanded).args(["log", "HEAD", "--format=%H"])).unwrap_or_default();
    let on_branch: std::collections::HashSet<String> = head_raw
        .lines()
        .filter(|l| !l.is_empty())
        .map(String::from)
        .collect();

    let raw = run(
        git_cmd(&expanded).args(["log", "--all", "--topo-order", &format!("--skip={}", offset), &format!("-{}", limit), "--format=%H%x1f%h%x1f%an%x1f%aI%x1f%s"])
    )?;

    let commits = raw
        .lines()
        .filter(|l| !l.is_empty())
        .map(|line| {
            let parts: Vec<&str> = line.splitn(5, '\x1f').collect();
            let hash = parts.first().unwrap_or(&"").to_string();
            let on_current_branch = on_branch.contains(&hash);
            GitCommit {
                hash,
                short_hash: parts.get(1).unwrap_or(&"").to_string(),
                author: parts.get(2).unwrap_or(&"").to_string(),
                date: parts.get(3).unwrap_or(&"").to_string(),
                message: parts.get(4).map(|s| s.trim_end()).unwrap_or("").to_string(),
                on_current_branch,
            }
        })
        .collect();

    Ok(commits)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU32, Ordering};

    // --- Pure parser / guard tests (no git required) -----------------------

    #[test]
    fn reject_option_like_rejects_option_like_values() {
        assert!(reject_option_like("main").is_ok());
        assert!(reject_option_like("feature/thing").is_ok());
        assert!(reject_option_like("release-1.2").is_ok());
        assert!(reject_option_like("-rf").is_err());
        assert!(reject_option_like("--upload-pack=evil").is_err());
    }

    #[test]
    fn parse_diff_extracts_path_and_lines() {
        let raw = "\
diff --git a/src/main.rs b/src/main.rs
index 1111111..2222222 100644
--- a/src/main.rs
+++ b/src/main.rs
@@ -1,3 +1,3 @@
 unchanged
-old line
+new line
";
        let files = parse_diff(raw);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].file_path, "src/main.rs");
        assert_eq!(files[0].hunks.len(), 1);
        let lines = &files[0].hunks[0].lines;
        assert_eq!(lines.len(), 3);
        assert_eq!(lines[0].kind, "context");
        assert_eq!(lines[0].content, "unchanged");
        assert_eq!(lines[1].kind, "remove");
        assert_eq!(lines[1].content, "old line");
        assert_eq!(lines[2].kind, "add");
        assert_eq!(lines[2].content, "new line");
    }

    #[test]
    fn parse_diff_keeps_body_lines_that_look_like_headers() {
        // Regression: a removed line "-- text" prints as "--- text" and an added
        // line "++ text" prints as "+++ text"; these must NOT be dropped as file
        // metadata once we are inside a hunk.
        let raw = "\
diff --git a/notes.md b/notes.md
index 1111111..2222222 100644
--- a/notes.md
+++ b/notes.md
@@ -1,2 +1,2 @@
-- removed dashes
++ added plus
";
        let files = parse_diff(raw);
        let lines = &files[0].hunks[0].lines;
        assert_eq!(lines.len(), 2, "dashed body lines must be preserved");
        assert_eq!(lines[0].kind, "remove");
        assert_eq!(lines[0].content, "- removed dashes");
        assert_eq!(lines[1].kind, "add");
        assert_eq!(lines[1].content, "+ added plus");
    }

    #[test]
    fn parse_diff_skips_no_newline_marker() {
        let raw = "\
diff --git a/f.txt b/f.txt
index 1111111..2222222 100644
--- a/f.txt
+++ b/f.txt
@@ -1 +1 @@
-a
\\ No newline at end of file
+b
";
        let files = parse_diff(raw);
        let lines = &files[0].hunks[0].lines;
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].content, "a");
        assert_eq!(lines[1].content, "b");
    }

    #[test]
    fn parse_diff_handles_multiple_files() {
        let raw = "\
diff --git a/one.txt b/one.txt
--- a/one.txt
+++ b/one.txt
@@ -0,0 +1 @@
+first
diff --git a/two.txt b/two.txt
--- a/two.txt
+++ b/two.txt
@@ -0,0 +1 @@
+second
";
        let files = parse_diff(raw);
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].file_path, "one.txt");
        assert_eq!(files[1].file_path, "two.txt");
    }

    #[test]
    fn parse_stash_subject_variants() {
        assert_eq!(
            parse_stash_subject("WIP on main: 1a2b3c4 add feature"),
            ("main".into(), "add feature".into()),
        );
        // Only a hash, no message: must not leak the hash as the message.
        assert_eq!(
            parse_stash_subject("WIP on main: 1a2b3c4"),
            ("main".into(), String::new()),
        );
        assert_eq!(
            parse_stash_subject("On feature/x: custom label"),
            ("feature/x".into(), "custom label".into()),
        );
        assert_eq!(
            parse_stash_subject("just a raw subject"),
            (String::new(), "just a raw subject".into()),
        );
    }

    // --- Integration tests against a throwaway git repo --------------------

    struct TempRepo {
        path: PathBuf,
    }

    impl TempRepo {
        fn new() -> Self {
            static COUNTER: AtomicU32 = AtomicU32::new(0);
            let n = COUNTER.fetch_add(1, Ordering::SeqCst);
            let path = std::env::temp_dir()
                .join(format!("cairn-git-test-{}-{}", std::process::id(), n));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).unwrap();
            let repo = TempRepo { path };
            repo.git(&["init", "-q"]);
            repo.git(&["config", "user.name", "Test"]);
            repo.git(&["config", "user.email", "test@example.com"]);
            repo.git(&["config", "commit.gpgsign", "false"]);
            repo
        }

        fn wt(&self) -> String {
            self.path.to_string_lossy().to_string()
        }

        fn git(&self, args: &[&str]) -> std::process::Output {
            Command::new("git")
                .current_dir(&self.path)
                .args(args)
                .output()
                .expect("git should be runnable")
        }

        fn write(&self, rel: &str, content: &str) {
            let p = self.path.join(rel);
            if let Some(parent) = p.parent() {
                fs::create_dir_all(parent).unwrap();
            }
            fs::write(p, content).unwrap();
        }

        fn commit(&self, rel: &str, content: &str, message: &str) {
            self.write(rel, content);
            self.git(&["add", rel]);
            self.git(&["commit", "-q", "-m", message]);
        }
    }

    impl Drop for TempRepo {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[tokio::test]
    async fn git_status_categorizes_entries() {
        let repo = TempRepo::new();
        repo.commit("tracked.txt", "one\n", "init");

        repo.write("tracked.txt", "two\n"); // modified, unstaged
        repo.write("untracked.txt", "new\n"); // untracked
        repo.write("staged.txt", "add\n");
        repo.git(&["add", "staged.txt"]); // staged addition

        let status = git_status(repo.wt()).await.unwrap();
        assert_eq!(status.get("tracked.txt").map(String::as_str), Some("modified"));
        assert_eq!(status.get("untracked.txt").map(String::as_str), Some("untracked"));
        assert_eq!(status.get("staged.txt").map(String::as_str), Some("staged-added"));
    }

    #[tokio::test]
    async fn discard_untracked_file_deletes_it() {
        let repo = TempRepo::new();
        repo.commit("a.txt", "a\n", "init");
        repo.write("untracked.txt", "junk\n");
        assert!(repo.path.join("untracked.txt").exists());

        git_discard_file(repo.wt(), "untracked.txt".into()).await.unwrap();

        assert!(
            !repo.path.join("untracked.txt").exists(),
            "discarding an untracked file must remove it"
        );
    }

    #[tokio::test]
    async fn discard_tracked_file_reverts_to_head() {
        let repo = TempRepo::new();
        repo.commit("a.txt", "original\n", "init");
        repo.write("a.txt", "modified\n");

        git_discard_file(repo.wt(), "a.txt".into()).await.unwrap();

        let restored = fs::read_to_string(repo.path.join("a.txt")).unwrap();
        assert_eq!(restored, "original\n");
    }

    #[tokio::test]
    async fn stash_rename_relabels_without_losing_the_stash() {
        let repo = TempRepo::new();
        repo.commit("a.txt", "one\n", "init");
        repo.write("a.txt", "two\n");

        git_stash_push(repo.wt(), "old label".into(), false, false, vec![]).await.unwrap();
        let before = git_stash_list(repo.wt()).await.unwrap();
        assert_eq!(before.len(), 1);
        assert_eq!(before[0].message, "old label");

        git_stash_rename(repo.wt(), 0, "new label".into()).await.unwrap();

        let after = git_stash_list(repo.wt()).await.unwrap();
        assert_eq!(after.len(), 1, "rename must not lose or duplicate the stash");
        assert_eq!(after[0].message, "new label");
    }

    #[tokio::test]
    async fn diff_unstaged_reports_worktree_changes() {
        let repo = TempRepo::new();
        repo.commit("a.txt", "line one\n", "init");
        repo.write("a.txt", "line one changed\n");

        let files = git_diff_unstaged(repo.wt()).await.unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].file_path, "a.txt");
        let kinds: Vec<&str> = files[0].hunks[0].lines.iter().map(|l| l.kind.as_str()).collect();
        assert!(kinds.contains(&"remove"));
        assert!(kinds.contains(&"add"));
    }

    #[tokio::test]
    async fn run_propagates_git_failure() {
        let repo = TempRepo::new();
        repo.commit("a.txt", "a\n", "init");
        // A syntactically valid but nonexistent revision must surface as Err,
        // not a silent empty-but-ok result.
        assert!(git_diff_commit(repo.wt(), "deadbeefdeadbeef".into()).await.is_err());
    }

    #[tokio::test]
    async fn checkout_rejects_dash_prefixed_ref() {
        let repo = TempRepo::new();
        repo.commit("a.txt", "a\n", "init");
        assert!(git_checkout_branch(repo.wt(), "-rf".into()).await.is_err());
    }
}
