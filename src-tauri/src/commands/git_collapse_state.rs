// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Which file groups are folded in the git view of one instance, so the view
//! reopens folded the same way.

use std::fs;
use serde::{Deserialize, Serialize};
use crate::storage::{instance_git_collapse_state_file, write_json_atomic};

/// Folded groups of the git view, listed by path.
#[derive(Serialize, Deserialize, Clone, Default)]
pub struct GitCollapseState {
    #[serde(rename = "collapsedUnstaged", default)]
    pub collapsed_unstaged: Vec<String>,
    #[serde(rename = "collapsedStaged", default)]
    pub collapsed_staged: Vec<String>,
    #[serde(rename = "expandedStaged", default)]
    pub expanded_staged: Vec<String>,
}

/// `None` when the instance has never folded anything.
fn read_git_collapse_state(project_id: &str, instance_id: &str) -> Result<Option<GitCollapseState>, String> {
    let path = instance_git_collapse_state_file(project_id, instance_id)?;
    if !path.exists() { return Ok(None); }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Ok(Some(serde_json::from_str(&content).map_err(|e| e.to_string())?))
}

/// Overwrites the whole state atomically.
fn write_git_collapse_state(project_id: &str, instance_id: &str, state: &GitCollapseState) -> Result<(), String> {
    write_json_atomic(&instance_git_collapse_state_file(project_id, instance_id)?, state)
}

/// `None` means everything starts expanded.
#[tauri::command]
pub fn get_git_collapse_state(project_id: String, instance_id: String) -> Result<Option<GitCollapseState>, String> {
    read_git_collapse_state(&project_id, &instance_id)
}

/// Called on every fold or unfold in the git view.
#[tauri::command]
pub async fn save_git_collapse_state(project_id: String, instance_id: String, state: GitCollapseState) -> Result<(), String> {
    write_git_collapse_state(&project_id, &instance_id, &state)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn from_json(json: &str) -> GitCollapseState {
        serde_json::from_str(json).expect("collapse state should parse")
    }

    #[test]
    fn an_instance_that_never_folded_anything_starts_expanded() {
        let state = from_json("{}");
        assert!(state.collapsed_unstaged.is_empty());
        assert!(state.collapsed_staged.is_empty());
        assert!(state.expanded_staged.is_empty());
    }

    #[test]
    fn a_state_predating_a_group_gains_its_default() {
        let state = from_json(r#"{"collapsedUnstaged": ["src"]}"#);
        assert_eq!(state.collapsed_unstaged, vec!["src"]);
        assert!(state.collapsed_staged.is_empty());
    }

    #[test]
    fn the_folded_groups_survive_a_round_trip() {
        let original = GitCollapseState {
            collapsed_unstaged: vec!["src".to_string(), "dossier été".to_string()],
            collapsed_staged: vec!["tests".to_string()],
            expanded_staged: vec!["docs".to_string()],
        };
        let json = serde_json::to_string(&original).expect("should serialize");
        let back = from_json(&json);
        assert_eq!(back.collapsed_unstaged, original.collapsed_unstaged);
        assert_eq!(back.collapsed_staged, original.collapsed_staged);
        assert_eq!(back.expanded_staged, original.expanded_staged);
    }

    #[test]
    fn the_two_sides_of_the_index_stay_apart() {
        let state = from_json(r#"{"collapsedUnstaged": ["a"], "collapsedStaged": ["b"]}"#);
        assert_eq!(state.collapsed_unstaged, vec!["a"]);
        assert_eq!(state.collapsed_staged, vec!["b"]);
    }

    #[test]
    fn it_serializes_under_the_names_the_frontend_reads() {
        let json = serde_json::to_value(GitCollapseState::default()).expect("should serialize");
        let object = json.as_object().expect("state should be an object");
        for key in ["collapsedUnstaged", "collapsedStaged", "expandedStaged"] {
            assert!(object.contains_key(key), "{key} is missing from the payload");
        }
    }

    #[test]
    fn a_corrupted_file_is_reported_rather_than_panicking() {
        assert!(serde_json::from_str::<GitCollapseState>("not json").is_err());
        assert!(
            serde_json::from_str::<GitCollapseState>(r#"{"collapsedStaged": "tests"}"#).is_err()
        );
    }
}
