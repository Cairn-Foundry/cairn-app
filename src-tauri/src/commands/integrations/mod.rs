//! Integrations: GitLab, GitHub and Jira behind capability-named commands.
//! The frontend only ever sees the normalized model of `model.rs`.

pub mod connections;
pub mod http;
pub mod model;
pub mod provider;
pub mod providers;
pub mod watch;

use std::collections::HashMap;
use std::future::Future;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, State};
use crate::commands::agent::config::{delete_provider_api_key, get_api_key, set_provider_api_key};
use connections::*;
use model::*;
use provider::{Backend, CiProvider, ForgeProvider, TrackerProvider};

const TTL_LIST: Duration = Duration::from_secs(30);
const TTL_TICKET: Duration = Duration::from_secs(5 * 60);
const TTL_MEMBERS: Duration = Duration::from_secs(10 * 60);

type CacheKey = (String, String);

#[derive(Default)]
pub struct IntegrationState {
    cache: Mutex<HashMap<CacheKey, (Instant, Value)>>,
    watches: Mutex<HashMap<String, watch::WatchHandle>>,
}

impl IntegrationState {
    fn cached_value(&self, key: &CacheKey, ttl: Duration) -> Option<Value> {
        let cache = self.cache.lock().ok()?;
        let (stored_at, value) = cache.get(key)?;
        (stored_at.elapsed() < ttl).then(|| value.clone())
    }

    fn store(&self, key: CacheKey, value: Value) {
        if let Ok(mut cache) = self.cache.lock() {
            cache.insert(key, (Instant::now(), value));
        }
    }

    fn invalidate_project(&self, project_id: &str) {
        if let Ok(mut cache) = self.cache.lock() {
            cache.retain(|(project, _), _| project != project_id);
        }
    }

    fn invalidate_all(&self) {
        if let Ok(mut cache) = self.cache.lock() {
            cache.clear();
        }
    }
}

async fn cached<T, F, Fut>(
    state: &IntegrationState,
    project_id: &str,
    key: String,
    ttl: Duration,
    force: bool,
    load: F,
) -> Result<T, IntegrationError>
where
    T: Serialize + DeserializeOwned,
    F: FnOnce() -> Fut,
    Fut: Future<Output = Result<T, IntegrationError>>,
{
    let cache_key = (project_id.to_string(), key);
    if !force
        && let Some(value) = state.cached_value(&cache_key, ttl)
        && let Ok(hit) = serde_json::from_value::<T>(value)
    {
        return Ok(hit);
    }
    let fresh = load().await?;
    if let Ok(value) = serde_json::to_value(&fresh) {
        state.store(cache_key, value);
    }
    Ok(fresh)
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn generate_id() -> String {
    let mut bytes = [0u8; 16];
    let _ = getrandom::fill(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn with_credential_flag(mut connection: IntegrationConnection) -> IntegrationConnection {
    connection.has_credentials = get_api_key(&credential_key(&connection.id)).is_some();
    connection
}

fn watch_key(project_id: &str, instance_id: &str) -> String {
    format!("{project_id}:{instance_id}")
}

// ---------------------------------------------------------------------------
// Kinds and connections
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn integration_kinds() -> Result<Vec<IntegrationKindDescriptor>, IntegrationError> {
    Ok(kind_descriptors())
}

#[tauri::command]
pub async fn list_integration_connections() -> Result<Vec<IntegrationConnection>, IntegrationError> {
    Ok(read_connections()?.into_iter().map(with_credential_flag).collect())
}

async fn detect_jira_deployment(connection: &IntegrationConnection, token: &str) -> Option<String> {
    let http = provider::http_client_for(connection, token).ok()?;
    let info = http.get_json("rest/api/2/serverInfo", &[]).await.ok()?;
    info.get("deploymentType").and_then(Value::as_str).map(str::to_string)
}

/// Writes the connection (no secret inside) then stores the token encrypted
/// under `integration:<id>`. `credentials` carries `token` and, for Jira
/// Cloud, `email`.
#[tauri::command]
pub async fn save_integration_connection(
    state: State<'_, IntegrationState>,
    connection: IntegrationConnection,
    credentials: HashMap<String, String>,
) -> Result<IntegrationConnection, IntegrationError> {
    let mut connection = connection;
    if connection.id.trim().is_empty() {
        connection.id = generate_id();
    }
    if connection.created_at == 0 {
        connection.created_at = now_ms();
    }
    connection.base_url = connection.base_url.trim().trim_end_matches('/').to_string();
    if let Some(email) = credentials.get("email").map(|e| e.trim()).filter(|e| !e.is_empty()) {
        connection.email = Some(email.to_string());
    }

    let mut connections = read_connections()?;
    if let Some(existing) = connections.iter().find(|c| c.id == connection.id) {
        if connection.identity.is_none() {
            connection.identity = existing.identity.clone();
        }
        if connection.deployment.is_none() {
            connection.deployment = existing.deployment.clone();
        }
        if connection.email.is_none() {
            connection.email = existing.email.clone();
        }
    }

    let key = credential_key(&connection.id);
    if let Some(token) = credentials.get("token").map(|t| t.trim()).filter(|t| !t.is_empty()) {
        set_provider_api_key(key.clone(), token.to_string()).await?;
    }
    let token = get_api_key(&key);
    connection.has_credentials = token.is_some();

    if connection.kind == IntegrationKind::Jira
        && let Some(token) = token.as_deref()
        && let Some(deployment) = detect_jira_deployment(&connection, token).await
    {
        connection.deployment = Some(deployment);
    }

    match connections.iter_mut().find(|c| c.id == connection.id) {
        Some(slot) => *slot = connection.clone(),
        None => connections.push(connection.clone()),
    }
    write_connections(&connections)?;
    state.invalidate_all();
    Ok(connection)
}

#[tauri::command]
pub async fn delete_integration_connection(
    state: State<'_, IntegrationState>,
    id: String,
) -> Result<Vec<IntegrationConnection>, IntegrationError> {
    let mut connections = read_connections()?;
    connections.retain(|c| c.id != id);
    write_connections(&connections)?;
    delete_provider_api_key(credential_key(&id)).await?;
    state.invalidate_all();
    Ok(connections.into_iter().map(with_credential_flag).collect())
}

/// Calls the service's "who am I" endpoint and stores the identity it answers.
#[tauri::command]
pub async fn test_integration_connection(id: String) -> Result<IntegrationIdentity, IntegrationError> {
    let connection = find_connection(&id)?;
    let token = provider::stored_token(&connection)?;
    let identity = Backend::for_connection(&connection, &token, "")?.test_identity().await?;
    let mut connections = read_connections()?;
    if let Some(slot) = connections.iter_mut().find(|c| c.id == id) {
        slot.identity = Some(identity.clone());
        slot.has_credentials = true;
        write_connections(&connections)?;
    }
    Ok(identity)
}

// ---------------------------------------------------------------------------
// Project bindings
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn get_project_integrations(project_id: String) -> Result<ProjectIntegrations, IntegrationError> {
    Ok(read_project_integrations(&project_id)?)
}

#[tauri::command]
pub async fn save_project_integrations(
    state: State<'_, IntegrationState>,
    project_id: String,
    bindings: ProjectIntegrations,
) -> Result<ProjectIntegrations, IntegrationError> {
    write_project_integrations(&project_id, &bindings)?;
    state.invalidate_project(&project_id);
    Ok(bindings)
}

#[tauri::command]
pub async fn suggest_project_integrations(project_id: String, remote_url: String) -> Result<ProjectIntegrations, IntegrationError> {
    let _ = project_id;
    Ok(suggest_bindings(&remote_url, &read_connections()?))
}

#[tauri::command]
pub async fn get_project_capabilities(project_id: String) -> Result<ResolvedCapabilities, IntegrationError> {
    let bindings = read_project_integrations(&project_id)?;
    Ok(resolve_capabilities(&bindings, &read_connections()?))
}

#[tauri::command]
pub async fn list_tracker_projects(connection_id: String, text: String) -> Result<Vec<TrackerProject>, IntegrationError> {
    let connection = find_connection(&connection_id)?;
    let token = provider::stored_token(&connection)?;
    Backend::for_connection(&connection, &token, "")?.list_projects(&text).await
}

// ---------------------------------------------------------------------------
// Tracker
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn tracker_list_tickets(
    state: State<'_, IntegrationState>,
    project_id: String,
    query: TicketQuery,
    force: Option<bool>,
) -> Result<Page<Ticket>, IntegrationError> {
    let key = format!("tickets:{}", serde_json::to_string(&query).unwrap_or_default());
    cached(&state, &project_id, key, TTL_LIST, force.unwrap_or(false), || async {
        Backend::for_capability(&project_id, Capability::Tracker)?.list_tickets(&query).await
    })
    .await
}

#[tauri::command]
pub async fn tracker_get_ticket(
    state: State<'_, IntegrationState>,
    project_id: String,
    key: String,
    force: Option<bool>,
) -> Result<Ticket, IntegrationError> {
    let cache_key = format!("ticket:{key}");
    cached(&state, &project_id, cache_key, TTL_TICKET, force.unwrap_or(false), || async {
        Backend::for_capability(&project_id, Capability::Tracker)?.get_ticket(&key).await
    })
    .await
}

#[tauri::command]
pub async fn tracker_resolve_url(project_id: String, url: String) -> Result<Option<Ticket>, IntegrationError> {
    Backend::for_capability(&project_id, Capability::Tracker)?.resolve_ticket_url(&url).await
}

#[tauri::command]
pub async fn tracker_list_transitions(project_id: String, key: String) -> Result<Vec<TicketTransition>, IntegrationError> {
    Backend::for_capability(&project_id, Capability::Tracker)?.list_transitions(&key).await
}

#[tauri::command]
pub async fn tracker_list_statuses(project_id: String) -> Result<Vec<TrackerStatus>, IntegrationError> {
    Backend::for_capability(&project_id, Capability::Tracker)?.list_statuses().await
}

#[tauri::command]
pub async fn tracker_transition(
    state: State<'_, IntegrationState>,
    project_id: String,
    key: String,
    transition_id: String,
) -> Result<Ticket, IntegrationError> {
    let ticket = Backend::for_capability(&project_id, Capability::Tracker)?.transition(&key, &transition_id).await?;
    state.invalidate_project(&project_id);
    Ok(ticket)
}

// ---------------------------------------------------------------------------
// Forge
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn forge_find_merge_request(
    state: State<'_, IntegrationState>,
    project_id: String,
    branch: String,
    force: Option<bool>,
) -> Result<Option<MergeRequest>, IntegrationError> {
    let key = format!("mr:{branch}");
    cached(&state, &project_id, key, TTL_LIST, force.unwrap_or(false), || async {
        Backend::for_capability(&project_id, Capability::Forge)?.find_merge_request(&branch).await
    })
    .await
}

#[tauri::command]
pub async fn forge_create_merge_request(
    state: State<'_, IntegrationState>,
    project_id: String,
    draft: MergeRequestDraft,
) -> Result<MergeRequest, IntegrationError> {
    let mr = Backend::for_capability(&project_id, Capability::Forge)?.create_merge_request(&draft).await?;
    state.invalidate_project(&project_id);
    Ok(mr)
}

#[tauri::command]
pub async fn forge_list_discussions(
    state: State<'_, IntegrationState>,
    project_id: String,
    mr_id: String,
    force: Option<bool>,
) -> Result<Vec<Discussion>, IntegrationError> {
    let key = format!("discussions:{mr_id}");
    cached(&state, &project_id, key, TTL_LIST, force.unwrap_or(false), || async {
        Backend::for_capability(&project_id, Capability::Forge)?.list_discussions(&mr_id).await
    })
    .await
}

#[tauri::command]
pub async fn forge_reply(
    state: State<'_, IntegrationState>,
    project_id: String,
    mr_id: String,
    discussion_id: String,
    body: String,
) -> Result<Comment, IntegrationError> {
    let comment = Backend::for_capability(&project_id, Capability::Forge)?.reply(&mr_id, &discussion_id, &body).await?;
    state.invalidate_project(&project_id);
    Ok(comment)
}

#[tauri::command]
pub async fn forge_resolve(
    state: State<'_, IntegrationState>,
    project_id: String,
    mr_id: String,
    discussion_id: String,
    resolved: bool,
) -> Result<(), IntegrationError> {
    Backend::for_capability(&project_id, Capability::Forge)?.resolve(&mr_id, &discussion_id, resolved).await?;
    state.invalidate_project(&project_id);
    Ok(())
}

#[tauri::command]
pub async fn forge_approve(
    state: State<'_, IntegrationState>,
    project_id: String,
    mr_id: String,
    approve: bool,
) -> Result<MergeRequest, IntegrationError> {
    let mr = Backend::for_capability(&project_id, Capability::Forge)?.approve(&mr_id, approve).await?;
    state.invalidate_project(&project_id);
    Ok(mr)
}

#[tauri::command]
pub async fn forge_list_members(
    state: State<'_, IntegrationState>,
    project_id: String,
    text: String,
    force: Option<bool>,
) -> Result<Vec<Actor>, IntegrationError> {
    let key = format!("members:{text}");
    cached(&state, &project_id, key, TTL_MEMBERS, force.unwrap_or(false), || async {
        Backend::for_capability(&project_id, Capability::Forge)?.list_members(&text).await
    })
    .await
}

#[tauri::command]
pub async fn forge_list_labels(
    state: State<'_, IntegrationState>,
    project_id: String,
    force: Option<bool>,
) -> Result<Vec<String>, IntegrationError> {
    cached(&state, &project_id, "labels".to_string(), TTL_MEMBERS, force.unwrap_or(false), || async {
        Backend::for_capability(&project_id, Capability::Forge)?.list_labels().await
    })
    .await
}

#[tauri::command]
pub async fn forge_web_link(project_id: String, target: WebLinkTarget) -> Result<String, IntegrationError> {
    Ok(Backend::for_capability(&project_id, Capability::Forge)?.web_links().resolve(&target))
}

// ---------------------------------------------------------------------------
// CI
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn ci_list_pipelines(
    state: State<'_, IntegrationState>,
    project_id: String,
    git_ref: String,
    limit: Option<usize>,
    force: Option<bool>,
) -> Result<Vec<Pipeline>, IntegrationError> {
    let limit = limit.unwrap_or(5);
    let key = format!("pipelines:{git_ref}:{limit}");
    cached(&state, &project_id, key, TTL_LIST, force.unwrap_or(false), || async {
        Backend::for_capability(&project_id, Capability::Ci)?.list_pipelines(&git_ref, limit).await
    })
    .await
}

#[tauri::command]
pub async fn ci_get_pipeline(
    state: State<'_, IntegrationState>,
    project_id: String,
    id: String,
    force: Option<bool>,
) -> Result<Pipeline, IntegrationError> {
    let key = format!("pipeline:{id}");
    cached(&state, &project_id, key, TTL_LIST, force.unwrap_or(false), || async {
        Backend::for_capability(&project_id, Capability::Ci)?.get_pipeline(&id).await
    })
    .await
}

#[tauri::command]
pub async fn ci_job_log(project_id: String, job_id: String) -> Result<JobLog, IntegrationError> {
    Backend::for_capability(&project_id, Capability::Ci)?.job_log(&job_id).await
}

#[tauri::command]
pub async fn ci_retry_job(state: State<'_, IntegrationState>, project_id: String, job_id: String) -> Result<(), IntegrationError> {
    Backend::for_capability(&project_id, Capability::Ci)?.retry_job(&job_id).await?;
    state.invalidate_project(&project_id);
    Ok(())
}

#[tauri::command]
pub async fn ci_cancel_pipeline(state: State<'_, IntegrationState>, project_id: String, id: String) -> Result<(), IntegrationError> {
    Backend::for_capability(&project_id, Capability::Ci)?.cancel_pipeline(&id).await?;
    state.invalidate_project(&project_id);
    Ok(())
}

#[tauri::command]
pub async fn ci_play_job(state: State<'_, IntegrationState>, project_id: String, job_id: String) -> Result<(), IntegrationError> {
    Backend::for_capability(&project_id, Capability::Ci)?.play_job(&job_id).await?;
    state.invalidate_project(&project_id);
    Ok(())
}

// ---------------------------------------------------------------------------
// Watch
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn integration_watch(
    app: AppHandle,
    state: State<'_, IntegrationState>,
    project_id: String,
    instance_id: String,
    branch: String,
) -> Result<(), IntegrationError> {
    let key = watch_key(&project_id, &instance_id);
    let handle = watch::start(app, project_id, instance_id, branch);
    if let Ok(mut watches) = state.watches.lock()
        && let Some(previous) = watches.insert(key, handle)
    {
        previous.stop();
    }
    Ok(())
}

#[tauri::command]
pub async fn integration_unwatch(
    state: State<'_, IntegrationState>,
    project_id: String,
    instance_id: String,
) -> Result<(), IntegrationError> {
    let key = watch_key(&project_id, &instance_id);
    if let Ok(mut watches) = state.watches.lock()
        && let Some(handle) = watches.remove(&key)
    {
        handle.stop();
    }
    Ok(())
}

/// Stops every poller; called on app exit.
pub fn shutdown(app: &AppHandle) {
    use tauri::Manager;
    if let Some(state) = app.try_state::<IntegrationState>()
        && let Ok(mut watches) = state.watches.lock()
    {
        for (_, handle) in watches.drain() {
            handle.stop();
        }
    }
}
