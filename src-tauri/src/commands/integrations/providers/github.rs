//! GitHub adapter (REST v3, Actions, one GraphQL call for review thread
//! resolution): tracker (issues), forge (pull requests, review threads,
//! reviews) and CI (workflow runs, jobs, logs).

use std::collections::HashMap;
use std::sync::Mutex;
use serde_json::{json, Value};
use crate::commands::integrations::http::{host_of, HttpClient};
use crate::commands::integrations::model::*;
use crate::commands::integrations::provider::{
    filter_by_text, github_status_param, is_full_sha, CiProvider, ForgeProvider, TrackerProvider, WebLinkStyle,
    WebLinks, PIPELINES_PER_PAGE,
};
use crate::commands::integrations::providers::gitlab::failure_excerpt;

const TICKETS_PER_PAGE: u32 = 20;
const MAX_LOG_CHARS: usize = 400_000;
const GENERAL_DISCUSSION_PREFIX: &str = "general-";

pub struct GitHubApi {
    http: HttpClient,
    base_url: String,
    repo_path: String,
    me: Mutex<Option<String>>,
}

fn parse_number(key: &str) -> Result<u64, IntegrationError> {
    key.trim()
        .trim_start_matches(['#', '!'])
        .parse::<u64>()
        .map_err(|_| IntegrationError::not_found(format!("'{key}' is not a GitHub number")))
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

fn label_names(v: &Value) -> Vec<String> {
    v.get("labels")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|l| l.as_str().map(str::to_string).or_else(|| opt_str_of(l, "name")))
                .collect()
        })
        .unwrap_or_default()
}

fn empty_actor() -> Actor {
    Actor { login: String::new(), display_name: String::new(), avatar_url: None }
}

pub fn map_actor(v: &Value) -> Actor {
    let login = str_of(v, "login");
    let name = str_of(v, "name");
    Actor {
        display_name: if name.is_empty() { login.clone() } else { name },
        login,
        avatar_url: opt_str_of(v, "avatar_url"),
    }
}

fn actors_of(v: &Value, key: &str) -> Vec<Actor> {
    v.get(key)
        .and_then(Value::as_array)
        .map(|a| a.iter().map(map_actor).collect())
        .unwrap_or_default()
}

fn is_pull_request(v: &Value) -> bool {
    v.get("pull_request").is_some_and(|p| !p.is_null())
}

fn ticket_status_category(state: &str) -> StatusCategory {
    match state {
        "open" => StatusCategory::Todo,
        "closed" => StatusCategory::Done,
        _ => StatusCategory::Unknown,
    }
}

pub fn map_ticket(v: &Value) -> Ticket {
    let number = id_of(v, "number");
    let state = str_of(v, "state");
    Ticket {
        id: number.clone(),
        key: format!("#{number}"),
        title: str_of(v, "title"),
        description: str_of(v, "body"),
        status_category: ticket_status_category(&state),
        status: state,
        kind: Some(if is_pull_request(v) { "pull_request" } else { "issue" }.to_string()),
        labels: label_names(v),
        assignees: v
            .get("assignees")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .map(|u| {
                        let actor = map_actor(u);
                        TicketAssignee { login: actor.login, display_name: actor.display_name }
                    })
                    .collect()
            })
            .unwrap_or_default(),
        url: str_of(v, "html_url"),
        updated_at: str_of(v, "updated_at"),
    }
}

/// Status of a workflow run, job or check run from its `status` and
/// `conclusion` pair.
pub fn map_run_status(status: &str, conclusion: Option<&str>) -> PipelineStatus {
    match status {
        "queued" | "waiting" | "pending" | "requested" => PipelineStatus::Pending,
        "in_progress" => PipelineStatus::Running,
        "completed" => match conclusion.unwrap_or("") {
            "success" | "neutral" => PipelineStatus::Success,
            "failure" | "timed_out" | "startup_failure" => PipelineStatus::Failed,
            "cancelled" => PipelineStatus::Canceled,
            "skipped" => PipelineStatus::Skipped,
            "action_required" => PipelineStatus::Manual,
            _ => PipelineStatus::Unknown,
        },
        _ => PipelineStatus::Unknown,
    }
}

fn status_of(v: &Value) -> PipelineStatus {
    map_run_status(&str_of(v, "status"), v.get("conclusion").and_then(Value::as_str))
}

fn mr_state(v: &Value) -> MergeRequestState {
    let is_merged = v.get("merged").and_then(Value::as_bool).unwrap_or(false)
        || v.get("merged_at").is_some_and(|m| !m.is_null());
    if is_merged {
        MergeRequestState::Merged
    } else if v.get("state").and_then(Value::as_str) == Some("closed") {
        MergeRequestState::Closed
    } else {
        MergeRequestState::Open
    }
}

fn mr_mergeable(v: &Value) -> Mergeable {
    match v.get("mergeable").and_then(Value::as_bool) {
        Some(true) => Mergeable::Yes,
        Some(false) => Mergeable::No,
        None => Mergeable::Unknown,
    }
}

/// Logins whose latest decisive review (approval or change request) is an
/// approval; comment-only reviews never override a decision.
pub fn approvers(reviews: &[Value]) -> Vec<String> {
    let mut latest: Vec<(String, String, String)> = Vec::new();
    for review in reviews {
        let state = str_of(review, "state");
        if state != "APPROVED" && state != "CHANGES_REQUESTED" && state != "DISMISSED" {
            continue;
        }
        let login = review.get("user").map(|u| str_of(u, "login")).unwrap_or_default();
        let submitted = str_of(review, "submitted_at");
        match latest.iter_mut().find(|(l, _, _)| *l == login) {
            Some(entry) if entry.1 <= submitted => *entry = (login, submitted, state),
            Some(_) => {}
            None => latest.push((login, submitted, state)),
        }
    }
    latest.into_iter().filter(|(_, _, s)| s == "APPROVED").map(|(l, _, _)| l).collect()
}

/// `reviews` is the answer of `pulls/:n/reviews`; `pipeline_status` the
/// aggregate of the head commit's check runs, when it was fetched.
pub fn map_merge_request(v: &Value, reviews: &[Value], my_login: Option<&str>, pipeline_status: Option<PipelineStatus>) -> MergeRequest {
    let number = id_of(v, "number");
    let approved_by = approvers(reviews);
    MergeRequest {
        id: number.clone(),
        number: format!("#{number}"),
        title: str_of(v, "title"),
        description: str_of(v, "body"),
        state: mr_state(v),
        is_draft: v.get("draft").and_then(Value::as_bool).unwrap_or(false),
        source_branch: v.get("head").map(|h| str_of(h, "ref")).unwrap_or_default(),
        target_branch: v.get("base").map(|b| str_of(b, "ref")).unwrap_or_default(),
        author: v.get("user").map(map_actor).unwrap_or_else(empty_actor),
        reviewers: actors_of(v, "requested_reviewers"),
        assignees: actors_of(v, "assignees"),
        labels: label_names(v),
        approvals: Approvals {
            approved: approved_by.len() as u32,
            required: None,
            approved_by_me: my_login.is_some_and(|me| approved_by.iter().any(|l| l == me)),
        },
        mergeable: mr_mergeable(v),
        has_conflicts: v.get("mergeable_state").and_then(Value::as_str) == Some("dirty"),
        head_sha: v.get("head").map(|h| str_of(h, "sha")).unwrap_or_default(),
        pipeline_status,
        url: str_of(v, "html_url"),
        created_at: str_of(v, "created_at"),
        updated_at: str_of(v, "updated_at"),
    }
}

/// The aggregate of `commits/:sha/check-runs`, `None` when there is none.
pub fn map_check_runs_status(v: &Value) -> Option<PipelineStatus> {
    let runs = v.get("check_runs")?.as_array()?;
    if runs.is_empty() {
        return None;
    }
    let statuses: Vec<PipelineStatus> = runs.iter().map(status_of).collect();
    Some(aggregate_status(&statuses))
}

pub fn map_comment(v: &Value) -> Comment {
    let author = v.get("user").map(map_actor).unwrap_or_else(empty_actor);
    let is_bot = v.get("user").and_then(|u| u.get("type")).and_then(Value::as_str) == Some("Bot");
    Comment {
        id: id_of(v, "id"),
        author,
        body: str_of(v, "body"),
        created_at: str_of(v, "created_at"),
        is_system: is_bot,
    }
}

fn map_anchor(comment: &Value) -> Option<DiscussionAnchor> {
    let path = opt_str_of(comment, "path")?;
    let line = comment
        .get("line")
        .and_then(Value::as_u64)
        .or_else(|| comment.get("original_line").and_then(Value::as_u64))?;
    let side = if comment.get("side").and_then(Value::as_str) == Some("LEFT") { DiffSide::Old } else { DiffSide::New };
    let sha = opt_str_of(comment, "commit_id")
        .filter(|s| !s.is_empty())
        .or_else(|| opt_str_of(comment, "original_commit_id"))
        .unwrap_or_default();
    Some(DiscussionAnchor { path: path.replace('\\', "/"), line: line as u32, side, sha })
}

/// Groups review comments into threads by `in_reply_to_id`, in order of the
/// root comments; `resolution` maps a root comment id to its thread state.
pub fn map_review_threads(comments: &[Value], resolution: &HashMap<String, bool>) -> Vec<Discussion> {
    let mut threads: Vec<Discussion> = Vec::new();
    for comment in comments {
        let reply_to = id_of(comment, "in_reply_to_id");
        if reply_to.is_empty() {
            let id = id_of(comment, "id");
            threads.push(Discussion {
                resolved: resolution.get(&id).copied().unwrap_or(false),
                id,
                resolvable: true,
                anchor: map_anchor(comment),
                comments: vec![map_comment(comment)],
            });
        }
    }
    for comment in comments {
        let reply_to = id_of(comment, "in_reply_to_id");
        if reply_to.is_empty() {
            continue;
        }
        match threads.iter_mut().find(|t| t.id == reply_to) {
            Some(thread) => thread.comments.push(map_comment(comment)),
            None => threads.push(Discussion {
                id: reply_to,
                resolved: false,
                resolvable: true,
                anchor: map_anchor(comment),
                comments: vec![map_comment(comment)],
            }),
        }
    }
    threads
}

/// Every issue comment of the pull request is one general discussion.
pub fn map_general_discussions(comments: &[Value]) -> Vec<Discussion> {
    comments
        .iter()
        .map(|c| Discussion {
            id: format!("{GENERAL_DISCUSSION_PREFIX}{}", id_of(c, "id")),
            resolved: false,
            resolvable: false,
            anchor: None,
            comments: vec![map_comment(c)],
        })
        .collect()
}

fn aggregate_status(statuses: &[PipelineStatus]) -> PipelineStatus {
    let has = |s: PipelineStatus| statuses.contains(&s);
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
    } else if !statuses.is_empty() && statuses.iter().all(|s| *s == PipelineStatus::Skipped) {
        PipelineStatus::Skipped
    } else if statuses.iter().all(|s| matches!(s, PipelineStatus::Success | PipelineStatus::Skipped)) {
        PipelineStatus::Success
    } else {
        PipelineStatus::Unknown
    }
}

fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Seconds since the epoch of a GitHub timestamp (`2026-08-12T09:41:30Z`).
pub fn parse_timestamp(text: &str) -> Option<i64> {
    let text = text.trim();
    let mut parts = text.split(['T', ' ']);
    let date = parts.next()?;
    let time = parts.next()?.trim_end_matches('Z');
    let mut d = date.split('-').map(|p| p.parse::<i64>().ok());
    let (y, m, day) = (d.next()??, d.next()??, d.next()??);
    let time = time.split(['+', '-']).next()?.split('.').next()?;
    let mut t = time.split(':').map(|p| p.parse::<i64>().ok());
    let (h, mi, s) = (t.next()??, t.next()??, t.next().flatten().unwrap_or(0));
    Some(days_from_civil(y, m, day) * 86_400 + h * 3600 + mi * 60 + s)
}

fn duration_between(start: Option<&str>, end: Option<&str>) -> Option<u64> {
    let start = parse_timestamp(start?)?;
    let end = parse_timestamp(end?)?;
    Some((end - start).max(0) as u64 * 1000)
}

pub fn map_job(v: &Value) -> PipelineJob {
    let status = status_of(v);
    let raw_status = str_of(v, "status");
    PipelineJob {
        id: id_of(v, "id"),
        name: str_of(v, "name"),
        status,
        duration_ms: duration_between(v.get("started_at").and_then(Value::as_str), v.get("completed_at").and_then(Value::as_str)),
        started_at: opt_str_of(v, "started_at"),
        can_retry: raw_status == "completed" && status != PipelineStatus::Skipped,
        can_cancel: matches!(status, PipelineStatus::Pending | PipelineStatus::Running),
        is_manual: false,
        url: str_of(v, "html_url"),
    }
}

/// `jobs` is the `jobs` array of `actions/runs/:id/jobs`; the run becomes one
/// pipeline with a single stage named after the workflow.
pub fn map_pipeline(run: &Value, jobs: &[Value]) -> Pipeline {
    let mapped: Vec<PipelineJob> = jobs.iter().map(map_job).collect();
    let status = status_of(run);
    let failed_job_id = mapped.iter().find(|j| j.status == PipelineStatus::Failed).map(|j| j.id.clone());
    let stage_status = if mapped.is_empty() { status } else { aggregate_status(&mapped.iter().map(|j| j.status).collect::<Vec<_>>()) };
    let workflow_name = str_of(run, "name");
    let title = run
        .get("head_commit")
        .and_then(|c| c.get("message"))
        .and_then(Value::as_str)
        .and_then(|m| m.lines().next())
        .map(str::to_string)
        .filter(|t| !t.is_empty())
        .or_else(|| opt_str_of(run, "display_title"))
        .unwrap_or_else(|| str_of(run, "head_sha").chars().take(8).collect());
    let is_completed = str_of(run, "status") == "completed";
    let started_at = opt_str_of(run, "run_started_at").or_else(|| opt_str_of(run, "created_at"));
    let finished_at = if is_completed { opt_str_of(run, "updated_at") } else { None };
    let id = id_of(run, "id");
    Pipeline {
        number: format!("#{}", id_of(run, "run_number")),
        id,
        status,
        git_ref: str_of(run, "head_branch"),
        sha: str_of(run, "head_sha"),
        title,
        source: opt_str_of(run, "event"),
        stages: vec![PipelineStage { name: workflow_name, status: stage_status, jobs: mapped }],
        duration_ms: duration_between(started_at.as_deref(), finished_at.as_deref()),
        started_at,
        finished_at,
        url: str_of(run, "html_url"),
        failed_job_id,
    }
}

pub fn map_project(v: &Value) -> TrackerProject {
    TrackerProject {
        key: str_of(v, "full_name"),
        label: str_of(v, "full_name"),
        url: str_of(v, "html_url"),
    }
}

pub fn map_identity(v: &Value) -> IntegrationIdentity {
    let actor = map_actor(v);
    IntegrationIdentity { login: actor.login, display_name: actor.display_name, avatar_url: actor.avatar_url }
}

/// The issue number in a GitHub issue URL of `host` for `repo_path`.
pub fn issue_number_from_url(url: &str, host: &str, repo_path: &str) -> Option<u64> {
    if host_of(url)?.as_str() != host {
        return None;
    }
    let path = url.split_once("://")?.1.split(['?', '#']).next()?;
    let path = path.split_once('/')?.1;
    let rest = path.strip_prefix(repo_path.trim_matches('/'))?.strip_prefix("/issues/")?;
    rest.split('/').next()?.parse().ok()
}

fn contains_ignore_case(haystack: &str, needle: &str) -> bool {
    haystack.to_ascii_lowercase().contains(&needle.to_ascii_lowercase())
}

/// The GraphQL endpoint next to the REST base: `api.github.com/graphql` on
/// github.com, `<host>/api/graphql` on Enterprise.
fn graphql_url(api_base: &str) -> String {
    match api_base.strip_suffix("/api/v3") {
        Some(host) => format!("{host}/api/graphql"),
        None => format!("{}/graphql", api_base.trim_end_matches('/')),
    }
}

impl GitHubApi {
    pub fn new(http: HttpClient, base_url: &str, repo_path: &str) -> Self {
        GitHubApi {
            http,
            base_url: base_url.trim_end_matches('/').to_string(),
            repo_path: repo_path.trim_matches('/').to_string(),
            me: Mutex::new(None),
        }
    }

    fn repo(&self, rest: &str) -> String {
        format!("repos/{}/{}", self.repo_path, rest.trim_start_matches('/'))
    }

    fn owner_and_name(&self) -> (&str, &str) {
        self.repo_path.split_once('/').unwrap_or((self.repo_path.as_str(), ""))
    }

    async fn me(&self) -> Result<String, IntegrationError> {
        if let Ok(cache) = self.me.lock()
            && let Some(me) = cache.as_ref()
        {
            return Ok(me.clone());
        }
        let user = self.http.get_json("user", &[]).await?;
        let login = str_of(&user, "login");
        if let Ok(mut cache) = self.me.lock() {
            *cache = Some(login.clone());
        }
        Ok(login)
    }

    pub async fn test_identity(&self) -> Result<IntegrationIdentity, IntegrationError> {
        Ok(map_identity(&self.http.get_json("user", &[]).await?))
    }

    pub async fn list_projects(&self, text: &str) -> Result<Vec<TrackerProject>, IntegrationError> {
        let query = vec![("per_page", "100".to_string()), ("sort", "updated".to_string())];
        let value = self.http.get_json("user/repos", &query).await?;
        let text = text.trim();
        Ok(value
            .as_array()
            .map(|a| {
                a.iter()
                    .map(map_project)
                    .filter(|p| text.is_empty() || contains_ignore_case(&p.key, text))
                    .collect()
            })
            .unwrap_or_default())
    }

    async fn graphql(&self, query: &str, variables: Value) -> Result<Value, IntegrationError> {
        let url = graphql_url(self.http.api_base());
        let answer = self.http.post_json(&url, &json!({ "query": query, "variables": variables })).await?;
        if let Some(errors) = answer.get("errors").and_then(Value::as_array)
            && let Some(first) = errors.first()
        {
            return Err(IntegrationError::provider(str_of(first, "message")));
        }
        Ok(answer.get("data").cloned().unwrap_or(Value::Null))
    }

    /// Review threads of a pull request keyed by the id of their first
    /// comment: the GraphQL node id (needed to resolve) and the state.
    async fn review_threads(&self, number: u64) -> Result<HashMap<String, (String, bool)>, IntegrationError> {
        let (owner, name) = self.owner_and_name();
        let query = "query($owner:String!,$name:String!,$number:Int!,$after:String){\
            repository(owner:$owner,name:$name){pullRequest(number:$number){\
            reviewThreads(first:100,after:$after){pageInfo{hasNextPage endCursor}\
            nodes{id isResolved comments(first:1){nodes{databaseId}}}}}}}";
        let mut threads = HashMap::new();
        let mut after = Value::Null;
        for _ in 0..crate::commands::integrations::http::MAX_PAGES {
            let data = self
                .graphql(query, json!({ "owner": owner, "name": name, "number": number, "after": after }))
                .await?;
            let connection = &data["repository"]["pullRequest"]["reviewThreads"];
            for node in connection.get("nodes").and_then(Value::as_array).into_iter().flatten() {
                let first_id = id_of(&node["comments"]["nodes"][0], "databaseId");
                if first_id.is_empty() {
                    continue;
                }
                let is_resolved = node.get("isResolved").and_then(Value::as_bool).unwrap_or(false);
                threads.insert(first_id, (str_of(node, "id"), is_resolved));
            }
            let page = &connection["pageInfo"];
            if !page.get("hasNextPage").and_then(Value::as_bool).unwrap_or(false) {
                break;
            }
            after = page.get("endCursor").cloned().unwrap_or(Value::Null);
        }
        Ok(threads)
    }

    async fn set_thread_resolved(&self, thread_node_id: &str, resolved: bool) -> Result<(), IntegrationError> {
        let mutation = if resolved {
            "mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}"
        } else {
            "mutation($id:ID!){unresolveReviewThread(input:{threadId:$id}){thread{isResolved}}}"
        };
        self.graphql(mutation, json!({ "id": thread_node_id })).await.map(|_| ())
    }

    async fn head_status(&self, sha: &str) -> Option<PipelineStatus> {
        if sha.is_empty() {
            return None;
        }
        let checks = self
            .http
            .get_json(&self.repo(&format!("commits/{sha}/check-runs")), &[("per_page", "100".to_string())])
            .await
            .ok()?;
        map_check_runs_status(&checks)
    }

    async fn reviews(&self, number: u64) -> Result<Vec<Value>, IntegrationError> {
        let (reviews, _) = self
            .http
            .get_paged(&self.repo(&format!("pulls/{number}/reviews")), &[("per_page", "100".to_string())])
            .await?;
        Ok(reviews)
    }

    async fn get_pull(&self, number: u64) -> Result<MergeRequest, IntegrationError> {
        let pull = self.http.get_json(&self.repo(&format!("pulls/{number}")), &[]).await?;
        let reviews = self.reviews(number).await.unwrap_or_default();
        let me = self.me().await.ok();
        let head_sha = pull.get("head").map(|h| str_of(h, "sha")).unwrap_or_default();
        let pipeline_status = self.head_status(&head_sha).await;
        Ok(map_merge_request(&pull, &reviews, me.as_deref(), pipeline_status))
    }

    async fn run_jobs(&self, run_id: &str) -> Result<Vec<Value>, IntegrationError> {
        let value = self
            .http
            .get_json(&self.repo(&format!("actions/runs/{run_id}/jobs")), &[("per_page", "100".to_string())])
            .await?;
        Ok(value.get("jobs").and_then(Value::as_array).cloned().unwrap_or_default())
    }
}

impl TrackerProvider for GitHubApi {
    async fn list_tickets(&self, q: &TicketQuery) -> Result<Page<Ticket>, IntegrationError> {
        let text = q.text.trim();
        if !text.is_empty()
            && let Ok(number) = parse_number(text)
        {
            return Ok(Page { items: self.get_ticket(&number.to_string()).await.into_iter().collect(), has_more: false });
        }
        let mut terms = vec![format!("repo:{}", self.repo_path), "is:issue".to_string()];
        match q.scope {
            TicketScope::Assigned => terms.push("assignee:@me".to_string()),
            TicketScope::Created => terms.push("author:@me".to_string()),
            TicketScope::All => {}
        }
        match q.state {
            TicketState::Open => terms.push("is:open".to_string()),
            TicketState::Closed => terms.push("is:closed".to_string()),
            TicketState::All => {}
        }
        if !text.is_empty() {
            terms.push(text.to_string());
        }
        let page = q.page.max(1);
        let query = vec![
            ("q", terms.join(" ")),
            ("sort", "updated".to_string()),
            ("order", "desc".to_string()),
            ("per_page", TICKETS_PER_PAGE.to_string()),
            ("page", page.to_string()),
        ];
        let value = self.http.get_json("search/issues", &query).await?;
        let items: Vec<Ticket> = value
            .get("items")
            .and_then(Value::as_array)
            .map(|a| a.iter().filter(|i| !is_pull_request(i)).map(map_ticket).collect())
            .unwrap_or_default();
        let total = value.get("total_count").and_then(Value::as_u64).unwrap_or(0);
        Ok(Page { items, has_more: total > (page as u64) * TICKETS_PER_PAGE as u64 })
    }

    async fn get_ticket(&self, key: &str) -> Result<Ticket, IntegrationError> {
        let number = parse_number(key)?;
        let issue = self.http.get_json(&self.repo(&format!("issues/{number}")), &[]).await?;
        if is_pull_request(&issue) {
            return Err(IntegrationError::not_found(format!("#{number} is a pull request, not an issue")));
        }
        Ok(map_ticket(&issue))
    }

    async fn resolve_ticket_url(&self, url: &str) -> Result<Option<Ticket>, IntegrationError> {
        let Some(host) = host_of(&self.base_url) else { return Ok(None) };
        match issue_number_from_url(url, &host, &self.repo_path) {
            Some(number) => self.get_ticket(&number.to_string()).await.map(Some),
            None => Ok(None),
        }
    }

    async fn list_transitions(&self, key: &str) -> Result<Vec<TicketTransition>, IntegrationError> {
        let ticket = self.get_ticket(key).await?;
        Ok(if ticket.status == "closed" {
            vec![TicketTransition { id: "reopen".to_string(), name: "Reopen".to_string(), to_status: "open".to_string() }]
        } else {
            vec![TicketTransition { id: "close".to_string(), name: "Close".to_string(), to_status: "closed".to_string() }]
        })
    }

    async fn list_statuses(&self) -> Result<Vec<TrackerStatus>, IntegrationError> {
        Ok(vec![
            TrackerStatus { id: "open".to_string(), name: "Open".to_string(), category: StatusCategory::Todo },
            TrackerStatus { id: "closed".to_string(), name: "Closed".to_string(), category: StatusCategory::Done },
        ])
    }

    async fn transition(&self, key: &str, transition_id: &str) -> Result<Ticket, IntegrationError> {
        let number = parse_number(key)?;
        let state = match transition_id {
            "close" | "closed" => "closed",
            "reopen" | "open" | "opened" => "open",
            other => return Err(IntegrationError::not_found(format!("Unknown transition '{other}'"))),
        };
        let updated = self
            .http
            .patch_json(&self.repo(&format!("issues/{number}")), &json!({ "state": state }))
            .await?;
        Ok(map_ticket(&updated))
    }
}

impl ForgeProvider for GitHubApi {
    async fn find_merge_request(&self, source_branch: &str) -> Result<Option<MergeRequest>, IntegrationError> {
        let (owner, _) = self.owner_and_name();
        let query = vec![
            ("head", format!("{owner}:{source_branch}")),
            ("state", "all".to_string()),
            ("sort", "updated".to_string()),
            ("direction", "desc".to_string()),
            ("per_page", "20".to_string()),
        ];
        let found = self.http.get_json(&self.repo("pulls"), &query).await?;
        let pulls = found.as_array().cloned().unwrap_or_default();
        let chosen = pulls
            .iter()
            .find(|p| p.get("state").and_then(Value::as_str) == Some("open"))
            .or_else(|| pulls.first());
        let Some(number) = chosen.and_then(|p| p.get("number")).and_then(Value::as_u64) else {
            return Ok(None);
        };
        self.get_pull(number).await.map(Some)
    }

    async fn create_merge_request(&self, draft: &MergeRequestDraft) -> Result<MergeRequest, IntegrationError> {
        let mut description = draft.description.clone();
        if let Some(key) = draft.linked_ticket_key.as_deref().map(str::trim).filter(|k| !k.is_empty()) {
            let key = if key.starts_with('#') { key.to_string() } else { format!("#{key}") };
            if !description.trim_end().is_empty() {
                description.push_str("\n\n");
            }
            description.push_str(&format!("Closes {key}"));
        }
        let body = json!({
            "title": draft.title.trim(),
            "head": draft.source_branch,
            "base": draft.target_branch,
            "body": description,
            "draft": draft.is_draft,
        });
        let created = self.http.post_json(&self.repo("pulls"), &body).await?;
        let Some(number) = created.get("number").and_then(Value::as_u64) else {
            return Ok(map_merge_request(&created, &[], None, None));
        };
        if !draft.reviewers.is_empty() {
            self.http
                .post_json(&self.repo(&format!("pulls/{number}/requested_reviewers")), &json!({ "reviewers": draft.reviewers }))
                .await?;
        }
        if !draft.labels.is_empty() {
            self.http
                .post_json(&self.repo(&format!("issues/{number}/labels")), &json!({ "labels": draft.labels }))
                .await?;
        }
        self.get_pull(number).await
    }

    async fn list_discussions(&self, mr: &str) -> Result<Vec<Discussion>, IntegrationError> {
        let number = parse_number(mr)?;
        let (review_comments, _) = self
            .http
            .get_paged(&self.repo(&format!("pulls/{number}/comments")), &[("per_page", "100".to_string())])
            .await?;
        let resolution: HashMap<String, bool> = self
            .review_threads(number)
            .await
            .unwrap_or_default()
            .into_iter()
            .map(|(id, (_, is_resolved))| (id, is_resolved))
            .collect();
        let mut discussions = map_review_threads(&review_comments, &resolution);
        let (issue_comments, _) = self
            .http
            .get_paged(&self.repo(&format!("issues/{number}/comments")), &[("per_page", "100".to_string())])
            .await?;
        discussions.extend(map_general_discussions(&issue_comments));
        Ok(discussions)
    }

    async fn reply(&self, mr: &str, discussion: &str, body: &str) -> Result<Comment, IntegrationError> {
        let number = parse_number(mr)?;
        let created = if discussion.starts_with(GENERAL_DISCUSSION_PREFIX) {
            self.http
                .post_json(&self.repo(&format!("issues/{number}/comments")), &json!({ "body": body }))
                .await?
        } else {
            self.http
                .post_json(&self.repo(&format!("pulls/{number}/comments/{discussion}/replies")), &json!({ "body": body }))
                .await?
        };
        Ok(map_comment(&created))
    }

    async fn resolve(&self, mr: &str, discussion: &str, resolved: bool) -> Result<(), IntegrationError> {
        let number = parse_number(mr)?;
        if discussion.starts_with(GENERAL_DISCUSSION_PREFIX) {
            return Err(IntegrationError::unsupported());
        }
        let threads = self.review_threads(number).await?;
        let Some((node_id, _)) = threads.get(discussion) else {
            return Err(IntegrationError::not_found(format!("No review thread starts with comment {discussion}")));
        };
        self.set_thread_resolved(node_id, resolved).await
    }

    async fn approve(&self, mr: &str, approve: bool) -> Result<MergeRequest, IntegrationError> {
        let number = parse_number(mr)?;
        if approve {
            self.http
                .post_json(&self.repo(&format!("pulls/{number}/reviews")), &json!({ "event": "APPROVE" }))
                .await?;
        } else {
            let me = self.me().await?;
            let reviews = self.reviews(number).await?;
            let mine = reviews
                .iter()
                .filter(|r| str_of(r, "state") == "APPROVED" && r.get("user").map(|u| str_of(u, "login")) == Some(me.clone()))
                .max_by_key(|r| str_of(r, "submitted_at"));
            if let Some(review) = mine {
                let id = id_of(review, "id");
                self.http
                    .put_json(
                        &self.repo(&format!("pulls/{number}/reviews/{id}/dismissals")),
                        &json!({ "message": "Approval revoked", "event": "DISMISS" }),
                    )
                    .await?;
            }
        }
        self.get_pull(number).await
    }

    async fn list_members(&self, text: &str) -> Result<Vec<Actor>, IntegrationError> {
        let query = vec![("per_page", "100".to_string()), ("affiliation", "all".to_string())];
        let members = match self.http.get_paged(&self.repo("collaborators"), &query).await {
            Ok((items, _)) => items,
            Err(_) => self.http.get_paged(&self.repo("assignees"), &[("per_page", "100".to_string())]).await?.0,
        };
        let text = text.trim();
        let mut actors: Vec<Actor> = Vec::new();
        for member in &members {
            let actor = map_actor(member);
            let is_match = text.is_empty() || contains_ignore_case(&actor.login, text) || contains_ignore_case(&actor.display_name, text);
            if is_match && !actors.iter().any(|a| a.login == actor.login) {
                actors.push(actor);
            }
        }
        Ok(actors)
    }

    async fn list_labels(&self) -> Result<Vec<String>, IntegrationError> {
        let (items, _) = self.http.get_paged(&self.repo("labels"), &[("per_page", "100".to_string())]).await?;
        Ok(items.iter().map(|l| str_of(l, "name")).filter(|n| !n.is_empty()).collect())
    }

    fn web_links(&self) -> WebLinks {
        WebLinks { repo_url: format!("{}/{}", self.base_url, self.repo_path), style: WebLinkStyle::GitHub }
    }
}

impl CiProvider for GitHubApi {
    async fn list_pipelines(
        &self,
        git_ref: &str,
        q: &PipelineQuery,
        limit: usize,
        page: usize,
    ) -> Result<Page<Pipeline>, IntegrationError> {
        let mut query = vec![
            ("branch", git_ref.to_string()),
            ("per_page", limit.clamp(1, PIPELINES_PER_PAGE).to_string()),
            ("page", page.max(1).to_string()),
        ];
        if let Some(status) = q.status.and_then(github_status_param) {
            query.push(("status", status.to_string()));
        }
        if let Some(username) = q.username.as_deref().filter(|u| !u.is_empty()) {
            query.push(("actor", username.to_string()));
        }
        if let Some(source) = q.source.as_deref().filter(|s| !s.is_empty()) {
            query.push(("event", source.to_string()));
        }
        let text = q.text.trim();
        if is_full_sha(text) {
            query.push(("head_sha", text.to_string()));
        }

        let list = self.http.get_json(&self.repo("actions/runs"), &query).await?;
        let runs: Vec<&Value> = list.get("workflow_runs").and_then(Value::as_array).into_iter().flatten().collect();
        let has_more = runs.len() >= limit.clamp(1, PIPELINES_PER_PAGE);
        let mut pipelines = Vec::new();
        for run in runs {
            let id = id_of(run, "id");
            if id.is_empty() {
                continue;
            }
            let jobs = self.run_jobs(&id).await?;
            pipelines.push(map_pipeline(run, &jobs));
        }
        Ok(Page { items: filter_by_text(pipelines, text), has_more })
    }

    async fn get_pipeline(&self, id: &str) -> Result<Pipeline, IntegrationError> {
        let run = self.http.get_json(&self.repo(&format!("actions/runs/{id}")), &[]).await?;
        let jobs = self.run_jobs(id).await?;
        Ok(map_pipeline(&run, &jobs))
    }

    async fn job_log(&self, job_id: &str) -> Result<JobLog, IntegrationError> {
        let text = self
            .http
            .get_text_following_foreign_redirect(&self.repo(&format!("actions/jobs/{job_id}/logs")))
            .await?;
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
        self.http.post_json(&self.repo(&format!("actions/jobs/{job_id}/rerun")), &json!({})).await.map(|_| ())
    }

    async fn cancel_pipeline(&self, id: &str) -> Result<(), IntegrationError> {
        self.http.post_json(&self.repo(&format!("actions/runs/{id}/cancel")), &json!({})).await.map(|_| ())
    }

    async fn play_job(&self, _job_id: &str) -> Result<(), IntegrationError> {
        Err(IntegrationError::unsupported())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ISSUE: &str = include_str!("../fixtures/github/issue.json");
    const PULL: &str = include_str!("../fixtures/github/pull.json");
    const REVIEWS: &str = include_str!("../fixtures/github/reviews.json");
    const REVIEW_COMMENTS: &str = include_str!("../fixtures/github/review_comments.json");
    const ISSUE_COMMENTS: &str = include_str!("../fixtures/github/issue_comments.json");
    const WORKFLOW_RUN: &str = include_str!("../fixtures/github/workflow_run.json");
    const JOBS: &str = include_str!("../fixtures/github/jobs.json");
    const USER: &str = include_str!("../fixtures/github/user.json");

    fn parse(s: &str) -> Value {
        serde_json::from_str(s).unwrap()
    }

    fn array(s: &str) -> Vec<Value> {
        parse(s).as_array().unwrap().clone()
    }

    #[test]
    fn maps_issue_to_ticket() {
        let t = map_ticket(&parse(ISSUE));
        assert_eq!(t.id, "42");
        assert_eq!(t.key, "#42");
        assert_eq!(t.title, "Pipeline badge stays red after a retry");
        assert_eq!(t.status, "open");
        assert_eq!(t.status_category, StatusCategory::Todo);
        assert_eq!(t.labels, vec!["bug", "in progress"]);
        assert_eq!(t.assignees.len(), 1);
        assert_eq!(t.assignees[0].login, "alovelace");
        assert_eq!(t.assignees[0].display_name, "alovelace");
        assert_eq!(t.kind.as_deref(), Some("issue"));
        assert_eq!(t.url, "https://github.com/cairn-app/cairn/issues/42");
        assert!(t.description.starts_with("After retrying"));
    }

    #[test]
    fn closed_issue_is_done_and_pull_requests_are_flagged() {
        let mut v = parse(ISSUE);
        v["state"] = json!("closed");
        assert_eq!(map_ticket(&v).status_category, StatusCategory::Done);
        v["pull_request"] = json!({ "url": "https://api.github.com/repos/cairn-app/cairn/pulls/42" });
        assert!(is_pull_request(&v));
        assert_eq!(map_ticket(&v).kind.as_deref(), Some("pull_request"));
    }

    #[test]
    fn maps_pull_request_with_reviews() {
        let mr = map_merge_request(&parse(PULL), &array(REVIEWS), Some("alice"), Some(PipelineStatus::Failed));
        assert_eq!(mr.id, "340");
        assert_eq!(mr.number, "#340");
        assert_eq!(mr.state, MergeRequestState::Open);
        assert!(mr.is_draft);
        assert_eq!(mr.source_branch, "feat/42-pipeline-badge");
        assert_eq!(mr.target_branch, "main");
        assert_eq!(mr.author.login, "alovelace");
        assert_eq!(mr.reviewers.len(), 1);
        assert_eq!(mr.reviewers[0].login, "alice");
        assert_eq!(mr.assignees[0].login, "alovelace");
        assert_eq!(mr.labels, vec!["bug"]);
        assert_eq!(mr.approvals.approved, 1);
        assert_eq!(mr.approvals.required, None);
        assert!(mr.approvals.approved_by_me);
        assert_eq!(mr.mergeable, Mergeable::Yes);
        assert!(!mr.has_conflicts);
        assert_eq!(mr.head_sha, "8f3a1c2d4e5b6a7f8091a2b3c4d5e6f708192a3b");
        assert_eq!(mr.pipeline_status, Some(PipelineStatus::Failed));
        assert_eq!(mr.url, "https://github.com/cairn-app/cairn/pull/340");
        assert!(mr.description.ends_with("Closes #42"));
    }

    #[test]
    fn approvals_follow_the_latest_decisive_review_per_user() {
        let approved = approvers(&array(REVIEWS));
        assert_eq!(approved, vec!["alice"]);
        let mr = map_merge_request(&parse(PULL), &array(REVIEWS), Some("bob"), None);
        assert!(!mr.approvals.approved_by_me);
        let mr = map_merge_request(&parse(PULL), &[], None, None);
        assert_eq!(mr.approvals.approved, 0);
        assert_eq!(mr.pipeline_status, None);
    }

    #[test]
    fn pull_request_states_and_mergeability() {
        let mut v = parse(PULL);
        v["merged_at"] = json!("2026-08-13T10:00:00Z");
        v["state"] = json!("closed");
        assert_eq!(map_merge_request(&v, &[], None, None).state, MergeRequestState::Merged);
        v["merged_at"] = Value::Null;
        assert_eq!(map_merge_request(&v, &[], None, None).state, MergeRequestState::Closed);
        v["mergeable"] = Value::Null;
        assert_eq!(map_merge_request(&v, &[], None, None).mergeable, Mergeable::Unknown);
        v["mergeable"] = json!(false);
        v["mergeable_state"] = json!("dirty");
        let mr = map_merge_request(&v, &[], None, None);
        assert_eq!(mr.mergeable, Mergeable::No);
        assert!(mr.has_conflicts);
    }

    #[test]
    fn groups_review_comments_into_threads_by_in_reply_to_id() {
        let mut resolution = HashMap::new();
        resolution.insert("1900000003".to_string(), true);
        let threads = map_review_threads(&array(REVIEW_COMMENTS), &resolution);
        assert_eq!(threads.len(), 2);
        let first = &threads[0];
        assert_eq!(first.id, "1900000001");
        assert!(first.resolvable);
        assert!(!first.resolved);
        assert_eq!(first.comments.len(), 2);
        assert_eq!(first.comments[1].body, "Good catch, fixed in the next push.");
        let anchor = first.anchor.as_ref().unwrap();
        assert_eq!(anchor.path, "src/lib/stores/pipelines.ts");
        assert_eq!(anchor.line, 48);
        assert_eq!(anchor.side, DiffSide::New);
        assert_eq!(anchor.sha, "8f3a1c2d4e5b6a7f8091a2b3c4d5e6f708192a3b");

        let second = &threads[1];
        assert_eq!(second.id, "1900000003");
        assert!(second.resolved);
        assert_eq!(second.comments.len(), 1);
        let anchor = second.anchor.as_ref().unwrap();
        assert_eq!(anchor.side, DiffSide::Old);
        assert_eq!(anchor.line, 12);
    }

    #[test]
    fn orphan_reply_starts_its_own_thread() {
        let comments: Vec<Value> = array(REVIEW_COMMENTS).into_iter().skip(1).take(1).collect();
        let threads = map_review_threads(&comments, &HashMap::new());
        assert_eq!(threads.len(), 1);
        assert_eq!(threads[0].id, "1900000001");
        assert_eq!(threads[0].comments.len(), 1);
    }

    #[test]
    fn issue_comments_become_general_discussions() {
        let general = map_general_discussions(&array(ISSUE_COMMENTS));
        assert_eq!(general.len(), 2);
        assert_eq!(general[0].id, "general-3100000001");
        assert!(general[0].anchor.is_none());
        assert!(!general[0].resolvable);
        assert!(general[0].comments[0].is_system);
        assert!(!general[1].comments[0].is_system);
        assert_eq!(general[1].comments[0].author.login, "alice");
    }

    #[test]
    fn maps_workflow_run_to_pipeline_with_one_stage() {
        let jobs = parse(JOBS);
        let p = map_pipeline(&parse(WORKFLOW_RUN), jobs["jobs"].as_array().unwrap());
        assert_eq!(p.id, "16800412345");
        assert_eq!(p.number, "#8241");
        assert_eq!(p.status, PipelineStatus::Failed);
        assert_eq!(p.git_ref, "feat/42-pipeline-badge");
        assert_eq!(p.sha, "8f3a1c2d4e5b6a7f8091a2b3c4d5e6f708192a3b");
        assert_eq!(p.source.as_deref(), Some("pull_request"));
        assert_eq!(p.title, "fix(cicd): refresh badge after retry, #42");
        assert_eq!(p.started_at.as_deref(), Some("2026-08-12T09:41:35Z"));
        assert_eq!(p.finished_at.as_deref(), Some("2026-08-12T09:46:42Z"));
        assert_eq!(p.duration_ms, Some(307_000));
        assert_eq!(p.stages.len(), 1);
        assert_eq!(p.stages[0].name, "CI");
        assert_eq!(p.stages[0].status, PipelineStatus::Failed);
        assert_eq!(p.stages[0].jobs.len(), 3);
        assert_eq!(p.failed_job_id.as_deref(), Some("47500000002"));
        let failed = &p.stages[0].jobs[1];
        assert_eq!(failed.name, "test");
        assert!(failed.can_retry);
        assert!(!failed.can_cancel);
        assert_eq!(failed.duration_ms, Some(299_000));
        assert_eq!(failed.url, "https://github.com/cairn-app/cairn/actions/runs/16800412345/job/47500000002");
        let skipped = &p.stages[0].jobs[2];
        assert_eq!(skipped.status, PipelineStatus::Skipped);
        assert!(!skipped.can_retry);
        assert_eq!(p.url, "https://github.com/cairn-app/cairn/actions/runs/16800412345");
    }

    #[test]
    fn running_run_has_no_finish_and_cancellable_jobs() {
        let mut run = parse(WORKFLOW_RUN);
        run["status"] = json!("in_progress");
        run["conclusion"] = Value::Null;
        let mut job = parse(JOBS)["jobs"][1].clone();
        job["status"] = json!("in_progress");
        job["conclusion"] = Value::Null;
        job["completed_at"] = Value::Null;
        let p = map_pipeline(&run, &[job]);
        assert_eq!(p.status, PipelineStatus::Running);
        assert!(p.finished_at.is_none());
        assert!(p.duration_ms.is_none());
        let j = &p.stages[0].jobs[0];
        assert!(j.can_cancel);
        assert!(!j.can_retry);
        assert!(j.duration_ms.is_none());
        let empty = map_pipeline(&run, &[]);
        assert_eq!(empty.stages[0].status, PipelineStatus::Running);
        assert!(empty.failed_job_id.is_none());
    }

    #[test]
    fn run_status_mapping() {
        assert_eq!(map_run_status("queued", None), PipelineStatus::Pending);
        assert_eq!(map_run_status("waiting", None), PipelineStatus::Pending);
        assert_eq!(map_run_status("in_progress", None), PipelineStatus::Running);
        assert_eq!(map_run_status("completed", Some("success")), PipelineStatus::Success);
        assert_eq!(map_run_status("completed", Some("neutral")), PipelineStatus::Success);
        assert_eq!(map_run_status("completed", Some("failure")), PipelineStatus::Failed);
        assert_eq!(map_run_status("completed", Some("timed_out")), PipelineStatus::Failed);
        assert_eq!(map_run_status("completed", Some("cancelled")), PipelineStatus::Canceled);
        assert_eq!(map_run_status("completed", Some("skipped")), PipelineStatus::Skipped);
        assert_eq!(map_run_status("completed", Some("action_required")), PipelineStatus::Manual);
        assert_eq!(map_run_status("completed", Some("stale")), PipelineStatus::Unknown);
        assert_eq!(map_run_status("weird", None), PipelineStatus::Unknown);
    }

    #[test]
    fn check_runs_aggregate_to_the_worst_status() {
        let checks = json!({ "total_count": 2, "check_runs": [
            { "status": "completed", "conclusion": "success" },
            { "status": "in_progress", "conclusion": null }
        ]});
        assert_eq!(map_check_runs_status(&checks), Some(PipelineStatus::Running));
        assert_eq!(map_check_runs_status(&json!({ "total_count": 0, "check_runs": [] })), None);
    }

    #[test]
    fn maps_user_to_identity_and_project() {
        let id = map_identity(&parse(USER));
        assert_eq!(id.login, "alovelace");
        assert_eq!(id.display_name, "Ada Lovelace");
        assert!(id.avatar_url.as_deref().unwrap().starts_with("https://"));
        let p = map_project(&json!({ "full_name": "cairn-app/cairn", "html_url": "https://github.com/cairn-app/cairn" }));
        assert_eq!(p.key, "cairn-app/cairn");
        assert_eq!(p.url, "https://github.com/cairn-app/cairn");
    }

    #[test]
    fn parses_github_timestamps() {
        assert_eq!(parse_timestamp("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_timestamp("2026-08-12T09:41:30Z"), Some(1_786_527_690));
        assert_eq!(parse_timestamp("2026-08-12T09:41:30.123Z"), Some(1_786_527_690));
        assert!(parse_timestamp("yesterday").is_none());
    }

    #[test]
    fn issue_url_resolution() {
        assert_eq!(issue_number_from_url("https://github.com/cairn-app/cairn/issues/42", "github.com", "cairn-app/cairn"), Some(42));
        assert_eq!(issue_number_from_url("https://github.com/cairn-app/cairn/issues/42#issuecomment-1", "github.com", "cairn-app/cairn"), Some(42));
        assert_eq!(issue_number_from_url("https://github.com/other/repo/issues/42", "github.com", "cairn-app/cairn"), None);
        assert_eq!(issue_number_from_url("https://github.com/cairn-app/cairn/pull/340", "github.com", "cairn-app/cairn"), None);
        assert_eq!(issue_number_from_url("https://github.com/cairn-app/cairn/issues/42", "ghe.corp.net", "cairn-app/cairn"), None);
        assert_eq!(parse_number("#42").unwrap(), 42);
        assert_eq!(parse_number("CAIRN-42").unwrap_err().code, IntegrationErrorCode::NotFound);
    }

    #[test]
    fn graphql_endpoint_per_host() {
        assert_eq!(graphql_url("https://api.github.com"), "https://api.github.com/graphql");
        assert_eq!(graphql_url("https://ghe.corp.net/api/v3"), "https://ghe.corp.net/api/graphql");
    }
}
