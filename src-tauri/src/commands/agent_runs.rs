//! The agent runs of a project: a capped history of what ran, what came back,
//! and what was still in flight when the app last closed.

use std::fs;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use crate::storage::{project_agent_runs_file, write_json_atomic};

/// How many finished runs a project keeps. The list is a history, not an
/// archive: what matters is what is running and what just came back.
const HISTORY_LIMIT: usize = 50;

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct AgentRun {
    pub id: String,
    #[serde(default)]
    pub agent_id: String,
    #[serde(default)]
    pub agent_name: String,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub instance_id: String,
    #[serde(default)]
    pub instance_name: String,
    #[serde(default)]
    pub conversation_id: String,
    #[serde(default)]
    pub conversation_title: String,
    #[serde(default)]
    pub scope: String,
    #[serde(default)]
    pub provider_id: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub working_dir: String,
    #[serde(default)]
    pub prompt: String,
    #[serde(default)]
    pub started_at: i64,
    #[serde(default)]
    pub ended_at: Option<i64>,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub result: String,
    /// The agent's reasoning, kept like the answer so entering its thread shows
    /// the same thing the conversation shows for its own turns.
    #[serde(default)]
    pub thinking: String,
    /// What the agent did, in the order it did it: text, reasoning and tool
    /// calls in one list, because they interleave.
    #[serde(default)]
    pub blocks: Vec<Value>,
    /// Tokens, cost, duration and turns of the run, as the provider reported
    /// them. Shape belongs to the provider, so it travels as-is.
    #[serde(default)]
    pub usage: Option<Value>,
    #[serde(default)]
    pub error: String,
}

/// A run that was in flight when the app went down. Its process died with the
/// window, so it can only be relaunched - never resumed where it stopped.
fn is_in_flight(status: &str) -> bool {
    matches!(status, "running" | "awaiting-permission")
}

#[tauri::command]
pub fn get_agent_runs(project_id: String) -> Result<Vec<AgentRun>, String> {
    let path = project_agent_runs_file(&project_id)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let runs: Vec<AgentRun> = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(runs
        .into_iter()
        .map(|mut run| {
            if is_in_flight(&run.status) {
                run.status = "interrupted".into();
            }
            run
        })
        .collect())
}

/// Keeps every run still in flight, and only the most recent finished ones.
/// The caller hands them newest first.
fn trim_history(runs: Vec<AgentRun>) -> Vec<AgentRun> {
    let mut finished = 0usize;
    runs.into_iter()
        .filter(|run| {
            if is_in_flight(&run.status) {
                return true;
            }
            finished += 1;
            finished <= HISTORY_LIMIT
        })
        .collect()
}

#[tauri::command]
pub async fn save_agent_runs(project_id: String, runs: Vec<AgentRun>) -> Result<(), String> {
    write_json_atomic(&project_agent_runs_file(&project_id)?, &trim_history(runs))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(id: &str, status: &str) -> AgentRun {
        AgentRun { id: id.into(), status: status.into(), ..Default::default() }
    }

    #[test]
    fn the_history_is_capped_without_dropping_a_run_still_flying() {
        let mut runs = vec![run("live", "running")];
        for i in 0..HISTORY_LIMIT + 10 {
            runs.push(run(&format!("done-{i}"), "done"));
        }
        let kept = trim_history(runs);
        assert_eq!(kept.len(), HISTORY_LIMIT + 1);
        assert_eq!(kept[0].id, "live");
        assert_eq!(kept[1].id, "done-0");
    }

    #[test]
    fn every_in_flight_status_is_recognised() {
        for status in ["running", "awaiting-permission"] {
            assert!(is_in_flight(status), "{status}");
        }
        for status in ["done", "stopped", "error", "interrupted"] {
            assert!(!is_in_flight(status), "{status}");
        }
    }
}
