// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

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
pub async fn save_file_state(project_id: String, instance_id: String, state: FileState) -> Result<(), String> {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn from_json(json: &str) -> FileState {
        serde_json::from_str(json).expect("file state should parse")
    }

    #[test]
    fn an_instance_that_never_opened_a_file_starts_empty() {
        let state = from_json("{}");
        assert!(state.panes.is_empty());
        assert!(state.expanded.is_empty());
        assert!(state.recent_files.is_empty());
        assert!(!state.split_mode);
    }

    #[test]
    fn a_state_predating_a_field_gains_its_default() {
        let state = from_json(r#"{"expanded": ["src"]}"#);
        assert_eq!(state.expanded, vec!["src"]);
        assert!(state.recent_files.is_empty());
        assert_eq!(state.split_left_width, 0);
    }

    #[test]
    fn the_editor_layout_survives_a_round_trip() {
        let original = FileState {
            panes: vec![serde_json::json!({"tabs": ["a.ts"]})],
            expanded: vec!["src".to_string(), "src/lib".to_string()],
            split_mode: true,
            split_left_width: 420,
            recent_files: vec!["src/a.ts".to_string()],
        };

        let json = serde_json::to_string(&original).expect("should serialize");
        let back = from_json(&json);

        assert_eq!(back.expanded, original.expanded);
        assert!(back.split_mode);
        assert_eq!(back.split_left_width, 420);
        assert_eq!(back.recent_files, original.recent_files);
        assert_eq!(back.panes.len(), 1);
    }

    #[test]
    fn paths_with_spaces_and_accents_come_back_unchanged() {
        let original = FileState {
            expanded: vec!["dossier été".to_string()],
            recent_files: vec!["dossier été/mon fichier.ts".to_string()],
            ..Default::default()
        };
        let json = serde_json::to_string(&original).expect("should serialize");
        let back = from_json(&json);
        assert_eq!(back.expanded, vec!["dossier été"]);
        assert_eq!(back.recent_files, vec!["dossier été/mon fichier.ts"]);
    }

    #[test]
    fn the_panes_are_carried_through_without_being_understood() {
        let state = from_json(r#"{"panes": [{"anything": {"the": "frontend wants"}}]}"#);
        assert_eq!(state.panes.len(), 1);
        let json = serde_json::to_value(&state).expect("should serialize");
        assert_eq!(json["panes"][0]["anything"]["the"], "frontend wants");
    }

    #[test]
    fn it_serializes_under_the_names_the_frontend_reads() {
        let json = serde_json::to_value(FileState::default()).expect("should serialize");
        let object = json.as_object().expect("state should be an object");
        for key in ["panes", "expanded", "splitMode", "splitLeftWidth", "recentFiles"] {
            assert!(object.contains_key(key), "{key} is missing from the payload");
        }
    }

    #[test]
    fn a_corrupted_file_is_reported_rather_than_panicking() {
        assert!(serde_json::from_str::<FileState>("not json").is_err());
        assert!(serde_json::from_str::<FileState>(r#"{"expanded": "src"}"#).is_err());
    }
}
