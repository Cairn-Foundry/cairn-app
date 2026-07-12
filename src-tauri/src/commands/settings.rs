use std::fs;
use serde::{Deserialize, Serialize};
use crate::storage::{settings_file, write_json_atomic};

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct CairnShortcutBinding {
    pub key: String,
    #[serde(rename = "mod", default)]
    pub is_mod: bool,
    #[serde(default)]
    pub shift: bool,
    #[serde(default)]
    pub alt: bool,
    #[serde(default)]
    pub ctrl: bool,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ShortcutConfig {
    pub id: String,
    pub binding: Option<CairnShortcutBinding>,
    pub enabled: bool,
}

fn deserialize_shortcuts<'de, D>(deserializer: D) -> Result<Vec<ShortcutConfig>, D::Error>
where D: serde::Deserializer<'de> {
    let v = serde_json::Value::deserialize(deserializer).unwrap_or(serde_json::Value::Null);
    Ok(serde_json::from_value::<Vec<ShortcutConfig>>(v).unwrap_or_default())
}

#[derive(Serialize, Deserialize, Clone)]
pub struct WorkflowTabConfig {
    pub key: String,
    pub name: String,
    pub icon: String,
    pub enabled: bool,
    pub order: u32,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct GitProfile {
    pub id: String,
    pub label: String,
    pub name: String,
    pub email: String,
}

// Keep this list in sync with DEFAULT_WF_TABS in
// src/lib/utils/home/workflow-tabs.ts (same keys, order and icons).
fn default_workflow_tabs() -> Vec<WorkflowTabConfig> {
    vec![
        WorkflowTabConfig { key: "files".into(),  name: "Files".into(),  icon: "folder".into(), enabled: true, order: 0 },
        WorkflowTabConfig { key: "agent".into(),  name: "Agent".into(),  icon: "agent".into(),  enabled: true, order: 1 },
        WorkflowTabConfig { key: "tests".into(),  name: "Tests".into(),  icon: "tests".into(),  enabled: true, order: 2 },
        WorkflowTabConfig { key: "git".into(),    name: "Git".into(),    icon: "git".into(),    enabled: true, order: 3 },
        WorkflowTabConfig { key: "cicd".into(),   name: "CI/CD".into(),  icon: "ci".into(),     enabled: true, order: 4 },
        WorkflowTabConfig { key: "review".into(), name: "Review".into(), icon: "review".into(), enabled: true, order: 5 },
    ]
}

#[derive(Serialize, Deserialize, Clone)]
pub struct CairnSettings {
    #[serde(rename = "treePanelWidth", default = "default_tree_panel_width")]
    pub tree_panel_width: u32,
    #[serde(rename = "showMinimap", default = "default_show_minimap")]
    pub show_minimap: bool,
    #[serde(rename = "editorFontSize", default = "default_editor_font_size")]
    pub editor_font_size: u32,
    #[serde(rename = "fontFamily", default = "default_editor_font_family")]
    pub editor_font_family: String,
    #[serde(rename = "splitMode", default = "default_split_mode")]
    pub split_mode: bool,
    #[serde(rename = "splitLeftWidth", default = "default_split_left_width")]
    pub split_left_width: u32,
    #[serde(default, deserialize_with = "deserialize_shortcuts")]
    pub shortcuts: Vec<ShortcutConfig>,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(rename = "accentColor", default = "default_accent_color")]
    pub accent_color: String,
    #[serde(rename = "workflowTabs", default = "default_workflow_tabs")]
    pub workflow_tabs: Vec<WorkflowTabConfig>,
    #[serde(rename = "sidebarPosition", default = "default_sidebar_position")]
    pub sidebar_position: String,
    #[serde(rename = "showWhitespace", default = "default_show_whitespace")]
    pub show_whitespace: bool,
    #[serde(rename = "saveOn", default = "default_save_on")]
    pub save_on: String,
    #[serde(rename = "gitProfiles", default)]
    pub git_profiles: Vec<GitProfile>,
    #[serde(rename = "agentActivityWidth", default = "default_agent_activity_width")]
    pub agent_activity_width: u32,
}

fn default_agent_activity_width() -> u32 { 300 }
fn default_sidebar_position() -> String { "left".to_string() }
fn default_show_whitespace() -> bool { false }
fn default_save_on() -> String { "blur".to_string() }
fn default_tree_panel_width() -> u32 { 220 }
fn default_show_minimap() -> bool { true }
fn default_editor_font_size() -> u32 { 13 }
fn default_editor_font_family() -> String { "'JetBrains Mono', ui-monospace, monospace".to_string() }
fn default_split_mode() -> bool { false }
fn default_split_left_width() -> u32 { 0 }
fn default_theme() -> String { "dark".to_string() }
fn default_accent_color() -> String { "#6c8eff".to_string() }

impl Default for CairnSettings {
    fn default() -> Self {
        CairnSettings {
            tree_panel_width: default_tree_panel_width(),
            show_minimap: default_show_minimap(),
            editor_font_size: default_editor_font_size(),
            editor_font_family: default_editor_font_family(),
            split_mode: false,
            split_left_width: 0,
            shortcuts: Vec::new(),
            theme: default_theme(),
            accent_color: default_accent_color(),
            workflow_tabs: default_workflow_tabs(),
            sidebar_position: default_sidebar_position(),
            show_whitespace: default_show_whitespace(),
            save_on: default_save_on(),
            git_profiles: Vec::new(),
            agent_activity_width: default_agent_activity_width(),
        }
    }
}

fn read_settings() -> Result<CairnSettings, String> {
    let path = settings_file()?;
    if !path.exists() { return Ok(CairnSettings::default()); }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

fn write_settings(settings: &CairnSettings) -> Result<(), String> {
    write_json_atomic(&settings_file()?, settings)
}

#[tauri::command]
pub fn get_settings() -> Result<CairnSettings, String> {
    read_settings()
}

#[tauri::command]
pub fn update_settings(settings: CairnSettings) -> Result<CairnSettings, String> {
    write_settings(&settings)?;
    Ok(settings)
}
