// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Shelling out on behalf of the frontend, plus the few OS integrations that
//! have no plugin: opening a terminal, revealing a file, cloning a repo.

use std::io::Write;
use std::process::Stdio;
use crate::child_env;
use crate::commands::cli_providers::resolve_binary;
use crate::commands::git_error;
use crate::storage::{CommandOutput, copy_dir_recursive};

/// Runs a program to completion and captures its output. A spawn failure comes
/// back as an unsuccessful `CommandOutput`, never as an error.
/// Async: the callers shell out to git, which blocks the UI thread.
#[tauri::command]
pub async fn run_shell_command(program: String, args: Vec<String>, cwd: Option<String>) -> CommandOutput {
    let mut cmd = child_env::command(&program);
    cmd.args(&args);
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    match cmd.output() {
        Ok(output) => CommandOutput {
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
            success: output.status.success(),
        },
        Err(e) => CommandOutput {
            stdout: String::new(),
            stderr: e.to_string(),
            success: false,
        },
    }
}

/// Same, with `stdin` written to the process before its output is read.
#[tauri::command]
pub async fn run_shell_command_with_stdin(program: String, args: Vec<String>, cwd: Option<String>, stdin: String) -> CommandOutput {
    let mut cmd = child_env::command(&program);
    cmd.args(&args);
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    match cmd.spawn() {
        Err(e) => CommandOutput { stdout: String::new(), stderr: e.to_string(), success: false },
        Ok(mut child) => {
            if let Some(mut sh) = child.stdin.take() {
                let _ = sh.write_all(stdin.as_bytes());
            }
            match child.wait_with_output() {
                Ok(out) => CommandOutput {
                    stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
                    stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
                    success: out.status.success(),
                },
                Err(e) => CommandOutput { stdout: String::new(), stderr: e.to_string(), success: false },
            }
        }
    }
}

/// True when the emulator started and did not fail straight away. A launcher
/// that spawns fine and then exits non-zero (a wrapper whose target is missing,
/// a display it cannot reach) used to count as launched and left the user with
/// nothing, so a short grace period lets the next candidate take over.
#[cfg(target_os = "linux")]
fn spawn_stays_up(mut cmd: std::process::Command) -> bool {
    let Ok(mut child) = cmd.spawn() else { return false };
    for _ in 0..10 {
        match child.try_wait() {
            Ok(Some(status)) => return status.success(),
            Ok(None) => std::thread::sleep(std::time::Duration::from_millis(50)),
            Err(_) => return false,
        }
    }
    true
}

#[cfg(any(target_os = "linux", test))]
const LINUX_TERMINALS: [&str; 8] = [
    "x-terminal-emulator",
    "gnome-terminal",
    "konsole",
    "xfce4-terminal",
    "tilix",
    "kitty",
    "alacritty",
    "xterm",
];

/// The terminal that last opened, so the search is paid once per run of the app.
#[cfg(target_os = "linux")]
static WORKING_TERMINAL: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

/// Emulators to try, in order: the one that worked last, then `$TERMINAL`, then
/// the known list. Duplicates are dropped.
#[cfg(any(target_os = "linux", test))]
fn terminal_candidates(remembered: Option<&str>, from_env: Option<&str>) -> Vec<String> {
    let mut ordered: Vec<String> = Vec::new();
    for name in remembered
        .into_iter()
        .chain(from_env.filter(|v| !v.trim().is_empty()))
        .chain(LINUX_TERMINALS)
    {
        if !ordered.iter().any(|seen| seen == name) {
            ordered.push(name.to_string());
        }
    }
    ordered
}

#[cfg(any(target_os = "linux", test))]
fn emulator_name(program: &str) -> String {
    std::path::Path::new(program)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// How each emulator is told which directory to open in; the rest inherit the
/// working directory of the spawned process.
#[cfg(any(target_os = "linux", test))]
fn terminal_args(program: &str, dir: &str) -> Vec<String> {
    match emulator_name(program).as_str() {
        "gnome-terminal" | "xfce4-terminal" | "tilix" | "alacritty" => {
            vec![format!("--working-directory={dir}")]
        }
        "konsole" => vec!["--workdir".to_string(), dir.to_string()],
        "kitty" => vec!["--directory".to_string(), dir.to_string()],
        _ => Vec::new(),
    }
}

/// How each emulator is told to run a command in place of the shell: `-e` is
/// the xterm convention most of them kept, kitty takes the command bare.
#[cfg(any(target_os = "linux", test))]
fn exec_args(program: &str) -> Vec<String> {
    match emulator_name(program).as_str() {
        "gnome-terminal" => vec!["--".to_string()],
        "xfce4-terminal" => vec!["-x".to_string()],
        "kitty" => Vec::new(),
        _ => vec!["-e".to_string()],
    }
}

/// How each emulator is asked to open a tab in a window it already has, when it
/// can. gnome-terminal joins the window of the tab named by `GNOME_TERMINAL_SCREEN`
/// and fails when that tab is gone, so the caller falls back to a new window.
#[cfg(any(target_os = "linux", test))]
fn tab_args(program: &str) -> Vec<String> {
    match emulator_name(program).as_str() {
        "gnome-terminal" | "xfce4-terminal" => vec!["--tab".to_string()],
        "konsole" => vec!["--new-tab".to_string()],
        _ => Vec::new(),
    }
}

/// Debian's `x-terminal-emulator` alternative is a `<name>.wrapper` script that
/// only knows xterm's options and drops the others, so a command is run through
/// the emulator behind it.
#[cfg(any(target_os = "linux", test))]
fn behind_wrapper(path: &std::path::Path) -> Option<String> {
    path.file_name()?.to_str()?.strip_suffix(".wrapper").map(str::to_string)
}

#[cfg(target_os = "linux")]
fn unwrapped(program: &str) -> String {
    which::which(program)
        .ok()
        .and_then(|p| p.canonicalize().ok())
        .and_then(|p| behind_wrapper(&p))
        .unwrap_or_else(|| program.to_string())
}

#[cfg(target_os = "linux")]
const NO_TERMINAL: &str = "No supported terminal emulator found. Set the TERMINAL environment variable, or install gnome-terminal, xfce4-terminal, konsole or x-terminal-emulator.";

/// Opens `dir` in the first emulator that works and remembers it, running `run`
/// in place of the shell when given - as a tab of an existing window first,
/// then in a new one. A remembered emulator that no longer starts is forgotten
/// and the search starts over.
#[cfg(target_os = "linux")]
fn launch_linux_terminal(dir: &str, run: &[String]) -> bool {
    let remembered = WORKING_TERMINAL.lock().ok().and_then(|g| g.clone());
    let from_env = std::env::var("TERMINAL").ok();
    for candidate in terminal_candidates(remembered.as_deref(), from_env.as_deref()) {
        let program = if run.is_empty() { candidate.clone() } else { unwrapped(&candidate) };
        let launch = |tab: Vec<String>| {
            let mut cmd = child_env::command(&program);
            cmd.args(terminal_args(&program, dir)).current_dir(dir);
            if !run.is_empty() {
                cmd.args(tab).args(exec_args(&program)).args(run);
            }
            spawn_stays_up(cmd)
        };
        let tab = tab_args(&program);
        let worked = (!run.is_empty() && !tab.is_empty() && launch(tab)) || launch(Vec::new());
        if let Ok(mut slot) = WORKING_TERMINAL.lock() {
            if worked {
                *slot = Some(candidate);
            } else if slot.as_deref() == Some(candidate.as_str()) {
                *slot = None;
            }
        }
        if worked {
            return true;
        }
    }
    false
}

/// Opens the system terminal in `path`, or in its parent when it is a file.
/// Linux has no single terminal: `$TERMINAL` first, then the known emulators.
#[tauri::command]
pub async fn open_in_terminal(path: String) -> Result<(), String> {
    let expanded = shellexpand::tilde(&path).into_owned();
    let dir = {
        let p = std::path::Path::new(&expanded);
        if p.is_dir() { expanded.clone() } else { p.parent().map(|d| d.to_string_lossy().into_owned()).unwrap_or(expanded.clone()) }
    };
    #[cfg(target_os = "macos")]
    child_env::command("open").args(["-a", "Terminal", &dir]).spawn().map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    child_env::command("cmd").args(["/c", "start", "cmd", "/k", &format!("cd /d {}", dir)]).spawn().map_err(|e| e.to_string())?;
    #[cfg(target_os = "linux")]
    {
        if !launch_linux_terminal(&dir, &[]) {
            return Err(NO_TERMINAL.to_string());
        }
    }
    Ok(())
}

/// Opens the system terminal in `cwd` running an agent CLI - resuming a
/// conversation outside the app - through the login shell, as the embedded PTY
/// does. Linux only: the other platforms' terminals take no command to run.
#[tauri::command]
pub async fn open_cli_in_terminal(cwd: String, argv: Vec<String>) -> Result<(), String> {
    let (program, rest) = argv.split_first().ok_or("Empty args")?;
    let binary = resolve_binary(program, None).ok_or_else(|| format!("{program} not found"))?;
    let run = crate::commands::terminal::agent_argv(&binary, rest);
    #[cfg(target_os = "linux")]
    {
        if launch_linux_terminal(&cwd, &run) {
            return Ok(());
        }
        Err(NO_TERMINAL.to_string())
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (cwd, run);
        Err("Continuing a conversation in the system terminal is only supported on Linux.".to_string())
    }
}

/// Shows the path in the system file manager, selected when the platform can.
#[tauri::command]
pub async fn reveal_in_file_manager(path: String) -> Result<(), String> {
    let expanded = shellexpand::tilde(&path).into_owned();
    #[cfg(target_os = "macos")]
    child_env::command("open").arg("-R").arg(&expanded).spawn().map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    child_env::command("explorer").arg(format!("/select,{}", expanded)).spawn().map_err(|e| e.to_string())?;
    #[cfg(target_os = "linux")]
    {
        let p = std::path::Path::new(&expanded);
        let parent = p.parent().unwrap_or(p);
        let launched =
            child_env::command("nautilus").args(["--select", &expanded]).spawn().is_ok() ||
            child_env::command("dolphin").args(["--select", &expanded]).spawn().is_ok() ||
            child_env::command("nemo").arg(&expanded).spawn().is_ok() ||
            child_env::command("thunar").arg(&expanded).spawn().is_ok();
        if !launched {
            child_env::command("xdg-open").arg(parent).spawn().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Opens a URL or a file with the application the desktop associates with it.
/// Goes through `child_env`: an opener inheriting the AppImage environment starts
/// the browser or the viewer on the bundle's libraries.
#[tauri::command]
pub async fn open_external(target: String) -> Result<(), String> {
    let target = openable(&target).ok_or_else(|| format!("Refusing to open {target}"))?;
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::process::CommandExt;
        let mut last = String::from("No opener found");
        for mut cmd in open::commands(&target) {
            child_env::scrub(&mut cmd);
            // Out of Cairn's group, a Ctrl+C in the terminal that launched it spares the browser.
            cmd.process_group(0);
            match cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn() {
                Ok(mut child) => {
                    // Some openers wait for the application they start.
                    std::thread::spawn(move || child.wait());
                    return Ok(());
                }
                Err(e) => last = e.to_string(),
            }
        }
        Err(last)
    }
    #[cfg(not(target_os = "linux"))]
    open::that_detached(&target).map_err(|e| e.to_string())
}

/// What `open_external` agrees to hand to the desktop: a web, mail or phone
/// link, or a file that exists.
fn openable(target: &str) -> Option<String> {
    let lower = target.to_ascii_lowercase();
    if ["http://", "https://", "mailto:", "tel:"].iter().any(|s| lower.starts_with(s)) {
        return Some(target.to_string());
    }
    let expanded = shellexpand::tilde(target).into_owned();
    let path = std::path::Path::new(&expanded);
    (path.is_absolute() && path.exists()).then_some(expanded)
}

/// Copies a file or a whole directory, creating the missing parents.
#[tauri::command]
pub async fn copy_path(from: String, to: String) -> Result<(), String> {
    let src = std::path::Path::new(&from);
    let dst = std::path::Path::new(&to);
    if src.is_dir() {
        std::fs::create_dir_all(dst).map_err(|e| e.to_string())?;
        copy_dir_recursive(src, dst)
    } else {
        if let Some(parent) = dst.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::copy(src, dst).map(|_| ()).map_err(|e| e.to_string())
    }
}

/// Resolves `~` and returns the canonical path, erroring if it is not an
/// existing directory.
#[tauri::command]
pub fn validate_directory(path: String) -> Result<String, String> {
    let expanded = shellexpand::tilde(&path).into_owned();
    let dir_path = std::path::PathBuf::from(&expanded);
    if !dir_path.exists() {
        return Err(format!("Path does not exist: {}", path));
    }
    if !dir_path.is_dir() {
        return Err(format!("Path is not a directory: {}", path));
    }
    dir_path.canonicalize().map_err(|e| e.to_string()).map(|p| p.to_string_lossy().to_string())
}

/// Clones `url` into `dest_parent/name` and returns the canonical destination.
/// Refuses to touch an existing destination, and reports git's stderr as the
/// error so the user sees the real reason.
#[tauri::command]
pub async fn clone_repository(url: String, dest_parent: String, name: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let expanded = shellexpand::tilde(&dest_parent).into_owned();
        let dest = std::path::PathBuf::from(&expanded).join(&name);
        if dest.exists() {
            return Err(format!("Destination already exists: {}", dest.display()));
        }
        let output = child_env::command("git")
            .args(["clone", "--", &url, dest.to_str().unwrap_or(&name)])
            .output()
            .map_err(git_error::spawn_message)?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(stderr);
        }
        dest.canonicalize()
            .map(|p| p.to_string_lossy().to_string())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_search_starts_with_the_remembered_then_the_env_one() {
        let order = terminal_candidates(Some("kitty"), Some("foot"));
        assert_eq!(&order[..3], ["kitty", "foot", "x-terminal-emulator"]);
        assert_eq!(order.iter().filter(|n| *n == "kitty").count(), 1);
    }

    #[test]
    fn terminal_search_ignores_an_empty_env_value() {
        let order = terminal_candidates(None, Some("  "));
        assert_eq!(order, LINUX_TERMINALS);
    }

    #[test]
    fn terminals_get_their_own_command_flag() {
        assert_eq!(exec_args("/usr/bin/gnome-terminal"), ["--"]);
        assert_eq!(exec_args("xfce4-terminal"), ["-x"]);
        assert_eq!(exec_args("konsole"), ["-e"]);
        assert!(exec_args("kitty").is_empty());
    }

    #[test]
    fn terminals_that_can_join_a_window_get_a_tab_flag() {
        assert_eq!(tab_args("/usr/bin/gnome-terminal"), ["--tab"]);
        assert_eq!(tab_args("xfce4-terminal"), ["--tab"]);
        assert_eq!(tab_args("konsole"), ["--new-tab"]);
        assert!(tab_args("kitty").is_empty());
        assert!(tab_args("alacritty").is_empty());
    }

    #[test]
    fn a_debian_wrapper_names_the_emulator_behind_it() {
        let wrapper = std::path::Path::new("/usr/bin/gnome-terminal.wrapper");
        assert_eq!(behind_wrapper(wrapper).as_deref(), Some("gnome-terminal"));
        assert_eq!(behind_wrapper(std::path::Path::new("/usr/bin/gnome-terminal")), None);
        assert_eq!(behind_wrapper(std::path::Path::new("/usr/bin/kitty")), None);
    }

    #[test]
    fn terminals_get_their_own_directory_flag() {
        assert_eq!(terminal_args("konsole", "/p"), ["--workdir", "/p"]);
        assert_eq!(terminal_args("/usr/bin/gnome-terminal", "/p"), ["--working-directory=/p"]);
        assert!(terminal_args("xterm", "/p").is_empty());
    }

    #[test]
    fn opens_the_web_and_mail_links() {
        for url in ["https://forge/mr/1", "HTTP://example.com", "mailto:a@b.c", "tel:+331"] {
            assert_eq!(openable(url).as_deref(), Some(url));
        }
    }

    #[test]
    fn refuses_any_other_scheme() {
        for url in ["file:///etc/passwd", "javascript:alert(1)", "smb://host/share", "ftp://host"] {
            assert_eq!(openable(url), None, "{url}");
        }
    }

    #[test]
    fn opens_a_file_that_exists() {
        let dir = std::env::temp_dir();
        let file = dir.join("cairn-open-external-test");
        std::fs::write(&file, b"x").unwrap();
        let path = file.to_string_lossy().into_owned();
        assert_eq!(openable(&path), Some(path.clone()));
        std::fs::remove_file(&file).unwrap();
        assert_eq!(openable(&path), None);
    }

    #[test]
    fn refuses_a_relative_path() {
        assert_eq!(openable("Cargo.toml"), None);
    }
}
