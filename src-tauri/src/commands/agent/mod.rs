use std::collections::HashMap;
use std::process::Child;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use serde::Serialize;
use tauri::{Emitter, Manager};

pub mod providers;
pub use providers::{ClaudeCliProvider, ProviderRegistry};

pub struct AgentResponse {
    pub content: String,
    pub summary: String,
    pub session_id: Option<String>,
}

/// Shared handle to a running agent subprocess. The provider stores its spawned
/// child here so `stop_agent` can kill it; `cancelled` distinguishes a
/// user-requested stop from a genuine failure.
pub struct RunningAgent {
    pub child: Mutex<Option<Child>>,
    pub cancelled: AtomicBool,
}

pub type RunningChild = Arc<RunningAgent>;

pub trait AgentProvider: Send + Sync {
    fn send(
        &self,
        message: &str,
        working_dir: &str,
        session_id: Option<&str>,
        handle: &RunningChild,
    ) -> Result<AgentResponse, String>;
}

/// Sessions are keyed per (provider, working_dir) so distinct instances/worktrees
/// never resume one another's conversation.
fn session_key(provider_id: &str, working_dir: &str) -> String {
    format!("{provider_id}\u{1f}{working_dir}")
}

#[derive(Default)]
pub struct AgentSession {
    session_ids: HashMap<String, String>,
}

impl AgentSession {
    fn get_id(&self, key: &str) -> Option<&str> {
        self.session_ids.get(key).map(String::as_str)
    }

    fn set_id(&mut self, key: &str, session_id: String) {
        self.session_ids.insert(key.to_string(), session_id);
    }

    fn clear_key(&mut self, key: &str) {
        self.session_ids.remove(key);
    }

    fn clear_all(&mut self) {
        self.session_ids.clear();
    }
}

pub struct AgentState {
    pub registry: ProviderRegistry,
    pub session:  Mutex<AgentSession>,
    pub running:  Mutex<HashMap<String, RunningChild>>,
}

impl AgentState {
    pub fn new() -> Self {
        Self {
            registry: ProviderRegistry::new(),
            session:  Mutex::new(AgentSession::default()),
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
}

pub fn emit_agent(app: &tauri::AppHandle, line: String, source: &str, working_dir: Option<String>) {
    let _ = app.emit("claude-output", AgentOutputEvent {
        line,
        source: source.to_string(),
        summary: None,
        working_dir,
    });
}

fn emit_agent_response(app: &tauri::AppHandle, content: String, summary: String, working_dir: Option<String>) {
    let _ = app.emit("claude-output", AgentOutputEvent {
        line:    content,
        source:  "stdout".to_string(),
        summary: Some(summary),
        working_dir,
    });
}

#[tauri::command]
pub async fn send_message(
    app: tauri::AppHandle,
    message: String,
    working_dir: String,
    provider_id: String,
) -> Result<(), String> {
    let state = app.state::<AgentState>();

    let provider = state.registry
        .get(&provider_id)
        .ok_or_else(|| format!("Unknown provider: {provider_id}"))?;

    let key = session_key(&provider_id, &working_dir);

    let session_id = state.session
        .lock().map_err(|e| e.to_string())?
        .get_id(&key)
        .map(str::to_string);

    emit_agent(&app, message.clone(), "stdin", Some(working_dir.clone()));

    let handle: RunningChild = Arc::new(RunningAgent {
        child: Mutex::new(None),
        cancelled: AtomicBool::new(false),
    });
    state.running.lock().map_err(|e| e.to_string())?
        .insert(key.clone(), handle.clone());

    let app_out = app.clone();
    std::thread::spawn(move || {
        let result = provider.send(&message, &working_dir, session_id.as_deref(), &handle);

        if let Ok(mut running) = app_out.state::<AgentState>().running.lock() {
            running.remove(&key);
        }

        // A user-requested stop already notified the frontend; don't emit the
        // subprocess's (now meaningless) error or partial result on top of it.
        if handle.cancelled.load(Ordering::SeqCst) {
            return;
        }

        match result {
            Ok(response) => {
                if !response.content.is_empty() {
                    emit_agent_response(&app_out, response.content, response.summary, Some(working_dir.clone()));
                }
                if let Some(id) = response.session_id {
                    if let Ok(mut s) = app_out.state::<AgentState>().session.lock() {
                        s.set_id(&key, id);
                    }
                }
            }
            Err(e) => emit_agent(&app_out, format!("[error: {e}]"), "system", Some(working_dir.clone())),
        }
        emit_agent(&app_out, "[done]".into(), "system", Some(working_dir.clone()));
    });

    Ok(())
}

#[tauri::command]
pub async fn reset_agent_session(
    app: tauri::AppHandle,
    provider_id: Option<String>,
    working_dir: Option<String>,
) -> Result<(), String> {
    let state = app.state::<AgentState>();
    let mut session = state.session.lock().map_err(|e| e.to_string())?;
    match (&provider_id, &working_dir) {
        (Some(p), Some(w)) => session.clear_key(&session_key(p, w)),
        _ => session.clear_all(),
    }
    emit_agent(&app, "[session reset]".into(), "system", working_dir);
    Ok(())
}

#[tauri::command]
pub async fn stop_agent(
    app: tauri::AppHandle,
    provider_id: Option<String>,
    working_dir: Option<String>,
) -> Result<(), String> {
    let state = app.state::<AgentState>();

    // Resolve which running agents to stop: a specific one, or all as a fallback.
    let keys: Vec<String> = match (&provider_id, &working_dir) {
        (Some(p), Some(w)) => vec![session_key(p, w)],
        _ => state.running.lock().map_err(|e| e.to_string())?.keys().cloned().collect(),
    };

    for key in keys {
        let handle = state.running.lock().map_err(|e| e.to_string())?.remove(&key);
        if let Some(handle) = handle {
            handle.cancelled.store(true, Ordering::SeqCst);
            if let Ok(mut slot) = handle.child.lock() {
                if let Some(mut child) = slot.take() {
                    let _ = child.kill();
                }
            }
        }
    }

    emit_agent(&app, "[session stopped]".into(), "system", working_dir);
    Ok(())
}
