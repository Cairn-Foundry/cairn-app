//! Editor state of one instance: open panes, tree expansion, split layout and
//! recent files, so the Files view reopens exactly as it was left.

use std::fs;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use crate::storage::{instance_file_state_file, write_json_atomic};

/// Editor layout of one instance. `panes` stays opaque `Value`: its shape is
/// owned by the frontend and must survive round-tripping unchanged.
#[derive(Serialize, Deserialize, Clone, Default)]
pub struct FileState {
    #[serde(default)]
    pub panes: Vec<Value>,
    #[serde(default)]
    pub expanded: Vec<String>,
    #[serde(rename = "splitMode", default)]
    pub split_mode: bool,
    #[serde(rename = "splitLeftWidth", default)]
    pub split_left_width: u32,
    #[serde(rename = "recentFiles", default)]
    pub recent_files: Vec<String>,
}

/// `None` when the instance has never opened a file.
fn read_file_state(project_id: &str, instance_id: &str) -> Result<Option<FileState>, String> {
    let path = instance_file_state_file(project_id, instance_id)?;
    if !path.exists() { return Ok(None); }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let state = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(Some(state))
}

/// Overwrites the whole state atomically.
fn write_file_state(project_id: &str, instance_id: &str, state: &FileState) -> Result<(), String> {
    write_json_atomic(&instance_file_state_file(project_id, instance_id)?, state)
}

/// `None` lets the frontend start from an empty editor.
#[tauri::command]
pub fn get_file_state(project_id: String, instance_id: String) -> Result<Option<FileState>, String> {
    read_file_state(&project_id, &instance_id)
}

/// Called as tabs, cursor and scroll change.
#[tauri::command]
pub fn save_file_state(project_id: String, instance_id: String, state: FileState) -> Result<(), String> {
    write_file_state(&project_id, &instance_id, &state)
}

/// Drops the whole instance directory, not just the file state: called when the
/// instance itself is deleted.
pub fn delete_file_state_dir(project_id: &str, instance_id: &str) -> Result<(), String> {
    let path = instance_file_state_file(project_id, instance_id)?;
    let dir = path.parent().unwrap().to_path_buf();
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}
