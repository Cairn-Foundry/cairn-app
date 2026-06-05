use std::fs;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct CommandOutput {
    pub stdout: String,
    pub stderr: String,
    pub success: bool,
}

pub fn cairn_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Cannot resolve home directory")?;
    Ok(home.join(".cairn"))
}

pub fn settings_file() -> Result<PathBuf, String> {
    Ok(cairn_dir()?.join("settings.json"))
}

pub fn projects_file() -> Result<PathBuf, String> {
    Ok(cairn_dir()?.join("projects").join("projects.json"))
}

pub fn listing_file() -> Result<PathBuf, String> {
    Ok(cairn_dir()?.join("projects").join("listing.json"))
}

pub fn instances_file(project_id: &str) -> Result<PathBuf, String> {
    Ok(cairn_dir()?.join("projects").join(project_id).join("instances.json"))
}

pub fn worktrees_dir(project_id: &str) -> Result<PathBuf, String> {
    Ok(cairn_dir()?.join("projects").join(project_id).join("worktrees"))
}

pub fn ui_state_file() -> Result<PathBuf, String> {
    Ok(cairn_dir()?.join("ui-state.json"))
}

pub fn instance_file_state_file(project_id: &str, instance_id: &str) -> Result<PathBuf, String> {
    Ok(cairn_dir()?
        .join("projects")
        .join(project_id)
        .join("instances")
        .join(instance_id)
        .join("file-state.json"))
}

pub fn instance_commit_state_file(project_id: &str, instance_id: &str) -> Result<PathBuf, String> {
    Ok(cairn_dir()?
        .join("projects")
        .join(project_id)
        .join("instances")
        .join(instance_id)
        .join("commit-state.json"))
}

pub fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> Result<(), String> {
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
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
