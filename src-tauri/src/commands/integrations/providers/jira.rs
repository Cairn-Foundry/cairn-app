// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Jira adapter: tracker only. Cloud (REST v3, ADF descriptions, Basic auth)
//! and Data Center (REST v2, wiki markup, Bearer auth).

use serde_json::{json, Value};
use crate::commands::integrations::http::{host_of, HttpClient};
use crate::commands::integrations::model::*;
use crate::commands::integrations::provider::TrackerProvider;

const TICKETS_PER_PAGE: u32 = 20;
const PROJECTS_PER_PAGE: u32 = 50;
const ISSUE_FIELDS: &str = "summary,description,status,issuetype,labels,assignee,updated";

pub struct JiraApi {
    http: HttpClient,
    base_url: String,
    project_key: String,
    is_cloud: bool,
}

fn str_of(v: &Value, key: &str) -> String {
    v.get(key).and_then(Value::as_str).unwrap_or_default().to_string()
}

fn opt_str_of(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_string)
}

fn id_of(v: &Value, key: &str) -> String {
    match v.get(key) {
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::String(s)) => s.clone(),
        _ => String::new(),
    }
}

/// `CAIRN-42`: an uppercase project key, a dash and a number.
pub fn is_issue_key(text: &str) -> bool {
    let Some((project, number)) = text.rsplit_once('-') else { return false };
    let is_project = !project.is_empty()
        && project.chars().next().is_some_and(|c| c.is_ascii_uppercase())
        && project.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_');
    is_project && !number.is_empty() && number.chars().all(|c| c.is_ascii_digit())
}

pub fn map_status_category(key: &str) -> StatusCategory {
    match key {
        "new" => StatusCategory::Todo,
        "indeterminate" => StatusCategory::InProgress,
        "done" => StatusCategory::Done,
        _ => StatusCategory::Unknown,
    }
}

fn user_login(user: &Value) -> String {
    ["accountId", "name", "key"]
        .iter()
        .find_map(|k| opt_str_of(user, k))
        .unwrap_or_default()
}

fn map_assignee(user: &Value) -> TicketAssignee {
    let login = user_login(user);
    let display_name = opt_str_of(user, "displayName").unwrap_or_else(|| login.clone());
    TicketAssignee { login, display_name }
}

fn map_description(description: Option<&Value>) -> String {
    match description {
        Some(Value::String(wiki)) if !wiki.trim().is_empty() => format!("```\n{}\n```", wiki.trim_end()),
        Some(doc @ Value::Object(_)) => adf_to_markdown(doc),
        _ => String::new(),
    }
}

/// `v` is one issue of a search answer or of `issue/:key`; both carry the same
/// `fields` object.
pub fn map_ticket(v: &Value, base_url: &str) -> Ticket {
    let empty = json!({});
    let fields = v.get("fields").unwrap_or(&empty);
    let key = str_of(v, "key");
    let status = fields.get("status").unwrap_or(&empty);
    Ticket {
        id: id_of(v, "id"),
        url: format!("{}/browse/{key}", base_url.trim_end_matches('/')),
        key,
        title: str_of(fields, "summary"),
        description: map_description(fields.get("description")),
        status: str_of(status, "name"),
        status_category: map_status_category(&str_of(status.get("statusCategory").unwrap_or(&empty), "key")),
        kind: fields.get("issuetype").and_then(|t| opt_str_of(t, "name")),
        labels: fields
            .get("labels")
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(Value::as_str).map(str::to_string).collect())
            .unwrap_or_default(),
        assignees: fields.get("assignee").filter(|a| a.is_object()).map(map_assignee).into_iter().collect(),
        updated_at: str_of(fields, "updated"),
    }
}

pub fn map_transitions(v: &Value) -> Vec<TicketTransition> {
    v.get("transitions")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter(|t| t.get("isAvailable").and_then(Value::as_bool).unwrap_or(true))
                .map(|t| TicketTransition {
                    id: id_of(t, "id"),
                    name: str_of(t, "name"),
                    to_status: t.get("to").map(|to| str_of(to, "name")).unwrap_or_default(),
                })
                .collect()
        })
        .unwrap_or_default()
}

pub fn map_identity(v: &Value) -> IntegrationIdentity {
    let login = user_login(v);
    IntegrationIdentity {
        display_name: opt_str_of(v, "displayName").unwrap_or_else(|| login.clone()),
        login,
        avatar_url: v.get("avatarUrls").and_then(|a| opt_str_of(a, "48x48")),
    }
}

pub fn map_project(v: &Value, base_url: &str) -> TrackerProject {
    let key = str_of(v, "key");
    TrackerProject {
        url: format!("{}/projects/{key}", base_url.trim_end_matches('/')),
        label: {
            let name = str_of(v, "name");
            if name.is_empty() { key.clone() } else { format!("{name} ({key})") }
        },
        key,
    }
}

/// The issue key in a `/browse/KEY` URL of `host`, if that is what `url` is.
pub fn issue_key_from_url(url: &str, host: &str) -> Option<String> {
    if host_of(url)?.as_str() != host {
        return None;
    }
    let path = url.split_once("://")?.1.split(['?', '#']).next()?;
    let key = path.rsplit_once("/browse/")?.1.split('/').next()?;
    if is_issue_key(key) { Some(key.to_string()) } else { None }
}

fn jql_string(text: &str) -> String {
    format!("\"{}\"", text.replace('\\', "\\\\").replace('"', "\\\""))
}

pub fn build_jql(project_key: &str, q: &TicketQuery) -> String {
    let mut clauses = vec![format!("project = {}", jql_string(project_key))];
    match q.scope {
        TicketScope::Assigned => clauses.push("assignee = currentUser()".to_string()),
        TicketScope::Created => clauses.push("reporter = currentUser()".to_string()),
        TicketScope::All => {}
    }
    match q.state {
        TicketState::Open => clauses.push("resolution = Unresolved".to_string()),
        TicketState::Closed => clauses.push("resolution != Unresolved".to_string()),
        TicketState::All => {}
    }
    let text = q.text.trim();
    if !text.is_empty() {
        clauses.push(format!("text ~ {}", jql_string(text)));
    }
    format!("{} ORDER BY updated DESC", clauses.join(" AND "))
}

// ---------------------------------------------------------------------------
// ADF -> markdown
// ---------------------------------------------------------------------------

fn adf_children(node: &Value) -> &[Value] {
    node.get("content").and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[])
}

fn adf_attr<'a>(node: &'a Value, key: &str) -> Option<&'a Value> {
    node.get("attrs").and_then(|a| a.get(key))
}

fn adf_attr_str(node: &Value, key: &str) -> Option<String> {
    adf_attr(node, key).and_then(Value::as_str).map(str::to_string)
}

fn adf_text(node: &Value) -> String {
    let text = str_of(node, "text");
    let Some(marks) = node.get("marks").and_then(Value::as_array) else { return text };
    let mut out = text;
    let mut link: Option<String> = None;
    for mark in marks {
        match str_of(mark, "type").as_str() {
            "strong" => out = format!("**{out}**"),
            "em" => out = format!("_{out}_"),
            "code" => out = format!("`{out}`"),
            "strike" => out = format!("~~{out}~~"),
            "link" => link = adf_attr_str(mark, "href"),
            _ => {}
        }
    }
    match link {
        Some(href) => format!("[{out}]({href})"),
        None => out,
    }
}

fn adf_inline(node: &Value) -> String {
    match str_of(node, "type").as_str() {
        "text" => adf_text(node),
        "hardBreak" => "\n".to_string(),
        "mention" => adf_attr_str(node, "text").unwrap_or_else(|| format!("@{}", adf_attr_str(node, "id").unwrap_or_default())),
        "inlineCard" => adf_attr_str(node, "url").map(|url| format!("[{url}]({url})")).unwrap_or_default(),
        "emoji" => adf_attr_str(node, "text").or_else(|| adf_attr_str(node, "shortName")).unwrap_or_default(),
        "status" => adf_attr_str(node, "text").unwrap_or_default(),
        "date" => adf_attr_str(node, "timestamp").unwrap_or_default(),
        _ => adf_children(node).iter().map(adf_inline).collect(),
    }
}

fn adf_inlines(node: &Value) -> String {
    adf_children(node).iter().map(adf_inline).collect()
}

fn indent(text: &str, prefix: &str) -> String {
    text.lines()
        .map(|l| if l.is_empty() { l.to_string() } else { format!("{prefix}{l}") })
        .collect::<Vec<_>>()
        .join("\n")
}

fn adf_list(node: &Value, is_ordered: bool) -> String {
    let start = adf_attr(node, "order").and_then(Value::as_u64).unwrap_or(1);
    adf_children(node)
        .iter()
        .enumerate()
        .map(|(i, item)| {
            let marker = if is_ordered { format!("{}. ", start + i as u64) } else { "- ".to_string() };
            let body = adf_blocks(adf_children(item), "\n");
            let pad = " ".repeat(marker.len());
            let mut lines = body.lines();
            let first = lines.next().unwrap_or_default().to_string();
            let rest: Vec<&str> = lines.collect();
            if rest.is_empty() {
                format!("{marker}{first}")
            } else {
                format!("{marker}{first}\n{}", indent(&rest.join("\n"), &pad))
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn adf_table(node: &Value) -> String {
    let cell_text = |cell: &Value| adf_blocks(adf_children(cell), " ").replace('\n', " ").replace('|', "\\|");
    let rows: Vec<Vec<String>> = adf_children(node)
        .iter()
        .filter(|r| str_of(r, "type") == "tableRow")
        .map(|r| adf_children(r).iter().map(cell_text).collect())
        .collect();
    let Some(first) = rows.first() else { return String::new() };
    let width = rows.iter().map(Vec::len).max().unwrap_or(0);
    let render_row = |cells: &Vec<String>| {
        let mut cells = cells.clone();
        cells.resize(width, String::new());
        format!("| {} |", cells.join(" | "))
    };
    let mut out = vec![render_row(first), format!("|{}", " --- |".repeat(width))];
    out.extend(rows.iter().skip(1).map(render_row));
    out.join("\n")
}

fn adf_block(node: &Value) -> String {
    match str_of(node, "type").as_str() {
        "paragraph" => adf_inlines(node),
        "heading" => {
            let level = adf_attr(node, "level").and_then(Value::as_u64).unwrap_or(1).clamp(1, 6) as usize;
            format!("{} {}", "#".repeat(level), adf_inlines(node))
        }
        "bulletList" => adf_list(node, false),
        "orderedList" => adf_list(node, true),
        "codeBlock" => {
            let language = adf_attr_str(node, "language").unwrap_or_default();
            format!("```{language}\n{}\n```", adf_inlines(node))
        }
        "blockquote" => indent(&adf_blocks(adf_children(node), "\n\n"), "> "),
        "rule" => "---".to_string(),
        "table" => adf_table(node),
        "panel" | "expand" | "nestedExpand" | "layoutSection" | "layoutColumn" | "listItem" | "doc" | "mediaSingle" | "mediaGroup" => {
            adf_blocks(adf_children(node), "\n\n")
        }
        "media" => adf_attr_str(node, "alt").map(|alt| format!("[{alt}]")).unwrap_or_default(),
        "text" | "hardBreak" | "mention" | "inlineCard" | "emoji" | "status" | "date" => adf_inline(node),
        _ => adf_blocks(adf_children(node), "\n\n"),
    }
}

fn adf_blocks(nodes: &[Value], separator: &str) -> String {
    nodes.iter().map(adf_block).filter(|s| !s.is_empty()).collect::<Vec<_>>().join(separator)
}

/// Markdown for an Atlassian Document Format `doc` node.
pub fn adf_to_markdown(doc: &Value) -> String {
    adf_blocks(adf_children(doc), "\n\n")
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

fn is_gone(err: &IntegrationError) -> bool {
    err.code == IntegrationErrorCode::NotFound || err.message.starts_with("HTTP 410")
}

impl JiraApi {
    /// `http` is rooted at the site URL; paths start with `rest/api/3/` on
    /// Cloud and `rest/api/2/` on Data Center.
    pub fn new(http: HttpClient, base_url: &str, project_key: &str, is_cloud: bool) -> Self {
        JiraApi {
            http,
            base_url: base_url.trim_end_matches('/').to_string(),
            project_key: project_key.trim().to_string(),
            is_cloud,
        }
    }

    fn api(&self, rest: &str) -> String {
        let version = if self.is_cloud { 3 } else { 2 };
        format!("rest/api/{version}/{}", rest.trim_start_matches('/'))
    }

    pub async fn test_identity(&self) -> Result<IntegrationIdentity, IntegrationError> {
        Ok(map_identity(&self.http.get_json(&self.api("myself"), &[]).await?))
    }

    pub async fn list_projects(&self, text: &str) -> Result<Vec<TrackerProject>, IntegrationError> {
        let text = text.trim();
        if self.is_cloud {
            let mut query = vec![("orderBy", "name".to_string())];
            if !text.is_empty() {
                query.push(("query", text.to_string()));
            }
            let (items, _) = self.http.get_paged_start_at(&self.api("project/search"), &query, "values", PROJECTS_PER_PAGE).await?;
            return Ok(items.iter().map(|p| map_project(p, &self.base_url)).collect());
        }
        let value = self.http.get_json(&self.api("project"), &[]).await?;
        let needle = text.to_lowercase();
        Ok(value
            .as_array()
            .map(|a| {
                a.iter()
                    .filter(|p| {
                        needle.is_empty()
                            || str_of(p, "key").to_lowercase().contains(&needle)
                            || str_of(p, "name").to_lowercase().contains(&needle)
                    })
                    .map(|p| map_project(p, &self.base_url))
                    .collect()
            })
            .unwrap_or_default())
    }

    fn page_of(&self, value: &Value, offset_has_more: Option<bool>) -> Page<Ticket> {
        let items: Vec<Ticket> = value
            .get("issues")
            .and_then(Value::as_array)
            .map(|a| a.iter().map(|i| map_ticket(i, &self.base_url)).collect())
            .unwrap_or_default();
        let has_more = match offset_has_more {
            Some(has_more) => has_more,
            None => value.get("isLast").and_then(Value::as_bool).map(|last| !last).unwrap_or_else(|| {
                value.get("nextPageToken").and_then(Value::as_str).is_some_and(|t| !t.is_empty())
            }),
        };
        Page { items, has_more }
    }

    async fn search_start_at(&self, jql: &str, page: u32) -> Result<Page<Ticket>, IntegrationError> {
        let start_at = (page.max(1) - 1) as u64 * TICKETS_PER_PAGE as u64;
        let query = vec![
            ("jql", jql.to_string()),
            ("fields", ISSUE_FIELDS.to_string()),
            ("startAt", start_at.to_string()),
            ("maxResults", TICKETS_PER_PAGE.to_string()),
        ];
        let value = self.http.get_json(&self.api("search"), &query).await?;
        let received = value.get("issues").and_then(Value::as_array).map(Vec::len).unwrap_or(0) as u64;
        let has_more = value
            .get("total")
            .and_then(Value::as_u64)
            .map(|total| start_at + received < total)
            .unwrap_or(received == TICKETS_PER_PAGE as u64 && received > 0);
        Ok(self.page_of(&value, Some(has_more)))
    }

    async fn search_jql_cloud(&self, jql: &str, page: u32) -> Result<Page<Ticket>, IntegrationError> {
        let fields: Vec<&str> = ISSUE_FIELDS.split(',').collect();
        let mut token: Option<String> = None;
        let mut value = Value::Null;
        for _ in 0..page.max(1) {
            let mut body = json!({ "jql": jql, "maxResults": TICKETS_PER_PAGE, "fields": fields });
            if let Some(t) = &token {
                body["nextPageToken"] = Value::String(t.clone());
            }
            value = self.http.post_json(&self.api("search/jql"), &body).await?;
            token = value.get("nextPageToken").and_then(Value::as_str).filter(|t| !t.is_empty()).map(str::to_string);
            let is_last = value.get("isLast").and_then(Value::as_bool).unwrap_or(token.is_none());
            if is_last || token.is_none() {
                break;
            }
        }
        Ok(self.page_of(&value, None))
    }

    async fn search(&self, jql: &str, page: u32) -> Result<Page<Ticket>, IntegrationError> {
        if !self.is_cloud {
            return self.search_start_at(jql, page).await;
        }
        match self.search_jql_cloud(jql, page).await {
            Err(err) if is_gone(&err) => self.search_start_at(jql, page).await,
            other => other,
        }
    }

    fn full_key(&self, key: &str) -> String {
        let key = key.trim();
        if key.chars().all(|c| c.is_ascii_digit()) && !key.is_empty() && !self.project_key.is_empty() {
            format!("{}-{key}", self.project_key)
        } else {
            key.to_ascii_uppercase()
        }
    }
}

impl TrackerProvider for JiraApi {
    async fn list_tickets(&self, q: &TicketQuery) -> Result<Page<Ticket>, IntegrationError> {
        let text = q.text.trim();
        let looks_like_key = !text.is_empty() && (is_issue_key(&text.to_ascii_uppercase()) || text.chars().all(|c| c.is_ascii_digit()));
        if looks_like_key {
            return Ok(Page { items: self.get_ticket(text).await.into_iter().collect(), has_more: false });
        }
        self.search(&build_jql(&self.project_key, q), q.page).await
    }

    async fn get_ticket(&self, key: &str) -> Result<Ticket, IntegrationError> {
        let key = self.full_key(key);
        if !is_issue_key(&key) {
            return Err(IntegrationError::not_found(format!("'{key}' is not a Jira issue key")));
        }
        let value = self.http.get_json(&self.api(&format!("issue/{key}")), &[("fields", ISSUE_FIELDS.to_string())]).await?;
        Ok(map_ticket(&value, &self.base_url))
    }

    async fn resolve_ticket_url(&self, url: &str) -> Result<Option<Ticket>, IntegrationError> {
        let Some(host) = host_of(&self.base_url) else { return Ok(None) };
        match issue_key_from_url(url, &host) {
            Some(key) => self.get_ticket(&key).await.map(Some),
            None => Ok(None),
        }
    }

    async fn list_transitions(&self, key: &str) -> Result<Vec<TicketTransition>, IntegrationError> {
        let key = self.full_key(key);
        let value = self.http.get_json(&self.api(&format!("issue/{key}/transitions")), &[]).await?;
        Ok(map_transitions(&value))
    }

    async fn list_statuses(&self) -> Result<Vec<TrackerStatus>, IntegrationError> {
        let value = self.http.get_json(&self.api(&format!("project/{}/statuses", &self.project_key)), &[]).await?;
        let mut seen = std::collections::HashSet::new();
        let mut statuses = Vec::new();
        if let Some(issue_types) = value.as_array() {
            for it in issue_types {
                if let Some(arr) = it.get("statuses").and_then(Value::as_array) {
                    for s in arr {
                        let id = id_of(s, "id");
                        if id.is_empty() || !seen.insert(id.clone()) {
                            continue;
                        }
                        let category_key = s.get("statusCategory")
                            .and_then(|c| c.get("key"))
                            .and_then(Value::as_str)
                            .unwrap_or("");
                        statuses.push(TrackerStatus {
                            id,
                            name: str_of(s, "name"),
                            category: map_status_category(category_key),
                        });
                    }
                }
            }
        }
        Ok(statuses)
    }

    async fn transition(&self, key: &str, transition_id: &str) -> Result<Ticket, IntegrationError> {
        let key = self.full_key(key);
        self.http
            .post_json(&self.api(&format!("issue/{key}/transitions")), &json!({ "transition": { "id": transition_id } }))
            .await?;
        self.get_ticket(&key).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ISSUE_CLOUD: &str = include_str!("../fixtures/jira/issue_cloud.json");
    const ISSUE_DC: &str = include_str!("../fixtures/jira/issue_dc.json");
    const SEARCH_PAGE: &str = include_str!("../fixtures/jira/search_page.json");
    const TRANSITIONS: &str = include_str!("../fixtures/jira/transitions.json");
    const MYSELF: &str = include_str!("../fixtures/jira/myself.json");
    const PROJECT_SEARCH: &str = include_str!("../fixtures/jira/project_search.json");
    const BASE: &str = "https://acme.atlassian.net";

    fn parse(s: &str) -> Value {
        serde_json::from_str(s).unwrap()
    }

    fn adf(content: Value) -> Value {
        json!({ "type": "doc", "version": 1, "content": content })
    }

    fn text(t: &str) -> Value {
        json!({ "type": "text", "text": t })
    }

    fn paragraph(content: Vec<Value>) -> Value {
        json!({ "type": "paragraph", "content": content })
    }

    #[test]
    fn maps_cloud_issue_to_ticket() {
        let t = map_ticket(&parse(ISSUE_CLOUD), BASE);
        assert_eq!(t.id, "10042");
        assert_eq!(t.key, "CAIRN-42");
        assert_eq!(t.title, "Pipeline badge stays red after a retry");
        assert_eq!(t.status, "In Progress");
        assert_eq!(t.status_category, StatusCategory::InProgress);
        assert_eq!(t.kind.as_deref(), Some("Bug"));
        assert_eq!(t.labels, vec!["bug", "cicd"]);
        assert_eq!(t.assignees.len(), 1);
        assert_eq!(t.assignees[0].login, "5b10ac8d82e05b22cc7d4ef5");
        assert_eq!(t.assignees[0].display_name, "Ada Lovelace");
        assert_eq!(t.url, "https://acme.atlassian.net/browse/CAIRN-42");
        assert_eq!(t.updated_at, "2026-08-14T10:22:31.000+0200");
        assert!(t.description.starts_with("## Symptom\n\nAfter retrying"));
    }

    #[test]
    fn cloud_issue_description_is_full_markdown() {
        let t = map_ticket(&parse(ISSUE_CLOUD), BASE);
        let expected = concat!(
            "## Symptom\n\n",
            "After retrying a failed job the badge **stays red** until a _reload_. See [the store](https://gitlab.com/cairn/cairn/-/blob/main/src/lib/stores/pipelines.ts).\n\n",
            "- Open the CI/CD tab\n",
            "- Retry the failed job\n",
            "  1. wait for it to finish\n",
            "  2. the badge does not move\n\n",
            "```typescript\npipelines.refresh(id);\nbadge.update();\n```\n\n",
            "Reported by @Ada Lovelace, tracked in [https://acme.atlassian.net/browse/CAIRN-40](https://acme.atlassian.net/browse/CAIRN-40)\n\n",
            "---\n\n",
            "> Refresh once the retry answers.\n\n",
            "| Browser | Result |\n| --- | --- |\n| WebKit | red \\| stuck |"
        );
        assert_eq!(t.description, expected);
    }

    #[test]
    fn maps_data_center_issue_with_wiki_description() {
        let t = map_ticket(&parse(ISSUE_DC), "https://jira.acme.io/");
        assert_eq!(t.id, "20017");
        assert_eq!(t.key, "OPS-17");
        assert_eq!(t.status_category, StatusCategory::Todo);
        assert_eq!(t.kind.as_deref(), Some("Task"));
        assert!(t.labels.is_empty());
        assert!(t.assignees.is_empty());
        assert_eq!(t.url, "https://jira.acme.io/browse/OPS-17");
        assert!(t.description.starts_with("```\nh2. Context\n"));
        assert!(t.description.ends_with("{{RUNNER_TOKEN}} variable\n```"));
    }

    #[test]
    fn maps_search_page_issues() {
        let page = parse(SEARCH_PAGE);
        let tickets: Vec<Ticket> = page["issues"].as_array().unwrap().iter().map(|i| map_ticket(i, BASE)).collect();
        assert_eq!(tickets.len(), 2);
        assert_eq!(tickets[0].description, "Short one.");
        assert_eq!(tickets[1].key, "CAIRN-38");
        assert_eq!(tickets[1].status_category, StatusCategory::Done);
        assert_eq!(tickets[1].description, "");
        assert!(tickets[1].assignees.is_empty());
    }

    #[test]
    fn maps_transitions() {
        let transitions = map_transitions(&parse(TRANSITIONS));
        assert_eq!(transitions.len(), 2);
        assert_eq!(transitions[1].id, "31");
        assert_eq!(transitions[1].name, "Done");
        assert_eq!(transitions[1].to_status, "Done");
    }

    #[test]
    fn maps_myself_to_identity() {
        let id = map_identity(&parse(MYSELF));
        assert_eq!(id.login, "5b10ac8d82e05b22cc7d4ef5");
        assert_eq!(id.display_name, "Ada Lovelace");
        assert_eq!(id.avatar_url.as_deref(), Some("https://avatar-management.services.atlassian.com/initials/BB-1.png?size=48"));
        let dc = map_identity(&json!({ "name": "alovelace", "key": "JIRAUSER1", "displayName": "Ben" }));
        assert_eq!(dc.login, "alovelace");
        assert!(dc.avatar_url.is_none());
    }

    #[test]
    fn maps_project_search() {
        let projects: Vec<TrackerProject> = parse(PROJECT_SEARCH)["values"].as_array().unwrap().iter().map(|p| map_project(p, BASE)).collect();
        assert_eq!(projects.len(), 2);
        assert_eq!(projects[0].key, "CAIRN");
        assert_eq!(projects[0].label, "Cairn (CAIRN)");
        assert_eq!(projects[0].url, "https://acme.atlassian.net/projects/CAIRN");
    }

    #[test]
    fn status_category_mapping() {
        assert_eq!(map_status_category("new"), StatusCategory::Todo);
        assert_eq!(map_status_category("indeterminate"), StatusCategory::InProgress);
        assert_eq!(map_status_category("done"), StatusCategory::Done);
        assert_eq!(map_status_category("undefined"), StatusCategory::Unknown);
        assert_eq!(map_status_category(""), StatusCategory::Unknown);
    }

    #[test]
    fn issue_url_resolution() {
        assert_eq!(issue_key_from_url("https://acme.atlassian.net/browse/CAIRN-42", "acme.atlassian.net").as_deref(), Some("CAIRN-42"));
        assert_eq!(
            issue_key_from_url("https://acme.atlassian.net/browse/CAIRN-42?focusedCommentId=1#comment-1", "acme.atlassian.net").as_deref(),
            Some("CAIRN-42")
        );
        assert_eq!(issue_key_from_url("https://acme.atlassian.net/jira/software/projects/CAIRN/boards/1?selectedIssue=CAIRN-42", "acme.atlassian.net"), None);
        assert_eq!(issue_key_from_url("https://acme.atlassian.net/browse/CAIRN-42", "other.atlassian.net"), None);
        assert_eq!(issue_key_from_url("https://acme.atlassian.net/browse/not-a-key", "acme.atlassian.net"), None);
        assert!(is_issue_key("CAIRN-42"));
        assert!(is_issue_key("A1_B-7"));
        assert!(!is_issue_key("cairn-42"));
        assert!(!is_issue_key("42"));
        assert!(!is_issue_key("CAIRN-"));
    }

    #[test]
    fn jql_follows_scope_state_and_text() {
        let q = TicketQuery { scope: TicketScope::Assigned, text: String::new(), state: TicketState::Open, page: 1 };
        assert_eq!(build_jql("CAIRN", &q), "project = \"CAIRN\" AND assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC");
        let q = TicketQuery { scope: TicketScope::Created, text: "badge \"red\"".into(), state: TicketState::Closed, page: 1 };
        assert_eq!(
            build_jql("CAIRN", &q),
            "project = \"CAIRN\" AND reporter = currentUser() AND resolution != Unresolved AND text ~ \"badge \\\"red\\\"\" ORDER BY updated DESC"
        );
        let q = TicketQuery { scope: TicketScope::All, text: String::new(), state: TicketState::All, page: 1 };
        assert_eq!(build_jql("CAIRN", &q), "project = \"CAIRN\" ORDER BY updated DESC");
    }

    #[test]
    fn adf_paragraphs_and_marks() {
        let doc = adf(json!([
            paragraph(vec![text("plain "), json!({ "type": "text", "text": "bold", "marks": [{ "type": "strong" }] })]),
            paragraph(vec![json!({ "type": "text", "text": "x", "marks": [{ "type": "code" }] }), json!({ "type": "hardBreak" }), text("next")]),
        ]));
        assert_eq!(adf_to_markdown(&doc), "plain **bold**\n\n`x`\nnext");
    }

    #[test]
    fn adf_nested_lists() {
        let item = |t: &str, nested: Option<Value>| {
            let mut content = vec![paragraph(vec![text(t)])];
            if let Some(n) = nested {
                content.push(n);
            }
            json!({ "type": "listItem", "content": content })
        };
        let inner = json!({ "type": "bulletList", "content": [item("b1", None), item("b2", None)] });
        let doc = adf(json!([{ "type": "orderedList", "attrs": { "order": 3 }, "content": [item("a", Some(inner)), item("c", None)] }]));
        assert_eq!(adf_to_markdown(&doc), "3. a\n   - b1\n   - b2\n4. c");
    }

    #[test]
    fn adf_code_block_and_heading() {
        let doc = adf(json!([
            { "type": "heading", "attrs": { "level": 3 }, "content": [text("Title")] },
            { "type": "codeBlock", "attrs": { "language": "rust" }, "content": [text("fn main() {}")] },
            { "type": "codeBlock", "content": [text("no lang")] },
        ]));
        assert_eq!(adf_to_markdown(&doc), "### Title\n\n```rust\nfn main() {}\n```\n\n```\nno lang\n```");
    }

    #[test]
    fn adf_link_and_mention() {
        let doc = adf(json!([paragraph(vec![
            json!({ "type": "text", "text": "docs", "marks": [{ "type": "link", "attrs": { "href": "https://cairn.dev" } }, { "type": "em" }] }),
            text(" by "),
            json!({ "type": "mention", "attrs": { "id": "abc", "text": "@Alice" } }),
            text(" and "),
            json!({ "type": "mention", "attrs": { "id": "def" } }),
        ])]));
        assert_eq!(adf_to_markdown(&doc), "[_docs_](https://cairn.dev) by @Alice and @def");
    }

    #[test]
    fn adf_unknown_nodes_fall_back_to_their_text() {
        let doc = adf(json!([
            { "type": "panel", "attrs": { "panelType": "info" }, "content": [paragraph(vec![text("inside")])] },
            { "type": "somethingNew", "content": [paragraph(vec![text("deep")])] },
            { "type": "mediaSingle", "content": [{ "type": "media", "attrs": { "id": "1", "type": "file" } }] },
        ]));
        assert_eq!(adf_to_markdown(&doc), "inside\n\ndeep");
        assert_eq!(adf_to_markdown(&json!({ "type": "doc", "version": 1 })), "");
    }
}
