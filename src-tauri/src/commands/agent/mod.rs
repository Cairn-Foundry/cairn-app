//! The agent runtime: provider registry, the live runs of the app, and the
//! `claude-output` events every provider reports through.

use std::collections::HashMap;
use std::process::Child;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::Manager;

pub mod config;
pub mod platform;
pub mod oneshot;
pub mod providers;
pub use providers::{ClaudeCliProvider, ProviderRegistry};

/// What a finished run hands back. The session id belongs to the conversation,
/// not to the worktree: it is emitted to the frontend, stored on the
/// conversation, and given back on the next `send_message`. Rust keeps none.
pub struct AgentResponse {
    pub session_id: Option<String>,
}

/// The live process of one run, shared between the worker thread and the
/// commands that talk to it. `cancelled` distinguishes a stop the user asked
/// for from a genuine failure, so stopping reports nothing as an error.
pub struct RunningAgent {
    pub child: Mutex<Option<Child>>,
    pub stdin: Mutex<Option<std::process::ChildStdin>>,
    pub cancelled: AtomicBool,
}

/// Shared handle on a run, held by the worker thread and by `AgentState`.
pub type RunningChild = Arc<RunningAgent>;

/// Per-send overrides: whatever is left unset falls back to the stored
/// provider settings.
#[derive(Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct RunOptions {
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub effort: Option<String>,
    #[serde(default)]
    pub permission_mode: Option<String>,
    #[serde(default)]
    pub system_prompt: Option<String>,
    #[serde(default)]
    pub temperature: Option<f64>,
    #[serde(default)]
    pub max_tokens: Option<u32>,
    #[serde(default)]
    pub history: Option<Vec<HistoryMessage>>,
    #[serde(default)]
    pub allowed_tools: Option<Vec<String>>,
    #[serde(default)]
    pub disallowed_tools: Option<Vec<String>>,
}

/// One past turn, replayed into the prompt for providers that cannot resume.
#[derive(Deserialize, Serialize, Clone)]
pub struct HistoryMessage {
    pub role: String,
    pub content: String,
}

/// Persisted provider settings merged with the per-send overrides.
#[derive(Clone, Default)]
pub struct ResolvedOptions {
    pub model: String,
    pub effort: String,
    pub permission_mode: String,
    pub system_prompt: String,
    pub temperature: f64,
    pub max_tokens: u32,
    pub timeout: u32,
    pub streaming: bool,
    pub base_url: String,
    pub binary_path: String,
    pub extra_args: Vec<String>,
    pub api_key: Option<String>,
    pub history: Vec<HistoryMessage>,
    pub allowed_tools: Vec<String>,
    pub disallowed_tools: Vec<String>,
}

/// Everything a provider needs for one run, borrowed for the call.
pub struct SendRequest<'a> {
    pub message: &'a str,
    pub working_dir: &'a str,
    pub session_id: Option<&'a str>,
    pub run_id: &'a str,
    pub env: &'a HashMap<String, String>,
    pub options: &'a ResolvedOptions,
}

/// One backend Cairn can talk to. `send` runs on a worker thread and blocks
/// until the run ends, reporting everything through `emit_agent*` as it goes.
pub trait AgentProvider: Send + Sync {
    fn send(
        &self,
        app: &tauri::AppHandle,
        request: &SendRequest,
        handle: &RunningChild,
    ) -> Result<AgentResponse, String>;
}

/// App-wide agent state. `running` is keyed by run id, not by instance, so
/// several conversations of the same instance can answer at the same time.
pub struct AgentState {
    pub registry: ProviderRegistry,
    pub running:  Mutex<HashMap<String, RunningChild>>,
}

impl Default for AgentState {
    fn default() -> Self {
        Self::new()
    }
}

impl AgentState {
    /// Registers every known provider; no run is live yet.
    pub fn new() -> Self {
        Self {
            registry: ProviderRegistry::new(),
            running:  Mutex::new(HashMap::new()),
        }
    }
}

/// One `claude-output` event. `run_id` is what routes it to the conversation
/// that started the run.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentOutputEvent {
    line:        String,
    source:      String,
    summary:     Option<String>,
    working_dir: Option<String>,
    run_id:      Option<String>,
    data:        Option<Value>,
    /// The delegation this event belongs to, when the provider produced it
    /// inside a subagent it started: the `tool_use_id` of the `Agent` call.
    /// Empty for the main thread, which is every event of a provider that does
    /// not delegate.
    agent:       Option<String>,
    /// The provider's own id for a tool call, so the line it drew can be found
    /// again when something else reports on that same call.
    tool_id:     Option<String>,
}

/// Every agent event leaves through this queue, one `claude-output-batch` per frame.
static AGENT_OUTPUT: super::coalesce::Coalescer<AgentOutputEvent> =
    super::coalesce::Coalescer::new("claude-output-batch");

/// A line of text attributed to the main thread of the run.
pub fn emit_agent(
    app: &tauri::AppHandle,
    line: String,
    source: &str,
    working_dir: Option<String>,
    run_id: Option<String>,
) {
    emit_agent_for(app, line, source, working_dir, run_id, None);
}

/// Same, attributed to the subagent `agent` when the provider produced it
/// inside a delegation.
pub fn emit_agent_for(
    app: &tauri::AppHandle,
    line: String,
    source: &str,
    working_dir: Option<String>,
    run_id: Option<String>,
    agent: Option<String>,
) {
    AGENT_OUTPUT.push(app, AgentOutputEvent {
        line,
        source: source.to_string(),
        summary: None,
        working_dir,
        run_id,
        data: None,
        agent,
        tool_id: None,
    });
}

/// A tool call as one activity row.
pub fn emit_agent_tool(
    app: &tauri::AppHandle,
    label: String,
    tool: &str,
    working_dir: Option<String>,
    run_id: Option<String>,
) {
    emit_agent_tool_for(app, label, tool, working_dir, run_id, None, None);
}

/// Same, with the delegation it happened in and the provider's own id for the
/// call, so a later result can find the row it must close.
pub fn emit_agent_tool_for(
    app: &tauri::AppHandle,
    label: String,
    tool: &str,
    working_dir: Option<String>,
    run_id: Option<String>,
    agent: Option<String>,
    tool_id: Option<String>,
) {
    AGENT_OUTPUT.push(app, AgentOutputEvent {
        line:    label,
        source:  "tool".to_string(),
        summary: Some(tool.to_string()),
        working_dir,
        run_id,
        data: None,
        agent,
        tool_id,
    });
}

/// Structured payloads: usage, cost, error, thinking, tool_result, init.
pub fn emit_agent_data(
    app: &tauri::AppHandle,
    source: &str,
    data: Value,
    working_dir: Option<String>,
    run_id: Option<String>,
) {
    emit_agent_data_for(app, source, data, working_dir, run_id, None);
}

/// Same, attributed to a subagent.
pub fn emit_agent_data_for(
    app: &tauri::AppHandle,
    source: &str,
    data: Value,
    working_dir: Option<String>,
    run_id: Option<String>,
    agent: Option<String>,
) {
    AGENT_OUTPUT.push(app, AgentOutputEvent {
        line: String::new(),
        source: source.to_string(),
        summary: None,
        working_dir,
        run_id,
        data: Some(data),
        agent,
        tool_id: None,
    });
}

/// The stored provider settings with the per-send overrides applied on top; an
/// empty override never wins over a configured value.
fn resolve_options(provider_id: &str, overrides: Option<RunOptions>) -> ResolvedOptions {
    let stored = config::read_ai_providers_config()
        .ok()
        .and_then(|c| c.providers.get(provider_id).cloned())
        .unwrap_or_default();

    let overrides = overrides.unwrap_or_default();
    // A custom model is just another entry in the picker, so the selected model
    // is authoritative; the legacy single pin still applies when nothing is set.
    let stored_model = if stored.model.is_empty() {
        stored.custom_model.clone()
    } else {
        stored.model.clone()
    };

    ResolvedOptions {
        model: overrides.model.filter(|m| !m.is_empty()).unwrap_or(stored_model),
        effort: overrides.effort.filter(|e| !e.is_empty()).unwrap_or(stored.effort),
        permission_mode: overrides
            .permission_mode
            .filter(|p| !p.is_empty())
            .unwrap_or(stored.permission_mode),
        system_prompt: overrides.system_prompt.unwrap_or_default(),
        temperature: overrides.temperature.unwrap_or(stored.temperature),
        max_tokens: overrides.max_tokens.unwrap_or(stored.max_tokens),
        timeout: stored.timeout,
        streaming: stored.streaming,
        base_url: stored.base_url,
        binary_path: stored.binary_path,
        extra_args: stored.extra_args,
        api_key: config::get_api_key(provider_id),
        history: overrides.history.unwrap_or_default(),
        allowed_tools: overrides.allowed_tools.unwrap_or_default(),
        disallowed_tools: overrides.disallowed_tools.unwrap_or_default(),
    }
}

/// Starts a run on a worker thread and returns at once: the answer arrives as
/// `claude-output` events carrying `run_id`, which the frontend minted. The
/// `[done]` event closes the run whether it succeeded or not.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn send_message(
    app: tauri::AppHandle,
    message: String,
    working_dir: String,
    provider_id: String,
    run_id: String,
    session_id: Option<String>,
    env: Option<HashMap<String, String>>,
    options: Option<RunOptions>,
) -> Result<(), String> {
    let state = app.state::<AgentState>();

    let provider = state.registry
        .get(&provider_id)
        .ok_or_else(|| format!("Unknown provider: {provider_id}"))?;

    emit_agent(&app, message.clone(), "stdin", Some(working_dir.clone()), Some(run_id.clone()));

    let handle: RunningChild = Arc::new(RunningAgent {
        child: Mutex::new(None),
        stdin: Mutex::new(None),
        cancelled: AtomicBool::new(false),
    });
    state.running.lock().map_err(|e| e.to_string())?
        .insert(run_id.clone(), handle.clone());

    let app_out = app.clone();
    let env = env.unwrap_or_default();
    let resolved = resolve_options(&provider_id, options);
    std::thread::spawn(move || {
        let request = SendRequest {
            message: &message,
            working_dir: &working_dir,
            session_id: session_id.as_deref(),
            run_id: &run_id,
            env: &env,
            options: &resolved,
        };
        // A provider that panics would take the rest of this thread with it:
        // the run would stay in `running`, no `[done]` would ever be emitted,
        // and the conversation would sit busy for ever with no way back short
        // of restarting. Turned into an ordinary error, it travels the same
        // path as any other failure and the conversation is released.
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            provider.send(&app_out, &request, &handle)
        }))
        .unwrap_or_else(|payload| {
            let detail = payload
                .downcast_ref::<&str>()
                .map(|s| (*s).to_string())
                .or_else(|| payload.downcast_ref::<String>().cloned())
                .unwrap_or_else(|| "unknown cause".into());
            Err(format!("The agent provider crashed: {detail}"))
        });

        if let Ok(mut running) = app_out.state::<AgentState>().running.lock() {
            running.remove(&run_id);
        }

        if handle.cancelled.load(Ordering::SeqCst) {
            return;
        }

        let wd = Some(working_dir.clone());
        let rid = Some(run_id.clone());
        match result {
            Ok(response) => {
                if let Some(id) = response.session_id {
                    emit_agent(&app_out, id, "session", wd.clone(), rid.clone());
                }
            }
            Err(e) => {
                emit_agent_data(
                    &app_out,
                    "error",
                    serde_json::json!({ "message": e }),
                    wd.clone(),
                    rid.clone(),
                );
            }
        }
        emit_agent(&app_out, "[done]".into(), "system", wd, rid);
    });

    Ok(())
}

/// Answer a pending can_use_tool control request of a running CLI session.
/// `response` is the inner payload: {"behavior":"allow","updatedInput":...,
/// "updatedPermissions":...} or {"behavior":"deny","message":"..."}.
#[tauri::command]
pub async fn respond_permission(
    app: tauri::AppHandle,
    run_id: String,
    request_id: String,
    response: Value,
) -> Result<(), String> {
    use std::io::Write;

    let state = app.state::<AgentState>();
    let handle = state
        .running
        .lock()
        .map_err(|e| e.to_string())?
        .get(&run_id)
        .cloned()
        .ok_or("No running agent for this run")?;

    let envelope = serde_json::json!({
        "type": "control_response",
        "response": {
            "subtype": "success",
            "request_id": request_id,
            "response": response,
        },
    });

    let mut slot = handle.stdin.lock().map_err(|e| e.to_string())?;
    let stdin = slot.as_mut().ok_or("Agent input is closed")?;
    writeln!(stdin, "{envelope}").map_err(|e| e.to_string())
}

/// Kills the process tree of every run still in flight on the way out, so no
/// CLI keeps answering - and keeps costing - after the app is gone.
pub fn shutdown(app: &tauri::AppHandle) {
    let state = app.state::<AgentState>();
    let Ok(mut running) = state.running.lock() else {
        return;
    };
    for (_, handle) in running.drain() {
        handle.cancelled.store(true, Ordering::SeqCst);
        if let Ok(mut stdin) = handle.stdin.lock() {
            stdin.take();
        }
        if let Ok(mut slot) = handle.child.lock()
            && let Some(mut child) = slot.take() {
                platform::kill_tree(&mut child);
            }
    }
}

/// Kills the process tree of one run; the other runs of the same instance keep
/// going.
#[tauri::command]
pub async fn stop_agent(app: tauri::AppHandle, run_id: String) -> Result<(), String> {
    let state = app.state::<AgentState>();

    let handle = state.running.lock().map_err(|e| e.to_string())?.remove(&run_id);
    if let Some(handle) = handle {
        handle.cancelled.store(true, Ordering::SeqCst);
        if let Ok(mut stdin) = handle.stdin.lock() {
            stdin.take();
        }
        if let Ok(mut slot) = handle.child.lock()
            && let Some(mut child) = slot.take() {
                platform::kill_tree(&mut child);
            }
    }

    emit_agent(&app, "[session stopped]".into(), "system", None, Some(run_id));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A run handle with no process behind it: the registry only ever holds
    /// and hands back these, so the child slot can stay empty.
    fn handle() -> RunningChild {
        Arc::new(RunningAgent {
            child: Mutex::new(None),
            stdin: Mutex::new(None),
            cancelled: AtomicBool::new(false),
        })
    }

    fn register(state: &AgentState, run_id: &str) -> RunningChild {
        let child = handle();
        state
            .running
            .lock()
            .unwrap()
            .insert(run_id.to_string(), Arc::clone(&child));
        child
    }

    /// What `stop_agent` does to the registry, without the Tauri handle it
    /// needs to emit the event afterwards.
    fn stop(state: &AgentState, run_id: &str) -> bool {
        let removed = state.running.lock().unwrap().remove(run_id);
        match removed {
            Some(handle) => {
                handle.cancelled.store(true, Ordering::SeqCst);
                true
            }
            None => false,
        }
    }

    #[test]
    fn a_fresh_state_has_no_run_going() {
        let state = AgentState::new();
        assert!(state.running.lock().unwrap().is_empty());
    }

    #[test]
    fn the_default_state_is_the_new_one() {
        assert!(AgentState::default().running.lock().unwrap().is_empty());
    }

    /// The registry is keyed by run id rather than by instance, which is what
    /// lets several conversations of one instance answer at the same time.
    #[test]
    fn several_runs_live_side_by_side() {
        let state = AgentState::new();
        register(&state, "run-1");
        register(&state, "run-2");
        register(&state, "run-3");
        assert_eq!(state.running.lock().unwrap().len(), 3);
    }

    #[test]
    fn stopping_one_run_leaves_its_siblings_going() {
        let state = AgentState::new();
        let first = register(&state, "run-1");
        let second = register(&state, "run-2");

        assert!(stop(&state, "run-1"));

        assert!(first.cancelled.load(Ordering::SeqCst));
        assert!(!second.cancelled.load(Ordering::SeqCst));
        let running = state.running.lock().unwrap();
        assert!(!running.contains_key("run-1"));
        assert!(running.contains_key("run-2"));
    }

    #[test]
    fn a_stopped_run_is_marked_cancelled_so_it_is_not_reported_as_a_failure() {
        let state = AgentState::new();
        let child = register(&state, "run-1");
        assert!(!child.cancelled.load(Ordering::SeqCst));
        stop(&state, "run-1");
        assert!(child.cancelled.load(Ordering::SeqCst));
    }

    #[test]
    fn stopping_a_run_nobody_started_changes_nothing() {
        let state = AgentState::new();
        register(&state, "run-1");
        assert!(!stop(&state, "never-started"));
        assert_eq!(state.running.lock().unwrap().len(), 1);
    }

    #[test]
    fn stopping_the_same_run_twice_is_harmless() {
        let state = AgentState::new();
        register(&state, "run-1");
        assert!(stop(&state, "run-1"));
        assert!(!stop(&state, "run-1"));
        assert!(state.running.lock().unwrap().is_empty());
    }

    #[test]
    fn a_run_that_finished_leaves_the_registry() {
        let state = AgentState::new();
        register(&state, "run-1");
        state.running.lock().unwrap().remove("run-1");
        assert!(state.running.lock().unwrap().is_empty());
    }

    #[test]
    fn the_worker_and_the_registry_share_one_handle() {
        let state = AgentState::new();
        let held_by_worker = register(&state, "run-1");
        let held_by_registry = state
            .running
            .lock()
            .unwrap()
            .get("run-1")
            .cloned()
            .expect("the run should be registered");
        assert!(Arc::ptr_eq(&held_by_worker, &held_by_registry));

        stop(&state, "run-1");
        assert!(held_by_worker.cancelled.load(Ordering::SeqCst));
    }

    #[test]
    fn shutting_down_clears_every_run() {
        let state = AgentState::new();
        let first = register(&state, "run-1");
        let second = register(&state, "run-2");

        for (_, handle) in state.running.lock().unwrap().drain() {
            handle.cancelled.store(true, Ordering::SeqCst);
        }

        assert!(state.running.lock().unwrap().is_empty());
        assert!(first.cancelled.load(Ordering::SeqCst));
        assert!(second.cancelled.load(Ordering::SeqCst));
    }

    #[test]
    fn registering_the_same_id_twice_keeps_only_the_latest() {
        let state = AgentState::new();
        register(&state, "run-1");
        let second = register(&state, "run-1");
        let running = state.running.lock().unwrap();
        assert_eq!(running.len(), 1);
        assert!(Arc::ptr_eq(running.get("run-1").unwrap(), &second));
    }
}
