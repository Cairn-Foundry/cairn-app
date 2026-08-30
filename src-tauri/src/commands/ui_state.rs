//! Navigation state persisted across launches, so the app reopens on the exact
//! view the user left. Every new view that takes over the main area needs its
//! "is it open" flag added here.

use std::collections::HashMap;
use std::fs;
use serde::{Deserialize, Serialize};
use crate::storage::{ui_state_file, write_json_atomic};

/// What one project's workspace was showing: workflow step, active tool, and
/// the transient search fields of the git view.
#[derive(Serialize, Deserialize, Clone)]
pub struct ProjectUiState {
    #[serde(rename = "activeStep", default = "default_step")]
    pub active_step: String,
    #[serde(rename = "gitLeftTab", default = "default_git_left_tab")]
    pub git_left_tab: String,
    #[serde(rename = "terminalActive", default)]
    pub terminal_active: bool,
    #[serde(rename = "commandsActive", default)]
    pub commands_active: bool,
    #[serde(rename = "envActive", default)]
    pub env_active: bool,
    #[serde(rename = "formattingActive", default)]
    pub formatting_active: bool,
    /// The CLI the Agent step last started a conversation with, so its picker
    /// offers it first. Empty until one has been started.
    #[serde(rename = "lastCli", default)]
    pub last_cli: String,
    #[serde(rename = "gitChangesSearch", default)]
    pub git_changes_search: String,
    #[serde(rename = "gitLogSearch", default)]
    pub git_log_search: String,
    #[serde(rename = "gitStagedSearch", default)]
    pub git_staged_search: String,
    #[serde(rename = "referencesPanelOpen", default)]
    pub references_panel_open: bool,
    #[serde(rename = "referencesQuery", default)]
    pub references_query: String,
}

impl Default for ProjectUiState {
    fn default() -> Self {
        Self {
            active_step: default_step(),
            git_left_tab: default_git_left_tab(),
            terminal_active: false,
            commands_active: false,
            env_active: false,
            formatting_active: false,
            last_cli: String::new(),
            git_changes_search: String::new(),
            git_log_search: String::new(),
            git_staged_search: String::new(),
            references_panel_open: false,
            references_query: String::new(),
        }
    }
}

/// Top-level navigation plus one `ProjectUiState` per project ever opened.
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

// Serde defaults, also used by the Default impls so both agree on one value.
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

/// Falls back to the default state on a first launch, but still fails loudly on
/// a corrupt file rather than silently discarding it.
fn read_ui_state() -> Result<UiState, String> {
    let path = ui_state_file()?;
    if !path.exists() { return Ok(UiState::default()); }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

/// Overwrites the whole navigation state atomically.
fn write_ui_state(state: &UiState) -> Result<(), String> {
    write_json_atomic(&ui_state_file()?, state)
}

/// Read once on launch to restore the view the user left.
#[tauri::command]
pub fn get_ui_state() -> Result<UiState, String> {
    read_ui_state()
}

/// Called on every navigation change, debounced by the frontend.
#[tauri::command]
pub async fn save_ui_state(state: UiState) -> Result<(), String> {
    write_ui_state(&state)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn from_json(json: &str) -> UiState {
        serde_json::from_str(json).expect("ui state should parse")
    }

    fn project_from_json(json: &str) -> ProjectUiState {
        serde_json::from_str(json).expect("project state should parse")
    }

    #[test]
    fn an_empty_file_opens_the_app_on_its_defaults() {
        let state = from_json("{}");
        let defaults = UiState::default();
        assert_eq!(state.screen, defaults.screen);
        assert_eq!(state.home_section, defaults.home_section);
        assert!(state.active_project_id.is_none());
        assert!(state.project_states.is_empty());
    }

    #[test]
    fn a_project_that_was_never_opened_starts_on_the_files_step() {
        let state = project_from_json("{}");
        assert_eq!(state.active_step, default_step());
        assert_eq!(state.git_left_tab, default_git_left_tab());
    }

    #[test]
    fn a_project_state_predating_a_field_gains_its_default() {
        let state = project_from_json(r#"{"activeStep": "git"}"#);
        assert_eq!(state.active_step, "git");
        assert!(!state.references_panel_open);
        assert_eq!(state.last_cli, "");
        assert_eq!(state.git_left_tab, default_git_left_tab());
    }

    #[test]
    fn every_tool_flag_starts_closed() {
        let state = project_from_json("{}");
        assert!(!state.terminal_active);
        assert!(!state.commands_active);
        assert!(!state.env_active);
        assert!(!state.formatting_active);
    }

    #[test]
    fn the_view_of_a_project_survives_a_round_trip() {
        let original = ProjectUiState {
            active_step: "tests".to_string(),
            git_left_tab: "graph".to_string(),
            terminal_active: true,
            last_cli: "claude-code".to_string(),
            references_query: r#"{"symbol":"foo"}"#.to_string(),
            ..Default::default()
        };

        let json = serde_json::to_string(&original).expect("should serialize");
        let back = project_from_json(&json);

        assert_eq!(back.active_step, "tests");
        assert_eq!(back.git_left_tab, "graph");
        assert!(back.terminal_active);
        assert_eq!(back.last_cli, "claude-code");
        assert_eq!(back.references_query, r#"{"symbol":"foo"}"#);
    }

    #[test]
    fn several_projects_keep_their_own_view() {
        let state = from_json(
            r#"{"projectStates": {
                "p1": {"activeStep": "git"},
                "p2": {"activeStep": "agent"}
            }}"#,
        );
        assert_eq!(state.project_states["p1"].active_step, "git");
        assert_eq!(state.project_states["p2"].active_step, "agent");
    }

    #[test]
    fn the_whole_state_survives_a_round_trip() {
        let mut original = UiState {
            screen: "workspace".to_string(),
            active_project_id: Some("p1".to_string()),
            open_tab_order: vec!["p1".to_string(), "p2".to_string()],
            ..Default::default()
        };
        original
            .project_states
            .insert("p1".to_string(), ProjectUiState::default());

        let json = serde_json::to_string(&original).expect("should serialize");
        let back = from_json(&json);

        assert_eq!(back.screen, "workspace");
        assert_eq!(back.active_project_id.as_deref(), Some("p1"));
        assert_eq!(back.open_tab_order, vec!["p1", "p2"]);
        assert!(back.project_states.contains_key("p1"));
    }

    #[test]
    fn the_project_view_serializes_under_the_names_the_frontend_reads() {
        let json = serde_json::to_value(ProjectUiState::default()).expect("should serialize");
        let object = json.as_object().expect("state should be an object");
        for key in [
            "activeStep",
            "gitLeftTab",
            "terminalActive",
            "commandsActive",
            "envActive",
            "formattingActive",
            "lastCli",
            "referencesPanelOpen",
            "referencesQuery",
        ] {
            assert!(object.contains_key(key), "{key} is missing from the payload");
        }
    }

    #[test]
    fn a_corrupted_file_is_reported_rather_than_panicking() {
        assert!(serde_json::from_str::<UiState>("not json").is_err());
        assert!(serde_json::from_str::<UiState>("[]").is_err());
    }

    #[test]
    fn a_project_state_of_the_wrong_shape_is_reported() {
        let result = serde_json::from_str::<UiState>(r#"{"projectStates": {"p1": "git"}}"#);
        assert!(result.is_err());
    }

    #[test]
    fn an_unknown_field_from_a_newer_release_is_ignored() {
        let state = project_from_json(r#"{"activeStep": "git", "shippedLater": true}"#);
        assert_eq!(state.active_step, "git");
    }
}
