//! The "an agent finished and you have not read it" markers, mapping an
//! instance key to the conversation id that came back.

use std::collections::HashMap;
use std::fs;
use crate::storage::{agent_activity_file, write_json_atomic};

/// Empty on a first launch; a corrupt file still surfaces as an error.
#[tauri::command]
pub fn get_agent_activity() -> Result<HashMap<String, String>, String> {
    let path = agent_activity_file()?;
    if !path.exists() {
        return Ok(HashMap::new());
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

/// Replaces the whole map: dropping a key is how a marker gets cleared.
#[tauri::command]
pub async fn save_agent_activity(done: HashMap<String, String>) -> Result<(), String> {
    write_json_atomic(&agent_activity_file()?, &done)
}
