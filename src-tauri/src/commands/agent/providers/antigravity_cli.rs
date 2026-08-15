use serde_json::{json, Value};

use super::super::{
    emit_agent_data, emit_agent_for, emit_agent_tool_for, platform, AgentProvider, AgentResponse,
    RunningChild, SendRequest,
};
use super::cli_common::{run_cli, tool_label};

pub struct AntigravityCliProvider;

/// Antigravity reports its usage under its own names; the UI reads the ones
/// Claude Code uses, so they are renamed here rather than in every consumer.
fn usage_of(usage: Option<&Value>) -> Value {
    json!({
        "input_tokens": usage.and_then(|u| u.get("input_tokens")),
        "output_tokens": usage.and_then(|u| u.get("output_tokens")),
        "cache_read_input_tokens": usage.and_then(|u| u.get("cache_read_tokens")),
    })
}

/// A step is identified by its index in the run: it is what ties the row drawn
/// when a tool starts to the result that closes it.
fn step_id(step: &Value) -> Option<String> {
    step.get("step_index")
        .and_then(Value::as_i64)
        .map(|i| format!("step-{i}"))
}

impl AgentProvider for AntigravityCliProvider {
    fn send(
        &self,
        app: &tauri::AppHandle,
        request: &SendRequest,
        handle: &RunningChild,
    ) -> Result<AgentResponse, String> {
        let opts = request.options;
        let binary_override = (!opts.binary_path.is_empty()).then_some(opts.binary_path.as_str());
        let binary = platform::resolve_binary("agy", binary_override).ok_or(
            "Antigravity CLI not found. Install it or set its path in the provider settings.",
        )?;

        let mut args: Vec<String> = vec![
            "-p".into(),
            request.message.to_string(),
            "--output-format".into(),
            "stream-json".into(),
        ];
        if let Some(id) = request.session_id {
            args.push("--conversation".into());
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
        if opts.permission_mode == "always-proceed" {
            args.push("--dangerously-skip-permissions".into());
        }
        args.extend(opts.extra_args.iter().cloned());

        let wd = Some(request.working_dir.to_string());
        let rid = Some(request.run_id.to_string());
        let mut session_id_out: Option<String> = None;
        let mut model_seen: Option<String> = None;

        run_cli(&binary, &args, &[], request, handle, |line| {
            let Ok(event) = serde_json::from_str::<Value>(line) else { return };

            if let Some(id) = event.get("conversation_id").and_then(Value::as_str) {
                session_id_out = Some(id.to_string());
            }

            match event.get("event").and_then(Value::as_str) {
                Some("init") => {
                    let init = event.get("init");
                    model_seen = init
                        .and_then(|i| i.get("model"))
                        .and_then(Value::as_str)
                        .map(String::from);
                    emit_agent_data(
                        app,
                        "init",
                        json!({
                            "model": init.and_then(|i| i.get("model")),
                            "tools": init.and_then(|i| i.get("tools")),
                            "agents": init.and_then(|i| i.get("agent")),
                            "permissionMode": init.and_then(|i| i.get("permission_mode")),
                        }),
                        wd.clone(),
                        rid.clone(),
                    );
                }
                Some("step_update") => {
                    let Some(step) = event.get("step_update") else { return };
                    if let Some(id) = step.get("conversation_id").and_then(Value::as_str) {
                        session_id_out = Some(id.to_string());
                    }
                    let done = step.get("state").and_then(Value::as_str) == Some("DONE");

                    match step.get("step_type").and_then(Value::as_str) {
                        Some("agent_response") => {
                            if let Some(text) = step.get("text_delta").and_then(Value::as_str)
                                && !text.is_empty() {
                                    emit_agent_for(
                                        app,
                                        text.to_string(),
                                        "assistant",
                                        wd.clone(),
                                        rid.clone(),
                                        None,
                                    );
                                }
                        }
                        Some("tool") => {
                            let info = step.get("tool_info");
                            let name = info
                                .and_then(|i| i.get("name"))
                                .and_then(Value::as_str)
                                .or_else(|| step.get("tool_name").and_then(Value::as_str))
                                .unwrap_or("tool");
                            if done {
                                emit_agent_data(
                                    app,
                                    "tool_result",
                                    json!({
                                        "isError": info.and_then(|i| i.get("error")).is_some_and(|e| !e.is_null()),
                                        "toolUseId": step_id(step),
                                    }),
                                    wd.clone(),
                                    rid.clone(),
                                );
                            } else {
                                emit_agent_tool_for(
                                    app,
                                    tool_label(name, info.and_then(|i| i.get("parameters"))),
                                    name,
                                    wd.clone(),
                                    rid.clone(),
                                    None,
                                    step_id(step),
                                );
                            }
                        }
                        _ => {}
                    }
                }
                Some("result") => {
                    emit_agent_data(
                        app,
                        "usage",
                        json!({
                            "model": model_seen,
                            "usage": usage_of(event.get("usage")),
                            "durationMs": event
                                .get("duration_seconds")
                                .and_then(Value::as_f64)
                                .map(|s| (s * 1000.0) as i64),
                            "numTurns": event.get("num_turns"),
                        }),
                        wd.clone(),
                        rid.clone(),
                    );
                    let status = event.get("status").and_then(Value::as_str).unwrap_or("");
                    if !status.is_empty() && status != "SUCCESS" {
                        let message = event
                            .get("error")
                            .and_then(Value::as_str)
                            .map(String::from)
                            .unwrap_or_else(|| format!("Antigravity run ended {status}"));
                        emit_agent_data(
                            app,
                            "error",
                            json!({ "message": message }),
                            wd.clone(),
                            rid.clone(),
                        );
                    }
                }
                _ => {}
            }
        })?;

        Ok(AgentResponse { session_id: session_id_out })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn usage_is_renamed_to_what_the_ui_reads() {
        let usage = json!({
            "input_tokens": 10,
            "output_tokens": 4,
            "cache_read_tokens": 7,
            "total_tokens": 21,
        });

        assert_eq!(
            usage_of(Some(&usage)),
            json!({
                "input_tokens": 10,
                "output_tokens": 4,
                "cache_read_input_tokens": 7,
            }),
        );
    }

    #[test]
    fn a_step_without_an_index_closes_nothing() {
        assert_eq!(step_id(&json!({ "step_index": 3 })).as_deref(), Some("step-3"));
        assert_eq!(step_id(&json!({})), None);
    }
}
