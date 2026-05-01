use std::collections::HashMap;
use std::process::Command;
use git2::{Repository, BranchType};

#[tauri::command]
pub fn list_branches(project_path: String) -> Result<Vec<String>, String> {
    let expanded = shellexpand::tilde(&project_path).into_owned();
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
    let expanded = shellexpand::tilde(&path).into_owned();
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
    let expanded = shellexpand::tilde(&worktree_path).into_owned();
    let output = Command::new("git")
        .args(["status", "--porcelain", "-u"])
        .current_dir(&expanded)
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
            "staged"
        } else if y == 'D' {
            "deleted"
        } else {
            "modified"
        };

        map.insert(file_path, category.to_string());
    }

    Ok(map)
}
