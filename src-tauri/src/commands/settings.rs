//! Global app settings. `CairnSettings` is mirrored field for field in
//! `settings-service.ts`, so a field added here needs its counterpart there.

use std::fs;
use serde::{Deserialize, Serialize};
use crate::storage::{settings_file, write_json_atomic};

/// One key binding overriding a shortcut's default.
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

/// The user's bindings for one shortcut id.
#[derive(Serialize, Deserialize, Clone)]
pub struct ShortcutConfig {
    pub id: String,
    pub binding: Option<CairnShortcutBinding>,
    pub enabled: bool,
}

/// Tolerates a malformed shortcuts block by dropping it: a bad binding must
/// never stop the whole settings file from loading.
fn deserialize_shortcuts<'de, D>(deserializer: D) -> Result<Vec<ShortcutConfig>, D::Error>
where D: serde::Deserializer<'de> {
    let v = serde_json::Value::deserialize(deserializer).unwrap_or(serde_json::Value::Null);
    Ok(serde_json::from_value::<Vec<ShortcutConfig>>(v).unwrap_or_default())
}

/// A workflow tab and whether the user kept it visible.
#[derive(Serialize, Deserialize, Clone)]
pub struct WorkflowTabConfig {
    pub key: String,
    pub name: String,
    pub icon: String,
    pub enabled: bool,
    pub order: u32,
}

/// Which provider serves one AI feature. Every field may be empty: an empty
/// `provider_id` or `model` means the default provider, an empty
/// `prompt_template` the feature's own default.
#[derive(Serialize, Deserialize, Clone, Default)]
pub struct AiFeatureAssignment {
    #[serde(rename = "providerId", default)]
    pub provider_id: String,
    #[serde(default)]
    pub model: String,
    #[serde(rename = "promptTemplate", default)]
    pub prompt_template: String,
}

/// A named identity (name, email) selectable when committing.
#[derive(Serialize, Deserialize, Clone)]
pub struct GitProfile {
    pub id: String,
    pub label: String,
    pub name: String,
    pub email: String,
}

// Keep this list in sync with DEFAULT_WF_TABS in
// src/lib/utils/home/workflow-tabs.ts (same keys, order and icons).
/// The workflow tabs, in the order they ship enabled.
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

/// Global app settings. Mirrored field for field in `settings-service.ts`;
/// every field carries a serde default so an older file still loads.
#[derive(Serialize, Deserialize, Clone)]
pub struct CairnSettings {
    #[serde(rename = "treePanelWidth", default = "default_tree_panel_width")]
    pub tree_panel_width: u32,
    #[serde(rename = "showMinimap", default = "default_show_minimap")]
    pub show_minimap: bool,
    #[serde(rename = "stickyScroll", default = "default_sticky_scroll")]
    pub sticky_scroll: bool,
    #[serde(rename = "lineWrap", default)]
    pub line_wrap: bool,
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
    #[serde(rename = "workspaceSidebarPosition", default = "default_sidebar_position")]
    pub workspace_sidebar_position: String,
    #[serde(rename = "showPinnedCommandsSidebar", default = "default_true")]
    pub show_pinned_commands_sidebar: bool,
    #[serde(rename = "transparencyEffects", default = "default_true")]
    pub transparency_effects: bool,
    #[serde(rename = "iconAnimations", default = "default_true")]
    pub icon_animations: bool,
    #[serde(rename = "showWhitespace", default = "default_show_whitespace")]
    pub show_whitespace: bool,
    #[serde(rename = "saveOn", default = "default_save_on")]
    pub save_on: String,
    #[serde(rename = "gitProfiles", default)]
    pub git_profiles: Vec<GitProfile>,
    #[serde(rename = "quickSearchShowGitignored", default = "default_quick_search_show_gitignored")]
    pub quick_search_show_gitignored: bool,
    #[serde(rename = "autoCheckUpdates", default = "default_auto_check_updates")]
    pub auto_check_updates: bool,
    #[serde(rename = "aiEnabled", default = "default_ai_enabled")]
    pub ai_enabled: bool,
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
    /// Keyed by the feature id; a feature with no entry runs on the default provider.
    #[serde(rename = "aiFeatures", default)]
    pub ai_features: std::collections::HashMap<String, AiFeatureAssignment>,
    #[serde(rename = "integrationsPollSeconds", default = "default_integrations_poll_seconds")]
    pub integrations_poll_seconds: u64,
    #[serde(rename = "branchTemplate", default = "default_branch_template")]
    pub branch_template: String,
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

/// Per-language server preference: which one to use and how to launch it.
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

/// Colour and weight of one syntax token class.
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

/// A complete set of token styles.
#[derive(Serialize, Deserialize, Clone)]
pub struct SyntaxTheme {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub tokens: std::collections::HashMap<String, SyntaxTokenStyle>,
}

fn default_true() -> bool { true }

// Keep in sync with RESPONSE_STAT_FIELDS in src/lib/utils/agent/response-stats.ts.
fn default_suggest_language_servers() -> bool { true }
fn default_auto_check_updates() -> bool { true }
fn default_ai_enabled() -> bool { true }
fn default_quick_search_show_gitignored() -> bool { false }
fn default_sidebar_position() -> String { "left".to_string() }
fn default_show_whitespace() -> bool { false }
fn default_save_on() -> String { "blur".to_string() }
fn default_tree_panel_width() -> u32 { 220 }
fn default_show_minimap() -> bool { true }
fn default_sticky_scroll() -> bool { true }
fn default_editor_font_size() -> u32 { 13 }
fn default_ui_scale() -> f64 { 1.0 }
fn default_editor_font_family() -> String { "Menlo, ui-monospace, monospace".to_string() }
fn default_split_mode() -> bool { false }
fn default_split_left_width() -> u32 { 0 }
fn default_theme() -> String { "default".to_string() }
fn default_accent_color() -> String { "#6c8eff".to_string() }
pub(crate) fn default_integrations_poll_seconds() -> u64 { 10 }
fn default_branch_template() -> String { "feat/{{key}}-{{slug}}".to_string() }

impl Default for CairnSettings {
    fn default() -> Self {
        CairnSettings {
            tree_panel_width: default_tree_panel_width(),
            show_minimap: default_show_minimap(),
            sticky_scroll: default_sticky_scroll(),
            line_wrap: false,
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
            workspace_sidebar_position: default_sidebar_position(),
            show_pinned_commands_sidebar: true,
            transparency_effects: true,
            icon_animations: true,
            show_whitespace: default_show_whitespace(),
            save_on: default_save_on(),
            git_profiles: Vec::new(),
            quick_search_show_gitignored: default_quick_search_show_gitignored(),
            auto_check_updates: default_auto_check_updates(),
            ai_enabled: default_ai_enabled(),
            syntax_themes: Vec::new(),
            active_syntax_theme_id: String::new(),
            language_servers: Vec::new(),
            suggest_language_servers: default_suggest_language_servers(),
            dismissed_language_servers: Vec::new(),
            custom_language_servers: Vec::new(),
            ai_features: std::collections::HashMap::new(),
            integrations_poll_seconds: default_integrations_poll_seconds(),
            branch_template: default_branch_template(),
        }
    }
}

/// Defaults on a first launch; shared with the other command modules.
pub fn read_settings() -> Result<CairnSettings, String> {
    let path = settings_file()?;
    if !path.exists() { return Ok(CairnSettings::default()); }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

/// Overwrites the whole settings file atomically.
fn write_settings(settings: &CairnSettings) -> Result<(), String> {
    write_json_atomic(&settings_file()?, settings)
}

/// Read once on launch and after every save.
#[tauri::command]
pub fn get_settings() -> Result<CairnSettings, String> {
    read_settings()
}

/// Replaces the whole settings object and echoes back what was stored.
#[tauri::command]
pub async fn update_settings(settings: CairnSettings) -> Result<CairnSettings, String> {
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

#[cfg(test)]
mod tests {
    use super::*;

    /// What a settings file written by an older release looks like: the fields
    /// that shipped later are simply absent.
    fn from_json(json: &str) -> CairnSettings {
        serde_json::from_str(json).expect("settings should parse")
    }

    #[test]
    fn an_empty_file_loads_as_the_factory_settings() {
        let settings = from_json("{}");
        let defaults = CairnSettings::default();
        assert_eq!(settings.editor_font_size, defaults.editor_font_size);
        assert_eq!(settings.show_minimap, defaults.show_minimap);
        assert_eq!(settings.save_on, defaults.save_on);
    }

    #[test]
    fn a_file_predating_a_field_gains_its_default() {
        let settings = from_json(r#"{"editorFontSize": 20}"#);
        assert_eq!(settings.editor_font_size, 20);
        assert_eq!(settings.save_on, default_save_on());
        assert_eq!(settings.auto_check_updates, default_auto_check_updates());
    }

    #[test]
    fn a_stored_value_wins_over_the_default() {
        let settings = from_json(r#"{"showMinimap": false, "autoCheckUpdates": false}"#);
        assert!(!settings.show_minimap);
        assert!(!settings.auto_check_updates);
    }

    #[test]
    fn a_field_the_app_no_longer_knows_is_ignored() {
        let settings = from_json(r#"{"removedInV2": "gone", "editorFontSize": 15}"#);
        assert_eq!(settings.editor_font_size, 15);
    }

    #[test]
    fn the_workflow_tabs_are_restored_when_the_file_has_none() {
        let settings = from_json("{}");
        assert_eq!(settings.workflow_tabs.len(), default_workflow_tabs().len());
    }

    #[test]
    fn settings_survive_a_round_trip_through_json() {
        let original = CairnSettings {
            editor_font_size: 17,
            save_on: "change".to_string(),
            show_whitespace: true,
            ..Default::default()
        };

        let json = serde_json::to_string(&original).expect("should serialize");
        let back = from_json(&json);

        assert_eq!(back.editor_font_size, 17);
        assert_eq!(back.save_on, "change");
        assert!(back.show_whitespace);
    }

    #[test]
    fn settings_serialize_under_the_names_the_frontend_reads() {
        let json = serde_json::to_value(CairnSettings::default()).expect("should serialize");
        let object = json.as_object().expect("settings should be an object");
        for key in [
            "treePanelWidth",
            "showMinimap",
            "editorFontSize",
            "workflowTabs",
            "saveOn",
            "autoCheckUpdates",
        ] {
            assert!(object.contains_key(key), "{key} is missing from the payload");
        }
    }

    #[test]
    fn a_corrupted_file_is_reported_rather_than_panicking() {
        assert!(serde_json::from_str::<CairnSettings>("not json at all").is_err());
        assert!(serde_json::from_str::<CairnSettings>("{").is_err());
    }

    #[test]
    fn a_field_of_the_wrong_type_is_reported() {
        let result = serde_json::from_str::<CairnSettings>(r#"{"editorFontSize": "big"}"#);
        assert!(result.is_err());
    }

    #[test]
    fn the_defaults_agree_with_the_serde_defaults() {
        let from_default_impl = CairnSettings::default();
        let from_empty_file = from_json("{}");
        assert_eq!(
            from_default_impl.editor_font_size,
            from_empty_file.editor_font_size
        );
        assert_eq!(from_default_impl.ui_scale, from_empty_file.ui_scale);
        assert_eq!(
            from_default_impl.editor_font_family,
            from_empty_file.editor_font_family
        );
    }
}
