//! The last test run of an instance, so the step reopens on its result instead
//! of on an empty screen. Kept in its own file rather than in `ProjectUiState`,
//! which only holds scalars.

use std::fs;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::storage::{instance_test_state_file, write_json_atomic};

/// The suites and the summary stay opaque here: their shape belongs to the
/// runner adapters, and this layer only has to hand them back unchanged.
#[derive(Serialize, Deserialize, Clone, Default)]
pub struct TestPersistedState {
    #[serde(rename = "runnerId", default)]
    pub runner_id:        String,
    #[serde(default)]
    pub suites:           Vec<Value>,
    #[serde(default)]
    pub summary:          Option<Value>,
    #[serde(rename = "selectedCaseId", default)]
    pub selected_case_id: String,
    #[serde(default)]
    pub filter:           String,
    #[serde(default)]
    pub search:           String,
}

/// `None` when the instance has never run its tests.
#[tauri::command]
pub fn get_test_state(
    project_id: String,
    instance_id: String,
) -> Result<Option<TestPersistedState>, String> {
    let path = instance_test_state_file(&project_id, &instance_id)?;
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Ok(serde_json::from_str(&content).ok())
}

/// Overwrites the whole state atomically; called debounced after a run.
#[tauri::command]
pub fn save_test_state(
    project_id: String,
    instance_id: String,
    state: TestPersistedState,
) -> Result<(), String> {
    write_json_atomic(&instance_test_state_file(&project_id, &instance_id)?, &state)
}
