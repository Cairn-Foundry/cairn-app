// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Where an agent CLI says whose turn it is.
//!
//! Claude Code is launched with hooks (`cli-launch.ts`) that write the state of
//! the turn - `working`, `waiting`, `done` - into a file named after the
//! conversation. A hook runs in its own session, without the PTY as its
//! controlling terminal, so it has no way to print into the conversation's
//! terminal: the file is the channel. One non-recursive watch on the directory
//! reads them back and forwards each as an `agent-signal` event.

use std::path::PathBuf;
use std::sync::Mutex;
use notify::event::{AccessKind, AccessMode};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{Emitter, Manager};
use crate::storage;

/// The variable a conversation's PTY carries, naming the file its hooks write.
pub const ENV_VAR: &str = "CAIRN_AGENT_SIGNAL";

const TERMINAL_PREFIX: &str = "conversation:";
const SIGNALS: [&str; 3] = ["working", "waiting", "done"];

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentSignal {
    conversation_id: String,
    signal: String,
}

#[derive(Default)]
pub struct AgentSignalState(Mutex<Option<RecommendedWatcher>>);

/// The conversation a terminal belongs to, when its id is safe as a file name.
fn conversation_of(terminal_id: &str) -> Option<&str> {
    let id = terminal_id.strip_prefix(TERMINAL_PREFIX)?;
    let safe = !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    safe.then_some(id)
}

fn signal_file(terminal_id: &str) -> Option<PathBuf> {
    let id = conversation_of(terminal_id)?;
    Some(storage::agent_signals_dir().ok()?.join(id))
}

/// The file a conversation terminal's hooks write to, emptied for the new run.
pub fn prepare(terminal_id: &str) -> Option<String> {
    let path = signal_file(terminal_id)?;
    let _ = std::fs::remove_file(&path);
    Some(path.to_string_lossy().into_owned())
}

pub fn clear(terminal_id: &str) {
    if let Some(path) = signal_file(terminal_id) {
        let _ = std::fs::remove_file(path);
    }
}

fn relevant(kind: &EventKind) -> bool {
    matches!(
        kind,
        EventKind::Create(_)
            | EventKind::Modify(_)
            | EventKind::Access(AccessKind::Close(AccessMode::Write))
    )
}

/// Starts the watch. Files left by a previous session are dropped first: no CLI
/// they belonged to is still running.
pub fn start(app: &tauri::AppHandle) -> Result<(), String> {
    let dir = storage::agent_signals_dir()?;
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let emitter = app.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(event) = res else { return };
        if !relevant(&event.kind) {
            return;
        }
        for path in event.paths {
            let Some(id) = path.file_name().and_then(|n| n.to_str()) else { continue };
            // Read on every event: the hook truncates then writes, so an event
            // can land on the empty file, and the next one carries the content.
            let Ok(content) = std::fs::read_to_string(&path) else { continue };
            let signal = content.trim();
            if !SIGNALS.contains(&signal) {
                continue;
            }
            let _ = emitter.emit(
                "agent-signal",
                AgentSignal { conversation_id: id.to_string(), signal: signal.to_string() },
            );
        }
    })
    .map_err(|e| e.to_string())?;
    watcher.watch(&dir, RecursiveMode::NonRecursive).map_err(|e| e.to_string())?;
    *app.state::<AgentSignalState>().0.lock().unwrap_or_else(|e| e.into_inner()) = Some(watcher);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_conversation_terminals_get_a_file() {
        assert_eq!(conversation_of("conversation:3f2a-9c"), Some("3f2a-9c"));
        assert_eq!(conversation_of("project:abc"), None);
        assert_eq!(conversation_of("conversation:"), None);
        assert_eq!(conversation_of("conversation:../settings.json"), None);
    }
}
