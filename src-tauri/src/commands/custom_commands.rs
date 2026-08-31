// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

//! User-defined commands (scripts run in a terminal tab), stored globally or
//! per project, plus the port each one was allocated in an instance.

use std::collections::HashMap;
use std::fs;
use std::net::TcpListener;
use serde::{Deserialize, Serialize};
use crate::storage::{
    global_commands_file, instance_command_state_file, project_commands_file, write_json_atomic,
};

fn default_true() -> bool { true }

fn default_cwd() -> String { "worktree".to_string() }

/// A user command: a list of shell steps plus how the UI should present and
/// run it. `source` marks a command imported from the repo rather than typed.
#[derive(Serialize, Deserialize, Clone)]
pub struct CustomCommand {
    pub id: String,
    pub name: String,
    pub icon: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default)]
    pub steps: Vec<String>,
    #[serde(rename = "stopOnError", default = "default_true")]
    pub stop_on_error: bool,
    #[serde(default = "default_cwd")]
    pub cwd: String,
    #[serde(default)]
    pub pinned: bool,
    #[serde(rename = "autoClose", default)]
    pub auto_close: bool,
    #[serde(default)]
    pub confirm: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

/// The commands of one scope, global or project.
#[derive(Serialize, Deserialize, Clone, Default)]
pub struct CommandsFile {
    #[serde(default)]
    pub commands: Vec<CustomCommand>,
}

/// Ports handed out to this instance's commands, so a rerun reuses its port.
#[derive(Serialize, Deserialize, Clone, Default)]
pub struct InstanceCommandState {
    #[serde(default)]
    pub ports: HashMap<String, u16>,
}

const PORT_SCAN_RANGE: u16 = 100;

/// Empty for a scope that has no commands yet.
fn read_commands(path: &std::path::Path) -> Result<CommandsFile, String> {
    if !path.exists() { return Ok(CommandsFile::default()); }
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

/// Tested by binding it: only the OS can answer this without a race.
fn is_port_free(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_ok()
}

/// Commands defined for this project only.
#[tauri::command]
pub fn get_project_commands(project_id: String) -> Result<CommandsFile, String> {
    read_commands(&project_commands_file(&project_id)?)
}

/// Replaces the project's whole command list.
#[tauri::command]
pub async fn save_project_commands(project_id: String, state: CommandsFile) -> Result<(), String> {
    write_json_atomic(&project_commands_file(&project_id)?, &state)
}

/// Commands available in every project.
#[tauri::command]
pub fn get_global_commands() -> Result<CommandsFile, String> {
    read_commands(&global_commands_file()?)
}

/// Replaces the global command list.
#[tauri::command]
pub async fn save_global_commands(state: CommandsFile) -> Result<(), String> {
    write_json_atomic(&global_commands_file()?, &state)
}

/// Empty when no command has run in this instance yet.
#[tauri::command]
pub fn get_command_state(project_id: String, instance_id: String) -> Result<InstanceCommandState, String> {
    let path = instance_command_state_file(&project_id, &instance_id)?;
    if !path.exists() { return Ok(InstanceCommandState::default()); }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

/// Records the port allocation after a command starts.
#[tauri::command]
pub async fn save_command_state(
    project_id: String,
    instance_id: String,
    state: InstanceCommandState,
) -> Result<(), String> {
    write_json_atomic(&instance_command_state_file(&project_id, &instance_id)?, &state)
}

/// Keeps `preferred` when it is still free, otherwise scans upward from `base`.
/// `exclude` holds ports already promised to commands that have not bound yet,
/// which a free-port test alone cannot see.
#[tauri::command]
pub async fn allocate_port(
    base: u16,
    preferred: Option<u16>,
    exclude: Vec<u16>,
) -> Result<u16, String> {
    if let Some(port) = preferred
        && !exclude.contains(&port) && is_port_free(port) {
            return Ok(port);
        }
    for offset in 0..PORT_SCAN_RANGE {
        let Some(port) = base.checked_add(offset) else { break };
        if !exclude.contains(&port) && is_port_free(port) {
            return Ok(port);
        }
    }
    Err(format!(
        "No free port between {} and {}",
        base,
        base.saturating_add(PORT_SCAN_RANGE - 1)
    ))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn allocate_port_reuses_a_free_preferred_port() {
        // The port is only known to be free between the drop and the call, and
        // anything on the machine may take it in that window - including the
        // sibling test. A few attempts turn that race into a rare retry rather
        // than a flaky failure.
        for attempt in 0..8 {
            let held = TcpListener::bind(("127.0.0.1", 0)).unwrap();
            let free = held.local_addr().unwrap().port();
            drop(held);

            let got = allocate_port(free, Some(free), vec![]).await.unwrap();
            if got == free {
                return;
            }
            assert!(attempt < 7, "the preferred port was never handed back");
        }
    }

    #[tokio::test]
    async fn allocate_port_skips_a_busy_preferred_port() {
        let held = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let busy = held.local_addr().unwrap().port();

        let port = allocate_port(busy, Some(busy), vec![]).await.unwrap();

        assert_ne!(port, busy);
        assert!(port > busy);
    }

    #[tokio::test]
    async fn allocate_port_skips_excluded_ports() {
        let held = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let base = held.local_addr().unwrap().port();
        drop(held);

        let port = allocate_port(base, None, vec![base]).await.unwrap();

        assert_ne!(port, base);
    }
}
