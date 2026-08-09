use serde_json::{json, Value};

use super::super::{
    emit_agent_data, emit_agent_for, emit_agent_tool_for, platform, AgentProvider, AgentResponse,
    RunningChild, SendRequest,
};
use super::cli_common::{run_cli, tool_label};

pub struct CodexCliProvider;

/// The type of a thread item, whichever spelling the installed CLI uses:
/// `codex exec --json` moved it from `item_type` to `type` and both are still
/// in the wild.
fn item_type(item: &Value) -> &str {
    item.get("type")
        .or_else(|| item.get("item_type"))
        .and_then(Value::as_str)
        .unwrap_or("")
}

fn item_id(item: &Value) -> Option<String> {
    item.get("id").and_then(Value::as_str).map(String::from)
}

/// What a non-message item did, as the one line the activity row shows.
fn item_label(item: &Value) -> Option<(String, String)> {
    match item_type(item) {
        "command_execution" => Some((
            "Shell".into(),
            tool_label("Shell", Some(&json!({ "command": item.get("command") }))),
        )),
        "file_change" => {
            let paths: Vec<String> = item
                .get("changes")
                .and_then(Value::as_array)
                .map(|changes| {
                    changes
                        .iter()
                        .filter_map(|c| c.get("path").and_then(Value::as_str))
                        .map(String::from)
                        .collect()
                })
                .unwrap_or_default();
            let label = if paths.is_empty() {
                "Edit".to_string()
            } else {
                format!("Edit: {}", paths.join(", "))
            };
            Some(("Edit".into(), label))
        }
        "mcp_tool_call" => {
            let server = item.get("server").and_then(Value::as_str).unwrap_or("mcp");
            let tool = item.get("tool").and_then(Value::as_str).unwrap_or("call");
            Some((tool.to_string(), format!("{server}: {tool}")))
        }
        "web_search" => {
            let query = item.get("query").and_then(Value::as_str).unwrap_or("");
            Some(("WebSearch".into(), format!("WebSearch: {query}")))
        }
        "todo_list" => Some(("TodoWrite".into(), "TodoWrite".into())),
        _ => None,
    }
}

/// The sandbox the CLI runs its tools in. Codex spells its permissions as
/// sandbox levels rather than approval modes, so the conversation's permission
/// mode is passed straight through, and an unset one means the workspace stays
/// writable - the only useful default for an agent asked to change code.
fn sandbox_of(permission_mode: &str) -> String {
    match permission_mode {
        "" => "workspace-write".to_string(),
        other => other.to_string(),
    }
}

impl AgentProvider for CodexCliProvider {
    fn send(
        &self,
        app: &tauri::AppHandle,
        request: &SendRequest,
        handle: &RunningChild,
    ) -> Result<AgentResponse, String> {
        let opts = request.options;
        let binary_override = (!opts.binary_path.is_empty()).then_some(opts.binary_path.as_str());
        let binary = platform::resolve_binary("codex", binary_override)
            .ok_or("Codex CLI not found. Install it or set its path in the provider settings.")?;

        let mut args: Vec<String> = vec!["exec".into()];
        // `resume` is a subcommand of `exec`, so it comes before the flags.
        if let Some(id) = request.session_id {
            args.push("resume".into());
            args.push(id.to_string());
        }
        args.push("--json".into());
        args.push("--skip-git-repo-check".into());
        args.push("--sandbox".into());
        args.push(sandbox_of(&opts.permission_mode));
        if !opts.model.is_empty() {
            args.push("--model".into());
            args.push(opts.model.clone());
        }
        if !opts.effort.is_empty() {
            // Codex has no --effort flag: reasoning effort is a config key, and
            // -c is how the CLI takes an override for one run.
            args.push("-c".into());
            args.push(format!("model_reasoning_effort=\"{}\"", opts.effort));
        }
        args.extend(opts.extra_args.iter().cloned());
        args.push(request.message.to_string());

        let wd = Some(request.working_dir.to_string());
        let rid = Some(request.run_id.to_string());
        let mut session_id_out: Option<String> = None;
        let mut model_seen: Option<String> = None;

        run_cli(&binary, &args, &[], request, handle, |line| {
            let Ok(event) = serde_json::from_str::<Value>(line) else { return };
            let item = event.get("item");

            match event.get("type").and_then(Value::as_str) {
                Some("thread.started") => {
                    if let Some(id) = event.get("thread_id").and_then(Value::as_str) {
                        session_id_out = Some(id.to_string());
                    }
                }
                Some("turn.started") => {
                    if let Some(model) = event.get("model").and_then(Value::as_str) {
                        model_seen = Some(model.to_string());
                    }
                }
                Some("item.started") => {
                    if let Some(item) = item {
                        if let Some((tool, label)) = item_label(item) {
                            emit_agent_tool_for(
                                app,
                                label,
                                &tool,
                                wd.clone(),
                                rid.clone(),
                                None,
                                item_id(item),
                            );
                        }
                    }
                }
                Some("item.completed") => {
                    let Some(item) = item else { return };
                    match item_type(item) {
                        "agent_message" => {
                            if let Some(text) = item.get("text").and_then(Value::as_str) {
                                if !text.is_empty() {
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
                        }
                        "reasoning" => {
                            if let Some(text) = item.get("text").and_then(Value::as_str) {
                                if !text.is_empty() {
                                    emit_agent_data(
                                        app,
                                        "thinking",
                                        json!({ "text": text }),
                                        wd.clone(),
                                        rid.clone(),
                                    );
                                }
                            }
                        }
                        "error" => {
                            emit_agent_data(
                                app,
                                "error",
                                json!({ "message": item.get("message") }),
                                wd.clone(),
                                rid.clone(),
                            );
                        }
                        _ => {
                            if item_label(item).is_some() {
                                let failed = item
                                    .get("status")
                                    .and_then(Value::as_str)
                                    .is_some_and(|s| s == "failed" || s == "error")
                                    || item
                                        .get("exit_code")
                                        .and_then(Value::as_i64)
                                        .is_some_and(|c| c != 0);
                                emit_agent_data(
                                    app,
                                    "tool_result",
                                    json!({ "isError": failed, "toolUseId": item_id(item) }),
                                    wd.clone(),
                                    rid.clone(),
                                );
                            }
                        }
                    }
                }
                Some("turn.completed") => {
                    let usage = event.get("usage");
                    emit_agent_data(
                        app,
                        "usage",
                        json!({
                            "model": model_seen,
                            "usage": {
                                "input_tokens": usage.and_then(|u| u.get("input_tokens")),
                                "output_tokens": usage.and_then(|u| u.get("output_tokens")),
                                "cache_read_input_tokens": usage
                                    .and_then(|u| u.get("cached_input_tokens")),
                            },
                        }),
                        wd.clone(),
                        rid.clone(),
                    );
                }
                Some("turn.failed") => {
                    let message = event
                        .pointer("/error/message")
                        .or_else(|| event.get("error"))
                        .cloned()
                        .unwrap_or(Value::Null);
                    emit_agent_data(app, "error", json!({ "message": message }), wd.clone(), rid.clone());
                }
                Some("error") => {
                    emit_agent_data(
                        app,
                        "error",
                        json!({ "message": event.get("message") }),
                        wd.clone(),
                        rid.clone(),
                    );
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
    fn an_item_type_is_read_under_either_spelling() {
        assert_eq!(item_type(&json!({ "type": "agent_message" })), "agent_message");
        assert_eq!(item_type(&json!({ "item_type": "reasoning" })), "reasoning");
        assert_eq!(item_type(&json!({})), "");
    }

    #[test]
    fn a_shell_item_is_labelled_with_its_command() {
        let item = json!({ "type": "command_execution", "command": "cargo test" });

        assert_eq!(
            item_label(&item),
            Some(("Shell".into(), "Shell: cargo test".into())),
        );
    }

    #[test]
    fn an_edit_item_names_every_file_it_touched() {
        let item = json!({
            "type": "file_change",
            "changes": [{ "path": "a.rs" }, { "path": "b.rs" }],
        });

        assert_eq!(item_label(&item).unwrap().1, "Edit: a.rs, b.rs");
    }

    #[test]
    fn a_message_is_not_an_activity_row() {
        assert_eq!(item_label(&json!({ "type": "agent_message" })), None);
    }

    #[test]
    fn an_unset_permission_mode_still_lets_the_agent_write() {
        assert_eq!(sandbox_of(""), "workspace-write");
        assert_eq!(sandbox_of("read-only"), "read-only");
    }
}
