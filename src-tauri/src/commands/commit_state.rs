//! Commit options the git view remembers per instance, so reopening it offers
//! the same flags and profile as last time.

use std::fs;
use serde::{Deserialize, Serialize};
use crate::storage::{instance_commit_state_file, write_json_atomic};

/// Sticky state of the commit form of one instance.
#[derive(Serialize, Deserialize, Clone, Default)]
pub struct CommitState {
    #[serde(rename = "noVerify", default)]
    pub no_verify: bool,
    #[serde(rename = "signOff", default)]
    pub sign_off: bool,
    #[serde(rename = "allowEmpty", default)]
    pub allow_empty: bool,
    #[serde(rename = "selectedProfileId", default)]
    pub selected_profile_id: String,
    #[serde(rename = "appendTicketId", default)]
    pub append_ticket_id: bool,
}

/// `None` when the instance has never committed through the app.
fn read_commit_state(project_id: &str, instance_id: &str) -> Result<Option<CommitState>, String> {
    let path = instance_commit_state_file(project_id, instance_id)?;
    if !path.exists() { return Ok(None); }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Ok(Some(serde_json::from_str(&content).map_err(|e| e.to_string())?))
}

/// Overwrites the whole state atomically.
fn write_commit_state(project_id: &str, instance_id: &str, state: &CommitState) -> Result<(), String> {
    write_json_atomic(&instance_commit_state_file(project_id, instance_id)?, state)
}

/// `None` lets the frontend fall back to its own defaults.
#[tauri::command]
pub fn get_commit_state(project_id: String, instance_id: String) -> Result<Option<CommitState>, String> {
    read_commit_state(&project_id, &instance_id)
}

/// Called on every change of the commit options.
#[tauri::command]
pub fn save_commit_state(project_id: String, instance_id: String, state: CommitState) -> Result<(), String> {
    write_commit_state(&project_id, &instance_id, &state)
}
