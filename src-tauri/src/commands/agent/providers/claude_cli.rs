use std::io::{BufRead, BufReader, Read, Write};
use std::process::Stdio;
use std::sync::atomic::Ordering;
use serde_json::{json, Value};
use super::super::{
    emit_agent_data, emit_agent_data_for, emit_agent_for, emit_agent_tool_for,
    platform,
    AgentProvider, AgentResponse, RunningChild, SendRequest,
};
use super::cli_common::tool_label;

pub struct ClaudeCliProvider;

/// The delegation an event was produced inside, if any. `--forward-subagent-text`
/// sets `parent_tool_use_id` at the top level of the event, not inside
/// `message`, and leaves it null on everything the main thread produced.
fn parent_agent(event: &Value) -> Option<String> {
    event
        .get("parent_tool_use_id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .map(String::from)
}

/// Drives the CLI through its stream-json control protocol: the user message
/// goes in on stdin, permission requests come back as control_request events
/// and are answered through the same stdin (see respond_permission).
impl AgentProvider for ClaudeCliProvider {
    fn send(
        &self,
        app: &tauri::AppHandle,
        request: &SendRequest,
        handle: &RunningChild,
    ) -> Result<AgentResponse, String> {
        let opts = request.options;
        let binary_override = (!opts.binary_path.is_empty()).then_some(opts.binary_path.as_str());
        let binary = platform::resolve_binary("claude", binary_override)
            .ok_or("Claude Code CLI not found. Install it or set its path in the provider settings.")?;

        let mut args: Vec<String> = vec![
            "-p".into(),
            "--output-format".into(),
            "stream-json".into(),
            "--input-format".into(),
            "stream-json".into(),
            "--verbose".into(),
            // Without it a subagent's text and thinking never leave the CLI:
            // the delegation shows up as one opaque tool call and its work is
            // invisible. With it, those blocks arrive tagged with the
            // `parent_tool_use_id` of the `Agent` call that started them.
            "--forward-subagent-text".into(),
            "--permission-prompt-tool".into(),
            "stdio".into(),
        ];
        if let Some(id) = request.session_id {
            args.push("--resume".into());
            args.push(id.to_string());
        }
        if !opts.model.is_empty() {
            args.push("--model".into());
            args.push(opts.model.clone());
        }
        if !opts.effort.is_empty() {
            args.push("--effort".into());
            args.push(opts.effort.clone());
        }
        if !opts.permission_mode.is_empty() {
            args.push("--permission-mode".into());
            args.push(opts.permission_mode.clone());
        }
        if !opts.system_prompt.is_empty() {
            args.push("--append-system-prompt".into());
            args.push(opts.system_prompt.clone());
        }
        if !opts.allowed_tools.is_empty() {
            args.push("--allowedTools".into());
            args.push(opts.allowed_tools.join(","));
        }
        if !opts.disallowed_tools.is_empty() {
            args.push("--disallowedTools".into());
            args.push(opts.disallowed_tools.join(","));
        }
        args.extend(opts.extra_args.iter().cloned());

        let mut cmd = platform::new_command(&binary);
        cmd.args(&args)
            .envs(request.env)
            .current_dir(request.working_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn claude: {e}"))?;

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let mut stdin = child.stdin.take();

        if let Some(input) = stdin.as_mut() {
            let user_message = json!({
                "type": "user",
                "message": {
                    "role": "user",
                    "content": [{ "type": "text", "text": request.message }],
                },
            });
            writeln!(input, "{user_message}").map_err(|e| format!("Failed to send prompt: {e}"))?;
        }
        *handle.stdin.lock().map_err(|e| e.to_string())? = stdin;
        *handle.child.lock().map_err(|e| e.to_string())? = Some(child);

        if handle.cancelled.load(Ordering::SeqCst)
            && let Ok(mut slot) = handle.child.lock()
                && let Some(mut c) = slot.take() { platform::kill_tree(&mut c); }

        let stderr_thread = stderr.map(|mut err| {
            std::thread::spawn(move || {
                let mut buf = String::new();
                let _ = err.read_to_string(&mut buf);
                buf
            })
        });

        let wd = Some(request.working_dir.to_string());
        let rid = Some(request.run_id.to_string());
        let mut session_id_out: Option<String> = None;
        let mut model_seen: Option<String> = None;

        if let Some(out) = stdout {
            for line in BufReader::new(out).lines() {
                let line = match line { Ok(l) => l, Err(_) => break };
                if line.trim().is_empty() { continue; }
                let Ok(event) = serde_json::from_str::<Value>(&line) else { continue };

                if let Some(id) = event.get("session_id").and_then(Value::as_str) {
                    session_id_out = Some(id.to_string());
                }

                let agent = parent_agent(&event);

                match event.get("type").and_then(Value::as_str) {
                    Some("control_request") => {
                        let request_body = event.get("request");
                        if request_body.and_then(|r| r.get("subtype")).and_then(Value::as_str)
                            == Some("can_use_tool")
                        {
                            emit_agent_data(app, "permission_request", json!({
                                "requestId": event.get("request_id"),
                                "toolName": request_body.and_then(|r| r.get("tool_name")),
                                "displayName": request_body.and_then(|r| r.get("display_name")),
                                "input": request_body.and_then(|r| r.get("input")),
                                "description": request_body.and_then(|r| r.get("description")),
                                "suggestions": request_body.and_then(|r| r.get("permission_suggestions")),
                                "toolUseId": request_body.and_then(|r| r.get("tool_use_id")),
                            }), wd.clone(), rid.clone());
                        }
                    }
                    Some("rate_limit_event") => {
                        if let Some(info) = event.get("rate_limit_info") {
                            emit_agent_data(app, "rate_limit", info.clone(), wd.clone(), rid.clone());
                        }
                    }
                    // A subagent the CLI started on its own. The lifecycle is
                    // reported through these three, which carry the status, the
                    // summary and the usage - so nothing has to be inferred
                    // from the tool call itself.
                    Some("system") if event.get("subtype").and_then(Value::as_str) == Some("task_started") => {
                        emit_agent_data(app, "agent_start", json!({
                            "taskId": event.get("task_id"),
                            "toolUseId": event.get("tool_use_id"),
                            "subagentType": event.get("subagent_type"),
                            "description": event.get("description"),
                            "prompt": event.get("prompt"),
                            "background": event.get("task_type").and_then(Value::as_str)
                                == Some("background_agent"),
                        }), wd.clone(), rid.clone());
                    }
                    Some("system") if event.get("subtype").and_then(Value::as_str) == Some("task_updated") => {
                        emit_agent_data(app, "agent_status", json!({
                            "taskId": event.get("task_id"),
                            "status": event.pointer("/patch/status"),
                        }), wd.clone(), rid.clone());
                    }
                    Some("system") if event.get("subtype").and_then(Value::as_str) == Some("task_notification") => {
                        emit_agent_data(app, "agent_result", json!({
                            "taskId": event.get("task_id"),
                            "toolUseId": event.get("tool_use_id"),
                            "status": event.get("status"),
                            "summary": event.get("summary"),
                            "usage": event.get("usage"),
                        }), wd.clone(), rid.clone());
                    }
                    Some("system") if event.get("subtype").and_then(Value::as_str) == Some("init") => {
                        model_seen = event.get("model").and_then(Value::as_str).map(String::from);
                        emit_agent_data(app, "init", json!({
                            "model": event.get("model"),
                            "tools": event.get("tools"),
                            "agents": event.get("agents"),
                            "permissionMode": event.get("permissionMode"),
                        }), wd.clone(), rid.clone());
                    }
                    Some("assistant") => {
                        if let Some(model) = event.pointer("/message/model").and_then(Value::as_str) {
                            model_seen = Some(model.to_string());
                        }
                        let blocks = event
                            .get("message")
                            .and_then(|m| m.get("content"))
                            .and_then(Value::as_array);
                        if let Some(blocks) = blocks {
                            for block in blocks {
                                match block.get("type").and_then(Value::as_str) {
                                    Some("text") => {
                                        if let Some(text) = block.get("text").and_then(Value::as_str)
                                            && !text.is_empty() {
                                                emit_agent_for(app, text.to_string(), "assistant", wd.clone(), rid.clone(), agent.clone());
                                            }
                                    }
                                    Some("thinking") => {
                                        if let Some(text) = block.get("thinking").and_then(Value::as_str)
                                            && !text.is_empty() {
                                                emit_agent_data_for(app, "thinking", json!({ "text": text }), wd.clone(), rid.clone(), agent.clone());
                                            }
                                    }
                                    Some("tool_use") => {
                                        let name = block.get("name").and_then(Value::as_str).unwrap_or("tool");
                                        let label = tool_label(name, block.get("input"));
                                        emit_agent_tool_for(
                                            app,
                                            label,
                                            name,
                                            wd.clone(),
                                            rid.clone(),
                                            agent.clone(),
                                            block.get("id").and_then(Value::as_str).map(String::from),
                                        );
                                    }
                                    _ => {}
                                }
                            }
                        }
                    }
                    Some("user") => {
                        let blocks = event
                            .get("message")
                            .and_then(|m| m.get("content"))
                            .and_then(Value::as_array);
                        if let Some(blocks) = blocks {
                            for block in blocks {
                                if block.get("type").and_then(Value::as_str) == Some("tool_result") {
                                    emit_agent_data_for(app, "tool_result", json!({
                                        "isError": block.get("is_error").and_then(Value::as_bool).unwrap_or(false),
                                        "toolUseId": block.get("tool_use_id"),
                                    }), wd.clone(), rid.clone(), agent.clone());
                                }
                                // The prompt the subagent was handed, forwarded
                                // as its first user turn. It opens the thread
                                // rather than landing in the conversation.
                                if agent.is_some()
                                    && block.get("type").and_then(Value::as_str) == Some("text")
                                    && let Some(text) = block.get("text").and_then(Value::as_str)
                                        && !text.is_empty() {
                                            emit_agent_data_for(app, "agent_prompt", json!({ "text": text }), wd.clone(), rid.clone(), agent.clone());
                                        }
                            }
                        }
                    }
                    Some("result") => {
                        // The CLI reports the real context window of the model
                        // it used, under `modelUsage`. It is the only reliable
                        // source: a model id alone does not say how big its
                        // window is, and the 1M variants share their base name.
                        let context_window = model_seen
                            .as_deref()
                            .and_then(|model| {
                                event
                                    .get("modelUsage")
                                    .and_then(|m| m.get(model))
                                    .and_then(|m| m.get("contextWindow"))
                                    .cloned()
                            })
                            .unwrap_or(Value::Null);
                        emit_agent_data(app, "usage", json!({
                            "model": model_seen,
                            "usage": event.get("usage"),
                            "contextWindow": context_window,
                            "totalCostUsd": event.get("total_cost_usd"),
                            "durationMs": event.get("duration_ms").or_else(|| event.get("duration_api_ms")),
                            "numTurns": event.get("num_turns"),
                        }), wd.clone(), rid.clone());
                        if event.get("is_error").and_then(Value::as_bool) == Some(true)
                            && let Some(text) = event.get("result").and_then(Value::as_str) {
                                emit_agent_data(app, "error", json!({ "message": text }), wd.clone(), rid.clone());
                            }
                        // Closing stdin ends the streaming session; the CLI exits.
                        if let Ok(mut slot) = handle.stdin.lock() {
                            slot.take();
                        }
                    }
                    _ => {}
                }
            }
        }

        if let Ok(mut slot) = handle.stdin.lock() {
            slot.take();
        }
        let status = handle.child.lock().ok().and_then(|mut slot| {
            slot.take().and_then(|mut c| c.wait().ok())
        });
        let stderr_text = stderr_thread
            .and_then(|t| t.join().ok())
            .unwrap_or_default();

        if let Some(status) = status
            && !status.success() && !handle.cancelled.load(Ordering::SeqCst) {
                let detail = stderr_text.trim();
                let message = if detail.is_empty() {
                    format!("claude exited with {status}")
                } else {
                    detail.to_string()
                };
                return Err(message);
            }

        Ok(AgentResponse { session_id: session_id_out })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_event_of_the_main_thread_belongs_to_no_agent() {
        let event = json!({
            "type": "assistant",
            "parent_tool_use_id": Value::Null,
            "message": { "content": [{ "type": "text", "text": "hi" }] },
        });

        assert_eq!(parent_agent(&event), None);
        assert_eq!(parent_agent(&json!({ "type": "result" })), None);
    }

    #[test]
    fn an_event_produced_inside_a_subagent_carries_its_delegation() {
        let event = json!({
            "type": "assistant",
            "parent_tool_use_id": "toolu_01N1iTtycTciKopJPQvaqpkQ",
            "message": { "content": [{ "type": "text", "text": "HELLO" }] },
        });

        assert_eq!(
            parent_agent(&event).as_deref(),
            Some("toolu_01N1iTtycTciKopJPQvaqpkQ"),
        );
    }

    #[test]
    fn an_empty_attribution_is_the_main_thread_rather_than_an_agent_named_nothing() {
        assert_eq!(parent_agent(&json!({ "parent_tool_use_id": "" })), None);
    }
}
