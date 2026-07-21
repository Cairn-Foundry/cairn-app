use std::fs;
use serde::{Deserialize, Serialize};
use crate::storage::{instance_git_collapse_state_file, write_json_atomic};

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct GitCollapseState {
    #[serde(rename = "collapsedUnstaged", default)]
    pub collapsed_unstaged: Vec<String>,
    #[serde(rename = "collapsedStaged", default)]
    pub collapsed_staged: Vec<String>,
}

fn read_git_collapse_state(project_id: &str, instance_id: &str) -> Result<Option<GitCollapseState>, String> {
    let path = instance_git_collapse_state_file(project_id, instance_id)?;
    if !path.exists() { return Ok(None); }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Ok(Some(serde_json::from_str(&content).map_err(|e| e.to_string())?))
}

fn write_git_collapse_state(project_id: &str, instance_id: &str, state: &GitCollapseState) -> Result<(), String> {
    write_json_atomic(&instance_git_collapse_state_file(project_id, instance_id)?, state)
}

#[tauri::command]
pub fn get_git_collapse_state(project_id: String, instance_id: String) -> Result<Option<GitCollapseState>, String> {
    read_git_collapse_state(&project_id, &instance_id)
}

#[tauri::command]
pub fn save_git_collapse_state(project_id: String, instance_id: String, state: GitCollapseState) -> Result<(), String> {
    write_git_collapse_state(&project_id, &instance_id, &state)
}
