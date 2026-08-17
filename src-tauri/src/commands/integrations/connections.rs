//! Connections (`~/.cairn/integrations.json`), per-project bindings and the
//! kind descriptors that drive the connection form.

use std::fs;
use serde::{Deserialize, Serialize};
use crate::storage::{integrations_file, project_integrations_file, write_json_atomic};
use super::model::*;

#[derive(Serialize, Deserialize, Default)]
struct IntegrationsFile {
    #[serde(default)]
    connections: Vec<IntegrationConnection>,
}

pub fn read_connections() -> Result<Vec<IntegrationConnection>, String> {
    let path = integrations_file()?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let file: IntegrationsFile = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(file.connections)
}

pub fn write_connections(connections: &[IntegrationConnection]) -> Result<(), String> {
    write_json_atomic(&integrations_file()?, &IntegrationsFile { connections: connections.to_vec() })
}

pub fn find_connection(id: &str) -> Result<IntegrationConnection, IntegrationError> {
    read_connections()?
        .into_iter()
        .find(|c| c.id == id)
        .ok_or_else(|| IntegrationError::no_connection(format!("No integration connection with id {id}")))
}

pub fn read_project_integrations(project_id: &str) -> Result<ProjectIntegrations, String> {
    let path = project_integrations_file(project_id)?;
    if !path.exists() {
        return Ok(ProjectIntegrations::default());
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

pub fn write_project_integrations(project_id: &str, bindings: &ProjectIntegrations) -> Result<(), String> {
    write_json_atomic(&project_integrations_file(project_id)?, bindings)
}

pub fn credential_key(connection_id: &str) -> String {
    format!("integration:{connection_id}")
}

// ---------------------------------------------------------------------------
// Kind descriptors
// ---------------------------------------------------------------------------

fn token_field() -> CredentialField {
    CredentialField { key: "token".to_string(), label_key: "integrations.token".to_string(), secret: true }
}

pub fn kind_descriptors() -> Vec<IntegrationKindDescriptor> {
    vec![
        IntegrationKindDescriptor {
            kind: IntegrationKind::Gitlab,
            label: "GitLab".to_string(),
            icon: "gitlab".to_string(),
            default_base_url: Some("https://gitlab.com".to_string()),
            credential_fields: vec![token_field()],
            token_help_url: "https://gitlab.com/-/user_settings/personal_access_tokens".to_string(),
            required_scopes: vec!["api".to_string()],
            provides: vec![Capability::Tracker, Capability::Forge, Capability::Ci],
            terms: KindTerms { merge_request: MergeRequestTerm::Mr },
        },
        IntegrationKindDescriptor {
            kind: IntegrationKind::Github,
            label: "GitHub".to_string(),
            icon: "github".to_string(),
            default_base_url: Some("https://github.com".to_string()),
            credential_fields: vec![token_field()],
            token_help_url: "https://github.com/settings/personal-access-tokens/new".to_string(),
            required_scopes: vec![
                "Issues: read".to_string(),
                "Pull requests: write".to_string(),
                "Actions: read/write".to_string(),
                "Metadata: read".to_string(),
            ],
            provides: vec![Capability::Tracker, Capability::Forge, Capability::Ci],
            terms: KindTerms { merge_request: MergeRequestTerm::Pr },
        },
        IntegrationKindDescriptor {
            kind: IntegrationKind::Jira,
            label: "Jira".to_string(),
            icon: "jira".to_string(),
            default_base_url: None,
            credential_fields: vec![
                CredentialField { key: "email".to_string(), label_key: "integrations.email".to_string(), secret: false },
                token_field(),
            ],
            token_help_url: "https://id.atlassian.com/manage-profile/security/api-tokens".to_string(),
            required_scopes: vec!["read:jira-work".to_string(), "write:jira-work".to_string()],
            provides: vec![Capability::Tracker],
            terms: KindTerms { merge_request: MergeRequestTerm::Mr },
        },
    ]
}

pub fn descriptor_for(kind: IntegrationKind) -> IntegrationKindDescriptor {
    kind_descriptors()
        .into_iter()
        .find(|d| d.kind == kind)
        .expect("every kind has a descriptor")
}

// ---------------------------------------------------------------------------
// Remote URL parsing and binding suggestion
// ---------------------------------------------------------------------------

/// Host and `group/sub/repo` path of a git remote, whatever its syntax.
#[derive(Debug, PartialEq, Eq)]
pub struct RemoteRef {
    pub host: String,
    pub path: String,
}

pub fn parse_remote_url(remote: &str) -> Option<RemoteRef> {
    let remote = remote.trim();
    if remote.is_empty() {
        return None;
    }
    let (host_part, path) = if let Some((scheme_less, rest)) = remote.split_once("://") {
        let _ = scheme_less;
        let rest = rest.split_once('@').map(|(_, r)| r).unwrap_or(rest);
        rest.split_once('/')?
    } else if let Some((user_host, path)) = remote.split_once(':') {
        let host = user_host.split_once('@').map(|(_, h)| h).unwrap_or(user_host);
        (host, path)
    } else {
        return None;
    };
    let host = host_part.split(':').next()?.trim().to_ascii_lowercase();
    if host.is_empty() {
        return None;
    }
    let path = path.trim_matches('/').trim_end_matches(".git").trim_end_matches('/');
    if path.is_empty() {
        return None;
    }
    Some(RemoteRef { host, path: path.to_string() })
}

pub fn host_of_base_url(base_url: &str) -> Option<String> {
    let rest = base_url.trim().split_once("://").map(|(_, r)| r).unwrap_or(base_url.trim());
    let host = rest.split(['/', '?', '#']).next()?.split(':').next()?.trim().to_ascii_lowercase();
    if host.is_empty() { None } else { Some(host) }
}

/// The bindings a project on `remote_url` would most likely want, given the
/// connections at hand: forge and CI on the first connection whose host matches,
/// tracker on the same one when its kind provides it.
pub fn suggest_bindings(remote_url: &str, connections: &[IntegrationConnection]) -> ProjectIntegrations {
    let Some(remote) = parse_remote_url(remote_url) else {
        return ProjectIntegrations::default();
    };
    let Some(connection) = connections
        .iter()
        .find(|c| host_of_base_url(&c.base_url).as_deref() == Some(remote.host.as_str()))
    else {
        return ProjectIntegrations::default();
    };
    let descriptor = descriptor_for(connection.kind);
    let repo = RepoBinding { connection_id: connection.id.clone(), repo_path: remote.path.clone() };
    ProjectIntegrations {
        tracker: descriptor.provides.contains(&Capability::Tracker).then(|| TrackerBinding {
            connection_id: connection.id.clone(),
            project_key: remote.path.clone(),
            label: remote.path.clone(),
        }),
        forge: descriptor.provides.contains(&Capability::Forge).then(|| repo.clone()),
        ci: descriptor.provides.contains(&Capability::Ci).then(|| repo),
        auto_transition: AutoTransition::default(),
    }
}

pub fn resolve_capabilities(bindings: &ProjectIntegrations, connections: &[IntegrationConnection]) -> ResolvedCapabilities {
    let connection = |id: &str| connections.iter().find(|c| c.id == id);
    ResolvedCapabilities {
        tracker: bindings.tracker.as_ref().and_then(|b| connection(&b.connection_id)).map(|c| ResolvedTracker {
            kind: c.kind,
            label: c.label.clone(),
        }),
        forge: bindings.forge.as_ref().and_then(|b| connection(&b.connection_id).map(|c| (b, c))).map(|(b, c)| {
            ResolvedForge {
                kind: c.kind,
                label: c.label.clone(),
                web_url: format!("{}/{}", c.base_url.trim_end_matches('/'), b.repo_path),
                terms: descriptor_for(c.kind).terms,
            }
        }),
        ci: bindings.ci.as_ref().and_then(|b| connection(&b.connection_id)).map(|c| ResolvedCi {
            kind: c.kind,
            label: c.label.clone(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn connection(id: &str, kind: IntegrationKind, base_url: &str) -> IntegrationConnection {
        IntegrationConnection {
            id: id.to_string(),
            kind,
            label: id.to_string(),
            base_url: base_url.to_string(),
            has_credentials: true,
            identity: None,
            created_at: 0,
            email: None,
            deployment: None,
        }
    }

    #[test]
    fn parses_scp_like_remote() {
        let r = parse_remote_url("git@gitlab.com:group/sub/repo.git").unwrap();
        assert_eq!(r, RemoteRef { host: "gitlab.com".into(), path: "group/sub/repo".into() });
    }

    #[test]
    fn parses_ssh_remote_with_port() {
        let r = parse_remote_url("ssh://git@gitlab.acme.io:2222/team/repo.git").unwrap();
        assert_eq!(r, RemoteRef { host: "gitlab.acme.io".into(), path: "team/repo".into() });
    }

    #[test]
    fn parses_https_remote() {
        let r = parse_remote_url("https://github.com/owner/repo").unwrap();
        assert_eq!(r, RemoteRef { host: "github.com".into(), path: "owner/repo".into() });
    }

    #[test]
    fn parses_https_remote_with_user() {
        let r = parse_remote_url("https://user@ghe.corp.net/org/repo.git").unwrap();
        assert_eq!(r, RemoteRef { host: "ghe.corp.net".into(), path: "org/repo".into() });
    }

    #[test]
    fn rejects_garbage() {
        assert!(parse_remote_url("").is_none());
        assert!(parse_remote_url("just-a-name").is_none());
    }

    #[test]
    fn suggests_all_three_capabilities_on_gitlab_subgroup() {
        let conns = vec![
            connection("gh", IntegrationKind::Github, "https://github.com"),
            connection("gl", IntegrationKind::Gitlab, "https://gitlab.acme.io/"),
        ];
        let s = suggest_bindings("git@gitlab.acme.io:group/sub/repo.git", &conns);
        assert_eq!(s.forge.as_ref().unwrap().connection_id, "gl");
        assert_eq!(s.forge.as_ref().unwrap().repo_path, "group/sub/repo");
        assert_eq!(s.ci.as_ref().unwrap().repo_path, "group/sub/repo");
        assert_eq!(s.tracker.as_ref().unwrap().project_key, "group/sub/repo");
    }

    #[test]
    fn suggests_github_enterprise_host() {
        let conns = vec![connection("ghe", IntegrationKind::Github, "https://ghe.corp.net")];
        let s = suggest_bindings("https://ghe.corp.net/org/repo.git", &conns);
        assert_eq!(s.forge.as_ref().unwrap().connection_id, "ghe");
        assert!(s.tracker.is_some());
    }

    #[test]
    fn suggests_nothing_without_matching_host() {
        let conns = vec![connection("gl", IntegrationKind::Gitlab, "https://gitlab.com")];
        let s = suggest_bindings("git@github.com:owner/repo.git", &conns);
        assert_eq!(s, ProjectIntegrations::default());
    }

    #[test]
    fn jira_connection_never_suggested_as_forge() {
        let conns = vec![connection("j", IntegrationKind::Jira, "https://acme.atlassian.net")];
        let s = suggest_bindings("https://acme.atlassian.net/org/repo.git", &conns);
        assert!(s.forge.is_none());
        assert!(s.ci.is_none());
        assert!(s.tracker.is_some());
    }

    #[test]
    fn descriptors_cover_every_kind() {
        let kinds: Vec<IntegrationKind> = kind_descriptors().into_iter().map(|d| d.kind).collect();
        assert_eq!(kinds, vec![IntegrationKind::Gitlab, IntegrationKind::Github, IntegrationKind::Jira]);
        assert_eq!(descriptor_for(IntegrationKind::Jira).provides, vec![Capability::Tracker]);
    }
}
