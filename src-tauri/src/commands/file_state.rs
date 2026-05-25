use std::fs;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use crate::storage::instance_file_state_file;

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

fn read_file_state(project_id: &str, instance_id: &str) -> Result<Option<FileState>, String> {
    let path = instance_file_state_file(project_id, instance_id)?;
    if !path.exists() { return Ok(None); }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let state = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(Some(state))
}

fn write_file_state(project_id: &str, instance_id: &str, state: &FileState) -> Result<(), String> {
    let path = instance_file_state_file(project_id, instance_id)?;
    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    fs::write(&path, serde_json::to_string_pretty(state).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_file_state(project_id: String, instance_id: String) -> Result<Option<FileState>, String> {
    read_file_state(&project_id, &instance_id)
}

#[tauri::command]
pub fn save_file_state(project_id: String, instance_id: String, state: FileState) -> Result<(), String> {
    write_file_state(&project_id, &instance_id, &state)
}

pub fn delete_file_state_dir(project_id: &str, instance_id: &str) -> Result<(), String> {
    let path = instance_file_state_file(project_id, instance_id)?;
    let dir = path.parent().unwrap().to_path_buf();
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}
