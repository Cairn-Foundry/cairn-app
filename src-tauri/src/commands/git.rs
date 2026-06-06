use std::collections::HashMap;
use std::process::Command;
use git2::{Repository, BranchType};
use serde::Serialize;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
pub struct DiffLine {
    pub kind: String, // "add" | "remove" | "context"
    pub content: String,
}

#[derive(Serialize, Clone)]
pub struct GitDiffHunk {
    pub header: String,
    pub lines: Vec<DiffLine>,
}

#[derive(Serialize, Clone)]
pub struct GitFileDiff {
    #[serde(rename = "filePath")]
    pub file_path: String,
    pub hunks: Vec<GitDiffHunk>,
}

#[derive(Serialize)]
pub struct GitCommit {
    pub hash: String,
    #[serde(rename = "shortHash")]
    pub short_hash: String,
    pub author: String,
    pub date: String,
    pub message: String,
}

#[derive(Serialize)]
pub struct GitIdentity {
    pub name: String,
    pub email: String,
}

#[derive(Serialize)]
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

fn expand(path: &str) -> String {
    shellexpand::tilde(path).into_owned()
}

fn git_cmd(worktree: &str) -> Command {
    let mut cmd = Command::new("git");
    cmd.current_dir(worktree);
    cmd
}

fn run(cmd: &mut Command) -> Result<String, String> {
    let output = cmd.output().map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn parse_diff(raw: &str) -> Vec<GitFileDiff> {
    let mut files: Vec<GitFileDiff> = Vec::new();
    let mut current_file: Option<GitFileDiff> = None;
    let mut current_hunk: Option<GitDiffHunk> = None;

    for line in raw.lines() {
        if line.starts_with("diff --git ") {
            // Flush previous hunk/file
            if let Some(hunk) = current_hunk.take() {
                if let Some(ref mut f) = current_file {
                    f.hunks.push(hunk);
                }
            }
            if let Some(f) = current_file.take() {
                files.push(f);
            }
            // Extract file path from "diff --git a/path b/path"
            let path = line
                .split(" b/")
                .last()
                .unwrap_or("")
                .to_string();
            current_file = Some(GitFileDiff { file_path: path, hunks: Vec::new() });
        } else if line.starts_with("+++ ") || line.starts_with("--- ") || line.starts_with("index ") || line.starts_with("new file") || line.starts_with("deleted file") || line.starts_with("Binary") || line.starts_with('\\') {
            // Skip metadata lines and no-newline markers
        } else if line.starts_with("@@ ") {
            if let Some(hunk) = current_hunk.take() {
                if let Some(ref mut f) = current_file {
                    f.hunks.push(hunk);
                }
            }
            current_hunk = Some(GitDiffHunk {
                header: line.to_string(),
                lines: Vec::new(),
            });
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
    if let Some(hunk) = current_hunk.take() {
        if let Some(ref mut f) = current_file {
            f.hunks.push(hunk);
        }
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
pub fn list_branches(project_path: String) -> Result<Vec<String>, String> {
    let expanded = expand(&project_path);
    let repo = Repository::open(&expanded).map_err(|e| e.to_string())?;
    let branches = repo.branches(Some(BranchType::Local)).map_err(|e| e.to_string())?;
    let names = branches
        .filter_map(|b| b.ok())
        .filter_map(|(b, _)| b.name().ok().flatten().map(|n| n.to_string()))
        .collect();
    Ok(names)
}

#[tauri::command]
pub fn validate_git_repo(path: String) -> Result<String, String> {
    let expanded = expand(&path);
    let repo_path = std::path::PathBuf::from(&expanded);

    if !repo_path.exists() {
        return Err(format!("Path does not exist: {}", path));
    }
    if !repo_path.is_dir() {
        return Err(format!("Path is not a directory: {}", path));
    }

    Repository::discover(&repo_path)
        .map_err(|_| format!("Not a git repository: {}", path))
        .and_then(|repo| {
            repo.workdir()
                .ok_or_else(|| "Bare repositories are not supported".to_string())
                .map(|p| p.to_string_lossy().trim_end_matches('/').to_string())
        })
}

#[tauri::command]
pub fn git_status(worktree_path: String) -> Result<HashMap<String, String>, String> {
    let expanded = expand(&worktree_path);
    let output = git_cmd(&expanded)
        .args(["status", "--porcelain", "-u"])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Ok(HashMap::new());
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let mut map = HashMap::new();

    for line in text.lines() {
        if line.len() < 4 { continue; }
        let x = line.chars().nth(0).unwrap_or(' ');
        let y = line.chars().nth(1).unwrap_or(' ');
        let path = line[3..].trim_end().to_string();
        let file_path = if path.contains(" -> ") {
            path.split(" -> ").last().unwrap_or(&path).to_string()
        } else {
            path
        };

        let category = if x == '?' && y == '?' {
            "untracked"
        } else if x != ' ' && x != '?' {
            match x {
                'A' => "staged-added",
                'D' => "staged-deleted",
                'R' => "staged-renamed",
                'C' => "staged-copied",
                _   => "staged-modified",
            }
        } else if y == 'D' {
            "deleted"
        } else {
            "modified"
        };

        map.insert(file_path, category.to_string());
    }

    Ok(map)
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn git_diff_unstaged(worktree_path: String) -> Result<Vec<GitFileDiff>, String> {
    let expanded = expand(&worktree_path);
    let raw = run(git_cmd(&expanded).args(["diff", "--no-color", "--unified=3"]))?;
    Ok(parse_diff(&raw))
}

#[tauri::command]
pub fn git_diff_staged(worktree_path: String) -> Result<Vec<GitFileDiff>, String> {
    let expanded = expand(&worktree_path);
    let raw = run(git_cmd(&expanded).args(["diff", "--cached", "--no-color", "--unified=3"]))?;
    Ok(parse_diff(&raw))
}

#[tauri::command]
pub fn git_file_at_head(worktree_path: String, file_path: String) -> Result<String, String> {
    let expanded = expand(&worktree_path);
    let output = git_cmd(&expanded)
        .args(["show", &format!("HEAD:{}", file_path)])
        .output()
        .map_err(|e| e.to_string())?;
    // File is new/untracked, deleted from HEAD, or the repo has no commit yet.
    if !output.status.success() {
        return Ok(String::new());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
pub fn git_diff_file(worktree_path: String, file_path: String, staged: bool) -> Result<Vec<GitDiffHunk>, String> {
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
pub fn git_stage_file(worktree_path: String, file_path: String) -> Result<(), String> {
    let expanded = expand(&worktree_path);
    let out = git_cmd(&expanded).args(["add", "--", &file_path]).output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn git_unstage_file(worktree_path: String, file_path: String) -> Result<(), String> {
    let expanded = expand(&worktree_path);
    let out = git_cmd(&expanded).args(["restore", "--staged", "--", &file_path]).output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        // Fallback for repos with no commits yet
        let out2 = git_cmd(&expanded).args(["rm", "--cached", "--", &file_path]).output().map_err(|e| e.to_string())?;
        if !out2.status.success() {
            return Err(String::from_utf8_lossy(&out2.stderr).to_string());
        }
    }
    Ok(())
}

#[tauri::command]
pub fn git_stage_all(worktree_path: String) -> Result<(), String> {
    let expanded = expand(&worktree_path);
    let out = git_cmd(&expanded).args(["add", "-A"]).output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn git_unstage_all(worktree_path: String) -> Result<(), String> {
    let expanded = expand(&worktree_path);
    let out = git_cmd(&expanded).args(["restore", "--staged", "."]).output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        // Fallback for repos with no commits yet
        let out2 = git_cmd(&expanded).args(["rm", "--cached", "-r", "."]).output().map_err(|e| e.to_string())?;
        if !out2.status.success() {
            return Err(String::from_utf8_lossy(&out2.stderr).to_string());
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn git_get_identity(worktree_path: String) -> Result<GitIdentity, String> {
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
pub fn git_commit(
    worktree_path: String,
    message: String,
    no_verify: bool,
    sign_off: bool,
    allow_empty: bool,
    author_name: String,
    author_email: String,
) -> Result<String, String> {
    let expanded = expand(&worktree_path);
    let mut cmd = git_cmd(&expanded);
    cmd.arg("commit").arg("-m").arg(&message);
    if no_verify   { cmd.arg("--no-verify"); }
    if sign_off    { cmd.arg("--signoff"); }
    if allow_empty { cmd.arg("--allow-empty"); }
    if !author_name.is_empty() && !author_email.is_empty() {
        cmd.arg(format!("--author={} <{}>", author_name, author_email));
    }
    let out = cmd.output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

#[tauri::command]
pub fn git_amend_commit(
    worktree_path: String,
    message: String,
    no_verify: bool,
    sign_off: bool,
    author_name: String,
    author_email: String,
) -> Result<String, String> {
    let expanded = expand(&worktree_path);
    let mut cmd = git_cmd(&expanded);
    cmd.arg("commit").arg("--amend").arg("-m").arg(&message);
    if no_verify { cmd.arg("--no-verify"); }
    if sign_off  { cmd.arg("--signoff"); }
    if !author_name.is_empty() && !author_email.is_empty() {
        cmd.arg(format!("--author={} <{}>", author_name, author_email));
    }
    let out = cmd.output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

// ---------------------------------------------------------------------------
// Branches
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn git_current_branch(worktree_path: String) -> Result<String, String> {
    let expanded = expand(&worktree_path);
    let raw = run(git_cmd(&expanded).args(["branch", "--show-current"]))?;
    Ok(raw.trim().to_string())
}

#[tauri::command]
pub fn git_checkout_branch(worktree_path: String, branch_name: String) -> Result<(), String> {
    let expanded = expand(&worktree_path);
    let out = git_cmd(&expanded).args(["checkout", &branch_name]).output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn git_create_branch(worktree_path: String, branch_name: String, from_branch: String) -> Result<(), String> {
    let expanded = expand(&worktree_path);
    let out = git_cmd(&expanded).args(["checkout", "-b", &branch_name, &from_branch]).output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn git_delete_branch(worktree_path: String, branch_name: String) -> Result<(), String> {
    let expanded = expand(&worktree_path);
    let out = git_cmd(&expanded).args(["branch", "-d", &branch_name]).output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Remote
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn git_push(worktree_path: String, set_upstream: bool, branch: String) -> Result<String, String> {
    let expanded = expand(&worktree_path);
    let mut args = vec!["push"];
    if set_upstream {
        args.extend(["--set-upstream", "origin", branch.as_str()]);
    }
    let out = git_cmd(&expanded).args(&args).output().map_err(|e| e.to_string())?;
    let combined = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    if !out.status.success() {
        return Err(combined);
    }
    Ok(combined)
}

#[tauri::command]
pub fn git_pull(worktree_path: String) -> Result<String, String> {
    let expanded = expand(&worktree_path);
    let out = git_cmd(&expanded).args(["pull"]).output().map_err(|e| e.to_string())?;
    let combined = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    if !out.status.success() {
        return Err(combined);
    }
    Ok(combined)
}

#[tauri::command]
pub fn git_fetch(worktree_path: String) -> Result<(), String> {
    let expanded = expand(&worktree_path);
    let out = git_cmd(&expanded).args(["fetch", "--prune"]).output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn git_remote_status(worktree_path: String) -> Result<RemoteStatus, String> {
    let expanded = expand(&worktree_path);

    // Get upstream tracking branch
    let upstream_out = git_cmd(&expanded)
        .args(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])
        .output()
        .map_err(|e| e.to_string())?;

    if !upstream_out.status.success() {
        return Ok(RemoteStatus { ahead: 0, behind: 0, remote: String::new(), has_upstream: false });
    }

    let remote = String::from_utf8_lossy(&upstream_out.stdout).trim().to_string();

    let counts = run(git_cmd(&expanded).args(["rev-list", "--left-right", "--count", "HEAD...@{u}"]))?;
    let parts: Vec<&str> = counts.trim().split_whitespace().collect();
    let ahead = parts.first().and_then(|s| s.parse().ok()).unwrap_or(0);
    let behind = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0);

    Ok(RemoteStatus { ahead, behind, remote, has_upstream: true })
}

// ---------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------

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
pub fn git_graph(worktree_path: String) -> Result<Vec<GitGraphCommit>, String> {
    let expanded = expand(&worktree_path);
    let raw = run(git_cmd(&expanded).args([
        "log", "--all", "--topo-order",
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
// History
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn git_log(worktree_path: String, limit: usize) -> Result<Vec<GitCommit>, String> {
    let expanded = expand(&worktree_path);
    let limit_str = limit.to_string();
    let raw = run(
        git_cmd(&expanded).args(["log", &format!("-{}", limit_str), "--format=%H%x1f%h%x1f%an%x1f%aI%x1f%s"])
    )?;

    let commits = raw
        .lines()
        .filter(|l| !l.is_empty())
        .map(|line| {
            let parts: Vec<&str> = line.splitn(5, '\x1f').collect();
            GitCommit {
                hash: parts.first().unwrap_or(&"").to_string(),
                short_hash: parts.get(1).unwrap_or(&"").to_string(),
                author: parts.get(2).unwrap_or(&"").to_string(),
                date: parts.get(3).unwrap_or(&"").to_string(),
                message: parts.get(4).unwrap_or(&"").to_string(),
            }
        })
        .collect();

    Ok(commits)
}
