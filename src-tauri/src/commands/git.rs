//! Git operations for the review, history and branch views. Everything shells out
//! to the `git` binary except a few reads served by `git2`.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use std::process::Command;
use std::sync::{LazyLock, Mutex};
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
    /// Set when the file held more lines than `DIFF_MAX_LINES_PER_FILE` and the
    /// rest was dropped, so the view can say so rather than show a partial diff
    /// as if it were the whole change.
    #[serde(rename = "truncated", skip_serializing_if = "std::ops::Not::not")]
    pub truncated: bool,
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
/// Lines kept per file. The git view polls unstaged and staged diffs every few
/// seconds while it is open, and each one crosses the IPC boundary as JSON: a
/// worktree carrying a generated file, a lockfile or a vendored tree produces
/// megabytes nobody reads past the first screen of. Whatever sits beyond this
/// is dropped and the file is flagged truncated.
const DIFF_MAX_LINES_PER_FILE: usize = 20_000;

fn parse_diff(raw: &str) -> Vec<GitFileDiff> {
    let mut files: Vec<GitFileDiff> = Vec::new();
    let mut current_file: Option<GitFileDiff> = None;
    let mut current_hunk: Option<GitDiffHunk> = None;
    let mut lines_in_file: usize = 0;

    for line in raw.lines() {
        if line.starts_with("diff --git ") {
            lines_in_file = 0;
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
            current_file =
                Some(GitFileDiff { file_path: path, hunks: Vec::new(), truncated: false });
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
            if lines_in_file >= DIFF_MAX_LINES_PER_FILE {
                if let Some(ref mut f) = current_file {
                    f.truncated = true;
                }
                continue;
            }
            lines_in_file += 1;
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

/// A candidate base branch for an existing branch, and why it was proposed.
#[derive(Serialize)]
pub struct BaseSuggestion {
    /// The branch name, as it would be stored on the instance.
    pub branch: String,
    /// `merge` when a merge commit names it, `fork` when only the fork point
    /// points at it. The caller shows the stronger one first.
    pub reason: String,
    /// Commits the branch carries since it forked from this candidate: the
    /// smaller, the closer the fork.
    pub distance: usize,
}

/// Candidate bases for `branch`, best first.
///
/// Git does not record where a branch was cut from, so this is inference, never
/// a fact: the caller offers the result as a prefill the user can overrule, and
/// must not store it silently. Two signals are used - a `Merge branch 'x'`
/// commit on the branch, which is explicit, and the fork point, which is not.
#[tauri::command]
pub async fn suggest_base_branches(
    project_path: String,
    branch: String,
) -> Result<Vec<BaseSuggestion>, GitError> {
    reject_option_like(&branch)?;
    let expanded = expand(&project_path);

    // Branches that merged into this one are named outright in the subject, so
    // they beat anything the topology merely suggests.
    let merged: Vec<String> = run(git_cmd(&expanded).args([
        "log", "--merges", "--pretty=%s", "-n", "50", &branch,
    ]))
    .unwrap_or_default()
    .lines()
    .filter_map(|line| {
        let rest = line.strip_prefix("Merge branch '")?;
        let name = rest.split('\'').next()?;
        (!name.is_empty() && name != branch).then(|| name.to_string())
    })
    .collect();

    let remotes: Vec<String> = run(git_cmd(&expanded).args(["remote"]))
        .unwrap_or_default()
        .lines()
        .map(|r| r.trim().to_string())
        .filter(|r| !r.is_empty())
        .collect();

    let candidates = run(git_cmd(&expanded).args([
        "for-each-ref", "--format=%(refname:short)",
        "refs/heads", "refs/remotes",
    ]))
    .unwrap_or_default();

    let mut out: Vec<BaseSuggestion> = Vec::new();
    for candidate in candidates.lines() {
        let candidate = candidate.trim();
        // A branch is never its own base, and `origin/HEAD` is a pointer.
        // A bare remote name (`origin`) is the remote's own HEAD alias, not a
        // branch anyone bases work on.
        if candidate.is_empty()
            || candidate.ends_with("/HEAD")
            || !candidate.contains('/') && remotes.iter().any(|r| r == candidate)
            || candidate == branch
            || candidate.trim_start_matches("origin/") == branch
        {
            continue;
        }
        let Ok(merge_base) = run(git_cmd(&expanded).args(["merge-base", candidate, &branch]))
        else {
            continue;
        };
        let merge_base = merge_base.trim();
        if merge_base.is_empty() {
            continue;
        }
        // An unrelated line shares no history worth calling a base.
        let Ok(count) = run(git_cmd(&expanded).args([
            "rev-list", "--count", &format!("{merge_base}..{branch}"),
        ])) else {
            continue;
        };
        let Ok(distance) = count.trim().parse::<usize>() else { continue };
        let short = candidate.trim_start_matches("origin/");
        let reason = if merged.iter().any(|m| m == short || m == candidate) {
            "merge"
        } else {
            "fork"
        };
        out.push(BaseSuggestion {
            branch: candidate.to_string(),
            reason: reason.to_string(),
            distance,
        });
    }

    // An explicit merge wins; within a reason, the nearest fork point wins.
    out.sort_by(|a, b| match (a.reason.as_str(), b.reason.as_str()) {
        ("merge", "fork") => std::cmp::Ordering::Less,
        ("fork", "merge") => std::cmp::Ordering::Greater,
        _ => a.distance.cmp(&b.distance),
    });
    out.truncate(5);
    Ok(out)
}

/// Paths already proven to be worktree roots. The status poll revalidates on every
/// tick a property that only changes when the worktree is created or removed, and
/// each check costs a git process plus two canonicalisations. Only the positive is
/// cached: a path becomes a root when its instance is created, so caching a "no"
/// would leave that instance without git for the rest of the session. A root that
/// is later removed fails its `is_dir` guard here.
static REPO_ROOTS: LazyLock<Mutex<HashSet<String>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

/// True only when the path is itself a worktree root, not merely nested in a parent repository.
fn is_repo_root(expanded: &str) -> Result<bool, GitError> {
    if !Path::new(expanded).is_dir() {
        forget_repo_root(expanded);
        return Ok(false);
    }

    if REPO_ROOTS
        .lock()
        .is_ok_and(|roots| roots.contains(expanded))
    {
        return Ok(true);
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
    let is_root = match (fs::canonicalize(expanded), fs::canonicalize(&toplevel)) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    };
    if is_root
        && let Ok(mut roots) = REPO_ROOTS.lock()
    {
        roots.insert(expanded.to_string());
    }
    Ok(is_root)
}

/// Drops a path from the proven-roots set, so a worktree that goes away is rechecked.
fn forget_repo_root(expanded: &str) {
    if let Ok(mut roots) = REPO_ROOTS.lock() {
        roots.remove(expanded);
    }
}

#[tauri::command]
/// Whether the path is a worktree root.
pub async fn is_git_repo(worktree_path: String) -> Result<bool, GitError> {
    is_repo_root(&expand(&worktree_path))
}

/// Reads `status --porcelain -u` once. Both the category map and the changed
/// paths derive from this single output, so a caller wanting both pays for one
/// git process instead of two.
fn read_porcelain(worktree_path: &str) -> Result<Option<String>, GitError> {
    let expanded = expand(worktree_path);
    let output = git_cmd(&expanded)
        .args(["status", "--porcelain", "-u"])
        .output()?;

    if !output.status.success() {
        return Ok(None);
    }

    Ok(Some(String::from_utf8_lossy(&output.stdout).into_owned()))
}

/// Maps porcelain lines to one category per file (untracked, deleted, conflicted,
/// staged-*, modified). Renames are reported under their destination path.
fn parse_status(text: &str) -> HashMap<String, String> {
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

    map
}

#[tauri::command]
/// Porcelain status mapped to one category per file.
pub async fn git_status(worktree_path: String) -> Result<HashMap<String, String>, GitError> {
    Ok(read_porcelain(&worktree_path)?
        .map(|text| parse_status(&text))
        .unwrap_or_default())
}

/// Which paths have staged and unstaged changes, without any diff content.
#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct GitChangedPaths {
    pub staged: Vec<String>,
    pub unstaged: Vec<String>,
}

/// The paths behind the change badges. `parse_status` collapses the index and the
/// worktree column into one category, so a file that is both staged and
/// modified would be counted once; this keeps the two columns apart while
/// staying far cheaper than reading both full diffs.
fn parse_changed_paths(text: &str) -> GitChangedPaths {
    let mut changed = GitChangedPaths::default();

    for line in text.lines() {
        if line.len() < 4 { continue; }
        let x = line.chars().next().unwrap_or(' ');
        let y = line.chars().nth(1).unwrap_or(' ');
        let path = line[3..].trim_end();
        let file_path = path.split(" -> ").last().unwrap_or(path).to_string();

        if x == '?' && y == '?' {
            changed.unstaged.push(file_path);
            continue;
        }
        if x != ' ' {
            changed.staged.push(file_path.clone());
        }
        if y != ' ' {
            changed.unstaged.push(file_path);
        }
    }

    changed
}

#[tauri::command]
/// The paths behind the change badges, on their own.
pub async fn git_changed_paths(worktree_path: String) -> Result<GitChangedPaths, GitError> {
    Ok(read_porcelain(&worktree_path)?
        .map(|text| parse_changed_paths(&text))
        .unwrap_or_default())
}

/// Everything the status poll needs, from a single `status --porcelain -u`.
#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusFull {
    pub is_git_repo: bool,
    pub status: HashMap<String, String>,
    pub changed_paths: GitChangedPaths,
}

#[tauri::command]
/// Status, changed paths and the repository check in one call. The poll runs
/// every few seconds and used to spawn three git processes for this, two of them
/// running the very same porcelain command.
pub async fn git_status_full(worktree_path: String) -> Result<GitStatusFull, GitError> {
    if !is_repo_root(&expand(&worktree_path))? {
        return Ok(GitStatusFull::default());
    }

    let Some(text) = read_porcelain(&worktree_path)? else {
        return Ok(GitStatusFull { is_git_repo: true, ..Default::default() });
    };

    Ok(GitStatusFull {
        is_git_repo: true,
        status: parse_status(&text),
        changed_paths: parse_changed_paths(&text),
    })
}

/// Everything the status poll needs, in one round trip. Branch and upstream
/// counts come from git2 without a process; the status itself still goes
/// through porcelain so its codes stay exactly what parse_status expects.
/// `version` hashes the content: a caller passing the version it already
/// holds gets `None` back when nothing changed, and parses nothing.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitSnapshot {
    pub version:         u64,
    pub status:          GitStatusFull,
    pub current_branch:  String,
    pub remote_status:   RemoteStatus,
    pub operation_state: GitOperationState,
}

fn head_branch_git2(expanded: &str) -> Option<String> {
    let repo = git2::Repository::open(expanded).ok()?;
    let head = repo.find_reference("HEAD").ok()?;
    let target = head.symbolic_target().ok().flatten()?;
    Some(target.strip_prefix("refs/heads/").unwrap_or(target).to_string())
}

fn remote_status_git2(expanded: &str) -> RemoteStatus {
    let none = RemoteStatus { ahead: 0, behind: 0, remote: String::new(), has_upstream: false };
    let Ok(repo) = git2::Repository::open(expanded) else { return none };
    let Ok(head) = repo.head() else { return none };
    if !head.is_branch() {
        return none;
    }
    let branch = git2::Branch::wrap(head);
    let Ok(upstream) = branch.upstream() else { return none };
    let remote = upstream.name().ok().flatten().unwrap_or("").to_string();
    let (Some(local), Some(up)) = (branch.get().target(), upstream.get().target()) else { return none };
    match repo.graph_ahead_behind(local, up) {
        Ok((ahead, behind)) => RemoteStatus { ahead, behind, remote, has_upstream: true },
        Err(_) => none,
    }
}

#[tauri::command]
pub async fn git_snapshot(worktree_path: String, known_version: u64) -> Result<Option<GitSnapshot>, GitError> {
    let expanded = expand(&worktree_path);
    let status = git_status_full(worktree_path.clone()).await?;
    let mut snapshot = GitSnapshot {
        version:         0,
        current_branch:  if status.is_git_repo { head_branch_git2(&expanded).unwrap_or_default() } else { String::new() },
        remote_status:   if status.is_git_repo { remote_status_git2(&expanded) } else { remote_status_git2("") },
        operation_state: git_operation_state(worktree_path).await?,
        status,
    };
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    std::hash::Hash::hash(&serde_json::to_string(&snapshot).unwrap_or_default(), &mut hasher);
    snapshot.version = std::hash::Hasher::finish(&hasher);
    Ok((snapshot.version != known_version).then_some(snapshot))
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
// Exclude (.git/info/exclude)
// ---------------------------------------------------------------------------

/// Absolute path of `info/exclude` in the repository's common git dir, so it
/// resolves to the same file from any worktree of the repo.
fn exclude_path(worktree_path: &str) -> Result<std::path::PathBuf, GitError> {
    let expanded = expand(worktree_path);
    let common = run(git_cmd(&expanded).args(["rev-parse", "--path-format=absolute", "--git-common-dir"]))?
        .trim()
        .to_string();
    if common.is_empty() {
        return Err(GitError::new("not_a_repo", format!("Not a git repository: {worktree_path}")));
    }
    Ok(Path::new(&common).join("info").join("exclude"))
}

#[tauri::command]
/// Contents of the repository-local ignore file, empty when it does not exist yet.
pub async fn git_read_exclude(worktree_path: String) -> Result<String, GitError> {
    let path = exclude_path(&worktree_path)?;
    match fs::read_to_string(&path) {
        Ok(text) => Ok(text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(e.into()),
    }
}

#[tauri::command]
/// Replaces the repository-local ignore file, creating `info/` if needed.
pub async fn git_write_exclude(worktree_path: String, content: String) -> Result<(), GitError> {
    let path = exclude_path(&worktree_path)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut next = content;
    if !next.is_empty() && !next.ends_with('\n') {
        next.push('\n');
    }
    fs::write(&path, next)?;
    Ok(())
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

/// Both diffs the git view shows, behind a version hashed from the raw diff
/// text: a poll that holds the version gets `None` back, and nothing is parsed
/// or serialised for a change that did not happen.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffs {
    pub version:  u64,
    pub unstaged: Vec<GitFileDiff>,
    pub staged:   Vec<GitFileDiff>,
}

#[tauri::command]
pub async fn git_diffs(worktree_path: String, known_version: u64) -> Result<Option<GitDiffs>, GitError> {
    let expanded = expand(&worktree_path);
    let unstaged = run(git_cmd(&expanded).args(["diff", "--no-color", "--unified=3"]))?;
    let staged = run(git_cmd(&expanded).args(["diff", "--cached", "--no-color", "--unified=3"]))?;
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    std::hash::Hash::hash(&unstaged, &mut hasher);
    std::hash::Hash::hash(&staged, &mut hasher);
    let version = std::hash::Hasher::finish(&hasher).max(1);
    if version == known_version {
        return Ok(None);
    }
    Ok(Some(GitDiffs { version, unstaged: parse_diff(&unstaged), staged: parse_diff(&staged) }))
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

/// Files past this are not blamed: the walk costs more than the status bar line is worth.
const MAX_BLAME_BYTES: u64 = 1024 * 1024;

/// One line's blame, already reduced to what the status bar shows.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BlameLine {
    pub line: u32,
    pub hash: String,
    pub author: String,
    pub timestamp: i64,
    pub summary: String,
}

#[tauri::command]
/// Blame for the whole file, one entry per line. The `--line-porcelain` output
/// is parsed here rather than sent across: it repeats the full commit header
/// for every line and reaches megabytes on a large file, while the four fields
/// below are all the editor displays.
///
/// Blaming a large file is charged against the history behind every one of its
/// lines, so it grows with the depth of the repository, not just the file. Past
/// the size guard the status bar simply shows no blame rather than stalling the
/// tab that is opening.
pub async fn git_blame_file(worktree_path: String, file_path: String) -> Result<Vec<BlameLine>, GitError> {
    let expanded = expand(&worktree_path);
    let full = std::path::Path::new(&expanded).join(&file_path);
    if let Ok(meta) = std::fs::metadata(&full) {
        if meta.len() > MAX_BLAME_BYTES {
            return Ok(Vec::new());
        }
    }
    let raw = run(git_cmd(&expanded).args(["blame", "--line-porcelain", "--", &file_path]))?;
    Ok(parse_blame_porcelain(&raw))
}

/// Reads `--line-porcelain` blocks; a field git omitted stays empty and the
/// frontend substitutes its placeholder.
fn parse_blame_porcelain(raw: &str) -> Vec<BlameLine> {
    let mut out = Vec::new();
    let mut lines = raw.lines().peekable();

    while let Some(header) = lines.next() {
        let mut parts = header.split(' ');
        let Some(hash) = parts.next() else { continue };
        if hash.len() != 40 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
            continue;
        }
        let Some(line_no) = parts.nth(1).and_then(|n| n.parse::<u32>().ok()) else { continue };

        let mut author = String::new();
        let mut timestamp = 0i64;
        let mut summary = String::new();
        while let Some(field) = lines.peek() {
            if field.starts_with('\t') {
                lines.next();
                break;
            }
            let field = lines.next().unwrap_or_default();
            if let Some(v) = field.strip_prefix("author ") {
                author = v.to_string();
            } else if let Some(v) = field.strip_prefix("author-time ") {
                timestamp = v.parse().unwrap_or(0);
            } else if let Some(v) = field.strip_prefix("summary ") {
                summary = v.to_string();
            }
        }

        out.push(BlameLine {
            line: line_no,
            hash: hash[..7].to_string(),
            author,
            timestamp,
            summary,
        });
    }
    out
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
pub async fn git_push(worktree_path: String, set_upstream: bool, branch: String, force: bool, mode: Option<String>) -> Result<String, GitError> {
    reject_option_like(&branch)?;
    let expanded = expand(&worktree_path);
    let mut args = vec!["push"];

    // `force` stays for the plain button; `mode` is what the dropdown picks.
    match mode.as_deref() {
        Some("force") => args.push("--force"),
        Some("force-with-lease") => args.push("--force-with-lease"),
        _ if force => args.push("--force-with-lease"),
        _ => {}
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
pub async fn git_pull(worktree_path: String, mode: Option<String>) -> Result<GitOpResult, GitError> {
    let expanded = expand(&worktree_path);
    let strategy = match mode.as_deref() {
        Some("merge") => "--no-rebase",
        Some("ff-only") => "--ff-only",
        _ => "--rebase",
    };
    let out = git_cmd(&expanded)
        .env("GIT_EDITOR", "true")
        .args(["pull", strategy])
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
        // `--all` covers heads and remotes but not tags: without `--tags` a
        // commit only a tag points at is missing from the graph entirely.
        "log", "--all", "--tags", "--topo-order",
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
// Diff between two refs
// ---------------------------------------------------------------------------

/// A file changed between two refs, as listed by the review step.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChangedFile {
    pub file_path: String,
    /// `A`, `M` or `D`.
    pub status: String,
    pub additions: usize,
    pub deletions: usize,
}

/// Both sides of one file between two refs; `None` when the file is absent on that side.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileBetween {
    pub old_content: Option<String>,
    pub new_content: Option<String>,
}

fn three_dot_range(base: &str, head: &str) -> String {
    format!("{base}...{head}")
}

#[tauri::command]
/// Files changed by `base...head` with their line counts, in git's order.
pub async fn git_diff_files_between(
    worktree_path: String,
    base: String,
    head: String,
) -> Result<Vec<GitChangedFile>, GitError> {
    reject_option_like(&base)?;
    reject_option_like(&head)?;
    let expanded = expand(&worktree_path);
    let range = three_dot_range(&base, &head);
    let statuses = run(git_cmd(&expanded).args([
        "diff", "--name-status", "--no-renames", "--no-color", &range,
    ]))?;
    let numstats = run(git_cmd(&expanded).args([
        "diff", "--numstat", "--no-renames", "--no-color", &range,
    ]))?;
    let mut counts: std::collections::HashMap<String, (usize, usize)> = std::collections::HashMap::new();
    for line in numstats.lines() {
        let mut parts = line.splitn(3, '\t');
        let added = parts.next().and_then(|v| v.parse().ok()).unwrap_or(0);
        let deleted = parts.next().and_then(|v| v.parse().ok()).unwrap_or(0);
        if let Some(path) = parts.next() {
            counts.insert(path.to_string(), (added, deleted));
        }
    }
    Ok(statuses
        .lines()
        .filter_map(|line| {
            let mut parts = line.splitn(2, '\t');
            let status = parts.next()?.chars().next()?.to_string();
            let path = parts.next()?.to_string();
            let (additions, deletions) = counts.get(&path).copied().unwrap_or((0, 0));
            Some(GitChangedFile { file_path: path, status, additions, deletions })
        })
        .collect())
}

fn show_at(worktree: &str, rev: &str, file_path: &str) -> Result<Option<String>, GitError> {
    let output = git_cmd(worktree)
        .args(["show", &format!("{rev}:{file_path}")])
        .output()?;
    if !output.status.success() {
        return Ok(None);
    }
    Ok(Some(String::from_utf8_lossy(&output.stdout).to_string()))
}

#[tauri::command]
/// One file on both sides of `base...head`: the merge base of the two refs and `head`.
pub async fn git_diff_file_between(
    worktree_path: String,
    base: String,
    head: String,
    file_path: String,
) -> Result<GitFileBetween, GitError> {
    reject_option_like(&base)?;
    reject_option_like(&head)?;
    let expanded = expand(&worktree_path);
    let merge_base = run(git_cmd(&expanded).args(["merge-base", &base, &head]))?;
    let merge_base = merge_base.trim();
    Ok(GitFileBetween {
        old_content: show_at(&expanded, merge_base, &file_path)?,
        new_content: show_at(&expanded, &head, &file_path)?,
    })
}

#[tauri::command]
/// Whether the commit is present in the worktree's object store.
pub async fn git_commit_exists(worktree_path: String, commit_hash: String) -> Result<bool, GitError> {
    reject_option_like(&commit_hash)?;
    let expanded = expand(&worktree_path);
    let output = git_cmd(&expanded)
        .args(["cat-file", "-e", &format!("{commit_hash}^{{commit}}")])
        .output()?;
    Ok(output.status.success())
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
// Tags
// ---------------------------------------------------------------------------

/// A tag, with the commit it points at. An annotated tag carries its own
/// message and tagger; a lightweight one is just a name on a commit.
#[derive(Serialize)]
pub struct GitTag {
    pub name: String,
    pub hash: String,
    #[serde(rename = "shortHash")]
    pub short_hash: String,
    pub subject: String,
    pub message: String,
    pub date: String,
    pub tagger: String,
    pub annotated: bool,
}

/// Every tag in the worktree, most recent first.
#[tauri::command]
pub async fn git_tag_list(worktree_path: String) -> Result<Vec<GitTag>, GitError> {
    let expanded = expand(&worktree_path);
    // `creatordate` sorts annotated and lightweight tags alike; `*objectname`
    // dereferences an annotated tag to the commit it points at, which the bare
    // `objectname` would report as the tag object itself.
    //
    // An annotated tag's body carries its own newlines, so records are split on
    // a trailing RS rather than on line breaks: one tag is not one line.
    //
    // The date is `iso-strict`, not `iso`: the latter's "2026-08-30 12:06:42
    // +0200" is not ISO 8601 and the webview parses it as an invalid date.
    let out = run(git_cmd(&expanded).args([
        "for-each-ref",
        "--sort=-creatordate",
        "--format=%(refname:short)\x1f%(objecttype)\x1f%(objectname)\x1f%(*objectname)\x1f%(creatordate:iso-strict)\x1f%(taggername)\x1f%(subject)\x1f%(contents:body)\x1e",
        "refs/tags",
    ]))?;

    let tags = out
        .split('\x1e')
        .map(|record| record.trim_start_matches('\n'))
        .filter(|record| !record.trim().is_empty())
        .map(|record| {
            let parts: Vec<&str> = record.splitn(8, '\x1f').collect();
            let annotated = parts.get(1).copied().unwrap_or("") == "tag";
            let tag_object = parts.get(2).copied().unwrap_or("");
            let peeled = parts.get(3).copied().unwrap_or("");
            let hash = if annotated && !peeled.is_empty() {
                peeled
            } else {
                tag_object
            };
            GitTag {
                name: parts.first().copied().unwrap_or("").to_string(),
                hash: hash.to_string(),
                short_hash: hash.chars().take(7).collect(),
                subject: parts.get(6).copied().unwrap_or("").to_string(),
                message: parts.get(7).map(|s| s.trim_end()).unwrap_or("").to_string(),
                date: parts.get(4).copied().unwrap_or("").to_string(),
                tagger: parts.get(5).copied().unwrap_or("").to_string(),
                annotated,
            }
        })
        .collect();

    Ok(tags)
}

/// Creates a tag on `commit_hash`, or on HEAD when it is empty. A non-empty
/// `message` makes it annotated.
#[tauri::command]
pub async fn git_tag_create(
    worktree_path: String,
    name: String,
    message: String,
    commit_hash: String,
) -> Result<(), GitError> {
    let expanded = expand(&worktree_path);
    reject_option_like(&name)?;

    let mut args: Vec<String> = vec!["tag".into()];
    if !message.trim().is_empty() {
        args.push("-a".into());
        args.push("-m".into());
        args.push(message);
    }
    args.push(name);
    if !commit_hash.trim().is_empty() {
        reject_option_like(&commit_hash)?;
        args.push(commit_hash);
    }

    let out = git_cmd(&expanded).args(&args).output()?;
    if !out.status.success() {
        return Err(GitError::from_process(&out));
    }
    Ok(())
}

/// Deletes a tag locally. The remote keeps its own copy until it is deleted too.
#[tauri::command]
pub async fn git_tag_delete(worktree_path: String, name: String) -> Result<(), GitError> {
    let expanded = expand(&worktree_path);
    reject_option_like(&name)?;
    let out = git_cmd(&expanded).args(["tag", "-d", &name]).output()?;
    if !out.status.success() {
        return Err(GitError::from_process(&out));
    }
    Ok(())
}

/// Pushes one tag to `remote`.
#[tauri::command]
pub async fn git_tag_push(
    worktree_path: String,
    remote: String,
    name: String,
) -> Result<(), GitError> {
    let expanded = expand(&worktree_path);
    reject_option_like(&name)?;
    reject_option_like(&remote)?;
    let out = git_cmd(&expanded)
        .args(["push", &remote, &format!("refs/tags/{name}")])
        .output()?;
    if !out.status.success() {
        return Err(GitError::from_process(&out));
    }
    Ok(())
}

/// Deletes a tag on `remote`, leaving the local one alone.
#[tauri::command]
pub async fn git_tag_delete_remote(
    worktree_path: String,
    remote: String,
    name: String,
) -> Result<(), GitError> {
    let expanded = expand(&worktree_path);
    reject_option_like(&name)?;
    reject_option_like(&remote)?;
    let out = git_cmd(&expanded)
        .args(["push", &remote, "--delete", &format!("refs/tags/{name}")])
        .output()?;
    if !out.status.success() {
        return Err(GitError::from_process(&out));
    }
    Ok(())
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
    fn parse_blame_porcelain_keeps_one_entry_per_line() {
        let raw = "\
1111111111111111111111111111111111111111 1 1 2
author Ada
author-mail <ada@example.com>
author-time 1700000000
author-tz +0000
summary first commit
filename a.txt
\tfirst line
1111111111111111111111111111111111111111 2 2
\tsecond line
2222222222222222222222222222222222222222 3 3 1
author Grace
author-time 1800000000
summary later change
filename a.txt
\tthird line
";
        let blame = parse_blame_porcelain(raw);
        assert_eq!(blame.len(), 3);

        assert_eq!(blame[0].line, 1);
        assert_eq!(blame[0].hash, "1111111");
        assert_eq!(blame[0].author, "Ada");
        assert_eq!(blame[0].timestamp, 1700000000);
        assert_eq!(blame[0].summary, "first commit");

        // A repeated commit prints only the header, so the fields stay empty and
        // the frontend substitutes its placeholders.
        assert_eq!(blame[1].line, 2);
        assert_eq!(blame[1].hash, "1111111");
        assert_eq!(blame[1].author, "");

        assert_eq!(blame[2].line, 3);
        assert_eq!(blame[2].author, "Grace");
        assert_eq!(blame[2].summary, "later change");
    }

    #[test]
    fn parse_blame_porcelain_does_not_read_author_time_as_author() {
        let raw = "\
1111111111111111111111111111111111111111 1 1 1
author-time 1700000000
author-mail <ada@example.com>
\tline
";
        let blame = parse_blame_porcelain(raw);
        assert_eq!(blame[0].author, "");
        assert_eq!(blame[0].timestamp, 1700000000);
    }

    #[test]
    fn parse_blame_porcelain_skips_lines_that_are_not_headers() {
        assert!(parse_blame_porcelain("not a blame header\n").is_empty());
        assert!(parse_blame_porcelain("").is_empty());
        // 40 characters, but not hex.
        assert!(parse_blame_porcelain("zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz 1 1 1\n").is_empty());
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
    fn parse_diff_truncates_a_file_that_changed_too_much() {
        let mut raw = String::from(
            "diff --git a/big.txt b/big.txt\n--- a/big.txt\n+++ b/big.txt\n@@ -0,0 +1 @@\n",
        );
        for i in 0..(DIFF_MAX_LINES_PER_FILE + 500) {
            raw.push_str(&format!("+line {i}\n"));
        }
        // A second file must start with a clean budget rather than inherit the
        // first one's.
        raw.push_str("diff --git a/small.txt b/small.txt\n--- a/small.txt\n+++ b/small.txt\n@@ -0,0 +1 @@\n+only line\n");

        let files = parse_diff(&raw);
        assert_eq!(files.len(), 2);
        assert!(files[0].truncated);
        let kept: usize = files[0].hunks.iter().map(|h| h.lines.len()).sum();
        assert_eq!(kept, DIFF_MAX_LINES_PER_FILE);
        assert!(!files[1].truncated);
        assert_eq!(files[1].hunks[0].lines.len(), 1);
    }

    #[test]
    fn parse_diff_leaves_an_ordinary_file_untruncated() {
        let raw = "\
diff --git a/f.txt b/f.txt
--- a/f.txt
+++ b/f.txt
@@ -0,0 +1 @@
+one
";
        let files = parse_diff(raw);
        assert!(!files[0].truncated);
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
    async fn tag_list_reports_lightweight_and_annotated_tags() {
        let repo = TempRepo::new();
        repo.commit("a.txt", "one\n", "first");

        git_tag_create(repo.wt(), "v0.1.0".into(), String::new(), String::new())
            .await
            .unwrap();
        repo.commit("b.txt", "two\n", "second");
        git_tag_create(
            repo.wt(),
            "v0.2.0".into(),
            "the second release".into(),
            String::new(),
        )
        .await
        .unwrap();

        let tags = git_tag_list(repo.wt()).await.unwrap();
        assert_eq!(tags.len(), 2);

        let annotated = tags.iter().find(|t| t.name == "v0.2.0").unwrap();
        assert!(annotated.annotated);
        assert_eq!(annotated.subject, "the second release");

        let lightweight = tags.iter().find(|t| t.name == "v0.1.0").unwrap();
        assert!(!lightweight.annotated);

        // An annotated tag must report the commit it points at, not the tag
        // object, so both tags resolve to a real commit in the log.
        let head = run(git_cmd(&repo.wt()).args(["rev-parse", "HEAD"])).unwrap();
        assert_eq!(annotated.hash, head.trim());
        assert_eq!(annotated.short_hash.len(), 7);

        git_tag_delete(repo.wt(), "v0.1.0".into()).await.unwrap();
        let after = git_tag_list(repo.wt()).await.unwrap();
        assert_eq!(after.len(), 1);
        assert_eq!(after[0].name, "v0.2.0");
    }

    /// An annotated tag's body carries newlines: splitting the output on lines
    /// turned one tag into several bogus entries, which inflated the count and
    /// left the list unusable.
    #[tokio::test]
    async fn tag_list_keeps_one_entry_per_tag_with_a_multiline_message() {
        let repo = TempRepo::new();
        repo.commit("a.txt", "one\n", "first");

        repo.git(&["tag", "-a", "v1.0.0", "-m", "title\n\nbody over\nseveral lines"]);
        repo.git(&["tag", "v1.0.1"]);

        let tags = git_tag_list(repo.wt()).await.unwrap();
        assert_eq!(tags.len(), 2);

        let names: Vec<&str> = tags.iter().map(|t| t.name.as_str()).collect();
        assert!(names.contains(&"v1.0.0"));
        assert!(names.contains(&"v1.0.1"));

        let annotated = tags.iter().find(|t| t.name == "v1.0.0").unwrap();
        assert_eq!(annotated.subject, "title");
        // ISO 8601, the only form the webview parses: "YYYY-MM-DDTHH:MM:SS+HH:MM".
        assert!(
            annotated.date.contains('T'),
            "date must be iso-strict, got {}",
            annotated.date
        );
        assert!(annotated.message.contains("several lines"));
        // Every entry must still resolve to a real commit, not to a body fragment.
        assert!(tags.iter().all(|t| t.hash.len() == 40));
    }

    #[tokio::test]
    async fn tag_create_rejects_an_option_like_name() {
        let repo = TempRepo::new();
        repo.commit("a.txt", "one\n", "first");
        assert!(
            git_tag_create(repo.wt(), "--force".into(), String::new(), String::new())
                .await
                .is_err()
        );
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
    async fn status_full_matches_the_separate_commands() {
        let repo = TempRepo::new();
        repo.commit("tracked.txt", "one\n", "init");
        repo.write("tracked.txt", "two\n");
        repo.write("untracked.txt", "new\n");
        repo.write("staged.txt", "add\n");
        repo.git(&["add", "staged.txt"]);

        let full = git_status_full(repo.wt()).await.unwrap();
        assert!(full.is_git_repo);
        assert_eq!(full.status, git_status(repo.wt()).await.unwrap());

        let changed = git_changed_paths(repo.wt()).await.unwrap();
        assert_eq!(full.changed_paths.staged, changed.staged);
        assert_eq!(full.changed_paths.unstaged, changed.unstaged);
    }

    #[tokio::test]
    async fn status_full_reports_a_plain_directory_as_no_repository() {
        let dir = std::env::temp_dir().join(format!("cairn-not-a-repo-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();

        let full = git_status_full(dir.to_string_lossy().into_owned()).await.unwrap();
        assert!(!full.is_git_repo);
        assert!(full.status.is_empty());

        fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn changed_paths_keeps_the_index_and_worktree_columns_apart() {
        let repo = TempRepo::new();
        repo.commit("both.txt", "one\n", "init");

        // Staged once, then modified again: the badge counts it on both sides,
        // which the single category of `git_status` cannot express.
        repo.write("both.txt", "two\n");
        repo.git(&["add", "both.txt"]);
        repo.write("both.txt", "three\n");

        repo.write("untracked.txt", "new\n");
        repo.write("staged.txt", "add\n");
        repo.git(&["add", "staged.txt"]);

        let changed = git_changed_paths(repo.wt()).await.unwrap();

        assert!(changed.staged.contains(&"both.txt".to_string()));
        assert!(changed.unstaged.contains(&"both.txt".to_string()));
        assert!(changed.staged.contains(&"staged.txt".to_string()));
        assert!(!changed.unstaged.contains(&"staged.txt".to_string()));
        assert!(changed.unstaged.contains(&"untracked.txt".to_string()));
        assert!(!changed.staged.contains(&"untracked.txt".to_string()));
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

    #[tokio::test]
    async fn a_branch_never_suggests_itself_as_its_own_base() {
        let repo = TempRepo::new();
        repo.commit("a.txt", "one\n", "init");
        repo.git(&["checkout", "-q", "-b", "feature"]);
        repo.commit("b.txt", "two\n", "work");

        let out = suggest_base_branches(repo.wt(), "feature".into()).await.unwrap();
        assert!(
            out.iter().all(|s| s.branch != "feature"),
            "a branch compared with itself can never produce a diff",
        );
    }

    #[tokio::test]
    async fn the_nearest_fork_point_is_offered_first() {
        let repo = TempRepo::new();
        repo.commit("a.txt", "one\n", "init");
        // `old` forks early, `recent` forks late: the later fork is the closer base.
        repo.git(&["checkout", "-q", "-b", "old"]);
        repo.git(&["checkout", "-q", "master"]);
        repo.commit("b.txt", "two\n", "more on master");
        repo.commit("c.txt", "three\n", "still more");
        repo.git(&["checkout", "-q", "-b", "recent"]);
        repo.git(&["checkout", "-q", "-b", "feature"]);
        repo.commit("d.txt", "four\n", "the work");

        let out = suggest_base_branches(repo.wt(), "feature".into()).await.unwrap();
        let first = &out.first().expect("a candidate should be found").branch;
        assert!(first == "recent" || first == "master", "got {first}");
        let old = out.iter().find(|s| s.branch == "old").expect("old should be offered too");
        let recent = out.iter().find(|s| s.branch == "recent").unwrap();
        assert!(recent.distance < old.distance, "the later fork must rank closer");
    }

    #[tokio::test]
    async fn a_merge_commit_outranks_a_nearer_fork_point() {
        let repo = TempRepo::new();
        repo.commit("a.txt", "one\n", "init");
        repo.git(&["checkout", "-q", "-b", "release"]);
        repo.commit("r.txt", "rel\n", "release work");
        repo.git(&["checkout", "-q", "master"]);
        repo.git(&["checkout", "-q", "-b", "feature"]);
        // A sibling that forks nearer than the branch this one actually merges.
        repo.git(&["checkout", "-q", "-b", "sibling"]);
        repo.git(&["checkout", "-q", "feature"]);
        repo.commit("f.txt", "feat\n", "the work");
        repo.git(&["merge", "-q", "--no-ff", "-m", "Merge branch 'release' into feature", "release"]);

        let out = suggest_base_branches(repo.wt(), "feature".into()).await.unwrap();
        let first = out.first().expect("a candidate should be found");
        assert_eq!(first.branch, "release", "the named merge is explicit evidence");
        assert_eq!(first.reason, "merge");
    }

    #[tokio::test]
    async fn a_repository_with_nothing_to_compare_yields_nothing() {
        let repo = TempRepo::new();
        repo.commit("a.txt", "one\n", "init");

        let out = suggest_base_branches(repo.wt(), "master".into()).await.unwrap();
        assert!(out.is_empty(), "the only branch cannot be its own base");
    }

    #[tokio::test]
    async fn a_ref_that_looks_like_an_option_is_refused() {
        let repo = TempRepo::new();
        repo.commit("a.txt", "one\n", "init");
        assert!(suggest_base_branches(repo.wt(), "--upload-pack=evil".into()).await.is_err());
    }
}
