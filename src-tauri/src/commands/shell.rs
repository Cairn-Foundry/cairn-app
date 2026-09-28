// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Shelling out on behalf of the frontend, plus the few OS integrations that
//! have no plugin: opening a terminal, revealing a file, cloning a repo.

use std::io::Write;
use std::process::Stdio;
use crate::child_env;
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

/// Opens the system terminal in `path`, or in its parent when it is a file.
/// Linux has no single terminal, so the known emulators are tried in turn.
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
        let launched =
            child_env::command("x-terminal-emulator").current_dir(&dir).spawn().is_ok() ||
            child_env::command("gnome-terminal").arg(format!("--working-directory={}", dir)).spawn().is_ok() ||
            child_env::command("xfce4-terminal").arg(format!("--working-directory={}", dir)).spawn().is_ok() ||
            child_env::command("konsole").args(["--workdir", &dir]).spawn().is_ok() ||
            child_env::command("xterm").current_dir(&dir).spawn().is_ok();
        if !launched {
            return Err("No supported terminal emulator found. Install gnome-terminal, xfce4-terminal, konsole, or x-terminal-emulator.".to_string());
        }
    }
    Ok(())
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
        let mut last = String::from("No opener found");
        for mut cmd in open::commands(&target) {
            child_env::scrub(&mut cmd);
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
            .map_err(|e| format!("Failed to run git: {}", e))?;
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
