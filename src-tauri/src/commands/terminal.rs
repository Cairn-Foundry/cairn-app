// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

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
use crate::commands::cli_providers::resolve_binary;
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

/// How the PTY's process is spelled out: a script handed to the login shell, an
/// argv run directly, or nothing at all for an interactive shell.
///
/// `args` exists because an agent CLI is launched as `claude --resume <uuid>`
/// in a worktree whose path Cairn does not control: composing that into a
/// `$SHELL -lc` string would mean quoting an id and a path correctly on every
/// platform. Running the resolved binary with its argv skips the shell, and
/// with it the only injection surface of this module.
pub fn build_command(
    command: Option<&str>,
    args: Option<&[String]>,
) -> Result<CommandBuilder, String> {
    if let Some(argv) = args {
        let (program, rest) = argv.split_first().ok_or("Empty args")?;
        let binary = resolve_binary(program, None).ok_or_else(|| format!("{program} not found"))?;
        let mut cmd = CommandBuilder::new(binary);
        for arg in rest {
            cmd.arg(arg);
        }
        return Ok(cmd);
    }

    let mut cmd = CommandBuilder::new(default_shell());
    if let Some(script) = command {
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
    Ok(cmd)
}

/// Spawns a process on a new PTY and starts the reader thread that streams its
/// output. `args` runs a resolved binary directly, `command` runs a script
/// through the login shell, neither leaves an interactive shell. The reader
/// thread also reaps the child and emits `terminal-exit`, so nothing else has
/// to wait on it.
/// Async: opening the PTY and starting a login shell blocks the UI thread.
// Tauri passes a command's arguments by name from the frontend, so grouping
// them into a struct would only rename the payload, not simplify the call.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn terminal_create(
    app: tauri::AppHandle,
    id: String,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    command: Option<String>,
    args: Option<Vec<String>>,
    env: Option<HashMap<String, String>>,
) -> Result<(), String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;

    let mut cmd = build_command(command.as_deref(), args.as_deref())?;
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
        // The PTY closing does not mean the group is empty: a shell that exits
        // while a dev server it started still holds the terminal leaves that
        // server reparented to init, its port and its memory held for good. The
        // group is signalled before the status is claimed, because reaping the
        // leader frees its pid for reuse and the signal would then land on a
        // stranger.
        let exit_code = ended
            .as_mut()
            .and_then(|sess| {
                if let Some(pid) = sess.child.process_id() {
                    kill_group(pid);
                }
                let _ = sess.child.kill();
                sess.child.wait().ok()
            })
            .map(|status| status.exit_code() as i32);
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

/// Whether the process on this PTY has a child of its own right now.
///
/// A CLI waiting on a command it spawned - a build, a test run, an install that
/// takes ten minutes - prints nothing and reads nothing while it waits, so the
/// terminal looks exactly as idle as an abandoned one. The difference is on the
/// process table: the work it is waiting for is a live descendant.
///
/// `true` on any doubt. This backs a decision to *kill* a process, so failing
/// to answer must mean "leave it alone", never "nothing is running".
#[tauri::command]
pub async fn terminal_has_children(app: tauri::AppHandle, id: String) -> bool {
    let pid = {
        let state = app.state::<TerminalState>();
        let Ok(sessions) = state.sessions.lock() else { return true };
        match sessions.get(&id).and_then(|s| s.child.process_id()) {
            Some(pid) => pid,
            // No session: nothing to keep alive, so nothing to protect.
            None => return false,
        }
    };
    has_descendants(pid)
}

/// The process group of a PTY child holds the CLI and whatever it spawned, so a
/// group with more than the leader in it is a CLI doing something.
#[cfg(not(windows))]
fn has_descendants(pid: u32) -> bool {
    let Ok(out) = std::process::Command::new("pgrep").arg("-P").arg(pid.to_string()).output()
    else {
        return true;
    };
    // pgrep exits 1 when it matched nothing, 0 when it listed a pid, and
    // anything else on failure - which is a doubt, so it counts as busy.
    match out.status.code() {
        Some(0) => !String::from_utf8_lossy(&out.stdout).trim().is_empty(),
        Some(1) => false,
        _ => true,
    }
}

#[cfg(windows)]
fn has_descendants(_pid: u32) -> bool {
    // No cheap equivalent here, so the reaper never fires on Windows rather
    // than risking a killed build.
    true
}

/// Terminates a session's shell and everything it spawned.
///
/// Killing the PTY leader alone leaves its descendants behind - a dev server, a
/// watcher, a build - reparented to init and holding their ports and their
/// memory for the rest of the machine's uptime. The shell is the leader of the
/// PTY's process group, so signalling the negative pid reaches the whole group;
/// the leader is then killed and reaped, without which it stays a zombie.
fn kill_session(sess: &mut TerminalSession) {
    if let Some(pid) = sess.child.process_id() {
        kill_group(pid);
    }
    let _ = sess.child.kill();
    let _ = sess.child.wait();
}

/// Signals the session's whole process group, leaving the leader itself to the
/// caller.
///
/// The group is only signalled once it has been confirmed to still be this
/// session's: the leader may already have exited, and a reaped pid is free for
/// the kernel to reuse, so a blind negative-pid signal could hit whatever group
/// inherited it - up to the app's own. `pgrep -g` answers that question, and an
/// empty group is also the case where there is nothing left to kill.
#[cfg(not(windows))]
fn kill_group(pid: u32) {
    if pid <= 1 {
        return;
    }
    let Ok(members) = std::process::Command::new("pgrep").arg("-g").arg(pid.to_string()).output()
    else {
        return;
    };
    // The leader lists itself, so a group that is only the leader is one where
    // nothing was left behind.
    let alive = String::from_utf8_lossy(&members.stdout)
        .split_whitespace()
        .filter_map(|p| p.parse::<u32>().ok())
        .any(|member| member != pid);
    if !alive {
        return;
    }
    let _ = std::process::Command::new("kill")
        .args(["-TERM", &format!("-{pid}")])
        .output();
}

#[cfg(windows)]
fn kill_group(pid: u32) {
    if pid <= 1 {
        return;
    }
    let _ = std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .output();
}

/// Kills one session's shell; the reader thread ends on its own once the PTY
/// closes.
/// Async: reaping the shell and its group waits on the process table.
#[tauri::command]
pub async fn terminal_close(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let removed = {
        let state = app.state::<TerminalState>();
        let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
        sessions.remove(&id)
    };
    if let Some(mut sess) = removed {
        kill_session(&mut sess);
    }
    Ok(())
}

/// Kills every session, used when the app tears a project down.
#[tauri::command]
pub async fn terminal_close_all(app: tauri::AppHandle) -> Result<(), String> {
    let drained = {
        let state = app.state::<TerminalState>();
        let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
        sessions.drain().collect::<Vec<_>>()
    };
    for (_, mut sess) in drained {
        kill_session(&mut sess);
    }
    Ok(())
}

/// Kills every session on the way out. The frontend has no chance to close its
/// terminals when the window goes away, so without this the shells outlive the
/// app.
pub fn shutdown(app: &tauri::AppHandle) {
    let state = app.state::<TerminalState>();
    let drained = match state.sessions.lock() {
        Ok(mut sessions) => sessions.drain().collect::<Vec<_>>(),
        Err(_) => return,
    };
    for (_, mut sess) in drained {
        kill_session(&mut sess);
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
pub async fn save_terminal_state(project_id: String, instance_id: String, state: TerminalLayout) -> Result<(), String> {
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
pub async fn save_project_terminal_state(project_id: String, state: ProjectTerminalLayout) -> Result<(), String> {
    write_json_atomic(&project_terminal_state_file(&project_id)?, &state)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The debug rendering of a CommandBuilder is the only way to read back what
    /// it will exec; asserting on it is enough to tell argv from a shell script.
    fn rendered(cmd: &CommandBuilder) -> String {
        format!("{:?}", cmd.get_argv())
    }

    #[test]
    fn no_command_leaves_an_interactive_shell() {
        let cmd = build_command(None, None).unwrap();
        let argv = rendered(&cmd);
        assert!(!argv.contains("-lc"), "{argv}");
    }

    #[test]
    fn a_script_goes_through_the_login_shell() {
        let cmd = build_command(Some("echo hi"), None).unwrap();
        let argv = rendered(&cmd);
        assert!(argv.contains("echo hi"), "{argv}");
        #[cfg(not(windows))]
        assert!(argv.contains("-lc"), "{argv}");
    }

    #[test]
    fn argv_runs_the_binary_without_a_shell() {
        // `sh` is the one binary guaranteed to resolve on every unix runner.
        let cmd = build_command(None, Some(&["sh".into(), "--resume".into(), "a b".into()])).unwrap();
        let argv = rendered(&cmd);
        assert!(!argv.contains("-lc"), "{argv}");
        // The id is one argument, never re-split or re-quoted by a shell.
        assert!(argv.contains("a b"), "{argv}");
    }

    #[test]
    fn argv_wins_over_a_script_and_an_empty_argv_is_an_error() {
        let cmd = build_command(Some("echo hi"), Some(&["sh".into()])).unwrap();
        assert!(!rendered(&cmd).contains("echo hi"));
        assert!(build_command(None, Some(&[])).is_err());
    }

    #[test]
    fn an_unresolvable_binary_is_an_error_rather_than_a_shell_fallback() {
        assert!(build_command(None, Some(&["cairn-no-such-binary".into()])).is_err());
    }
}
