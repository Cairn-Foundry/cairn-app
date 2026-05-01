use std::collections::HashMap;
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

pub trait AgentProvider: Send + Sync {
    fn send(
        &self,
        message: &str,
        working_dir: &str,
        session_id: Option<&str>,
    ) -> Result<AgentResponse, String>;
}

#[derive(Default)]
pub struct AgentSession {
    session_ids: HashMap<String, String>,
}

impl AgentSession {
    pub fn get_id(&self, provider_id: &str) -> Option<&str> {
        self.session_ids.get(provider_id).map(String::as_str)
    }

    pub fn set_id(&mut self, provider_id: &str, session_id: String) {
        self.session_ids.insert(provider_id.to_string(), session_id);
    }

    pub fn clear(&mut self, provider_id: Option<&str>) {
        match provider_id {
            Some(id) => { self.session_ids.remove(id); }
            None     => { self.session_ids.clear(); }
        }
    }
}

pub struct AgentState {
    pub registry: ProviderRegistry,
    pub session:  Mutex<AgentSession>,
}

impl AgentState {
    pub fn new() -> Self {
        Self {
            registry: ProviderRegistry::new(),
            session:  Mutex::new(AgentSession::default()),
        }
    }
}

#[derive(Clone, Serialize)]
struct AgentOutputEvent {
    line:    String,
    source:  String,
    summary: Option<String>,
}

pub fn emit_agent(app: &tauri::AppHandle, line: String, source: &str) {
    let _ = app.emit("claude-output", AgentOutputEvent {
        line,
        source: source.to_string(),
        summary: None,
    });
}

fn emit_agent_response(app: &tauri::AppHandle, content: String, summary: String) {
    let _ = app.emit("claude-output", AgentOutputEvent {
        line:    content,
        source:  "stdout".to_string(),
        summary: Some(summary),
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

    let session_id = state.session
        .lock().map_err(|e| e.to_string())?
        .get_id(&provider_id)
        .map(str::to_string);

    emit_agent(&app, message.clone(), "stdin");

    let app_out = app.clone();
    std::thread::spawn(move || {
        match provider.send(&message, &working_dir, session_id.as_deref()) {
            Ok(response) => {
                if !response.content.is_empty() {
                    emit_agent_response(&app_out, response.content, response.summary);
                }
                if let Some(id) = response.session_id {
                    if let Ok(mut s) = app_out.state::<AgentState>().session.lock() {
                        s.set_id(&provider_id, id);
                    }
                }
            }
            Err(e) => emit_agent(&app_out, format!("[error: {e}]"), "system"),
        }
        emit_agent(&app_out, "[done]".into(), "system");
    });

    Ok(())
}

#[tauri::command]
pub async fn reset_agent_session(
    app: tauri::AppHandle,
    provider_id: Option<String>,
) -> Result<(), String> {
    let state = app.state::<AgentState>();
    state.session.lock().map_err(|e| e.to_string())?
        .clear(provider_id.as_deref());
    emit_agent(&app, "[session reset]".into(), "system");
    Ok(())
}

#[tauri::command]
pub async fn stop_agent(
    app: tauri::AppHandle,
    provider_id: Option<String>,
) -> Result<(), String> {
    let state = app.state::<AgentState>();
    state.session.lock().map_err(|e| e.to_string())?
        .clear(provider_id.as_deref());
    emit_agent(&app, "[session stopped]".into(), "system");
    Ok(())
}
