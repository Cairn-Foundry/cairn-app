use std::process::Command;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct CommandOutput {
    pub stdout: String,
    pub stderr: String,
    pub success: bool,
}

#[tauri::command]
fn run_shell_command(program: &str, args: Vec<String>, cwd: Option<String>) -> CommandOutput {
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
fn run_agent_command(instruction: &str, cwd: &str) -> String {
    // Stub — will invoke Claude Code CLI in a future iteration
    format!("agent stub: received '{}' in '{}'", instruction, cwd)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![run_shell_command, run_agent_command])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
