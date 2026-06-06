use std::collections::HashMap;
use std::fs;
use serde::{Deserialize, Serialize};
use crate::storage::ui_state_file;

#[derive(Serialize, Deserialize, Clone)]
pub struct ProjectUiState {
    #[serde(rename = "activeStep", default = "default_step")]
    pub active_step: String,
    #[serde(rename = "gitLeftTab", default = "default_git_left_tab")]
    pub git_left_tab: String,
}

impl Default for ProjectUiState {
    fn default() -> Self {
        Self {
            active_step: default_step(),
            git_left_tab: default_git_left_tab(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct UiState {
    #[serde(default = "default_screen")]
    pub screen: String,
    #[serde(rename = "activeProjectId")]
    pub active_project_id: Option<String>,
    #[serde(rename = "openTabOrder", default)]
    pub open_tab_order: Vec<String>,
    #[serde(rename = "homeSection", default = "default_home_section")]
    pub home_section: String,
    #[serde(rename = "homeSettingsTab", default = "default_settings_tab")]
    pub home_settings_tab: String,
    #[serde(rename = "projectStates", default)]
    pub project_states: HashMap<String, ProjectUiState>,
}

fn default_screen() -> String { "home".to_string() }
fn default_step() -> String { "files".to_string() }
fn default_home_section() -> String { "projects".to_string() }
fn default_settings_tab() -> String { "general".to_string() }
fn default_git_left_tab() -> String { "changes".to_string() }

impl Default for UiState {
    fn default() -> Self {
        Self {
            screen: default_screen(),
            active_project_id: None,
            open_tab_order: Vec::new(),
            home_section: default_home_section(),
            home_settings_tab: default_settings_tab(),
            project_states: HashMap::new(),
        }
    }
}

fn read_ui_state() -> Result<UiState, String> {
    let path = ui_state_file()?;
    if !path.exists() { return Ok(UiState::default()); }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

fn write_ui_state(state: &UiState) -> Result<(), String> {
    let path = ui_state_file()?;
    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    fs::write(&path, serde_json::to_string_pretty(state).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_ui_state() -> Result<UiState, String> {
    read_ui_state()
}

#[tauri::command]
pub fn save_ui_state(state: UiState) -> Result<(), String> {
    write_ui_state(&state)
}
