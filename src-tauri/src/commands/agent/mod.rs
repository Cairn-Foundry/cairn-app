use std::collections::HashMap;
use std::process::Child;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use serde::Serialize;
use tauri::{Emitter, Manager};

pub mod providers;
pub use providers::{ClaudeCliProvider, ProviderRegistry};

pub struct AgentResponse {
    pub session_id: Option<String>,
}

pub struct RunningAgent {
    pub child: Mutex<Option<Child>>,
    pub cancelled: AtomicBool,
}

pub type RunningChild = Arc<RunningAgent>;

pub trait AgentProvider: Send + Sync {
    fn send(
        &self,
        app: &tauri::AppHandle,
        message: &str,
        working_dir: &str,
        session_id: Option<&str>,
        handle: &RunningChild,
        run_id: &str,
        env: &HashMap<String, String>,
    ) -> Result<AgentResponse, String>;
}

pub struct AgentState {
    pub registry: ProviderRegistry,
    pub running:  Mutex<HashMap<String, RunningChild>>,
}

impl AgentState {
    pub fn new() -> Self {
        Self {
            registry: ProviderRegistry::new(),
            running:  Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentOutputEvent {
    line:        String,
    source:      String,
    summary:     Option<String>,
    working_dir: Option<String>,
    run_id:      Option<String>,
}

pub fn emit_agent(
    app: &tauri::AppHandle,
    line: String,
    source: &str,
    working_dir: Option<String>,
    run_id: Option<String>,
) {
    let _ = app.emit("claude-output", AgentOutputEvent {
        line,
        source: source.to_string(),
        summary: None,
        working_dir,
        run_id,
    });
}

pub fn emit_agent_tool(
    app: &tauri::AppHandle,
    label: String,
    tool: &str,
    working_dir: Option<String>,
    run_id: Option<String>,
) {
    let _ = app.emit("claude-output", AgentOutputEvent {
        line:    label,
        source:  "tool".to_string(),
        summary: Some(tool.to_string()),
        working_dir,
        run_id,
    });
}

#[tauri::command]
pub async fn send_message(
    app: tauri::AppHandle,
    message: String,
    working_dir: String,
    provider_id: String,
    run_id: String,
    session_id: Option<String>,
    env: Option<HashMap<String, String>>,
) -> Result<(), String> {
    let state = app.state::<AgentState>();

    let provider = state.registry
        .get(&provider_id)
        .ok_or_else(|| format!("Unknown provider: {provider_id}"))?;

    emit_agent(&app, message.clone(), "stdin", Some(working_dir.clone()), Some(run_id.clone()));

    let handle: RunningChild = Arc::new(RunningAgent {
        child: Mutex::new(None),
        cancelled: AtomicBool::new(false),
    });
    state.running.lock().map_err(|e| e.to_string())?
        .insert(run_id.clone(), handle.clone());

    let app_out = app.clone();
    let env = env.unwrap_or_default();
    std::thread::spawn(move || {
        let result = provider.send(
            &app_out,
            &message,
            &working_dir,
            session_id.as_deref(),
            &handle,
            &run_id,
            &env,
        );

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
            Err(e) => emit_agent(&app_out, format!("[error: {e}]"), "system", wd.clone(), rid.clone()),
        }
        emit_agent(&app_out, "[done]".into(), "system", wd, rid);
    });

    Ok(())
}

#[tauri::command]
pub async fn stop_agent(app: tauri::AppHandle, run_id: String) -> Result<(), String> {
    let state = app.state::<AgentState>();

    let handle = state.running.lock().map_err(|e| e.to_string())?.remove(&run_id);
    if let Some(handle) = handle {
        handle.cancelled.store(true, Ordering::SeqCst);
        if let Ok(mut slot) = handle.child.lock() {
            if let Some(mut child) = slot.take() {
                let _ = child.kill();
            }
        }
    }

    emit_agent(&app, "[session stopped]".into(), "system", None, Some(run_id));
    Ok(())
}
