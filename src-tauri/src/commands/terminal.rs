use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::sync::Mutex;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};
use crate::storage::{instance_terminal_state_file, project_terminal_state_file, write_json_atomic};

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
    #[serde(rename = "exitCode")]
    exit_code: Option<i32>,
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
    #[serde(rename = "splitId", default)]
    pub split_id: Option<String>,
    #[serde(rename = "splitRatio", default)]
    pub split_ratio: Option<f32>,
}

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

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct ProjectTerminalLayout {
    #[serde(default)]
    pub terminals: Vec<ProjectTerminalTab>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ProjectTerminalTab {
    pub id:    String,
    pub title: String,
    #[serde(default)]
    pub cwd:   Option<String>,
}

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

#[tauri::command]
pub fn save_project_terminal_state(project_id: String, state: ProjectTerminalLayout) -> Result<(), String> {
    write_json_atomic(&project_terminal_state_file(&project_id)?, &state)
}
