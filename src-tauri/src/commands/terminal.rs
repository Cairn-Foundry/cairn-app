use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::sync::Mutex;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};
use crate::storage::{instance_terminal_state_file, write_json_atomic};

struct TerminalSession {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child:  Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
pub struct TerminalState {
    sessions: Mutex<HashMap<String, TerminalSession>>,
}

impl TerminalState {
    pub fn new() -> Self {
        Self::default()
    }
}

#[derive(Clone, Serialize)]
struct TerminalOutput {
    id:   String,
    data: String,
}

#[derive(Clone, Serialize)]
struct TerminalExit {
    id: String,
}

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

#[tauri::command]
pub fn terminal_create(
    app: tauri::AppHandle,
    id: String,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new(default_shell());
    if let Some(dir) = cwd {
        let expanded = shellexpand::tilde(&dir).into_owned();
        if std::path::Path::new(&expanded).is_dir() {
            cmd.cwd(expanded);
        }
    }
    cmd.env("TERM", "xterm-256color");

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
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        let mut pending: Vec<u8> = Vec::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    pending.extend_from_slice(&buf[..n]);
                    let data = drain_utf8(&mut pending);
                    if !data.is_empty() {
                        let _ = app_out.emit("terminal-output", TerminalOutput { id: reader_id.clone(), data });
                    }
                }
            }
        }
        if let Ok(mut sessions) = app_out.state::<TerminalState>().sessions.lock() {
            if let Some(mut sess) = sessions.remove(&reader_id) {
                let _ = sess.child.kill();
            }
        }
        let _ = app_out.emit("terminal-exit", TerminalExit { id: reader_id });
    });

    Ok(())
}

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

#[tauri::command]
pub fn terminal_close(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let state = app.state::<TerminalState>();
    let removed = state.sessions.lock().map_err(|e| e.to_string())?.remove(&id);
    if let Some(mut sess) = removed {
        let _ = sess.child.kill();
    }
    Ok(())
}

#[tauri::command]
pub fn terminal_close_all(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<TerminalState>();
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    for (_, mut sess) in sessions.drain() {
        let _ = sess.child.kill();
    }
    Ok(())
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct TerminalLayout {
    #[serde(default)]
    pub terminals: Vec<TerminalTab>,
    #[serde(rename = "activeId", default)]
    pub active_id: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct TerminalTab {
    pub id:    String,
    pub title: String,
}

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

#[tauri::command]
pub fn save_terminal_state(project_id: String, instance_id: String, state: TerminalLayout) -> Result<(), String> {
    write_json_atomic(&instance_terminal_state_file(&project_id, &instance_id)?, &state)
}
