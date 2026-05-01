use std::io::Write;
use std::process::{Command, Stdio};
use crate::storage::{CommandOutput, copy_dir_recursive};

#[tauri::command]
pub fn run_shell_command(program: &str, args: Vec<String>, cwd: Option<String>) -> CommandOutput {
    let mut cmd = Command::new(program);
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

#[tauri::command]
pub fn run_shell_command_with_stdin(program: &str, args: Vec<String>, cwd: Option<String>, stdin: String) -> CommandOutput {
    let mut cmd = Command::new(program);
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

#[tauri::command]
pub fn run_agent_command(instruction: &str, cwd: &str) -> String {
    format!("agent stub: received '{}' in '{}'", instruction, cwd)
}

#[tauri::command]
pub fn open_in_terminal(path: String) -> Result<(), String> {
    let expanded = shellexpand::tilde(&path).into_owned();
    let dir = {
        let p = std::path::Path::new(&expanded);
        if p.is_dir() { expanded.clone() } else { p.parent().map(|d| d.to_string_lossy().into_owned()).unwrap_or(expanded.clone()) }
    };
    #[cfg(target_os = "macos")]
    Command::new("open").args(["-a", "Terminal", &dir]).spawn().map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    Command::new("cmd").args(["/c", "start", "cmd", "/k", &format!("cd /d {}", dir)]).spawn().map_err(|e| e.to_string())?;
    #[cfg(target_os = "linux")]
    {
        let launched =
            Command::new("x-terminal-emulator").current_dir(&dir).spawn().is_ok() ||
            Command::new("gnome-terminal").arg(format!("--working-directory={}", dir)).spawn().is_ok() ||
            Command::new("xfce4-terminal").arg(format!("--working-directory={}", dir)).spawn().is_ok() ||
            Command::new("konsole").args(["--workdir", &dir]).spawn().is_ok() ||
            Command::new("xterm").current_dir(&dir).spawn().is_ok();
        if !launched {
            return Err("No supported terminal emulator found. Install gnome-terminal, xfce4-terminal, konsole, or x-terminal-emulator.".to_string());
        }
    }
    Ok(())
}

#[tauri::command]
pub fn reveal_in_file_manager(path: String) -> Result<(), String> {
    let expanded = shellexpand::tilde(&path).into_owned();
    #[cfg(target_os = "macos")]
    Command::new("open").arg("-R").arg(&expanded).spawn().map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    Command::new("explorer").arg(format!("/select,{}", expanded)).spawn().map_err(|e| e.to_string())?;
    #[cfg(target_os = "linux")]
    {
        let p = std::path::Path::new(&expanded);
        let parent = p.parent().unwrap_or(p);
        let launched =
            Command::new("nautilus").args(["--select", &expanded]).spawn().is_ok() ||
            Command::new("dolphin").args(["--select", &expanded]).spawn().is_ok() ||
            Command::new("nemo").arg(&expanded).spawn().is_ok() ||
            Command::new("thunar").arg(&expanded).spawn().is_ok();
        if !launched {
            Command::new("xdg-open").arg(parent).spawn().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn copy_path(from: String, to: String) -> Result<(), String> {
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

#[tauri::command]
pub async fn clone_repository(url: String, dest_parent: String, name: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let expanded = shellexpand::tilde(&dest_parent).into_owned();
        let dest = std::path::PathBuf::from(&expanded).join(&name);
        if dest.exists() {
            return Err(format!("Destination already exists: {}", dest.display()));
        }
        let output = Command::new("git")
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
