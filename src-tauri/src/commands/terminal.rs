//! PTY-backed terminals. Each session is a spawned shell whose output is
//! streamed to the frontend as `terminal-output` events; the tab layout is
//! persisted per instance and per project.

use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::sync::Mutex;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};
use crate::storage::{instance_terminal_state_file, project_terminal_state_file, write_json_atomic};

/// One live PTY: the handle to write to it, resize it, and kill its child.
struct TerminalSession {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child:  Box<dyn Child + Send + Sync>,
}

/// Every live terminal of the app, keyed by the frontend's session id.
#[derive(Default)]
pub struct TerminalState {
    sessions: Mutex<HashMap<String, TerminalSession>>,
}

impl TerminalState {
    /// Starts with no session; terminals are created on demand.
    pub fn new() -> Self {
        Self::default()
    }
}

/// A chunk of shell output, emitted as a `terminal-output` event.
#[derive(Clone, Serialize)]
struct TerminalOutput {
    id:   String,
    data: String,
}

/// Emitted once when the shell exits, so the tab can show its status.
#[derive(Clone, Serialize)]
struct TerminalExit {
    id: String,
    #[serde(rename = "exitCode")]
    exit_code: Option<i32>,
}

/// Decodes as much of `pending` as forms whole UTF-8, leaving a trailing
/// partial sequence in the buffer for the next read. A byte that can never
/// start a valid sequence is replaced rather than stalling the stream.
fn drain_utf8(pending: &mut Vec<u8>) -> String {
    match std::str::from_utf8(pending) {
        Ok(s) => {
            let out = s.to_string();
            pending.clear();
            out
        }
        Err(e) => {
            let valid = e.valid_up_to();
            // Safe: bytes up to `valid_up_to` are guaranteed valid UTF-8.
            let mut out = std::str::from_utf8(&pending[..valid]).unwrap_or("").to_string();
            match e.error_len() {
                Some(len) => {
                    out.push('\u{FFFD}');
                    pending.drain(..valid + len);
                }
                None => {
                    pending.drain(..valid);
                }
            }
            out
        }
    }
}

/// Forces a UTF-8 locale when the inherited environment does not already ask
/// for one, otherwise the shell renders non-ASCII output as question marks.
#[cfg(not(windows))]
fn ensure_utf8_locale(cmd: &mut CommandBuilder) {
    let is_utf8 = |name: &str| {
        std::env::var(name)
            .map(|v| {
                let v = v.to_ascii_lowercase();
                v.contains("utf-8") || v.contains("utf8")
            })
            .unwrap_or(false)
    };

    if is_utf8("LC_ALL") || is_utf8("LC_CTYPE") || is_utf8("LANG") {
        return;
    }

    #[cfg(target_os = "macos")]
    let utf8_locale = "en_US.UTF-8";
    #[cfg(not(target_os = "macos"))]
    let utf8_locale = "C.UTF-8";

    cmd.env("LANG", utf8_locale);
    cmd.env("LC_CTYPE", utf8_locale);
    if std::env::var("LC_ALL").is_ok() {
        cmd.env("LC_ALL", utf8_locale);
    }
}

#[cfg(windows)]
fn ensure_utf8_locale(_cmd: &mut CommandBuilder) {}

/// The user's login shell, falling back to a shell that always exists.
fn default_shell() -> String {
    #[cfg(windows)]
    {
        std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
    }
    #[cfg(not(windows))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
    }
}

/// Spawns a shell on a new PTY and starts the reader thread that streams its
/// output. When `command` is given the shell runs it and exits; otherwise the
/// session is interactive. The reader thread also reaps the child and emits
/// `terminal-exit`, so nothing else has to wait on it.
/// Async: opening the PTY and starting a login shell blocks the UI thread.
#[tauri::command]
pub async fn terminal_create(
    app: tauri::AppHandle,
    id: String,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    command: Option<String>,
    env: Option<HashMap<String, String>>,
) -> Result<(), String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new(default_shell());
    if let Some(script) = command.as_deref() {
        #[cfg(windows)]
        {
            cmd.arg("/c");
            cmd.arg(script);
        }
        #[cfg(not(windows))]
        {
            cmd.arg("-lc");
            cmd.arg(script);
        }
    }
    if let Some(dir) = cwd {
        let expanded = shellexpand::tilde(&dir).into_owned();
        if std::path::Path::new(&expanded).is_dir() {
            cmd.cwd(expanded);
        }
    }
    cmd.env("TERM", "xterm-256color");
    ensure_utf8_locale(&mut cmd);
    for (key, value) in env.unwrap_or_default() {
        cmd.env(key, value);
    }

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    app.state::<TerminalState>()
        .sessions
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id.clone(), TerminalSession { writer, master: pair.master, child });

    let reader_id = id.clone();
    let app_out = app.clone();
    // A verbose build reads thousands of 4 KB chunks; one IPC event each floods the
    // bridge. The reader hands its chunks to an emitter thread that batches them and
    // flushes on size or after a frame, whichever comes first. The deadline lives in
    // that second thread because the PTY read blocks: a batch left under both
    // thresholds would otherwise wait for the next byte to be sent, which is exactly
    // the case of a command that has just gone quiet.
    const FLUSH_BYTES: usize = 16 * 1024;
    const FLUSH_AFTER: std::time::Duration = std::time::Duration::from_millis(16);

    let (tx, rx) = std::sync::mpsc::channel::<String>();
    let emit_id = id.clone();
    let app_emit = app.clone();
    let emitter = std::thread::spawn(move || {
        let mut batch = String::new();
        let mut deadline: Option<std::time::Instant> = None;
        loop {
            let received = match deadline {
                Some(at) => rx.recv_timeout(at.saturating_duration_since(std::time::Instant::now())),
                None => rx.recv().map_err(|_| std::sync::mpsc::RecvTimeoutError::Disconnected),
            };
            let closed = match received {
                Ok(chunk) => {
                    batch.push_str(&chunk);
                    deadline.get_or_insert_with(|| std::time::Instant::now() + FLUSH_AFTER);
                    false
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => false,
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => true,
            };
            let due = closed
                || batch.len() >= FLUSH_BYTES
                || deadline.is_some_and(|at| std::time::Instant::now() >= at);
            if due && !batch.is_empty() {
                let _ = app_emit.emit(
                    "terminal-output",
                    TerminalOutput { id: emit_id.clone(), data: std::mem::take(&mut batch) },
                );
            }
            if due {
                deadline = None;
            }
            if closed {
                break;
            }
        }
    });

    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        let mut pending: Vec<u8> = Vec::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    pending.extend_from_slice(&buf[..n]);
                    let data = drain_utf8(&mut pending);
                    if !data.is_empty() && tx.send(data).is_err() {
                        break;
                    }
                }
            }
        }
        // Dropping the sender closes the channel; joining guarantees the last batch
        // reaches the frontend before the exit event that follows it.
        drop(tx);
        let _ = emitter.join();

        let mut ended = app_out
            .state::<TerminalState>()
            .sessions
            .lock()
            .ok()
            .and_then(|mut sessions| sessions.remove(&reader_id));
        let exit_code = match ended.as_mut() {
            Some(sess) => match sess.child.try_wait() {
                Ok(Some(status)) => Some(status.exit_code() as i32),
                _ => {
                    let _ = sess.child.kill();
                    sess.child.wait().ok().map(|s| s.exit_code() as i32)
                }
            },
            None => None,
        };
        let _ = app_out.emit("terminal-exit", TerminalExit { id: reader_id, exit_code });
    });

    Ok(())
}

/// Writes keystrokes to the shell. An unknown id is ignored: the session may
/// have exited while the frontend was still typing.
#[tauri::command]
pub fn terminal_write(app: tauri::AppHandle, id: String, data: String) -> Result<(), String> {
    let state = app.state::<TerminalState>();
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    if let Some(sess) = sessions.get_mut(&id) {
        sess.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
        sess.writer.flush().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Tells the shell the window changed size, so it can rewrap its output.
#[tauri::command]
pub fn terminal_resize(app: tauri::AppHandle, id: String, cols: u16, rows: u16) -> Result<(), String> {
    let state = app.state::<TerminalState>();
    let sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    if let Some(sess) = sessions.get(&id) {
        sess.master
            .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Kills one session's shell; the reader thread ends on its own once the PTY
/// closes.
#[tauri::command]
pub fn terminal_close(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let state = app.state::<TerminalState>();
    let removed = state.sessions.lock().map_err(|e| e.to_string())?.remove(&id);
    if let Some(mut sess) = removed {
        let _ = sess.child.kill();
    }
    Ok(())
}

/// Kills every session, used when the app tears a project down.
#[tauri::command]
pub async fn terminal_close_all(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<TerminalState>();
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    for (_, mut sess) in sessions.drain() {
        let _ = sess.child.kill();
    }
    Ok(())
}

/// Kills every session on the way out. The frontend has no chance to close its
/// terminals when the window goes away, so without this the shells outlive the
/// app.
pub fn shutdown(app: &tauri::AppHandle) {
    let state = app.state::<TerminalState>();
    if let Ok(mut sessions) = state.sessions.lock() {
        for (_, mut sess) in sessions.drain() {
            let _ = sess.child.kill();
        }
    }
}

/// Terminal tabs of one instance, plus which is active and how the pane is split.
#[derive(Serialize, Deserialize, Clone, Default)]
pub struct TerminalLayout {
    #[serde(default)]
    pub terminals: Vec<TerminalTab>,
    #[serde(rename = "activeId", default)]
    pub active_id: Option<String>,
    #[serde(rename = "splitId", default)]
    pub split_id: Option<String>,
    #[serde(rename = "splitRatio", default)]
    pub split_ratio: Option<f32>,
}

/// One tab. `command_id` links it back to the custom command that opened it.
#[derive(Serialize, Deserialize, Clone)]
pub struct TerminalTab {
    pub id:    String,
    pub title: String,
    #[serde(rename = "commandId", default, skip_serializing_if = "Option::is_none")]
    pub command_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon:  Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub port:  Option<u16>,
}

/// `None` when the instance has never opened a terminal.
#[tauri::command]
pub fn get_terminal_state(project_id: String, instance_id: String) -> Result<Option<TerminalLayout>, String> {
    let path = instance_terminal_state_file(&project_id, &instance_id)?;
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let state = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(Some(state))
}

/// Persists the tab layout only; the PTYs themselves die with the app.
#[tauri::command]
pub fn save_terminal_state(project_id: String, instance_id: String, state: TerminalLayout) -> Result<(), String> {
    write_json_atomic(&instance_terminal_state_file(&project_id, &instance_id)?, &state)
}

/// Terminals shared across every instance of the project.
#[derive(Serialize, Deserialize, Clone, Default)]
pub struct ProjectTerminalLayout {
    #[serde(default)]
    pub terminals: Vec<ProjectTerminalTab>,
}

/// A shared terminal. `cwd` is remembered so it respawns where it was created.
#[derive(Serialize, Deserialize, Clone)]
pub struct ProjectTerminalTab {
    pub id:    String,
    pub title: String,
    #[serde(default)]
    pub cwd:   Option<String>,
}

/// `None` when the project has no shared terminal.
#[tauri::command]
pub fn get_project_terminal_state(project_id: String) -> Result<Option<ProjectTerminalLayout>, String> {
    let path = project_terminal_state_file(&project_id)?;
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let state = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(Some(state))
}

/// Persists the shared tab list only.
#[tauri::command]
pub fn save_project_terminal_state(project_id: String, state: ProjectTerminalLayout) -> Result<(), String> {
    write_json_atomic(&project_terminal_state_file(&project_id)?, &state)
}
