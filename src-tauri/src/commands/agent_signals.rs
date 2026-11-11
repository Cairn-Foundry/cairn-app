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

/// Read on every event: the hook truncates then writes, so an event can land
/// on the empty file, and the next one carries the content.
fn read_signal(path: &std::path::Path) -> Option<(String, String)> {
    let id = path.file_name()?.to_str()?;
    let content = std::fs::read_to_string(path).ok()?;
    let signal = content.trim();
    SIGNALS.contains(&signal).then(|| (id.to_string(), signal.to_string()))
}

/// Starts the watch. Files left by a previous session are dropped first: no CLI
/// they belonged to is still running.
pub fn start(app: &tauri::AppHandle) -> Result<(), String> {
    let dir = storage::agent_signals_dir()?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let _ = std::fs::remove_file(entry.path());
        }
    }

    let emitter = app.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(event) = res else { return };
        if !relevant(&event.kind) {
            return;
        }
        for path in event.paths {
            let Some((conversation_id, signal)) = read_signal(&path) else { continue };
            let _ = emitter.emit("agent-signal", AgentSignal { conversation_id, signal });
        }
    })
    .map_err(|e| e.to_string())?;
    watcher.watch(&dir, RecursiveMode::NonRecursive).map_err(|e| e.to_string())?;
    *app.state::<AgentSignalState>().0.lock().unwrap_or_else(|e| e.into_inner()) = Some(watcher);
    Ok(())
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NotificationOpened {
    conversation_id: String,
}

/// Brings the window forward and tells the frontend which conversation to show.
fn open_from_notification(app: &tauri::AppHandle, conversation_id: String) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    let _ = app.emit("agent-notification-opened", NotificationOpened { conversation_id });
}

#[cfg(not(all(unix, not(target_os = "macos"))))]
const CONVERSATION_EXTRA: &str = "conversationId";

/// macOS and Windows go through the plugin, which reports a click on a
/// notification along with its extras.
#[cfg(not(all(unix, not(target_os = "macos"))))]
pub fn listen_for_notification_clicks(app: &tauri::AppHandle) {
    use tauri_plugin_notification::NotificationExt;
    let handle = app.clone();
    let _ = app.notification().on_action(move |performed| {
        if performed.action_id() != "tap" {
            return;
        }
        let id = performed
            .notification()
            .and_then(|n| n.extra().get(CONVERSATION_EXTRA))
            .and_then(|v| v.as_str());
        if let Some(id) = id {
            open_from_notification(&handle, id.to_string());
        }
    });
}

/// Tells the user a conversation needs them.
///
/// Not the notification plugin on Linux: it sends each notification over a
/// connection it drops at once, and GNOME Shell withdraws a notification tied
/// to an application as soon as its sender leaves the bus - the window makes
/// the process an application, so every one vanished unseen. The connection is
/// held here until the notification is clicked or closed, which is also what
/// lets a click open the conversation.
#[tauri::command]
pub fn notify_agent(app: tauri::AppHandle, conversation_id: String, title: String, body: String) {
    #[cfg(all(unix, not(target_os = "macos")))]
    std::thread::spawn(move || {
        let shown = notify_rust::Notification::new()
            .summary(&title)
            .body(&body)
            .auto_icon()
            .action("default", "Open")
            .show();
        match shown {
            Ok(handle) => handle.wait_for_action(|action| {
                if action == "default" {
                    open_from_notification(&app, conversation_id);
                }
            }),
            Err(e) => eprintln!("agent notification failed: {e}"),
        }
    });
    #[cfg(not(all(unix, not(target_os = "macos"))))]
    {
        use tauri_plugin_notification::NotificationExt;
        let _ = app
            .notification()
            .builder()
            .title(title)
            .body(body)
            .extra(CONVERSATION_EXTRA, conversation_id)
            .show();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn signal_in(content: &str) -> Option<(String, String)> {
        let dir = std::env::temp_dir().join(format!("cairn-signal-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("3f2a-9c");
        std::fs::write(&path, content).unwrap();
        let read = read_signal(&path);
        let _ = std::fs::remove_dir_all(&dir);
        read
    }

    #[test]
    fn a_signal_file_is_read_trimmed_and_validated() {
        assert_eq!(signal_in("done\n"), Some(("3f2a-9c".into(), "done".into())));
        assert_eq!(signal_in("waiting"), Some(("3f2a-9c".into(), "waiting".into())));
        assert_eq!(signal_in(""), None);
        assert_eq!(signal_in("sleeping"), None);
    }

    #[test]
    fn only_conversation_terminals_get_a_file() {
        assert_eq!(conversation_of("conversation:3f2a-9c"), Some("3f2a-9c"));
        assert_eq!(conversation_of("project:abc"), None);
        assert_eq!(conversation_of("conversation:"), None);
        assert_eq!(conversation_of("conversation:../settings.json"), None);
    }
}
