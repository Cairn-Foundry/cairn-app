use std::fs;
use std::path::PathBuf;
use git2::{Repository, BranchType};
use serde::{Deserialize, Serialize};
use crate::storage::{instances_file, worktrees_dir, copy_dir_recursive};
use super::projects::read_projects;

#[derive(Serialize, Deserialize, Clone)]
pub struct InstanceTicket {
    pub id: String,
    pub title: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct StoredInstance {
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
    pub fn with_project(self, project_id: String) -> Instance {
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

pub fn read_instances(project_id: &str) -> Result<Vec<StoredInstance>, String> {
    let path = instances_file(project_id)?;
    if !path.exists() { return Ok(vec![]); }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

pub fn write_instances(project_id: &str, instances: &Vec<StoredInstance>) -> Result<(), String> {
    let path = instances_file(project_id)?;
    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    fs::write(&path, serde_json::to_string_pretty(instances).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_instances(project_id: String) -> Result<Vec<Instance>, String> {
    let stored = read_instances(&project_id)?;
    Ok(stored.into_iter().map(|i| i.with_project(project_id.clone())).collect())
}

#[tauri::command]
pub async fn create_instance(args: CreateInstanceArgs) -> Result<Instance, String> {
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
pub fn delete_instance(id: String, project_id: String) -> Result<(), String> {
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
