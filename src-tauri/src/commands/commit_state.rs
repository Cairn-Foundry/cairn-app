// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

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
pub async fn save_commit_state(project_id: String, instance_id: String, state: CommitState) -> Result<(), String> {
    write_commit_state(&project_id, &instance_id, &state)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn from_json(json: &str) -> CommitState {
        serde_json::from_str(json).expect("commit state should parse")
    }

    #[test]
    fn an_instance_that_never_committed_starts_with_every_flag_off() {
        let state = from_json("{}");
        assert!(!state.no_verify);
        assert!(!state.sign_off);
        assert!(!state.allow_empty);
        assert!(!state.append_ticket_id);
        assert_eq!(state.selected_profile_id, "");
    }

    #[test]
    fn a_state_predating_a_flag_gains_its_default() {
        let state = from_json(r#"{"noVerify": true}"#);
        assert!(state.no_verify);
        assert!(!state.sign_off);
        assert!(!state.append_ticket_id);
    }

    #[test]
    fn the_sticky_flags_survive_a_round_trip() {
        let original = CommitState {
            no_verify: true,
            sign_off: true,
            allow_empty: false,
            selected_profile_id: "work".to_string(),
            append_ticket_id: true,
        };
        let json = serde_json::to_string(&original).expect("should serialize");
        let back = from_json(&json);
        assert!(back.no_verify);
        assert!(back.sign_off);
        assert!(!back.allow_empty);
        assert_eq!(back.selected_profile_id, "work");
        assert!(back.append_ticket_id);
    }

    #[test]
    fn it_serializes_under_the_names_the_frontend_reads() {
        let json = serde_json::to_value(CommitState::default()).expect("should serialize");
        let object = json.as_object().expect("state should be an object");
        for key in [
            "noVerify",
            "signOff",
            "allowEmpty",
            "selectedProfileId",
            "appendTicketId",
        ] {
            assert!(object.contains_key(key), "{key} is missing from the payload");
        }
    }

    #[test]
    fn a_corrupted_file_is_reported_rather_than_panicking() {
        assert!(serde_json::from_str::<CommitState>("not json").is_err());
        assert!(serde_json::from_str::<CommitState>(r#"{"noVerify": "yes"}"#).is_err());
    }
}
