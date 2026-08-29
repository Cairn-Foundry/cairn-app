//! Capability traits and the `Backend` enum dispatching to one adapter per
//! service. `not_bound` and `no_connection` originate here, never in the front.

use super::connections::{credential_key, descriptor_for, find_connection, read_project_integrations};
use super::http::{host_of, Auth, HttpClient};
use super::model::*;
use super::providers::github::GitHubApi;
use super::providers::gitlab::GitLabApi;
use super::providers::jira::JiraApi;
use crate::commands::agent::config::get_api_key;

#[allow(async_fn_in_trait)]
pub trait TrackerProvider {
    async fn list_tickets(&self, q: &TicketQuery) -> Result<Page<Ticket>, IntegrationError>;
    async fn get_ticket(&self, key: &str) -> Result<Ticket, IntegrationError>;
    async fn resolve_ticket_url(&self, url: &str) -> Result<Option<Ticket>, IntegrationError>;
    async fn list_transitions(&self, key: &str) -> Result<Vec<TicketTransition>, IntegrationError>;
    async fn list_statuses(&self) -> Result<Vec<TrackerStatus>, IntegrationError>;
    async fn transition(&self, key: &str, transition_id: &str) -> Result<Ticket, IntegrationError>;
}

#[allow(async_fn_in_trait)]
pub trait ForgeProvider {
    async fn find_merge_request(&self, source_branch: &str) -> Result<Option<MergeRequest>, IntegrationError>;
    async fn create_merge_request(&self, draft: &MergeRequestDraft) -> Result<MergeRequest, IntegrationError>;
    async fn list_discussions(&self, mr: &str) -> Result<Vec<Discussion>, IntegrationError>;
    async fn reply(&self, mr: &str, discussion: &str, body: &str) -> Result<Comment, IntegrationError>;
    async fn resolve(&self, mr: &str, discussion: &str, resolved: bool) -> Result<(), IntegrationError>;
    async fn approve(&self, mr: &str, approve: bool) -> Result<MergeRequest, IntegrationError>;
    async fn list_members(&self, text: &str) -> Result<Vec<Actor>, IntegrationError>;
    async fn list_labels(&self) -> Result<Vec<String>, IntegrationError>;
    /// Opens a discussion anchored to a line of the merge request diff.
    async fn create_discussion(
        &self,
        mr: &str,
        anchor: &DiscussionAnchor,
        body: &str,
    ) -> Result<Discussion, IntegrationError>;
    /// Posts a whole review at once: every comment, the overall body, and the
    /// verdict. GitHub has the object natively; GitLab is composed from the
    /// pieces it does have.
    async fn submit_review(
        &self,
        mr: &str,
        comments: &[ReviewCommentDraft],
        verdict: ReviewVerdict,
        body: &str,
    ) -> Result<ReviewOutcome, IntegrationError>;
    fn web_links(&self) -> WebLinks;
}

#[allow(async_fn_in_trait)]
pub trait CiProvider {
    async fn list_pipelines(
        &self,
        git_ref: &str,
        query: &PipelineQuery,
        limit: usize,
        page: usize,
    ) -> Result<Page<Pipeline>, IntegrationError>;
    async fn get_pipeline(&self, id: &str) -> Result<Pipeline, IntegrationError>;
    async fn job_log(&self, job_id: &str) -> Result<JobLog, IntegrationError>;
    async fn retry_job(&self, job_id: &str) -> Result<(), IntegrationError>;
    async fn cancel_pipeline(&self, id: &str) -> Result<(), IntegrationError>;
    async fn play_job(&self, job_id: &str) -> Result<(), IntegrationError>;
}

// ---------------------------------------------------------------------------
// CI query helpers
// ---------------------------------------------------------------------------

/// How many pipelines one page may hold. Both forges cap `per_page` well above
/// this; the cost here is the per-pipeline job fetch, not the listing itself.
pub const PIPELINES_PER_PAGE: usize = 20;

/// The `status` value GitLab's `/pipelines` accepts, or `None` when the status
/// has no server-side equivalent and must be left to the text pass.
pub fn gitlab_status_param(status: PipelineStatus) -> Option<&'static str> {
    match status {
        PipelineStatus::Pending => Some("pending"),
        PipelineStatus::Running => Some("running"),
        PipelineStatus::Success => Some("success"),
        PipelineStatus::Failed => Some("failed"),
        PipelineStatus::Canceled => Some("canceled"),
        PipelineStatus::Skipped => Some("skipped"),
        PipelineStatus::Manual => Some("manual"),
        PipelineStatus::Unknown => None,
    }
}

/// The `status` value GitHub's `actions/runs` accepts.
pub fn github_status_param(status: PipelineStatus) -> Option<&'static str> {
    match status {
        PipelineStatus::Pending => Some("queued"),
        PipelineStatus::Running => Some("in_progress"),
        PipelineStatus::Success => Some("success"),
        PipelineStatus::Failed => Some("failure"),
        PipelineStatus::Canceled => Some("cancelled"),
        PipelineStatus::Skipped => Some("skipped"),
        PipelineStatus::Manual => Some("action_required"),
        PipelineStatus::Unknown => None,
    }
}

/// A full commit sha. Both forges match `sha` / `head_sha` exactly - a prefix
/// silently returns nothing - so only a complete sha may be pushed server-side;
/// anything shorter is left to the text pass below.
pub fn is_full_sha(text: &str) -> bool {
    text.len() == 40 && text.chars().all(|c| c.is_ascii_hexdigit())
}

/// The last pass, for what no forge indexes: the commit title, the pipeline
/// number, and a short sha. A full sha is already matched server-side.
pub fn filter_by_text(pipelines: Vec<Pipeline>, text: &str) -> Vec<Pipeline> {
    if text.is_empty() || is_full_sha(text) {
        return pipelines;
    }
    let needle = text.to_lowercase();
    pipelines
        .into_iter()
        .filter(|p| {
            p.title.to_lowercase().contains(&needle)
                || p.number.to_lowercase().contains(&needle)
                || p.sha.to_lowercase().starts_with(&needle)
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Web links
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum WebLinkStyle {
    GitLab,
    GitHub,
}

/// Builds browser URLs for a repository from a normalized target.
#[derive(Clone, Debug)]
pub struct WebLinks {
    pub repo_url: String,
    pub style: WebLinkStyle,
}

impl WebLinks {
    pub fn resolve(&self, target: &WebLinkTarget) -> String {
        let repo = self.repo_url.trim_end_matches('/');
        let prefix = match self.style {
            WebLinkStyle::GitLab => "/-",
            WebLinkStyle::GitHub => "",
        };
        match target {
            WebLinkTarget::File { path, line, git_ref } => {
                let anchor = line.map(|l| format!("#L{l}")).unwrap_or_default();
                format!("{repo}{prefix}/blob/{git_ref}/{}{anchor}", path.trim_start_matches('/'))
            }
            WebLinkTarget::Commit { sha } => format!("{repo}{prefix}/commit/{sha}"),
            WebLinkTarget::Branch { name } => format!("{repo}{prefix}/tree/{name}"),
            WebLinkTarget::Compare { base, head } => format!("{repo}{prefix}/compare/{base}...{head}"),
        }
    }
}

// ---------------------------------------------------------------------------
// Backend
// ---------------------------------------------------------------------------

pub enum Backend {
    GitLab(GitLabApi),
    GitHub(GitHubApi),
    Jira(JiraApi),
}

pub fn api_base_for(kind: IntegrationKind, base_url: &str) -> String {
    let base = base_url.trim().trim_end_matches('/');
    match kind {
        IntegrationKind::Gitlab => format!("{base}/api/v4"),
        IntegrationKind::Github => {
            if host_of(base).as_deref() == Some("github.com") {
                "https://api.github.com".to_string()
            } else {
                format!("{base}/api/v3")
            }
        }
        IntegrationKind::Jira => base.to_string(),
    }
}

fn is_jira_cloud(connection: &IntegrationConnection) -> bool {
    match connection.deployment.as_deref() {
        Some(deployment) => deployment.eq_ignore_ascii_case("cloud"),
        None => connection.email.as_deref().is_some_and(|e| !e.is_empty()),
    }
}

pub fn auth_for(connection: &IntegrationConnection, token: &str) -> Auth {
    match connection.kind {
        IntegrationKind::Gitlab => Auth::PrivateToken(token.to_string()),
        IntegrationKind::Github => Auth::Bearer(token.to_string()),
        IntegrationKind::Jira => {
            if is_jira_cloud(connection) {
                Auth::Basic { user: connection.email.clone().unwrap_or_default(), secret: token.to_string() }
            } else {
                Auth::Bearer(token.to_string())
            }
        }
    }
}

pub fn http_client_for(connection: &IntegrationConnection, token: &str) -> Result<HttpClient, IntegrationError> {
    HttpClient::new(
        &api_base_for(connection.kind, &connection.base_url),
        auth_for(connection, token),
        connection.kind == IntegrationKind::Github,
    )
}

pub fn stored_token(connection: &IntegrationConnection) -> Result<String, IntegrationError> {
    get_api_key(&credential_key(&connection.id))
        .ok_or_else(|| IntegrationError::unauthenticated(format!("No token stored for {}", connection.label)))
}

impl Backend {
    /// The adapter for one connection and one repository or tracker project.
    pub fn for_connection(connection: &IntegrationConnection, token: &str, project_key: &str) -> Result<Backend, IntegrationError> {
        let http = http_client_for(connection, token)?;
        Ok(match connection.kind {
            IntegrationKind::Gitlab => Backend::GitLab(GitLabApi::new(http, &connection.base_url, project_key)),
            IntegrationKind::Github => Backend::GitHub(GitHubApi::new(http, &connection.base_url, project_key)),
            IntegrationKind::Jira => Backend::Jira(JiraApi::new(http, &connection.base_url, project_key, is_jira_cloud(connection))),
        })
    }

    /// The adapter a project uses for `capability`, from its binding, the
    /// connection and the stored token.
    pub fn for_capability(project_id: &str, capability: Capability) -> Result<Backend, IntegrationError> {
        let bindings = read_project_integrations(project_id)?;
        let (connection_id, key) = match capability {
            Capability::Tracker => bindings.tracker.map(|b| (b.connection_id, b.project_key)),
            Capability::Forge => bindings.forge.map(|b| (b.connection_id, b.repo_path)),
            Capability::Ci => bindings.ci.map(|b| (b.connection_id, b.repo_path)),
        }
        .ok_or_else(|| IntegrationError::not_bound(format!("The project has no {capability:?} binding")))?;
        let connection = find_connection(&connection_id)?;
        if !descriptor_for(connection.kind).provides.contains(&capability) {
            return Err(IntegrationError::unsupported());
        }
        let token = stored_token(&connection)?;
        Backend::for_connection(&connection, &token, &key)
    }

    pub fn kind(&self) -> IntegrationKind {
        match self {
            Backend::GitLab(_) => IntegrationKind::Gitlab,
            Backend::GitHub(_) => IntegrationKind::Github,
            Backend::Jira(_) => IntegrationKind::Jira,
        }
    }

    pub async fn test_identity(&self) -> Result<IntegrationIdentity, IntegrationError> {
        match self {
            Backend::GitLab(api) => api.test_identity().await,
            Backend::GitHub(api) => api.test_identity().await,
            Backend::Jira(api) => api.test_identity().await,
        }
    }

    pub async fn list_projects(&self, text: &str) -> Result<Vec<TrackerProject>, IntegrationError> {
        match self {
            Backend::GitLab(api) => api.list_projects(text).await,
            Backend::GitHub(api) => api.list_projects(text).await,
            Backend::Jira(api) => api.list_projects(text).await,
        }
    }
}

impl TrackerProvider for Backend {
    async fn list_tickets(&self, q: &TicketQuery) -> Result<Page<Ticket>, IntegrationError> {
        match self {
            Backend::GitLab(api) => api.list_tickets(q).await,
            Backend::GitHub(api) => api.list_tickets(q).await,
            Backend::Jira(api) => api.list_tickets(q).await,
        }
    }
    async fn get_ticket(&self, key: &str) -> Result<Ticket, IntegrationError> {
        match self {
            Backend::GitLab(api) => api.get_ticket(key).await,
            Backend::GitHub(api) => api.get_ticket(key).await,
            Backend::Jira(api) => api.get_ticket(key).await,
        }
    }
    async fn resolve_ticket_url(&self, url: &str) -> Result<Option<Ticket>, IntegrationError> {
        match self {
            Backend::GitLab(api) => api.resolve_ticket_url(url).await,
            Backend::GitHub(api) => api.resolve_ticket_url(url).await,
            Backend::Jira(api) => api.resolve_ticket_url(url).await,
        }
    }
    async fn list_transitions(&self, key: &str) -> Result<Vec<TicketTransition>, IntegrationError> {
        match self {
            Backend::GitLab(api) => api.list_transitions(key).await,
            Backend::GitHub(api) => api.list_transitions(key).await,
            Backend::Jira(api) => api.list_transitions(key).await,
        }
    }
    async fn list_statuses(&self) -> Result<Vec<TrackerStatus>, IntegrationError> {
        match self {
            Backend::GitLab(api) => api.list_statuses().await,
            Backend::GitHub(api) => api.list_statuses().await,
            Backend::Jira(api) => api.list_statuses().await,
        }
    }
    async fn transition(&self, key: &str, transition_id: &str) -> Result<Ticket, IntegrationError> {
        match self {
            Backend::GitLab(api) => api.transition(key, transition_id).await,
            Backend::GitHub(api) => api.transition(key, transition_id).await,
            Backend::Jira(api) => api.transition(key, transition_id).await,
        }
    }
}

impl ForgeProvider for Backend {
    async fn find_merge_request(&self, source_branch: &str) -> Result<Option<MergeRequest>, IntegrationError> {
        match self {
            Backend::GitLab(api) => api.find_merge_request(source_branch).await,
            Backend::GitHub(api) => api.find_merge_request(source_branch).await,
            Backend::Jira(_) => Err(IntegrationError::unsupported()),
        }
    }
    async fn create_merge_request(&self, draft: &MergeRequestDraft) -> Result<MergeRequest, IntegrationError> {
        match self {
            Backend::GitLab(api) => api.create_merge_request(draft).await,
            Backend::GitHub(api) => api.create_merge_request(draft).await,
            Backend::Jira(_) => Err(IntegrationError::unsupported()),
        }
    }
    async fn list_discussions(&self, mr: &str) -> Result<Vec<Discussion>, IntegrationError> {
        match self {
            Backend::GitLab(api) => api.list_discussions(mr).await,
            Backend::GitHub(api) => api.list_discussions(mr).await,
            Backend::Jira(_) => Err(IntegrationError::unsupported()),
        }
    }
    async fn reply(&self, mr: &str, discussion: &str, body: &str) -> Result<Comment, IntegrationError> {
        match self {
            Backend::GitLab(api) => api.reply(mr, discussion, body).await,
            Backend::GitHub(api) => api.reply(mr, discussion, body).await,
            Backend::Jira(_) => Err(IntegrationError::unsupported()),
        }
    }
    async fn resolve(&self, mr: &str, discussion: &str, resolved: bool) -> Result<(), IntegrationError> {
        match self {
            Backend::GitLab(api) => api.resolve(mr, discussion, resolved).await,
            Backend::GitHub(api) => api.resolve(mr, discussion, resolved).await,
            Backend::Jira(_) => Err(IntegrationError::unsupported()),
        }
    }
    async fn approve(&self, mr: &str, approve: bool) -> Result<MergeRequest, IntegrationError> {
        match self {
            Backend::GitLab(api) => api.approve(mr, approve).await,
            Backend::GitHub(api) => api.approve(mr, approve).await,
            Backend::Jira(_) => Err(IntegrationError::unsupported()),
        }
    }
    async fn list_members(&self, text: &str) -> Result<Vec<Actor>, IntegrationError> {
        match self {
            Backend::GitLab(api) => api.list_members(text).await,
            Backend::GitHub(api) => api.list_members(text).await,
            Backend::Jira(_) => Err(IntegrationError::unsupported()),
        }
    }
    async fn list_labels(&self) -> Result<Vec<String>, IntegrationError> {
        match self {
            Backend::GitLab(api) => api.list_labels().await,
            Backend::GitHub(api) => api.list_labels().await,
            Backend::Jira(_) => Err(IntegrationError::unsupported()),
        }
    }
    async fn create_discussion(
        &self,
        mr: &str,
        anchor: &DiscussionAnchor,
        body: &str,
    ) -> Result<Discussion, IntegrationError> {
        match self {
            Backend::GitLab(api) => api.create_discussion(mr, anchor, body).await,
            Backend::GitHub(api) => api.create_discussion(mr, anchor, body).await,
            Backend::Jira(_) => Err(IntegrationError::unsupported()),
        }
    }
    async fn submit_review(
        &self,
        mr: &str,
        comments: &[ReviewCommentDraft],
        verdict: ReviewVerdict,
        body: &str,
    ) -> Result<ReviewOutcome, IntegrationError> {
        match self {
            Backend::GitLab(api) => api.submit_review(mr, comments, verdict, body).await,
            Backend::GitHub(api) => api.submit_review(mr, comments, verdict, body).await,
            Backend::Jira(_) => Err(IntegrationError::unsupported()),
        }
    }
    fn web_links(&self) -> WebLinks {
        match self {
            Backend::GitLab(api) => api.web_links(),
            Backend::GitHub(api) => api.web_links(),
            Backend::Jira(_) => WebLinks { repo_url: String::new(), style: WebLinkStyle::GitLab },
        }
    }
}

impl CiProvider for Backend {
    async fn list_pipelines(
        &self,
        git_ref: &str,
        query: &PipelineQuery,
        limit: usize,
        page: usize,
    ) -> Result<Page<Pipeline>, IntegrationError> {
        match self {
            Backend::GitLab(api) => api.list_pipelines(git_ref, query, limit, page).await,
            Backend::GitHub(api) => api.list_pipelines(git_ref, query, limit, page).await,
            Backend::Jira(_) => Err(IntegrationError::unsupported()),
        }
    }
    async fn get_pipeline(&self, id: &str) -> Result<Pipeline, IntegrationError> {
        match self {
            Backend::GitLab(api) => api.get_pipeline(id).await,
            Backend::GitHub(api) => api.get_pipeline(id).await,
            Backend::Jira(_) => Err(IntegrationError::unsupported()),
        }
    }
    async fn job_log(&self, job_id: &str) -> Result<JobLog, IntegrationError> {
        match self {
            Backend::GitLab(api) => api.job_log(job_id).await,
            Backend::GitHub(api) => api.job_log(job_id).await,
            Backend::Jira(_) => Err(IntegrationError::unsupported()),
        }
    }
    async fn retry_job(&self, job_id: &str) -> Result<(), IntegrationError> {
        match self {
            Backend::GitLab(api) => api.retry_job(job_id).await,
            Backend::GitHub(api) => api.retry_job(job_id).await,
            Backend::Jira(_) => Err(IntegrationError::unsupported()),
        }
    }
    async fn cancel_pipeline(&self, id: &str) -> Result<(), IntegrationError> {
        match self {
            Backend::GitLab(api) => api.cancel_pipeline(id).await,
            Backend::GitHub(api) => api.cancel_pipeline(id).await,
            Backend::Jira(_) => Err(IntegrationError::unsupported()),
        }
    }
    async fn play_job(&self, job_id: &str) -> Result<(), IntegrationError> {
        match self {
            Backend::GitLab(api) => api.play_job(job_id).await,
            Backend::GitHub(api) => api.play_job(job_id).await,
            Backend::Jira(_) => Err(IntegrationError::unsupported()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn jira_connection() -> IntegrationConnection {
        IntegrationConnection {
            id: "j".into(),
            kind: IntegrationKind::Jira,
            label: "Jira".into(),
            base_url: "https://acme.atlassian.net".into(),
            has_credentials: true,
            identity: None,
            created_at: 0,
            email: Some("me@acme.io".into()),
            deployment: Some("Cloud".into()),
        }
    }

    #[tokio::test]
    async fn jira_backend_is_unsupported_on_forge_and_ci() {
        let backend = Backend::for_connection(&jira_connection(), "token", "CAIRN").unwrap();
        let err = backend.find_merge_request("feat/x").await.unwrap_err();
        assert_eq!(err.code, IntegrationErrorCode::Unsupported);
        let err = backend.list_pipelines("main", &PipelineQuery::default(), 5, 1).await.unwrap_err();
        assert_eq!(err.code, IntegrationErrorCode::Unsupported);
    }

    #[test]
    fn api_bases_per_kind() {
        assert_eq!(api_base_for(IntegrationKind::Gitlab, "https://gitlab.com/"), "https://gitlab.com/api/v4");
        assert_eq!(api_base_for(IntegrationKind::Github, "https://github.com"), "https://api.github.com");
        assert_eq!(api_base_for(IntegrationKind::Github, "https://ghe.corp.net"), "https://ghe.corp.net/api/v3");
        assert_eq!(api_base_for(IntegrationKind::Jira, "https://acme.atlassian.net/"), "https://acme.atlassian.net");
    }

    #[test]
    fn web_links_follow_each_forge_layout() {
        let gl = WebLinks { repo_url: "https://gitlab.com/g/r".into(), style: WebLinkStyle::GitLab };
        let gh = WebLinks { repo_url: "https://github.com/o/r/".into(), style: WebLinkStyle::GitHub };
        let file = WebLinkTarget::File { path: "src/main.rs".into(), line: Some(12), git_ref: "main".into() };
        assert_eq!(gl.resolve(&file), "https://gitlab.com/g/r/-/blob/main/src/main.rs#L12");
        assert_eq!(gh.resolve(&file), "https://github.com/o/r/blob/main/src/main.rs#L12");
        assert_eq!(gl.resolve(&WebLinkTarget::Commit { sha: "abc".into() }), "https://gitlab.com/g/r/-/commit/abc");
        assert_eq!(gh.resolve(&WebLinkTarget::Branch { name: "dev".into() }), "https://github.com/o/r/tree/dev");
        assert_eq!(
            gl.resolve(&WebLinkTarget::Compare { base: "main".into(), head: "dev".into() }),
            "https://gitlab.com/g/r/-/compare/main...dev"
        );
    }

    #[test]
    fn web_link_target_deserializes_from_tagged_json() {
        let t: WebLinkTarget = serde_json::from_str(r#"{"type":"file","path":"a.rs","line":3,"ref":"main"}"#).unwrap();
        assert_eq!(t, WebLinkTarget::File { path: "a.rs".into(), line: Some(3), git_ref: "main".into() });
        let t: WebLinkTarget = serde_json::from_str(r#"{"type":"compare","base":"a","head":"b"}"#).unwrap();
        assert_eq!(t, WebLinkTarget::Compare { base: "a".into(), head: "b".into() });
    }
}
