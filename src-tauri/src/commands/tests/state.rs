// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

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
pub async fn save_test_state(
    project_id: String,
    instance_id: String,
    state: TestPersistedState,
) -> Result<(), String> {
    write_json_atomic(&instance_test_state_file(&project_id, &instance_id)?, &state)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn from_json(json: &str) -> TestPersistedState {
        serde_json::from_str(json).expect("test state should parse")
    }

    #[test]
    fn an_instance_that_never_ran_its_tests_starts_empty() {
        let state = from_json("{}");
        assert!(state.runner_id.is_empty());
        assert!(state.suites.is_empty());
        assert!(state.summary.is_none());
        assert!(state.filter.is_empty());
    }

    #[test]
    fn a_state_predating_a_field_gains_its_default() {
        let state = from_json(r#"{"runnerId": "vitest"}"#);
        assert_eq!(state.runner_id, "vitest");
        assert!(state.search.is_empty());
        assert!(state.selected_case_id.is_empty());
    }

    /// The suites and the summary belong to the runner adapters; this layer
    /// hands them back exactly as it received them rather than understanding
    /// their shape.
    #[test]
    fn the_suites_are_carried_through_without_being_understood() {
        let state = from_json(
            r#"{"suites": [{"anything": {"the": "adapter wants"}}],
                "summary": {"status": "passed", "counts": {"pass": 3}}}"#,
        );
        assert_eq!(state.suites.len(), 1);
        assert_eq!(state.suites[0]["anything"]["the"], "adapter wants");
        assert_eq!(state.summary.as_ref().unwrap()["status"], "passed");
    }

    #[test]
    fn the_last_run_survives_a_round_trip() {
        let original = TestPersistedState {
            runner_id: "vitest".to_string(),
            suites: vec![serde_json::json!({"file": "a.test.ts"})],
            summary: Some(serde_json::json!({"status": "failed"})),
            selected_case_id: "c1".to_string(),
            filter: "failed".to_string(),
            search: "auth".to_string(),
        };
        let json = serde_json::to_string(&original).expect("should serialize");
        let back = from_json(&json);
        assert_eq!(back.runner_id, "vitest");
        assert_eq!(back.selected_case_id, "c1");
        assert_eq!(back.filter, "failed");
        assert_eq!(back.search, "auth");
        assert_eq!(back.suites.len(), 1);
        assert_eq!(back.summary.as_ref().unwrap()["status"], "failed");
    }

    #[test]
    fn a_search_with_accents_comes_back_unchanged() {
        let original = TestPersistedState {
            search: "authentification réussie".to_string(),
            ..Default::default()
        };
        let json = serde_json::to_string(&original).expect("should serialize");
        assert_eq!(from_json(&json).search, "authentification réussie");
    }

    #[test]
    fn it_serializes_under_the_names_the_frontend_reads() {
        let json = serde_json::to_value(TestPersistedState::default()).expect("should serialize");
        let object = json.as_object().expect("state should be an object");
        for key in ["runnerId", "suites", "summary", "selectedCaseId", "filter", "search"] {
            assert!(object.contains_key(key), "{key} is missing from the payload");
        }
    }

    /// Unlike the other persisted states, a corrupt file here is read as "never
    /// ran" rather than surfaced: the command drops the parse error with `.ok()`,
    /// so the Tests step opens empty instead of on an error banner.
    #[test]
    fn a_corrupted_state_parses_as_an_error_the_command_turns_into_nothing() {
        assert!(serde_json::from_str::<TestPersistedState>("not json").is_err());
        assert!(serde_json::from_str::<TestPersistedState>(r#"{"suites": "one"}"#).is_err());
    }

    #[test]
    fn an_unknown_field_from_a_newer_release_is_ignored() {
        let state = from_json(r#"{"runnerId": "vitest", "shippedLater": true}"#);
        assert_eq!(state.runner_id, "vitest");
    }
}
