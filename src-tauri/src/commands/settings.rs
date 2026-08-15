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
    #[serde(rename = "uiScale", default = "default_ui_scale")]
    pub ui_scale: f64,
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
    #[serde(rename = "quickSearchShowGitignored", default = "default_quick_search_show_gitignored")]
    pub quick_search_show_gitignored: bool,
    #[serde(rename = "autoCheckUpdates", default = "default_auto_check_updates")]
    pub auto_check_updates: bool,
    #[serde(rename = "syntaxThemes", default)]
    pub syntax_themes: Vec<SyntaxTheme>,
    #[serde(rename = "activeSyntaxThemeId", default)]
    pub active_syntax_theme_id: String,
    #[serde(rename = "languageServers", default)]
    pub language_servers: Vec<LanguageServerSetting>,
    #[serde(rename = "suggestLanguageServers", default = "default_suggest_language_servers")]
    pub suggest_language_servers: bool,
    #[serde(rename = "dismissedLanguageServers", default)]
    pub dismissed_language_servers: Vec<String>,
    #[serde(rename = "customLanguageServers", default)]
    pub custom_language_servers: Vec<CustomLanguageServer>,
    #[serde(rename = "agentShowLiveActivity", default = "default_true")]
    pub agent_show_live_activity: bool,
    #[serde(rename = "agentActivityShowTime", default = "default_true")]
    pub agent_activity_show_time: bool,
    #[serde(rename = "agentActivityShowToolArgs", default = "default_true")]
    pub agent_activity_show_tool_args: bool,
    #[serde(rename = "agentActivityAutoScroll", default = "default_true")]
    pub agent_activity_auto_scroll: bool,
    #[serde(rename = "agentShowMessageTime", default = "default_true")]
    pub agent_show_message_time: bool,
    #[serde(rename = "agentShowThinking", default = "default_true")]
    pub agent_show_thinking: bool,
    #[serde(rename = "agentShowMessageCopy", default = "default_true")]
    pub agent_show_message_copy: bool,
    #[serde(rename = "agentShowResponseStats", default = "default_true")]
    pub agent_show_response_stats: bool,
    #[serde(rename = "agentResponseStats", default = "default_response_stats")]
    pub agent_response_stats: Vec<String>,
    #[serde(rename = "agentShowContextWindow", default = "default_true")]
    pub agent_show_context_window: bool,
    #[serde(rename = "agentShowConversationCost", default = "default_true")]
    pub agent_show_conversation_cost: bool,
    #[serde(rename = "agentShowRateLimit", default = "default_true")]
    pub agent_show_rate_limit: bool,
    #[serde(rename = "agentShowModelChip", default = "default_true")]
    pub agent_show_model_chip: bool,
    #[serde(rename = "agentShowEffortChip", default = "default_true")]
    pub agent_show_effort_chip: bool,
    #[serde(rename = "agentShowPermissionChip", default = "default_true")]
    pub agent_show_permission_chip: bool,
}

/// A language server the user brought themselves. Cairn runs it exactly as it
/// runs a catalogue one, but never installs, updates or removes it: it did not
/// put it there.
#[derive(Serialize, Deserialize, Clone)]
pub struct CustomLanguageServer {
    pub id:     String,
    pub name:   String,
    pub binary: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(rename = "languageIds", default)]
    pub language_ids: Vec<String>,
    #[serde(default)]
    pub extensions: Vec<String>,
    #[serde(rename = "rootMarkers", default)]
    pub root_markers: Vec<String>,
    #[serde(rename = "docUrl", default)]
    pub doc_url: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct LanguageServerSetting {
    pub id: String,
    pub enabled: bool,
    /// Empty means the binary from the catalogue.
    #[serde(default)]
    pub command: String,
    /// Empty means the arguments from the catalogue.
    #[serde(default)]
    pub args: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SyntaxTokenStyle {
    pub color: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bold: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub italic: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub underline: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SyntaxTheme {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub tokens: std::collections::HashMap<String, SyntaxTokenStyle>,
}

fn default_true() -> bool { true }

// Keep in sync with RESPONSE_STAT_FIELDS in src/lib/utils/agent/response-stats.ts.
fn default_response_stats() -> Vec<String> {
    ["duration", "tokens", "cost", "turns"].iter().map(|s| s.to_string()).collect()
}
fn default_agent_activity_width() -> u32 { 300 }
fn default_suggest_language_servers() -> bool { true }
fn default_auto_check_updates() -> bool { true }
fn default_quick_search_show_gitignored() -> bool { false }
fn default_sidebar_position() -> String { "left".to_string() }
fn default_show_whitespace() -> bool { false }
fn default_save_on() -> String { "blur".to_string() }
fn default_tree_panel_width() -> u32 { 220 }
fn default_show_minimap() -> bool { true }
fn default_editor_font_size() -> u32 { 13 }
fn default_ui_scale() -> f64 { 1.0 }
fn default_editor_font_family() -> String { "'JetBrains Mono', ui-monospace, monospace".to_string() }
fn default_split_mode() -> bool { false }
fn default_split_left_width() -> u32 { 0 }
fn default_theme() -> String { "default".to_string() }
fn default_accent_color() -> String { "#6c8eff".to_string() }

impl Default for CairnSettings {
    fn default() -> Self {
        CairnSettings {
            tree_panel_width: default_tree_panel_width(),
            show_minimap: default_show_minimap(),
            editor_font_size: default_editor_font_size(),
            ui_scale: default_ui_scale(),
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
            quick_search_show_gitignored: default_quick_search_show_gitignored(),
            auto_check_updates: default_auto_check_updates(),
            syntax_themes: Vec::new(),
            active_syntax_theme_id: String::new(),
            language_servers: Vec::new(),
            suggest_language_servers: default_suggest_language_servers(),
            dismissed_language_servers: Vec::new(),
            custom_language_servers: Vec::new(),
            agent_show_live_activity: true,
            agent_activity_show_time: true,
            agent_activity_show_tool_args: true,
            agent_activity_auto_scroll: true,
            agent_show_message_time: true,
            agent_show_thinking: true,
            agent_show_message_copy: true,
            agent_show_response_stats: true,
            agent_response_stats: default_response_stats(),
            agent_show_context_window: true,
            agent_show_conversation_cost: true,
            agent_show_rate_limit: true,
            agent_show_model_chip: true,
            agent_show_effort_chip: true,
            agent_show_permission_chip: true,
        }
    }
}

pub fn read_settings() -> Result<CairnSettings, String> {
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

/// Turns the native translucency of the window on or off. Only macOS has a real
/// vibrancy layer; elsewhere the glass theme falls back to its CSS blur.
#[tauri::command]
pub fn set_window_vibrancy(window: tauri::WebviewWindow, enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use window_vibrancy::{apply_vibrancy, clear_vibrancy, NSVisualEffectMaterial};

        if enabled {
            apply_vibrancy(&window, NSVisualEffectMaterial::HudWindow, None, None)
                .map_err(|e| e.to_string())?;
        } else {
            clear_vibrancy(&window).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, enabled);
        Ok(())
    }
}
