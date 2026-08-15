//! Which file groups are folded in the git view of one instance, so the view
//! reopens folded the same way.

use std::fs;
use serde::{Deserialize, Serialize};
use crate::storage::{instance_git_collapse_state_file, write_json_atomic};

/// Folded groups of the git view, listed by path.
#[derive(Serialize, Deserialize, Clone, Default)]
pub struct GitCollapseState {
    #[serde(rename = "collapsedUnstaged", default)]
    pub collapsed_unstaged: Vec<String>,
    #[serde(rename = "collapsedStaged", default)]
    pub collapsed_staged: Vec<String>,
    #[serde(rename = "expandedStaged", default)]
    pub expanded_staged: Vec<String>,
}

/// `None` when the instance has never folded anything.
fn read_git_collapse_state(project_id: &str, instance_id: &str) -> Result<Option<GitCollapseState>, String> {
    let path = instance_git_collapse_state_file(project_id, instance_id)?;
    if !path.exists() { return Ok(None); }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Ok(Some(serde_json::from_str(&content).map_err(|e| e.to_string())?))
}

/// Overwrites the whole state atomically.
fn write_git_collapse_state(project_id: &str, instance_id: &str, state: &GitCollapseState) -> Result<(), String> {
    write_json_atomic(&instance_git_collapse_state_file(project_id, instance_id)?, state)
}

/// `None` means everything starts expanded.
#[tauri::command]
pub fn get_git_collapse_state(project_id: String, instance_id: String) -> Result<Option<GitCollapseState>, String> {
    read_git_collapse_state(&project_id, &instance_id)
}

/// Called on every fold or unfold in the git view.
#[tauri::command]
pub fn save_git_collapse_state(project_id: String, instance_id: String, state: GitCollapseState) -> Result<(), String> {
    write_git_collapse_state(&project_id, &instance_id, &state)
}
