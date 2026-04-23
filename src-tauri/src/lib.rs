use std::fs;
use std::path::PathBuf;
use std::process::Command;
use git2::{Repository, BranchType};
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
    Command::new("open").arg(&expanded).spawn().map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    Command::new("explorer").arg(&expanded).spawn().map_err(|e| e.to_string())?;
    #[cfg(target_os = "linux")]
    Command::new("xdg-open").arg(&expanded).spawn().map_err(|e| e.to_string())?;
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

fn read_dir_recursive(dir: &PathBuf, root: &PathBuf) -> Vec<FileNode> {
    let mut entries: Vec<FileNode> = match fs::read_dir(dir) {
        Ok(rd) => rd.filter_map(|e| e.ok()).collect::<Vec<_>>(),
        Err(_) => return vec![],
    }
    .iter()
    .filter_map(|entry| {
        let path = entry.path();
        let name = path.file_name()?.to_string_lossy().to_string();
        // Skip hidden files and directories
        if name.starts_with('.') { return None; }
        let rel = path.strip_prefix(root).ok()?.to_string_lossy().to_string();
        let is_dir = path.is_dir();
        let children = if is_dir { Some(read_dir_recursive(&path, root)) } else { None };
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
fn read_dir_tree(path: String) -> Result<Vec<FileNode>, String> {
    let expanded = shellexpand::tilde(&path).into_owned();
    let root = PathBuf::from(&expanded);
    if !root.exists() { return Err(format!("Path does not exist: {}", path)); }
    Ok(read_dir_recursive(&root, &root))
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

// ── Settings ──────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
pub struct CairnSettings {
    #[serde(rename = "treePanelWidth", default = "default_tree_panel_width")]
    pub tree_panel_width: u32,
}

fn default_tree_panel_width() -> u32 { 220 }

impl Default for CairnSettings {
    fn default() -> Self { CairnSettings { tree_panel_width: default_tree_panel_width() } }
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
        .invoke_handler(tauri::generate_handler![
            run_shell_command,
            run_agent_command,
            list_projects,
            add_project,
            remove_project,
            update_project,
            duplicate_project,
            reveal_in_file_manager,
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
            get_settings,
            update_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
