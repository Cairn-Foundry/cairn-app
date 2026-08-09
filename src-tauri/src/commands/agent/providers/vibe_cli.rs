use std::collections::HashSet;
use std::path::PathBuf;

use serde_json::{json, Value};

use super::super::{
    emit_agent_data, emit_agent_for, emit_agent_tool_for, platform, AgentProvider, AgentResponse,
    RunningChild, SendRequest,
};
use super::cli_common::{run_cli, tool_label};

pub struct VibeCliProvider;

/// Where Vibe keeps one directory per session. `VIBE_HOME` moves the whole
/// home, which is how a user points the CLI at another profile.
fn session_log_dir(env: &std::collections::HashMap<String, String>) -> Option<PathBuf> {
    let home = env
        .get("VIBE_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var("VIBE_HOME").ok().map(PathBuf::from))
        .or_else(|| dirs::home_dir().map(|h| h.join(".vibe")))?;
    Some(home.join("logs").join("session"))
}

fn session_dirs(dir: &Option<PathBuf>) -> HashSet<String> {
    let Some(dir) = dir else { return HashSet::new() };
    let Ok(entries) = std::fs::read_dir(dir) else { return HashSet::new() };
    entries
        .filter_map(Result::ok)
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect()
}

/// The id of the session a run just opened. Programmatic mode prints no session
/// id, so the only place it exists is the directory the CLI wrote while it ran:
/// the one that was not there when the run started.
fn opened_session_id(dir: &Option<PathBuf>, known: &HashSet<String>) -> Option<String> {
    let dir = dir.as_ref()?;
    let fresh = std::fs::read_dir(dir)
        .ok()?
        .filter_map(Result::ok)
        .filter(|e| !known.contains(&e.file_name().to_string_lossy().to_string()))
        .max_by_key(|e| e.metadata().and_then(|m| m.modified()).ok())?;
    let meta = std::fs::read_to_string(fresh.path().join("meta.json")).ok()?;
    serde_json::from_str::<Value>(&meta)
        .ok()?
        .get("session_id")
        .and_then(Value::as_str)
        .map(String::from)
}

/// Vibe spells its permission modes as the agent profile a run adopts.
fn agent_of(permission_mode: &str) -> String {
    match permission_mode {
        "" => "default".to_string(),
        other => other.to_string(),
    }
}

impl AgentProvider for VibeCliProvider {
    fn send(
        &self,
        app: &tauri::AppHandle,
        request: &SendRequest,
        handle: &RunningChild,
    ) -> Result<AgentResponse, String> {
        let opts = request.options;
        let binary_override = (!opts.binary_path.is_empty()).then_some(opts.binary_path.as_str());
        let binary = platform::resolve_binary("vibe", binary_override)
            .ok_or("Mistral Vibe not found. Install it or set its path in the provider settings.")?;

        let mut args: Vec<String> = vec![
            "-p".into(),
            request.message.to_string(),
            "--output".into(),
            "streaming".into(),
            "--workdir".into(),
            request.working_dir.to_string(),
            // The worktree is trusted for this run only: a folder Cairn created
            // must not end up in the CLI's persisted trust list.
            "--trust".into(),
            "--agent".into(),
            agent_of(&opts.permission_mode),
        ];
        if let Some(id) = request.session_id {
            args.push("--resume".into());
            args.push(id.to_string());
        }
        args.extend(opts.extra_args.iter().cloned());

        // Vibe takes no --model flag; every config field is overridable by env.
        let extra_env: Vec<(&str, String)> = if opts.model.is_empty() {
            Vec::new()
        } else {
            vec![("VIBE_ACTIVE_MODEL", opts.model.clone())]
        };

        let log_dir = session_log_dir(request.env);
        let known = session_dirs(&log_dir);

        let wd = Some(request.working_dir.to_string());
        let rid = Some(request.run_id.to_string());

        run_cli(&binary, &args, &extra_env, request, handle, |line| {
            let Ok(message) = serde_json::from_str::<Value>(line) else { return };

            match message.get("role").and_then(Value::as_str) {
                Some("assistant") => {
                    if let Some(text) = message.get("reasoning_content").and_then(Value::as_str) {
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
                    if let Some(text) = message.get("content").and_then(Value::as_str) {
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
                    let calls = message.get("tool_calls").and_then(Value::as_array);
                    for call in calls.into_iter().flatten() {
                        let name = call
                            .pointer("/function/name")
                            .and_then(Value::as_str)
                            .unwrap_or("tool");
                        // Arguments travel as a JSON string, so the label can
                        // only name what was acted on once they are parsed.
                        let input = call
                            .pointer("/function/arguments")
                            .and_then(Value::as_str)
                            .and_then(|a| serde_json::from_str::<Value>(a).ok());
                        emit_agent_tool_for(
                            app,
                            tool_label(name, input.as_ref()),
                            name,
                            wd.clone(),
                            rid.clone(),
                            None,
                            call.get("id").and_then(Value::as_str).map(String::from),
                        );
                    }
                }
                Some("tool") => {
                    emit_agent_data(
                        app,
                        "tool_result",
                        json!({
                            "isError": false,
                            "toolUseId": message.get("tool_call_id"),
                        }),
                        wd.clone(),
                        rid.clone(),
                    );
                }
                _ => {}
            }
        })?;

        let session_id = request
            .session_id
            .map(String::from)
            .or_else(|| opened_session_id(&log_dir, &known));

        Ok(AgentResponse { session_id })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_unset_permission_mode_runs_the_default_profile() {
        assert_eq!(agent_of(""), "default");
        assert_eq!(agent_of("plan"), "plan");
    }

    #[test]
    fn a_run_that_opened_no_session_reports_none() {
        let dir = Some(PathBuf::from("/nonexistent/vibe/logs/session"));

        assert_eq!(session_dirs(&dir).len(), 0);
        assert_eq!(opened_session_id(&dir, &HashSet::new()), None);
    }
}
