use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use git2::{Repository, BranchType};
use regex::RegexBuilder;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct CommandOutput {
    pub stdout: String,
    pub stderr: String,
    pub success: bool,
}

// ── Storage layout ────────────────────────────────────────────────────────────
//
//  ~/.cairn/
//    settings.json              → CairnSettings
//    projects/
//      projects.json              → Vec<Project>
//      {project_id}/
//        instances.json           → Vec<StoredInstance>  (no projectId field)
//        worktrees/               → git worktree dirs live here

fn cairn_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Cannot resolve home directory")?;
    Ok(home.join(".cairn"))
}

fn settings_file() -> Result<PathBuf, String> {
    Ok(cairn_dir()?.join("settings.json"))
}

fn projects_file() -> Result<PathBuf, String> {
    Ok(cairn_dir()?.join("projects").join("projects.json"))
}

fn instances_file(project_id: &str) -> Result<PathBuf, String> {
    Ok(cairn_dir()?.join("projects").join(project_id).join("instances.json"))
}

fn worktrees_dir(project_id: &str) -> Result<PathBuf, String> {
    Ok(cairn_dir()?.join("projects").join(project_id).join("worktrees"))
}

fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> Result<(), String> {
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        // Skip .git directory to avoid copying repository internals
        if name == ".git" {
            continue;
        }
        let src_path = entry.path();
        let dst_path = dst.join(&name);
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        if file_type.is_dir() {
            fs::create_dir_all(&dst_path).map_err(|e| e.to_string())?;
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path).map(|_| ()).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

// ── Projects ──────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub color: String,
    #[serde(rename = "activeInstanceId")]
    pub active_instance_id: Option<String>,
}

fn read_projects() -> Result<Vec<Project>, String> {
    let path = projects_file()?;
    if !path.exists() { return Ok(vec![]); }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

fn write_projects(projects: &Vec<Project>) -> Result<(), String> {
    let path = projects_file()?;
    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    fs::write(&path, serde_json::to_string_pretty(projects).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn list_projects() -> Result<Vec<Project>, String> {
    read_projects()
}

#[tauri::command]
fn add_project(project: Project) -> Result<Vec<Project>, String> {
    let mut projects = read_projects()?;
    if projects.iter().any(|p| p.id == project.id) {
        return Err(format!("Project with id '{}' already exists", project.id));
    }
    let canonical = PathBuf::from(&project.path)
        .canonicalize()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| project.path.clone());
    if projects.iter().any(|p| {
        PathBuf::from(&p.path).canonicalize().map(|c| c.to_string_lossy().to_string()).unwrap_or_else(|_| p.path.clone()) == canonical
    }) {
        return Err(format!("A project for '{}' already exists", canonical));
    }
    // Ensure per-project dirs exist
    fs::create_dir_all(worktrees_dir(&project.id)?).map_err(|e| e.to_string())?;
    projects.push(project);
    write_projects(&projects)?;
    Ok(projects)
}

#[tauri::command]
async fn clone_repository(url: String, dest_parent: String, name: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let expanded = shellexpand::tilde(&dest_parent).into_owned();
        let dest = PathBuf::from(&expanded).join(&name);
        if dest.exists() {
            return Err(format!("Destination already exists: {}", dest.display()));
        }
        let output = Command::new("git")
            .args(["clone", "--", &url, dest.to_str().unwrap_or(&name)])
            .output()
            .map_err(|e| format!("Failed to run git: {}", e))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(stderr);
        }
        dest.canonicalize()
            .map(|p| p.to_string_lossy().to_string())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn remove_project(id: String) -> Result<Vec<Project>, String> {
    let mut projects = read_projects()?;
    projects.retain(|p| p.id != id);
    write_projects(&projects)?;
    // Delete all Cairn data for this project (instances + worktrees) — user files are untouched
    let project_data_dir = cairn_dir()?.join("projects").join(&id);
    if project_data_dir.exists() {
        fs::remove_dir_all(&project_data_dir).map_err(|e| e.to_string())?;
    }
    Ok(projects)
}

#[tauri::command]
fn update_project(id: String, name: String, color: String) -> Result<Vec<Project>, String> {
    let mut projects = read_projects()?;
    let p = projects.iter_mut()
        .find(|p| p.id == id)
        .ok_or_else(|| format!("Project '{}' not found", id))?;
    p.name = name;
    p.color = color;
    write_projects(&projects)?;
    Ok(projects)
}

#[tauri::command]
fn duplicate_project(id: String, new_id: String) -> Result<Vec<Project>, String> {
    let mut projects = read_projects()?;
    let original = projects.iter()
        .find(|p| p.id == id)
        .ok_or_else(|| format!("Project '{}' not found", id))?
        .clone();
    let duplicate = Project {
        id: new_id.clone(),
        name: format!("Copy of {}", original.name),
        path: original.path,
        color: original.color,
        active_instance_id: None,
    };
    fs::create_dir_all(worktrees_dir(&new_id)?).map_err(|e| e.to_string())?;
    projects.push(duplicate);
    write_projects(&projects)?;
    Ok(projects)
}

#[tauri::command]
fn reveal_in_file_manager(path: String) -> Result<(), String> {
    let expanded = shellexpand::tilde(&path).into_owned();
    #[cfg(target_os = "macos")]
    Command::new("open").arg("-R").arg(&expanded).spawn().map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    Command::new("explorer").arg(format!("/select,{}", expanded)).spawn().map_err(|e| e.to_string())?;
    #[cfg(target_os = "linux")]
    Command::new("xdg-open").arg(std::path::Path::new(&expanded).parent().unwrap_or(std::path::Path::new(&expanded))).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn copy_path(from: String, to: String) -> Result<(), String> {
    let src = std::path::Path::new(&from);
    let dst = std::path::Path::new(&to);
    if src.is_dir() {
        fs::create_dir_all(dst).map_err(|e| e.to_string())?;
        copy_dir_recursive(src, dst)
    } else {
        if let Some(parent) = dst.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::copy(src, dst).map(|_| ()).map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn open_in_terminal(path: String) -> Result<(), String> {
    let expanded = shellexpand::tilde(&path).into_owned();
    let dir = {
        let p = std::path::Path::new(&expanded);
        if p.is_dir() { expanded.clone() } else { p.parent().map(|d| d.to_string_lossy().into_owned()).unwrap_or(expanded.clone()) }
    };
    #[cfg(target_os = "macos")]
    Command::new("open").args(["-a", "Terminal", &dir]).spawn().map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    Command::new("cmd").args(["/c", "start", "cmd", "/k", &format!("cd /d {}", dir)]).spawn().map_err(|e| e.to_string())?;
    #[cfg(target_os = "linux")]
    Command::new("x-terminal-emulator").current_dir(&dir).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn set_active_instance(project_id: String, instance_id: Option<String>) -> Result<(), String> {
    let mut projects = read_projects()?;
    let project = projects.iter_mut()
        .find(|p| p.id == project_id)
        .ok_or_else(|| format!("Project '{}' not found", project_id))?;
    project.active_instance_id = instance_id;
    write_projects(&projects)
}

#[tauri::command]
fn validate_directory(path: String) -> Result<String, String> {
    let expanded = shellexpand::tilde(&path).into_owned();
    let dir_path = PathBuf::from(&expanded);
    if !dir_path.exists() {
        return Err(format!("Path does not exist: {}", path));
    }
    if !dir_path.is_dir() {
        return Err(format!("Path is not a directory: {}", path));
    }
    dir_path.canonicalize().map_err(|e| e.to_string()).map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn validate_git_repo(path: String) -> Result<String, String> {
    let expanded = shellexpand::tilde(&path).into_owned();
    let repo_path = PathBuf::from(&expanded);

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
fn list_branches(project_path: String) -> Result<Vec<String>, String> {
    let expanded = shellexpand::tilde(&project_path).into_owned();
    let repo = Repository::open(&expanded).map_err(|e| e.to_string())?;
    let branches = repo.branches(Some(BranchType::Local)).map_err(|e| e.to_string())?;
    let names = branches
        .filter_map(|b| b.ok())
        .filter_map(|(b, _)| b.name().ok().flatten().map(|n| n.to_string()))
        .collect();
    Ok(names)
}

// ── Instances ─────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
pub struct InstanceTicket {
    pub id: String,
    pub title: String,
}

// Stored on disk — no projectId (it's implied by the folder)
#[derive(Serialize, Deserialize, Clone)]
struct StoredInstance {
    pub id: String,
    pub ticket: InstanceTicket,
    pub branch: String,
    #[serde(rename = "worktreePath")]
    pub worktree_path: String,
    pub status: String,
    #[serde(rename = "createdAt")]
    pub created_at: u64,
    #[serde(rename = "useGit", default)]
    pub use_git: bool,
    #[serde(rename = "baseBranch", default)]
    pub base_branch: String,
}

// Returned to the frontend — includes projectId
#[derive(Serialize, Clone)]
pub struct Instance {
    pub id: String,
    #[serde(rename = "projectId")]
    pub project_id: String,
    pub ticket: InstanceTicket,
    pub branch: String,
    #[serde(rename = "worktreePath")]
    pub worktree_path: String,
    pub status: String,
    #[serde(rename = "createdAt")]
    pub created_at: u64,
    #[serde(rename = "useGit")]
    pub use_git: bool,
    #[serde(rename = "baseBranch")]
    pub base_branch: String,
}

impl StoredInstance {
    fn with_project(self, project_id: String) -> Instance {
        Instance {
            id: self.id,
            project_id,
            ticket: self.ticket,
            branch: self.branch,
            worktree_path: self.worktree_path,
            status: self.status,
            created_at: self.created_at,
            use_git: self.use_git,
            base_branch: self.base_branch,
        }
    }
}

#[derive(Deserialize)]
pub struct CreateInstanceArgs {
    pub id: String,
    #[serde(rename = "projectId")]
    pub project_id: String,
    #[serde(rename = "projectPath")]
    pub project_path: String,
    pub ticket: InstanceTicket,
    #[serde(rename = "useGit")]
    pub use_git: bool,
    pub branch: Option<String>,
    #[serde(rename = "baseBranch")]
    pub base_branch: Option<String>,
}

fn read_instances(project_id: &str) -> Result<Vec<StoredInstance>, String> {
    let path = instances_file(project_id)?;
    if !path.exists() { return Ok(vec![]); }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

fn write_instances(project_id: &str, instances: &Vec<StoredInstance>) -> Result<(), String> {
    let path = instances_file(project_id)?;
    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    fs::write(&path, serde_json::to_string_pretty(instances).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn list_instances(project_id: String) -> Result<Vec<Instance>, String> {
    let stored = read_instances(&project_id)?;
    Ok(stored.into_iter().map(|i| i.with_project(project_id.clone())).collect())
}

#[tauri::command]
async fn create_instance(args: CreateInstanceArgs) -> Result<Instance, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let expanded_project = shellexpand::tilde(&args.project_path).into_owned();

        let (branch, worktree_path_str) = if args.use_git {
            let branch = args.branch.clone().ok_or("branch is required for git mode")?;
            let base_branch = args.base_branch.clone().ok_or("baseBranch is required for git mode")?;

            let repo = Repository::open(&expanded_project).map_err(|e| e.to_string())?;

            let base_ref = format!("refs/heads/{}", base_branch);
            let base_obj = repo.revparse_single(&base_ref)
                .map_err(|_| format!("Base branch '{}' not found", base_branch))?;
            let base_commit = base_obj.peel_to_commit().map_err(|e| e.to_string())?;

            let branch_created = match repo.branch(&branch, &base_commit, false) {
                Ok(_) => true,
                Err(e) if e.code() == git2::ErrorCode::Exists => false,
                Err(e) => return Err(format!("Failed to create branch '{}': {}", branch, e)),
            };

            let slug = branch.replace('/', "-");
            let worktree_path = worktrees_dir(&args.project_id)?.join(&slug);

            let git_worktree_entry = repo.path().join("worktrees").join(&slug);
            if git_worktree_entry.exists() {
                fs::remove_dir_all(&git_worktree_entry).map_err(|e| e.to_string())?;
            }
            if worktree_path.exists() {
                fs::remove_dir_all(&worktree_path).map_err(|e| e.to_string())?;
            }

            fs::create_dir_all(worktree_path.parent().unwrap()).map_err(|e| e.to_string())?;

            let worktree_result = repo.worktree(
                &slug,
                &worktree_path,
                Some(git2::WorktreeAddOptions::new().reference(Some(
                    &repo.find_branch(&branch, BranchType::Local)
                        .map_err(|e| e.to_string())?
                        .into_reference(),
                ))),
            );

            if let Err(e) = worktree_result {
                if branch_created {
                    if let Ok(mut b) = repo.find_branch(&branch, BranchType::Local) {
                        let _ = b.delete();
                    };
                }
                let _ = fs::remove_dir_all(&worktree_path);
                return Err(format!("Failed to create worktree: {}", e));
            }

            (branch, worktree_path.to_string_lossy().to_string())
        } else {
            let slug = args.ticket.id.to_lowercase().replace(|c: char| !c.is_alphanumeric(), "-");
            let worktree_path = worktrees_dir(&args.project_id)?.join(&slug);
            fs::create_dir_all(&worktree_path).map_err(|e| e.to_string())?;
            copy_dir_recursive(&std::path::Path::new(&expanded_project), &worktree_path)?;
            (String::new(), worktree_path.to_string_lossy().to_string())
        };

        let stored = StoredInstance {
            id: args.id,
            ticket: args.ticket,
            branch,
            worktree_path: worktree_path_str,
            status: "idle".to_string(),
            created_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
            use_git: args.use_git,
            base_branch: args.base_branch.unwrap_or_default(),
        };

        let mut instances = read_instances(&args.project_id)?;
        instances.push(stored.clone());
        write_instances(&args.project_id, &instances)?;

        Ok(stored.with_project(args.project_id))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn delete_instance(id: String, project_id: String) -> Result<(), String> {
    let mut instances = read_instances(&project_id)?;
    let instance = instances.iter().find(|i| i.id == id)
        .ok_or_else(|| format!("Instance '{}' not found", id))?
        .clone();

    let wt_path = PathBuf::from(&instance.worktree_path);
    if wt_path.exists() {
        fs::remove_dir_all(&wt_path).map_err(|e| e.to_string())?;
    }

    if instance.use_git {
        let projects = read_projects()?;
        let expanded_project = projects.iter()
            .find(|p| p.id == project_id)
            .map(|p| shellexpand::tilde(&p.path).into_owned())
            .ok_or_else(|| "Project not found".to_string())?;

        let repo = Repository::open(&expanded_project).map_err(|e| e.to_string())?;

        let slug = instance.branch.replace('/', "-");
        if let Ok(wt) = repo.find_worktree(&slug) {
            let _ = wt.prune(None);
        }
        if let Ok(mut branch) = repo.find_branch(&instance.branch, BranchType::Local) {
            let _ = branch.delete();
        };
    }

    instances.retain(|i| i.id != id);
    write_instances(&project_id, &instances)?;
    Ok(())
}

// ── File system ───────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    #[serde(rename = "isDir")]
    pub is_dir: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<FileNode>>,
}

fn read_dir_recursive(dir: &PathBuf, root: &PathBuf, show_hidden: bool) -> Vec<FileNode> {
    let mut entries: Vec<FileNode> = match fs::read_dir(dir) {
        Ok(rd) => rd.filter_map(|e| e.ok()).collect::<Vec<_>>(),
        Err(_) => return vec![],
    }
    .iter()
    .filter_map(|entry| {
        let path = entry.path();
        let name = path.file_name()?.to_string_lossy().to_string();
        if !show_hidden && name.starts_with('.') { return None; }
        let rel = path.strip_prefix(root).ok()?.to_string_lossy().to_string();
        let is_dir = path.is_dir();
        let children = if is_dir { Some(read_dir_recursive(&path, root, show_hidden)) } else { None };
        Some(FileNode { name, path: rel, is_dir, children })
    })
    .collect();

    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    entries
}

#[tauri::command]
fn read_dir_tree(path: String, show_hidden: bool) -> Result<Vec<FileNode>, String> {
    let expanded = shellexpand::tilde(&path).into_owned();
    let root = PathBuf::from(&expanded);
    if !root.exists() { return Err(format!("Path does not exist: {}", path)); }
    Ok(read_dir_recursive(&root, &root, show_hidden))
}

#[tauri::command]
fn read_file(path: String) -> Result<Option<String>, String> {
    let expanded = shellexpand::tilde(&path).into_owned();
    let p = PathBuf::from(&expanded);
    if !p.exists() { return Err(format!("File not found: {}", path)); }

    // Return None for binary files
    let bytes = fs::read(&p).map_err(|e| e.to_string())?;
    match String::from_utf8(bytes) {
        Ok(text) => Ok(Some(text)),
        Err(_) => Ok(None), // binary
    }
}

#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    let expanded = shellexpand::tilde(&path).into_owned();
    let p = PathBuf::from(&expanded);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&p, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_path(path: String) -> Result<(), String> {
    let expanded = shellexpand::tilde(&path).into_owned();
    let p = PathBuf::from(&expanded);
    if !p.exists() { return Err(format!("Path does not exist: {}", path)); }
    if p.is_dir() {
        fs::remove_dir_all(&p).map_err(|e| e.to_string())
    } else {
        fs::remove_file(&p).map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn rename_path(from: String, to: String) -> Result<(), String> {
    let from_expanded = shellexpand::tilde(&from).into_owned();
    let to_expanded = shellexpand::tilde(&to).into_owned();
    let from_p = PathBuf::from(&from_expanded);
    let to_p = PathBuf::from(&to_expanded);
    if !from_p.exists() { return Err(format!("Path does not exist: {}", from)); }
    if to_p.exists() { return Err(format!("Destination already exists: {}", to)); }
    fs::rename(&from_p, &to_p).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_file_or_dir(path: String, is_dir: bool) -> Result<(), String> {
    let expanded = shellexpand::tilde(&path).into_owned();
    let p = PathBuf::from(&expanded);
    if p.exists() { return Err(format!("Already exists: {}", path)); }
    if is_dir {
        fs::create_dir_all(&p).map_err(|e| e.to_string())
    } else {
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::File::create(&p).map(|_| ()).map_err(|e| e.to_string())
    }
}

// ── Search ────────────────────────────────────────────────────────────────────

const BINARY_EXTENSIONS: &[&str] = &[
    "png","jpg","jpeg","gif","webp","ico","bmp","tiff",
    "pdf","doc","docx","xls","xlsx","ppt","pptx",
    "zip","tar","gz","bz2","xz","7z","rar",
    "mp3","mp4","wav","ogg","flac","avi","mov","mkv",
    "wasm","bin","exe","dll","so","dylib","a","o",
    "ttf","otf","woff","woff2","eot",
    "db","sqlite","sqlite3",
];

fn glob_match(pattern: &str, name: &str) -> bool {
    let p: Vec<char> = pattern.to_lowercase().chars().collect();
    let n: Vec<char> = name.to_lowercase().chars().collect();
    let mut dp = vec![vec![false; n.len() + 1]; p.len() + 1];
    dp[0][0] = true;
    for i in 1..=p.len() {
        if p[i - 1] == '*' { dp[i][0] = dp[i - 1][0]; }
    }
    for i in 1..=p.len() {
        for j in 1..=n.len() {
            dp[i][j] = if p[i - 1] == '*' {
                dp[i - 1][j] || dp[i][j - 1]
            } else if p[i - 1] == '?' || p[i - 1] == n[j - 1] {
                dp[i - 1][j - 1]
            } else {
                false
            };
        }
    }
    dp[p.len()][n.len()]
}

fn path_matches_exclude(rel_path: &str, patterns: &[&str]) -> bool {
    patterns.iter().any(|pat| {
        let pat = pat.trim();
        if pat.is_empty() { return false; }
        rel_path.split('/').any(|seg| glob_match(pat, seg))
    })
}

fn file_matches_include(name: &str, patterns: &[&str]) -> bool {
    if patterns.iter().all(|p| p.trim().is_empty()) { return true; }
    patterns.iter().any(|pat| {
        let pat = pat.trim();
        !pat.is_empty() && glob_match(pat, name)
    })
}

#[derive(Serialize)]
pub struct SearchMatch {
    pub path: String,
    pub line: u32,
    pub col: u32,
    pub text: String,
    #[serde(rename = "matchStart")]
    pub match_start: u32,
    #[serde(rename = "matchEnd")]
    pub match_end: u32,
}

fn collect_text_files(dir: &PathBuf, root: &PathBuf, include: &[&str], exclude: &[&str], out: &mut Vec<PathBuf>) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        let name = match path.file_name() { Some(n) => n.to_string_lossy().to_string(), None => continue };
        if name.starts_with('.') { continue; }
        let rel = match path.strip_prefix(root) { Ok(r) => r.to_string_lossy().to_string(), Err(_) => continue };
        if path.is_dir() {
            if path_matches_exclude(&rel, exclude) { continue; }
            collect_text_files(&path, root, include, exclude, out);
        } else {
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
            if BINARY_EXTENSIONS.contains(&ext.as_str()) { continue; }
            if path_matches_exclude(&rel, exclude) { continue; }
            if !file_matches_include(&name, include) { continue; }
            out.push(path);
        }
    }
}

#[tauri::command]
async fn search_in_files(
    root: String,
    query: String,
    case_sensitive: bool,
    is_regex: bool,
    include_glob: String,
    exclude_glob: String,
) -> Result<Vec<SearchMatch>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if query.trim().is_empty() { return Ok(vec![]); }
        let expanded = shellexpand::tilde(&root).into_owned();
        let root_path = PathBuf::from(&expanded);

        let pattern = if is_regex { query.clone() } else { regex::escape(&query) };
        let re = RegexBuilder::new(&pattern)
            .case_insensitive(!case_sensitive)
            .build()
            .map_err(|e| format!("Invalid regex: {}", e))?;

        let include_parts: Vec<&str> = include_glob.split(',').collect();
        let exclude_parts: Vec<&str> = exclude_glob.split(',').collect();

        let mut files = vec![];
        collect_text_files(&root_path, &root_path, &include_parts, &exclude_parts, &mut files);
        files.sort();

        let mut results: Vec<SearchMatch> = vec![];
        'file: for file_path in &files {
            let content = match fs::read(file_path) {
                Ok(b) => b,
                Err(_) => continue,
            };
            let text = match std::str::from_utf8(&content) {
                Ok(t) => t,
                Err(_) => continue,
            };
            let rel = file_path.strip_prefix(&root_path)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();

            for (line_idx, line_text) in text.lines().enumerate() {
                for m in re.find_iter(line_text) {
                    results.push(SearchMatch {
                        path: rel.clone(),
                        line: (line_idx + 1) as u32,
                        col: (m.start() + 1) as u32,
                        text: line_text.to_string(),
                        match_start: m.start() as u32,
                        match_end: m.end() as u32,
                    });
                    if results.len() >= 2000 { break 'file; }
                }
            }
        }
        Ok(results)
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── Settings ──────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct CairnShortcutBinding {
    pub key: String,
    #[serde(rename = "mod", default)]
    pub is_mod: bool,
    #[serde(default)]
    pub shift: bool,
    #[serde(default)]
    pub alt: bool,
    #[serde(default)]
    pub ctrl: bool,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ShortcutConfig {
    pub id: String,
    pub binding: Option<CairnShortcutBinding>,
    pub enabled: bool,
}

fn deserialize_shortcuts<'de, D>(deserializer: D) -> Result<Vec<ShortcutConfig>, D::Error>
where D: serde::Deserializer<'de> {
    let v = serde_json::Value::deserialize(deserializer).unwrap_or(serde_json::Value::Null);
    Ok(serde_json::from_value::<Vec<ShortcutConfig>>(v).unwrap_or_default())
}

#[derive(Serialize, Deserialize, Clone)]
pub struct WorkflowTabConfig {
    pub key: String,
    pub name: String,
    pub icon: String,
    pub enabled: bool,
    pub order: u32,
}

fn default_workflow_tabs() -> Vec<WorkflowTabConfig> {
    vec![
        WorkflowTabConfig { key: "files".into(),  name: "Files".into(),  icon: "folder".into(), enabled: true, order: 0 },
        WorkflowTabConfig { key: "agent".into(),  name: "Agent".into(),  icon: "agent".into(),  enabled: true, order: 1 },
        WorkflowTabConfig { key: "review".into(), name: "Review".into(), icon: "review".into(), enabled: true, order: 2 },
        WorkflowTabConfig { key: "tests".into(),  name: "Tests".into(),  icon: "tests".into(),  enabled: true, order: 3 },
        WorkflowTabConfig { key: "git".into(),    name: "Git".into(),    icon: "git".into(),    enabled: true, order: 4 },
        WorkflowTabConfig { key: "cicd".into(),   name: "CI/CD".into(),  icon: "ci".into(),     enabled: true, order: 5 },
    ]
}

#[derive(Serialize, Deserialize, Clone)]
pub struct CairnSettings {
    #[serde(rename = "treePanelWidth", default = "default_tree_panel_width")]
    pub tree_panel_width: u32,
    #[serde(rename = "showMinimap", default = "default_show_minimap")]
    pub show_minimap: bool,
    #[serde(rename = "editorFontSize", default = "default_editor_font_size")]
    pub editor_font_size: u32,
    #[serde(rename = "fontFamily", default = "default_editor_font_family")]
    pub editor_font_family: String,
    #[serde(rename = "splitMode", default = "default_split_mode")]
    pub split_mode: bool,
    #[serde(rename = "splitLeftWidth", default = "default_split_left_width")]
    pub split_left_width: u32,
    #[serde(default, deserialize_with = "deserialize_shortcuts")]
    pub shortcuts: Vec<ShortcutConfig>,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(rename = "accentColor", default = "default_accent_color")]
    pub accent_color: String,
    #[serde(rename = "workflowTabs", default = "default_workflow_tabs")]
    pub workflow_tabs: Vec<WorkflowTabConfig>,
    #[serde(rename = "sidebarPosition", default = "default_sidebar_position")]
    pub sidebar_position: String,
    #[serde(rename = "showWhitespace", default = "default_show_whitespace")]
    pub show_whitespace: bool,
    #[serde(rename = "saveOn", default = "default_save_on")]
    pub save_on: String,
}

fn default_sidebar_position() -> String { "left".to_string() }
fn default_show_whitespace() -> bool { false }
fn default_save_on() -> String { "blur".to_string() }
fn default_tree_panel_width() -> u32 { 220 }
fn default_show_minimap() -> bool { true }
fn default_editor_font_size() -> u32 { 13 }
fn default_editor_font_family() -> String { "'JetBrains Mono', ui-monospace, monospace".to_string() }
fn default_split_mode() -> bool { false }
fn default_split_left_width() -> u32 { 0 }
fn default_theme() -> String { "dark".to_string() }
fn default_accent_color() -> String { "#6c8eff".to_string() }

impl Default for CairnSettings {
    fn default() -> Self {
        CairnSettings {
            tree_panel_width: default_tree_panel_width(),
            show_minimap: default_show_minimap(),
            editor_font_size: default_editor_font_size(),
            editor_font_family: default_editor_font_family(),
            split_mode: false,
            split_left_width: 0,
            shortcuts: Vec::new(),
            theme: default_theme(),
            accent_color: default_accent_color(),
            workflow_tabs: default_workflow_tabs(),
            sidebar_position: default_sidebar_position(),
            show_whitespace: default_show_whitespace(),
            save_on: default_save_on(),
        }
    }
}

fn read_settings() -> Result<CairnSettings, String> {
    let path = settings_file()?;
    if !path.exists() { return Ok(CairnSettings::default()); }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

fn write_settings(settings: &CairnSettings) -> Result<(), String> {
    let path = settings_file()?;
    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    fs::write(&path, serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_settings() -> Result<CairnSettings, String> {
    read_settings()
}

#[tauri::command]
fn update_settings(settings: CairnSettings) -> Result<CairnSettings, String> {
    write_settings(&settings)?;
    Ok(settings)
}

// ── Git status ────────────────────────────────────────────────────────────────

#[tauri::command]
fn git_status(worktree_path: String) -> Result<HashMap<String, String>, String> {
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
        // Handle renames: "old -> new" format
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

// ── Shell / Agent stubs ───────────────────────────────────────────────────────

#[tauri::command]
fn run_shell_command(program: &str, args: Vec<String>, cwd: Option<String>) -> CommandOutput {
    let mut cmd = Command::new(program);
    cmd.args(&args);
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    match cmd.output() {
        Ok(output) => CommandOutput {
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
            success: output.status.success(),
        },
        Err(e) => CommandOutput {
            stdout: String::new(),
            stderr: e.to_string(),
            success: false,
        },
    }
}

#[tauri::command]
fn run_agent_command(instruction: &str, cwd: &str) -> String {
    format!("agent stub: received '{}' in '{}'", instruction, cwd)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                use tauri::menu::{MenuBuilder, SubmenuBuilder};
                let menu = MenuBuilder::new(app)
                    .item(
                        &SubmenuBuilder::new(app, "Cairn")
                            .about(None)
                            .separator()
                            .quit()
                            .build()?
                    )
                    .item(
                        &SubmenuBuilder::new(app, "Edit")
                            .undo()
                            .redo()
                            .separator()
                            .cut()
                            .copy()
                            .paste()
                            .select_all()
                            .build()?
                    )
                    .build()?;
                app.set_menu(menu)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            run_shell_command,
            run_agent_command,
            list_projects,
            add_project,
            remove_project,
            update_project,
            duplicate_project,
            reveal_in_file_manager,
            copy_path,
            open_in_terminal,
            validate_directory,
            validate_git_repo,
            clone_repository,
            list_branches,
            list_instances,
            create_instance,
            delete_instance,
            set_active_instance,
            read_dir_tree,
            read_file,
            write_file,
            delete_path,
            rename_path,
            create_file_or_dir,
            get_settings,
            update_settings,
            git_status,
            search_in_files,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
