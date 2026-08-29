//! Normalized model shared by every integration: the only shapes the frontend
//! ever sees. Mirrored by `src/lib/types/integrations.ts`.

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Hash, Debug)]
#[serde(rename_all = "lowercase")]
pub enum IntegrationKind {
    Gitlab,
    Github,
    Jira,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Hash, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Capability {
    Tracker,
    Forge,
    Ci,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationIdentity {
    pub login: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationConnection {
    pub id: String,
    pub kind: IntegrationKind,
    pub label: String,
    pub base_url: String,
    #[serde(default)]
    pub has_credentials: bool,
    #[serde(default)]
    pub identity: Option<IntegrationIdentity>,
    #[serde(default)]
    pub created_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deployment: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CredentialField {
    pub key: String,
    pub label_key: String,
    pub secret: bool,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum MergeRequestTerm {
    Mr,
    Pr,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct KindTerms {
    pub merge_request: MergeRequestTerm,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationKindDescriptor {
    pub kind: IntegrationKind,
    pub label: String,
    pub icon: String,
    pub default_base_url: Option<String>,
    pub credential_fields: Vec<CredentialField>,
    pub token_help_url: String,
    pub required_scopes: Vec<String>,
    pub provides: Vec<Capability>,
    pub terms: KindTerms,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TrackerBinding {
    pub connection_id: String,
    pub project_key: String,
    pub label: String,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RepoBinding {
    pub connection_id: String,
    pub repo_path: String,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct AutoTransition {
    #[serde(default)]
    pub on_create: Option<String>,
    #[serde(default)]
    pub on_finalize: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProjectIntegrations {
    #[serde(default)]
    pub tracker: Option<TrackerBinding>,
    #[serde(default)]
    pub forge: Option<RepoBinding>,
    #[serde(default)]
    pub ci: Option<RepoBinding>,
    #[serde(default)]
    pub auto_transition: AutoTransition,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedTracker {
    pub kind: IntegrationKind,
    pub label: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedForge {
    pub kind: IntegrationKind,
    pub label: String,
    pub web_url: String,
    pub terms: KindTerms,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedCi {
    pub kind: IntegrationKind,
    pub label: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedCapabilities {
    pub tracker: Option<ResolvedTracker>,
    pub forge: Option<ResolvedForge>,
    pub ci: Option<ResolvedCi>,
}

/// A project of a tracker or a repository of a forge, as offered by the picker.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TrackerProject {
    pub key: String,
    pub label: String,
    pub url: String,
}

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum StatusCategory {
    Todo,
    InProgress,
    Done,
    Unknown,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TicketAssignee {
    pub login: String,
    pub display_name: String,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Ticket {
    pub id: String,
    pub key: String,
    pub title: String,
    pub description: String,
    pub status: String,
    pub status_category: StatusCategory,
    pub kind: Option<String>,
    pub labels: Vec<String>,
    pub assignees: Vec<TicketAssignee>,
    pub url: String,
    pub updated_at: String,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum TicketScope {
    Assigned,
    Created,
    All,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum TicketState {
    Open,
    Closed,
    All,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TicketQuery {
    pub scope: TicketScope,
    #[serde(default)]
    pub text: String,
    pub state: TicketState,
    #[serde(default = "default_page")]
    pub page: u32,
}

fn default_page() -> u32 { 1 }

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TicketTransition {
    pub id: String,
    pub name: String,
    pub to_status: String,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TrackerStatus {
    pub id: String,
    pub name: String,
    pub category: StatusCategory,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Page<T> {
    pub items: Vec<T>,
    pub has_more: bool,
}

// ---------------------------------------------------------------------------
// Merge requests
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Actor {
    pub login: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum MergeRequestState {
    Open,
    Merged,
    Closed,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Mergeable {
    Yes,
    No,
    Unknown,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Approvals {
    pub approved: u32,
    pub required: Option<u32>,
    pub approved_by_me: bool,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MergeRequest {
    pub id: String,
    pub number: String,
    pub title: String,
    pub description: String,
    pub state: MergeRequestState,
    pub is_draft: bool,
    pub source_branch: String,
    pub target_branch: String,
    pub author: Actor,
    pub reviewers: Vec<Actor>,
    pub assignees: Vec<Actor>,
    pub labels: Vec<String>,
    pub approvals: Approvals,
    pub mergeable: Mergeable,
    pub has_conflicts: bool,
    pub head_sha: String,
    pub pipeline_status: Option<PipelineStatus>,
    pub url: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MergeRequestDraft {
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub is_draft: bool,
    pub source_branch: String,
    pub target_branch: String,
    #[serde(default)]
    pub reviewers: Vec<String>,
    #[serde(default)]
    pub assignees: Vec<String>,
    #[serde(default)]
    pub labels: Vec<String>,
    #[serde(default)]
    pub remove_source_branch: bool,
    #[serde(default)]
    pub is_squash: bool,
    #[serde(default)]
    pub linked_ticket_key: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum DiffSide {
    Old,
    New,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DiscussionAnchor {
    pub path: String,
    pub line: u32,
    pub side: DiffSide,
    pub sha: String,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    pub id: String,
    pub author: Actor,
    pub body: String,
    pub created_at: String,
    pub is_system: bool,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Discussion {
    pub id: String,
    pub resolved: bool,
    pub resolvable: bool,
    pub anchor: Option<DiscussionAnchor>,
    pub comments: Vec<Comment>,
}

/// One comment of a review, as the reviewer wrote it locally.
#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ReviewCommentDraft {
    /// The local id, echoed back so the frontend knows which one landed.
    pub id: String,
    pub path: String,
    pub line: u32,
    pub side: DiffSide,
    pub body: String,
}

/// What a submitted review says overall.
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum ReviewVerdict {
    Approve,
    Changes,
    Comment,
}

/// What actually reached the forge. A submission that fails halfway still
/// reports what it managed to post, so a second attempt sends only the rest.
#[derive(Serialize, Deserialize, Clone, PartialEq, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ReviewOutcome {
    /// Local comment id -> the id the forge gave it.
    pub published: std::collections::HashMap<String, String>,
    /// Local comment ids that could not be posted, with the reason.
    pub failed: Vec<ReviewFailure>,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ReviewFailure {
    pub id: String,
    pub message: String,
}

// ---------------------------------------------------------------------------
// Pipelines
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum PipelineStatus {
    Pending,
    Running,
    Success,
    Failed,
    Canceled,
    Skipped,
    Manual,
    Unknown,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PipelineJob {
    pub id: String,
    pub name: String,
    pub status: PipelineStatus,
    pub duration_ms: Option<u64>,
    pub started_at: Option<String>,
    pub can_retry: bool,
    pub can_cancel: bool,
    pub is_manual: bool,
    pub url: String,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PipelineStage {
    pub name: String,
    pub status: PipelineStatus,
    pub jobs: Vec<PipelineJob>,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Pipeline {
    pub id: String,
    pub number: String,
    pub status: PipelineStatus,
    #[serde(rename = "ref")]
    pub git_ref: String,
    pub sha: String,
    pub title: String,
    pub source: Option<String>,
    pub stages: Vec<PipelineStage>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub duration_ms: Option<u64>,
    pub url: String,
    pub failed_job_id: Option<String>,
}

/// What the CI list is narrowed to. Every field is applied by the provider, on
/// the whole branch history - never by the client on the page it happens to hold.
#[derive(Serialize, Deserialize, Clone, PartialEq, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct PipelineQuery {
    #[serde(default)]
    pub status: Option<PipelineStatus>,
    /// Free text: a sha prefix, a pipeline number, or a commit title fragment.
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
}

impl PipelineQuery {
    pub fn is_empty(&self) -> bool {
        self.status.is_none() && self.text.trim().is_empty() && self.username.is_none() && self.source.is_none()
    }
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct JobLog {
    pub job_id: String,
    pub text: String,
    pub truncated: bool,
    pub failure_excerpt: Option<String>,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum IntegrationErrorCode {
    NoConnection,
    NotBound,
    Unauthenticated,
    Forbidden,
    NotFound,
    RateLimited,
    Network,
    Unsupported,
    Provider,
}

/// Serializes as `{ code, message, retryAfterMs }`, the shape
/// `toIntegrationError` expects on the TS side.
#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationError {
    pub code: IntegrationErrorCode,
    pub message: String,
    pub retry_after_ms: Option<u64>,
}

impl IntegrationError {
    pub fn new(code: IntegrationErrorCode, message: impl Into<String>) -> Self {
        IntegrationError { code, message: message.into(), retry_after_ms: None }
    }
    pub fn no_connection(message: impl Into<String>) -> Self { Self::new(IntegrationErrorCode::NoConnection, message) }
    pub fn not_bound(message: impl Into<String>) -> Self { Self::new(IntegrationErrorCode::NotBound, message) }
    pub fn unauthenticated(message: impl Into<String>) -> Self { Self::new(IntegrationErrorCode::Unauthenticated, message) }
    pub fn forbidden(message: impl Into<String>) -> Self { Self::new(IntegrationErrorCode::Forbidden, message) }
    pub fn not_found(message: impl Into<String>) -> Self { Self::new(IntegrationErrorCode::NotFound, message) }
    pub fn network(message: impl Into<String>) -> Self { Self::new(IntegrationErrorCode::Network, message) }
    pub fn provider(message: impl Into<String>) -> Self { Self::new(IntegrationErrorCode::Provider, message) }
    pub fn unsupported() -> Self { Self::new(IntegrationErrorCode::Unsupported, "This service does not provide that capability") }
    pub fn rate_limited(retry_after_ms: Option<u64>) -> Self {
        IntegrationError {
            code: IntegrationErrorCode::RateLimited,
            message: "Rate limit reached".to_string(),
            retry_after_ms,
        }
    }
}

impl From<String> for IntegrationError {
    fn from(message: String) -> Self { Self::provider(message) }
}

impl std::fmt::Display for IntegrationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}: {}", self.code, self.message)
    }
}

// ---------------------------------------------------------------------------
// Web links and events
// ---------------------------------------------------------------------------

/// What the frontend asks a forge link for; TS sends `{ type: 'file', ... }`.
#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WebLinkTarget {
    File {
        path: String,
        #[serde(default)]
        line: Option<u32>,
        #[serde(rename = "ref")]
        git_ref: String,
    },
    Commit { sha: String },
    Branch { name: String },
    Compare { base: String, head: String },
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum IntegrationUpdateKind {
    Pipeline,
    MergeRequest,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationUpdateEvent {
    pub project_id: String,
    pub instance_id: String,
    pub kind: IntegrationUpdateKind,
    pub data: serde_json::Value,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn integration_error_serializes_as_camel_case_object() {
        let e = IntegrationError::rate_limited(Some(1500));
        let json = serde_json::to_value(&e).unwrap();
        assert_eq!(json, serde_json::json!({ "code": "rate_limited", "message": "Rate limit reached", "retryAfterMs": 1500 }));
        let e = IntegrationError::not_bound("x");
        assert_eq!(serde_json::to_value(&e).unwrap()["retryAfterMs"], serde_json::Value::Null);
    }

    #[test]
    fn project_integrations_default_loads_from_empty_object() {
        let p: ProjectIntegrations = serde_json::from_str("{}").unwrap();
        assert_eq!(p, ProjectIntegrations::default());
    }
}
