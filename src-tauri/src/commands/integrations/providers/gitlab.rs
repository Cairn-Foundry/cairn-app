//! GitLab adapter (`/api/v4`): tracker (issues), forge (merge requests,
//! discussions, approvals) and CI (pipelines, jobs, traces).

use std::sync::Mutex;
use serde_json::{json, Value};
use crate::commands::integrations::http::{host_of, HttpClient};
use crate::commands::integrations::model::*;
use crate::commands::integrations::provider::{CiProvider, ForgeProvider, TrackerProvider, WebLinkStyle, WebLinks};

const TICKETS_PER_PAGE: u32 = 20;
const MAX_LOG_CHARS: usize = 400_000;
const EXCERPT_CONTEXT_LINES: usize = 25;

pub struct GitLabApi {
    http: HttpClient,
    base_url: String,
    project_path: String,
    me: Mutex<Option<(u64, String)>>,
}

fn encode_path(path: &str) -> String {
    path.replace('/', "%2F")
}

fn parse_iid(key: &str) -> Result<u64, IntegrationError> {
    key.trim()
        .trim_start_matches(['#', '!'])
        .parse::<u64>()
        .map_err(|_| IntegrationError::not_found(format!("'{key}' is not a GitLab id")))
}

fn str_of(v: &Value, key: &str) -> String {
    v.get(key).and_then(Value::as_str).unwrap_or_default().to_string()
}

fn opt_str_of(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(Value::as_str).map(str::to_string)
}

fn id_of(v: &Value, key: &str) -> String {
    match v.get(key) {
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::String(s)) => s.clone(),
        _ => String::new(),
    }
}

fn strings_of(v: &Value, key: &str) -> Vec<String> {
    v.get(key)
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).map(str::to_string).collect())
        .unwrap_or_default()
}

pub fn map_actor(v: &Value) -> Actor {
    Actor {
        login: str_of(v, "username"),
        display_name: {
            let name = str_of(v, "name");
            if name.is_empty() { str_of(v, "username") } else { name }
        },
        avatar_url: opt_str_of(v, "avatar_url"),
    }
}

fn actors_of(v: &Value, key: &str) -> Vec<Actor> {
    v.get(key)
        .and_then(Value::as_array)
        .map(|a| a.iter().map(map_actor).collect())
        .unwrap_or_default()
}

fn ticket_status_category(state: &str, labels: &[String]) -> StatusCategory {
    match state {
        "closed" => StatusCategory::Done,
        "opened" => {
            let is_in_progress = labels.iter().any(|l| {
                let l = l.to_ascii_lowercase();
                l.contains("doing") || l.contains("in progress") || l.contains("in-progress") || l == "wip"
            });
            if is_in_progress { StatusCategory::InProgress } else { StatusCategory::Todo }
        }
        _ => StatusCategory::Unknown,
    }
}

pub fn map_ticket(v: &Value) -> Ticket {
    let iid = id_of(v, "iid");
    let labels = strings_of(v, "labels");
    let state = str_of(v, "state");
    Ticket {
        id: iid.clone(),
        key: format!("#{iid}"),
        title: str_of(v, "title"),
        description: str_of(v, "description"),
        status_category: ticket_status_category(&state, &labels),
        status: state,
        kind: opt_str_of(v, "issue_type").or_else(|| Some("issue".to_string())),
        labels,
        assignees: v
            .get("assignees")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .map(|u| TicketAssignee { login: str_of(u, "username"), display_name: str_of(u, "name") })
                    .collect()
            })
            .unwrap_or_default(),
        url: str_of(v, "web_url"),
        updated_at: str_of(v, "updated_at"),
    }
}

pub fn map_pipeline_status(status: &str) -> PipelineStatus {
    match status {
        "created" | "waiting_for_resource" | "preparing" | "pending" | "scheduled" | "waiting_for_callback" => PipelineStatus::Pending,
        "running" => PipelineStatus::Running,
        "success" => PipelineStatus::Success,
        "failed" => PipelineStatus::Failed,
        "canceled" | "canceling" => PipelineStatus::Canceled,
        "skipped" => PipelineStatus::Skipped,
        "manual" => PipelineStatus::Manual,
        _ => PipelineStatus::Unknown,
    }
}

fn mr_state(v: &Value) -> MergeRequestState {
    match v.get("state").and_then(Value::as_str) {
        Some("merged") => MergeRequestState::Merged,
        Some("closed") => MergeRequestState::Closed,
        _ => MergeRequestState::Open,
    }
}

fn mr_mergeable(v: &Value) -> Mergeable {
    match v.get("detailed_merge_status").and_then(Value::as_str) {
        Some("mergeable") => Mergeable::Yes,
        Some("checking") | Some("unchecked") | Some("preparing") | None => match v.get("merge_status").and_then(Value::as_str) {
            Some("can_be_merged") => Mergeable::Yes,
            Some("cannot_be_merged") => Mergeable::No,
            _ => Mergeable::Unknown,
        },
        Some(_) => Mergeable::No,
    }
}

/// `approvals` is the answer of `merge_requests/:iid/approvals`; `my_login`
/// tells whether the current user is among the approvers.
pub fn map_merge_request(v: &Value, approvals: Option<&Value>, my_login: Option<&str>) -> MergeRequest {
    let iid = id_of(v, "iid");
    let approved_by: Vec<String> = approvals
        .and_then(|a| a.get("approved_by"))
        .and_then(Value::as_array)
        .map(|a| a.iter().map(|e| str_of(e.get("user").unwrap_or(e), "username")).collect())
        .unwrap_or_default();
    MergeRequest {
        id: iid.clone(),
        number: format!("!{iid}"),
        title: str_of(v, "title"),
        description: str_of(v, "description"),
        state: mr_state(v),
        is_draft: v.get("draft").and_then(Value::as_bool).or_else(|| v.get("work_in_progress").and_then(Value::as_bool)).unwrap_or(false),
        source_branch: str_of(v, "source_branch"),
        target_branch: str_of(v, "target_branch"),
        author: v.get("author").map(map_actor).unwrap_or(Actor { login: String::new(), display_name: String::new(), avatar_url: None }),
        reviewers: actors_of(v, "reviewers"),
        assignees: actors_of(v, "assignees"),
        labels: strings_of(v, "labels"),
        approvals: Approvals {
            approved: approved_by.len() as u32,
            required: approvals.and_then(|a| a.get("approvals_required")).and_then(Value::as_u64).map(|n| n as u32),
            approved_by_me: my_login.is_some_and(|me| approved_by.iter().any(|l| l == me)),
        },
        mergeable: mr_mergeable(v),
        has_conflicts: v.get("has_conflicts").and_then(Value::as_bool).unwrap_or(false),
        head_sha: str_of(v, "sha"),
        pipeline_status: v
            .get("head_pipeline")
            .filter(|p| !p.is_null())
            .or_else(|| v.get("pipeline").filter(|p| !p.is_null()))
            .map(|p| map_pipeline_status(&str_of(p, "status"))),
        url: str_of(v, "web_url"),
        created_at: str_of(v, "created_at"),
        updated_at: str_of(v, "updated_at"),
    }
}

pub fn map_comment(note: &Value) -> Comment {
    Comment {
        id: id_of(note, "id"),
        author: note.get("author").map(map_actor).unwrap_or(Actor { login: String::new(), display_name: String::new(), avatar_url: None }),
        body: str_of(note, "body"),
        created_at: str_of(note, "created_at"),
        is_system: note.get("system").and_then(Value::as_bool).unwrap_or(false),
    }
}

fn map_anchor(position: &Value) -> Option<DiscussionAnchor> {
    let sha = str_of(position, "head_sha");
    if let Some(line) = position.get("new_line").and_then(Value::as_u64) {
        return Some(DiscussionAnchor {
            path: str_of(position, "new_path").replace('\\', "/"),
            line: line as u32,
            side: DiffSide::New,
            sha,
        });
    }
    if let Some(line) = position.get("old_line").and_then(Value::as_u64) {
        return Some(DiscussionAnchor {
            path: str_of(position, "old_path").replace('\\', "/"),
            line: line as u32,
            side: DiffSide::Old,
            sha,
        });
    }
    None
}

pub fn map_discussion(v: &Value) -> Option<Discussion> {
    let notes = v.get("notes")?.as_array()?;
    let first = notes.first()?;
    Some(Discussion {
        id: str_of(v, "id"),
        resolved: first.get("resolved").and_then(Value::as_bool).unwrap_or(false),
        resolvable: first.get("resolvable").and_then(Value::as_bool).unwrap_or(false),
        anchor: first.get("position").filter(|p| !p.is_null()).and_then(map_anchor),
        comments: notes.iter().map(map_comment).collect(),
    })
}

fn duration_ms(v: &Value, key: &str) -> Option<u64> {
    v.get(key).and_then(Value::as_f64).map(|s| (s * 1000.0) as u64)
}

fn aggregate_status(jobs: &[PipelineJob]) -> PipelineStatus {
    let has = |s: PipelineStatus| jobs.iter().any(|j| j.status == s);
    if has(PipelineStatus::Running) {
        PipelineStatus::Running
    } else if has(PipelineStatus::Failed) {
        PipelineStatus::Failed
    } else if has(PipelineStatus::Pending) {
        PipelineStatus::Pending
    } else if has(PipelineStatus::Canceled) {
        PipelineStatus::Canceled
    } else if has(PipelineStatus::Manual) {
        PipelineStatus::Manual
    } else if jobs.iter().all(|j| j.status == PipelineStatus::Skipped) && !jobs.is_empty() {
        PipelineStatus::Skipped
    } else if jobs.iter().all(|j| matches!(j.status, PipelineStatus::Success | PipelineStatus::Skipped)) {
        PipelineStatus::Success
    } else {
        PipelineStatus::Unknown
    }
}

pub fn map_job(v: &Value) -> PipelineJob {
    let status = map_pipeline_status(&str_of(v, "status"));
    PipelineJob {
        id: id_of(v, "id"),
        name: str_of(v, "name"),
        status,
        duration_ms: duration_ms(v, "duration"),
        started_at: opt_str_of(v, "started_at"),
        can_retry: matches!(status, PipelineStatus::Failed | PipelineStatus::Canceled | PipelineStatus::Success),
        can_cancel: matches!(status, PipelineStatus::Pending | PipelineStatus::Running),
        is_manual: status == PipelineStatus::Manual,
        url: str_of(v, "web_url"),
    }
}

/// `jobs` is the answer of `pipelines/:id/jobs`, grouped here by `stage` in
/// order of first appearance.
pub fn map_pipeline(v: &Value, jobs: &[Value]) -> Pipeline {
    let mut stages: Vec<PipelineStage> = Vec::new();
    for job in jobs {
        let stage_name = str_of(job, "stage");
        let mapped = map_job(job);
        match stages.iter_mut().find(|s| s.name == stage_name) {
            Some(stage) => stage.jobs.push(mapped),
            None => stages.push(PipelineStage { name: stage_name, status: PipelineStatus::Unknown, jobs: vec![mapped] }),
        }
    }
    for stage in &mut stages {
        stage.status = aggregate_status(&stage.jobs);
    }
    let failed_job_id = stages
        .iter()
        .flat_map(|s| s.jobs.iter())
        .find(|j| j.status == PipelineStatus::Failed)
        .map(|j| j.id.clone());
    let title = jobs
        .iter()
        .find_map(|j| j.get("commit").and_then(|c| c.get("title")).and_then(Value::as_str))
        .map(str::to_string)
        .unwrap_or_else(|| str_of(v, "sha").chars().take(8).collect());
    let id = id_of(v, "id");
    Pipeline {
        number: format!("#{id}"),
        id,
        status: map_pipeline_status(&str_of(v, "status")),
        git_ref: str_of(v, "ref"),
        sha: str_of(v, "sha"),
        title,
        source: opt_str_of(v, "source"),
        stages,
        started_at: opt_str_of(v, "started_at"),
        finished_at: opt_str_of(v, "finished_at"),
        duration_ms: duration_ms(v, "duration"),
        url: str_of(v, "web_url"),
        failed_job_id,
    }
}

/// The lines around the last error-looking line of a job trace, or the tail
/// when nothing stands out.
pub fn failure_excerpt(text: &str) -> Option<String> {
    let lines: Vec<&str> = text.lines().collect();
    if lines.is_empty() {
        return None;
    }
    let is_failure_line = |l: &str| {
        let lower = l.to_ascii_lowercase();
        lower.contains("error") || lower.contains("failed") || lower.contains("failure") || lower.contains("exit code")
    };
    let end = lines.iter().rposition(|l| is_failure_line(l)).map(|i| i + 1).unwrap_or(lines.len());
    let start = end.saturating_sub(EXCERPT_CONTEXT_LINES);
    let stop = (end + 5).min(lines.len());
    Some(lines[start..stop].join("\n"))
}

pub fn map_project(v: &Value) -> TrackerProject {
    TrackerProject {
        key: str_of(v, "path_with_namespace"),
        label: str_of(v, "name_with_namespace"),
        url: str_of(v, "web_url"),
    }
}

pub fn map_identity(v: &Value) -> IntegrationIdentity {
    IntegrationIdentity {
        login: str_of(v, "username"),
        display_name: str_of(v, "name"),
        avatar_url: opt_str_of(v, "avatar_url"),
    }
}

/// The issue iid in a GitLab issue URL of `host`, if that is what `url` is.
pub fn issue_iid_from_url(url: &str, host: &str) -> Option<u64> {
    if host_of(url)?.as_str() != host {
        return None;
    }
    let path = url.split_once("://")?.1.split(['?', '#']).next()?;
    let after = path.rsplit_once("/issues/")?.1;
    after.split('/').next()?.parse().ok()
}

fn header_has_value(headers: &reqwest::header::HeaderMap, name: &str) -> bool {
    headers.get(name).and_then(|v| v.to_str().ok()).is_some_and(|v| !v.trim().is_empty())
}

impl GitLabApi {
    pub fn new(http: HttpClient, base_url: &str, project_path: &str) -> Self {
        GitLabApi {
            http,
            base_url: base_url.trim_end_matches('/').to_string(),
            project_path: project_path.trim_matches('/').to_string(),
            me: Mutex::new(None),
        }
    }

    fn project(&self, rest: &str) -> String {
        format!("projects/{}/{}", encode_path(&self.project_path), rest.trim_start_matches('/'))
    }

    async fn me(&self) -> Result<(u64, String), IntegrationError> {
        if let Ok(cache) = self.me.lock()
            && let Some(me) = cache.as_ref()
        {
            return Ok(me.clone());
        }
        let user = self.http.get_json("user", &[]).await?;
        let me = (user.get("id").and_then(Value::as_u64).unwrap_or(0), str_of(&user, "username"));
        if let Ok(mut cache) = self.me.lock() {
            *cache = Some(me.clone());
        }
        Ok(me)
    }

    pub async fn test_identity(&self) -> Result<IntegrationIdentity, IntegrationError> {
        Ok(map_identity(&self.http.get_json("user", &[]).await?))
    }

    pub async fn list_projects(&self, text: &str) -> Result<Vec<TrackerProject>, IntegrationError> {
        let mut query = vec![
            ("membership", "true".to_string()),
            ("simple", "true".to_string()),
            ("order_by", "last_activity_at".to_string()),
            ("per_page", "30".to_string()),
        ];
        if !text.trim().is_empty() {
            query.push(("search", text.trim().to_string()));
        }
        let value = self.http.get_json("projects", &query).await?;
        Ok(value.as_array().map(|a| a.iter().map(map_project).collect()).unwrap_or_default())
    }

    async fn get_merge_request(&self, iid: u64) -> Result<MergeRequest, IntegrationError> {
        let mr = self.http.get_json(&self.project(&format!("merge_requests/{iid}")), &[]).await?;
        let approvals = self.http.get_json(&self.project(&format!("merge_requests/{iid}/approvals")), &[]).await.ok();
        let me = self.me().await.ok().map(|(_, login)| login);
        Ok(map_merge_request(&mr, approvals.as_ref(), me.as_deref()))
    }

    async fn user_ids(&self, logins: &[String]) -> Result<Vec<u64>, IntegrationError> {
        let mut ids = Vec::new();
        for login in logins {
            let users = self.http.get_json("users", &[("username", login.clone())]).await?;
            if let Some(id) = users.as_array().and_then(|a| a.first()).and_then(|u| u.get("id")).and_then(Value::as_u64) {
                ids.push(id);
            }
        }
        Ok(ids)
    }
}

impl TrackerProvider for GitLabApi {
    async fn list_tickets(&self, q: &TicketQuery) -> Result<Page<Ticket>, IntegrationError> {
        let text = q.text.trim();
        if let Ok(iid) = parse_iid(text)
            && !text.is_empty()
        {
            return Ok(Page { items: self.get_ticket(&iid.to_string()).await.into_iter().collect(), has_more: false });
        }
        let mut query = vec![
            ("per_page", TICKETS_PER_PAGE.to_string()),
            ("page", q.page.max(1).to_string()),
            ("order_by", "updated_at".to_string()),
            (
                "scope",
                match q.scope {
                    TicketScope::Assigned => "assigned_to_me",
                    TicketScope::Created => "created_by_me",
                    TicketScope::All => "all",
                }
                .to_string(),
            ),
        ];
        match q.state {
            TicketState::Open => query.push(("state", "opened".to_string())),
            TicketState::Closed => query.push(("state", "closed".to_string())),
            TicketState::All => {}
        }
        if !text.is_empty() {
            query.push(("search", text.to_string()));
        }
        let (value, headers) = self.http.get_with_headers(&self.project("issues"), &query).await?;
        let items = value.as_array().map(|a| a.iter().map(map_ticket).collect()).unwrap_or_default();
        Ok(Page { items, has_more: header_has_value(&headers, "x-next-page") })
    }

    async fn get_ticket(&self, key: &str) -> Result<Ticket, IntegrationError> {
        let iid = parse_iid(key)?;
        Ok(map_ticket(&self.http.get_json(&self.project(&format!("issues/{iid}")), &[]).await?))
    }

    async fn resolve_ticket_url(&self, url: &str) -> Result<Option<Ticket>, IntegrationError> {
        let Some(host) = host_of(&self.base_url) else { return Ok(None) };
        match issue_iid_from_url(url, &host) {
            Some(iid) => self.get_ticket(&iid.to_string()).await.map(Some),
            None => Ok(None),
        }
    }

    async fn list_transitions(&self, key: &str) -> Result<Vec<TicketTransition>, IntegrationError> {
        let ticket = self.get_ticket(key).await?;
        Ok(if ticket.status == "closed" {
            vec![TicketTransition { id: "reopen".to_string(), name: "Reopen".to_string(), to_status: "opened".to_string() }]
        } else {
            vec![TicketTransition { id: "close".to_string(), name: "Close".to_string(), to_status: "closed".to_string() }]
        })
    }

    async fn list_statuses(&self) -> Result<Vec<TrackerStatus>, IntegrationError> {
        Ok(vec![
            TrackerStatus { id: "opened".to_string(), name: "Opened".to_string(), category: StatusCategory::Todo },
            TrackerStatus { id: "closed".to_string(), name: "Closed".to_string(), category: StatusCategory::Done },
        ])
    }

    async fn transition(&self, key: &str, transition_id: &str) -> Result<Ticket, IntegrationError> {
        let iid = parse_iid(key)?;
        let event = match transition_id {
            "close" | "closed" => "close",
            "reopen" | "opened" | "open" => "reopen",
            other => return Err(IntegrationError::not_found(format!("Unknown transition '{other}'"))),
        };
        let updated = self
            .http
            .put_json(&self.project(&format!("issues/{iid}")), &json!({ "state_event": event }))
            .await?;
        Ok(map_ticket(&updated))
    }
}

impl ForgeProvider for GitLabApi {
    async fn find_merge_request(&self, source_branch: &str) -> Result<Option<MergeRequest>, IntegrationError> {
        let base_query = |state: &str| {
            vec![
                ("source_branch", source_branch.to_string()),
                ("state", state.to_string()),
                ("order_by", "updated_at".to_string()),
                ("per_page", "1".to_string()),
            ]
        };
        let mut found = self.http.get_json(&self.project("merge_requests"), &base_query("opened")).await?;
        if found.as_array().is_none_or(|a| a.is_empty()) {
            found = self.http.get_json(&self.project("merge_requests"), &base_query("all")).await?;
        }
        let Some(iid) = found.as_array().and_then(|a| a.first()).and_then(|m| m.get("iid")).and_then(Value::as_u64) else {
            return Ok(None);
        };
        self.get_merge_request(iid).await.map(Some)
    }

    async fn create_merge_request(&self, draft: &MergeRequestDraft) -> Result<MergeRequest, IntegrationError> {
        let mut title = draft.title.trim().to_string();
        if draft.is_draft && !title.to_ascii_lowercase().starts_with("draft:") {
            title = format!("Draft: {title}");
        }
        let mut description = draft.description.clone();
        if let Some(key) = draft.linked_ticket_key.as_deref().map(str::trim).filter(|k| !k.is_empty()) {
            let key = if key.starts_with('#') { key.to_string() } else { format!("#{key}") };
            if !description.trim_end().is_empty() {
                description.push_str("\n\n");
            }
            description.push_str(&format!("Closes {key}"));
        }
        let mut body = json!({
            "source_branch": draft.source_branch,
            "target_branch": draft.target_branch,
            "title": title,
            "description": description,
            "remove_source_branch": draft.remove_source_branch,
        });
        if !draft.labels.is_empty() {
            body["labels"] = Value::String(draft.labels.join(","));
        }
        if !draft.reviewers.is_empty() {
            body["reviewer_ids"] = json!(self.user_ids(&draft.reviewers).await?);
        }
        let created = self.http.post_json(&self.project("merge_requests"), &body).await?;
        match created.get("iid").and_then(Value::as_u64) {
            Some(iid) => self.get_merge_request(iid).await,
            None => Ok(map_merge_request(&created, None, None)),
        }
    }

    async fn list_discussions(&self, mr: &str) -> Result<Vec<Discussion>, IntegrationError> {
        let iid = parse_iid(mr)?;
        let (items, _) = self
            .http
            .get_paged(&self.project(&format!("merge_requests/{iid}/discussions")), &[("per_page", "100".to_string())])
            .await?;
        Ok(items.iter().filter_map(map_discussion).collect())
    }

    async fn reply(&self, mr: &str, discussion: &str, body: &str) -> Result<Comment, IntegrationError> {
        let iid = parse_iid(mr)?;
        let note = self
            .http
            .post_json(
                &self.project(&format!("merge_requests/{iid}/discussions/{discussion}/notes")),
                &json!({ "body": body }),
            )
            .await?;
        Ok(map_comment(&note))
    }

    async fn resolve(&self, mr: &str, discussion: &str, resolved: bool) -> Result<(), IntegrationError> {
        let iid = parse_iid(mr)?;
        self.http
            .put_json(
                &self.project(&format!("merge_requests/{iid}/discussions/{discussion}")),
                &json!({ "resolved": resolved }),
            )
            .await
            .map(|_| ())
    }

    async fn approve(&self, mr: &str, approve: bool) -> Result<MergeRequest, IntegrationError> {
        let iid = parse_iid(mr)?;
        let action = if approve { "approve" } else { "unapprove" };
        self.http.post_json(&self.project(&format!("merge_requests/{iid}/{action}")), &json!({})).await?;
        self.get_merge_request(iid).await
    }

    async fn list_members(&self, text: &str) -> Result<Vec<Actor>, IntegrationError> {
        let mut query = vec![("per_page", "50".to_string())];
        if !text.trim().is_empty() {
            query.push(("query", text.trim().to_string()));
        }
        let (items, _) = self.http.get_paged(&self.project("members/all"), &query).await?;
        let mut actors: Vec<Actor> = Vec::new();
        for member in &items {
            let actor = map_actor(member);
            if !actors.iter().any(|a| a.login == actor.login) {
                actors.push(actor);
            }
        }
        Ok(actors)
    }

    async fn list_labels(&self) -> Result<Vec<String>, IntegrationError> {
        let (items, _) = self.http.get_paged(&self.project("labels"), &[("per_page", "100".to_string())]).await?;
        Ok(items.iter().map(|l| str_of(l, "name")).filter(|n| !n.is_empty()).collect())
    }

    fn web_links(&self) -> WebLinks {
        WebLinks { repo_url: format!("{}/{}", self.base_url, self.project_path), style: WebLinkStyle::GitLab }
    }
}

impl CiProvider for GitLabApi {
    async fn list_pipelines(&self, git_ref: &str, limit: usize) -> Result<Vec<Pipeline>, IntegrationError> {
        let query = vec![
            ("ref", git_ref.to_string()),
            ("per_page", limit.clamp(1, 20).to_string()),
            ("order_by", "id".to_string()),
            ("sort", "desc".to_string()),
        ];
        let list = self.http.get_json(&self.project("pipelines"), &query).await?;
        let mut pipelines = Vec::new();
        for summary in list.as_array().into_iter().flatten() {
            let id = id_of(summary, "id");
            if id.is_empty() {
                continue;
            }
            pipelines.push(self.get_pipeline(&id).await?);
        }
        Ok(pipelines)
    }

    async fn get_pipeline(&self, id: &str) -> Result<Pipeline, IntegrationError> {
        let pipeline = self.http.get_json(&self.project(&format!("pipelines/{id}")), &[]).await?;
        let (jobs, _) = self
            .http
            .get_paged(&self.project(&format!("pipelines/{id}/jobs")), &[("per_page", "100".to_string())])
            .await?;
        Ok(map_pipeline(&pipeline, &jobs))
    }

    async fn job_log(&self, job_id: &str) -> Result<JobLog, IntegrationError> {
        let text = self.http.get_text(&self.project(&format!("jobs/{job_id}/trace")), &[]).await?;
        let truncated = text.chars().count() > MAX_LOG_CHARS;
        let text = if truncated {
            let skip = text.chars().count() - MAX_LOG_CHARS;
            text.chars().skip(skip).collect()
        } else {
            text
        };
        Ok(JobLog { job_id: job_id.to_string(), failure_excerpt: failure_excerpt(&text), text, truncated })
    }

    async fn retry_job(&self, job_id: &str) -> Result<(), IntegrationError> {
        self.http.post_json(&self.project(&format!("jobs/{job_id}/retry")), &json!({})).await.map(|_| ())
    }

    async fn cancel_pipeline(&self, id: &str) -> Result<(), IntegrationError> {
        self.http.post_json(&self.project(&format!("pipelines/{id}/cancel")), &json!({})).await.map(|_| ())
    }

    async fn play_job(&self, job_id: &str) -> Result<(), IntegrationError> {
        self.http.post_json(&self.project(&format!("jobs/{job_id}/play")), &json!({})).await.map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ISSUE: &str = include_str!("../fixtures/gitlab/issue.json");
    const MERGE_REQUEST: &str = include_str!("../fixtures/gitlab/merge_request.json");
    const APPROVALS: &str = include_str!("../fixtures/gitlab/approvals.json");
    const DISCUSSIONS: &str = include_str!("../fixtures/gitlab/discussions.json");
    const PIPELINE: &str = include_str!("../fixtures/gitlab/pipeline.json");
    const JOBS: &str = include_str!("../fixtures/gitlab/jobs.json");
    const USER: &str = include_str!("../fixtures/gitlab/user.json");

    fn parse(s: &str) -> Value {
        serde_json::from_str(s).unwrap()
    }

    #[test]
    fn maps_issue_to_ticket() {
        let t = map_ticket(&parse(ISSUE));
        assert_eq!(t.id, "42");
        assert_eq!(t.key, "#42");
        assert_eq!(t.title, "Pipeline badge stays red after a retry");
        assert_eq!(t.status, "opened");
        assert_eq!(t.status_category, StatusCategory::InProgress);
        assert_eq!(t.labels, vec!["bug", "Doing"]);
        assert_eq!(t.assignees.len(), 1);
        assert_eq!(t.assignees[0].login, "bbonneton");
        assert_eq!(t.kind.as_deref(), Some("issue"));
        assert_eq!(t.url, "https://gitlab.com/cairn/cairn/-/issues/42");
        assert!(t.description.starts_with("After retrying"));
    }

    #[test]
    fn closed_issue_is_done() {
        let mut v = parse(ISSUE);
        v["state"] = json!("closed");
        assert_eq!(map_ticket(&v).status_category, StatusCategory::Done);
    }

    #[test]
    fn maps_merge_request_with_approvals() {
        let mr = map_merge_request(&parse(MERGE_REQUEST), Some(&parse(APPROVALS)), Some("bbonneton"));
        assert_eq!(mr.id, "12");
        assert_eq!(mr.number, "!12");
        assert_eq!(mr.state, MergeRequestState::Open);
        assert!(mr.is_draft);
        assert_eq!(mr.source_branch, "feat/42-pipeline-badge");
        assert_eq!(mr.target_branch, "main");
        assert_eq!(mr.author.login, "bbonneton");
        assert_eq!(mr.reviewers.len(), 1);
        assert_eq!(mr.reviewers[0].login, "alice");
        assert_eq!(mr.labels, vec!["bug"]);
        assert_eq!(mr.approvals.approved, 1);
        assert_eq!(mr.approvals.required, Some(2));
        assert!(mr.approvals.approved_by_me);
        assert_eq!(mr.mergeable, Mergeable::No);
        assert!(!mr.has_conflicts);
        assert_eq!(mr.head_sha, "8f3a1c2d4e5b6a7f8091a2b3c4d5e6f708192a3b");
        assert_eq!(mr.pipeline_status, Some(PipelineStatus::Running));
        assert_eq!(mr.url, "https://gitlab.com/cairn/cairn/-/merge_requests/12");
    }

    #[test]
    fn merge_request_without_approvals_and_other_user() {
        let mr = map_merge_request(&parse(MERGE_REQUEST), Some(&parse(APPROVALS)), Some("someone"));
        assert!(!mr.approvals.approved_by_me);
        let mr = map_merge_request(&parse(MERGE_REQUEST), None, None);
        assert_eq!(mr.approvals.approved, 0);
        assert_eq!(mr.approvals.required, None);
    }

    #[test]
    fn maps_discussions_with_anchor_and_general() {
        let all: Vec<Discussion> = parse(DISCUSSIONS).as_array().unwrap().iter().filter_map(map_discussion).collect();
        assert_eq!(all.len(), 3);
        let anchored = &all[0];
        assert_eq!(anchored.id, "6a9c1e2f3b4d5a6c7e8f9012a3b4c5d6e7f80912");
        assert!(anchored.resolvable);
        assert!(!anchored.resolved);
        let anchor = anchored.anchor.as_ref().unwrap();
        assert_eq!(anchor.path, "src/lib/stores/pipelines.ts");
        assert_eq!(anchor.line, 48);
        assert_eq!(anchor.side, DiffSide::New);
        assert_eq!(anchor.sha, "8f3a1c2d4e5b6a7f8091a2b3c4d5e6f708192a3b");
        assert_eq!(anchored.comments.len(), 2);
        assert_eq!(anchored.comments[1].body, "Good catch, fixed in the next push.");

        let old_side = &all[1];
        let anchor = old_side.anchor.as_ref().unwrap();
        assert_eq!(anchor.side, DiffSide::Old);
        assert_eq!(anchor.line, 12);
        assert!(old_side.resolved);

        let general = &all[2];
        assert!(general.anchor.is_none());
        assert!(general.comments[0].is_system);
    }

    #[test]
    fn maps_pipeline_with_stages_and_failed_job() {
        let jobs = parse(JOBS);
        let p = map_pipeline(&parse(PIPELINE), jobs.as_array().unwrap());
        assert_eq!(p.id, "8241");
        assert_eq!(p.number, "#8241");
        assert_eq!(p.status, PipelineStatus::Failed);
        assert_eq!(p.git_ref, "feat/42-pipeline-badge");
        assert_eq!(p.source.as_deref(), Some("push"));
        assert_eq!(p.title, "fix(cicd): refresh badge after retry, #42");
        assert_eq!(p.duration_ms, Some(312_000));
        assert_eq!(p.stages.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(), vec!["build", "test", "deploy"]);
        assert_eq!(p.stages[0].status, PipelineStatus::Success);
        assert_eq!(p.stages[1].status, PipelineStatus::Failed);
        assert_eq!(p.stages[2].status, PipelineStatus::Manual);
        assert_eq!(p.stages[1].jobs.len(), 2);
        assert_eq!(p.failed_job_id.as_deref(), Some("50102"));
        let failed = &p.stages[1].jobs[1];
        assert!(failed.can_retry);
        assert!(!failed.can_cancel);
        assert_eq!(failed.duration_ms, Some(95_400));
        let manual = &p.stages[2].jobs[0];
        assert!(manual.is_manual);
        assert_eq!(p.url, "https://gitlab.com/cairn/cairn/-/pipelines/8241");
    }

    #[test]
    fn pipeline_without_jobs_has_no_stages() {
        let p = map_pipeline(&parse(PIPELINE), &[]);
        assert!(p.stages.is_empty());
        assert!(p.failed_job_id.is_none());
        assert_eq!(p.title, "c1d2e3f4");
    }

    #[test]
    fn maps_user_to_identity() {
        let id = map_identity(&parse(USER));
        assert_eq!(id.login, "bbonneton");
        assert_eq!(id.display_name, "Benjamin Bonneton");
        assert!(id.avatar_url.as_deref().unwrap().starts_with("https://"));
    }

    #[test]
    fn pipeline_status_mapping() {
        assert_eq!(map_pipeline_status("created"), PipelineStatus::Pending);
        assert_eq!(map_pipeline_status("waiting_for_resource"), PipelineStatus::Pending);
        assert_eq!(map_pipeline_status("canceling"), PipelineStatus::Canceled);
        assert_eq!(map_pipeline_status("manual"), PipelineStatus::Manual);
        assert_eq!(map_pipeline_status("weird"), PipelineStatus::Unknown);
    }

    #[test]
    fn failure_excerpt_targets_the_last_error() {
        let mut lines: Vec<String> = (0..100).map(|i| format!("line {i}")).collect();
        lines[70] = "ERROR: Job failed: exit code 1".to_string();
        let text = lines.join("\n");
        let excerpt = failure_excerpt(&text).unwrap();
        assert!(excerpt.contains("ERROR: Job failed"));
        assert!(excerpt.contains("line 46"));
        assert!(!excerpt.contains("line 44"));
        assert!(excerpt.contains("line 75"));
        assert!(!excerpt.contains("line 76"));
        assert!(failure_excerpt("").is_none());
    }

    #[test]
    fn issue_url_resolution() {
        assert_eq!(issue_iid_from_url("https://gitlab.com/cairn/cairn/-/issues/42", "gitlab.com"), Some(42));
        assert_eq!(issue_iid_from_url("https://gitlab.com/cairn/cairn/-/issues/42#note_1", "gitlab.com"), Some(42));
        assert_eq!(issue_iid_from_url("https://gitlab.com/cairn/cairn/-/issues/42", "gitlab.acme.io"), None);
        assert_eq!(issue_iid_from_url("https://gitlab.com/cairn/cairn/-/merge_requests/1", "gitlab.com"), None);
        assert_eq!(parse_iid("#42").unwrap(), 42);
        assert_eq!(parse_iid("!12").unwrap(), 12);
        assert_eq!(parse_iid("CAIRN-42").unwrap_err().code, IntegrationErrorCode::NotFound);
    }
}
