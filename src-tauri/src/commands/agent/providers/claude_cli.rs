use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::atomic::Ordering;
use serde_json::Value;
use super::super::{emit_agent, emit_agent_tool, AgentProvider, AgentResponse, RunningChild};

pub struct ClaudeCliProvider;

impl AgentProvider for ClaudeCliProvider {
    fn send(
        &self,
        app: &tauri::AppHandle,
        message: &str,
        working_dir: &str,
        session_id: Option<&str>,
        handle: &RunningChild,
        run_id: &str,
        env: &std::collections::HashMap<String, String>,
    ) -> Result<AgentResponse, String> {
        let mut args: Vec<String> = vec![
            "-p".into(),
            message.into(),
            "--output-format".into(),
            "stream-json".into(),
            "--verbose".into(),
        ];
        if let Some(id) = session_id {
            args.push("--resume".into());
            args.push(id.to_string());
        }

        let mut child = Command::new("claude")
            .args(&args)
            .envs(env)
            .current_dir(working_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed to spawn claude: {e}"))?;

        let stdout = child.stdout.take();
        *handle.child.lock().map_err(|e| e.to_string())? = Some(child);

        if handle.cancelled.load(Ordering::SeqCst) {
            if let Ok(mut slot) = handle.child.lock() {
                if let Some(mut c) = slot.take() { let _ = c.kill(); }
            }
        }

        let wd = Some(working_dir.to_string());
        let rid = Some(run_id.to_string());
        let mut session_id_out: Option<String> = None;

        if let Some(out) = stdout {
            for line in BufReader::new(out).lines() {
                let line = match line { Ok(l) => l, Err(_) => break };
                if line.trim().is_empty() { continue; }
                let Ok(event) = serde_json::from_str::<Value>(&line) else { continue };

                if let Some(id) = event.get("session_id").and_then(Value::as_str) {
                    session_id_out = Some(id.to_string());
                }

                match event.get("type").and_then(Value::as_str) {
                    Some("assistant") => {
                        let blocks = event
                            .get("message")
                            .and_then(|m| m.get("content"))
                            .and_then(Value::as_array);
                        if let Some(blocks) = blocks {
                            for block in blocks {
                                match block.get("type").and_then(Value::as_str) {
                                    Some("text") => {
                                        if let Some(text) = block.get("text").and_then(Value::as_str) {
                                            if !text.is_empty() {
                                                emit_agent(app, text.to_string(), "assistant", wd.clone(), rid.clone());
                                            }
                                        }
                                    }
                                    Some("tool_use") => {
                                        let name = block.get("name").and_then(Value::as_str).unwrap_or("tool");
                                        let label = tool_label(name, block.get("input"));
                                        emit_agent_tool(app, label, name, wd.clone(), rid.clone());
                                    }
                                    _ => {}
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }
        }

        if let Ok(mut slot) = handle.child.lock() {
            if let Some(mut c) = slot.take() { let _ = c.wait(); }
        }

        Ok(AgentResponse { session_id: session_id_out })
    }
}

fn tool_label(name: &str, input: Option<&Value>) -> String {
    let arg = input.and_then(|i| {
        i.get("file_path")
            .or_else(|| i.get("path"))
            .or_else(|| i.get("command"))
            .or_else(|| i.get("pattern"))
            .or_else(|| i.get("url"))
            .or_else(|| i.get("description"))
            .and_then(Value::as_str)
    });
    match arg {
        Some(a) => format!("{name}: {a}"),
        None => name.to_string(),
    }
}
