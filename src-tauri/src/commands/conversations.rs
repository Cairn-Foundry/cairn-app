// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Agent conversations, stored per scope (project, or one instance) as a single
//! light `index.json`.
//!
//! Cairn keeps metadata only. The conversation itself is the CLI, running in a
//! PTY, and its transcript lives wherever that CLI keeps it - so there is no
//! transcript file here, and nothing to read back beyond what the history panel
//! draws.

use std::fs;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};

use crate::storage::{
    instance_conversations_dir, instances_dir, project_conversations_dir, projects_dir,
    write_json_atomic,
};

/// One conversation: which CLI owns it, where it runs, and how to resume it.
///
/// `session_id` is only set when the CLI accepts an id imposed at launch
/// (`mints_session_id`). For the others it stays null and resume falls back to
/// "the last session in this cwd", which the worktree per instance makes
/// unambiguous.
#[derive(Serialize, Deserialize, Clone, Default)]
pub struct ConversationMeta {
    pub id: String,
    #[serde(default)]
    pub title: String,
    /// Id from `CLI_PROVIDERS`. A conversation belongs to one CLI for its whole
    /// life: its transcript is that CLI's, and no other can resume it.
    #[serde(default)]
    pub cli: String,
    #[serde(rename = "sessionId", default)]
    pub session_id: Option<String>,
    /// Whether the CLI ever wrote that session to disk. An id imposed at launch
    /// names a session the CLI only creates once the user has said something,
    /// so a conversation opened and left untouched must not be resumed.
    #[serde(rename = "sessionStarted", default)]
    pub session_started: bool,
    /// Whether that session was found in the CLI's own store. `session_started`
    /// records that the user typed; this records that the session was seen on
    /// disk, which is the only state where `--resume` is known to work.
    #[serde(rename = "sessionConfirmed", default)]
    pub session_confirmed: bool,
    /// Directory the CLI was launched in, kept so a resume lands in the same
    /// worktree even when the instance is reopened from elsewhere.
    #[serde(default)]
    pub cwd: String,
    #[serde(rename = "createdAt", default)]
    pub created_at: i64,
    #[serde(rename = "lastOpenedAt", default)]
    pub last_opened_at: i64,
    #[serde(rename = "lastActiveAt", default)]
    pub last_active_at: i64,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub archived: bool,
    /// The instance whose Agent step runs the CLI, set at launch and cleared
    /// when it stops. Still set on the next start means the app closed under it.
    #[serde(rename = "runningIn", default, skip_serializing_if = "Option::is_none")]
    pub running_in: Option<String>,
}

/// The whole `index.json` of one scope.
#[derive(Serialize, Deserialize, Clone, Default)]
pub struct ConversationIndex {
    #[serde(default)]
    pub conversations: Vec<ConversationMeta>,
    #[serde(rename = "activeId", default)]
    pub active_id: Option<String>,
}

/// No instance id means the project scope.
fn scope_dir(project_id: &str, instance_id: Option<&str>) -> Result<PathBuf, String> {
    match instance_id {
        Some(id) => instance_conversations_dir(project_id, id),
        None => project_conversations_dir(project_id),
    }
}

fn index_file(project_id: &str, instance_id: Option<&str>) -> Result<PathBuf, String> {
    Ok(scope_dir(project_id, instance_id)?.join("index.json"))
}

/// One small read that backs the whole history panel.
#[tauri::command]
pub fn get_conversation_index(
    project_id: String,
    instance_id: Option<String>,
) -> Result<Option<ConversationIndex>, String> {
    let path = index_file(&project_id, instance_id.as_deref())?;
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    // An index written by the transcript-era app deserializes into entries with
    // no `cli`, which the frontend filters out rather than migrating: the plan
    // is explicit that old history is not carried over.
    serde_json::from_str(&content).map(Some).map_err(|e| e.to_string())
}

/// Replaces the whole index of the scope.
#[tauri::command]
pub async fn save_conversation_index(
    project_id: String,
    instance_id: Option<String>,
    index: ConversationIndex,
) -> Result<(), String> {
    write_json_atomic(
        &index_file(&project_id, instance_id.as_deref())?,
        &index,
    )
}

/// A conversation whose CLI was still running when the app last closed.
#[derive(Serialize, Clone)]
pub struct InterruptedConversation {
    #[serde(rename = "projectId")]
    pub project_id: String,
    /// The instance of the index holding it; null for the project scope.
    #[serde(rename = "instanceId")]
    pub instance_id: Option<String>,
    pub conversation: ConversationMeta,
}

fn read_index(path: &Path) -> Option<ConversationIndex> {
    serde_json::from_str(&fs::read_to_string(path).ok()?).ok()
}

fn subdir_names(dir: &Path) -> Vec<String> {
    let Ok(entries) = fs::read_dir(dir) else { return Vec::new() };
    entries
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
        .filter_map(|e| e.file_name().into_string().ok())
        .collect()
}

/// Every scope that may hold an index: each project, then each of its instances.
fn scopes() -> Result<Vec<(String, Option<String>)>, String> {
    let mut out = Vec::new();
    for project_id in subdir_names(&projects_dir()?) {
        let instances = subdir_names(&instances_dir(&project_id)?);
        out.push((project_id.clone(), None));
        out.extend(instances.into_iter().map(|id| (project_id.clone(), Some(id))));
    }
    Ok(out)
}

fn interrupted_in<F>(
    scopes: Vec<(String, Option<String>)>,
    index_path: F,
) -> Vec<InterruptedConversation>
where
    F: Fn(&str, Option<&str>) -> Result<PathBuf, String>,
{
    let mut found = Vec::new();
    for (project_id, instance_id) in scopes {
        let Ok(path) = index_path(&project_id, instance_id.as_deref()) else { continue };
        let Some(index) = read_index(&path) else { continue };
        for conversation in index.conversations {
            if conversation.running_in.is_some() && !conversation.cli.is_empty() {
                found.push(InterruptedConversation {
                    project_id: project_id.clone(),
                    instance_id: instance_id.clone(),
                    conversation,
                });
            }
        }
    }
    found
}

/// Every conversation across projects that was running when the app closed.
#[tauri::command]
pub async fn list_interrupted_conversations() -> Result<Vec<InterruptedConversation>, String> {
    Ok(interrupted_in(scopes()?, index_file))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_index_from_before_the_cli_refonte_reads_back_without_a_cli() {
        let legacy = r#"{"conversations":[{"id":"a","title":"Old","providerId":"anthropic",
            "messageCount":12,"preview":"hello"}],"activeId":"a"}"#;
        let index: ConversationIndex = serde_json::from_str(legacy).unwrap();
        assert_eq!(index.conversations.len(), 1);
        assert_eq!(index.conversations[0].cli, "");
        assert_eq!(index.conversations[0].session_id, None);
    }

    #[test]
    fn a_conversation_round_trips_through_json() {
        let meta = ConversationMeta {
            id: "a".into(),
            title: "Fix the parser".into(),
            cli: "claude-code".into(),
            session_id: Some("3f2b1a10-0c4d-4e8a-9f11-2b3c4d5e6f70".into()),
            session_started: true,
            session_confirmed: true,
            cwd: "/repo/worktrees/x".into(),
            created_at: 1,
            last_opened_at: 2,
            last_active_at: 3,
            pinned: true,
            archived: false,
            running_in: None,
        };
        let json = serde_json::to_string(&meta).unwrap();
        assert!(json.contains("\"sessionId\""), "{json}");
        assert!(json.contains("\"lastOpenedAt\""), "{json}");
        let back: ConversationMeta = serde_json::from_str(&json).unwrap();
        assert_eq!(back.session_id.as_deref(), Some("3f2b1a10-0c4d-4e8a-9f11-2b3c4d5e6f70"));
        assert!(back.session_started);
        assert_eq!(back.cli, "claude-code");
    }

    fn write_index(path: &Path, conversations: Vec<ConversationMeta>) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let index = ConversationIndex { conversations, active_id: None };
        fs::write(path, serde_json::to_string(&index).unwrap()).unwrap();
    }

    fn conversation(id: &str, running_in: Option<&str>) -> ConversationMeta {
        ConversationMeta {
            id: id.into(),
            cli: "claude-code".into(),
            running_in: running_in.map(String::from),
            ..Default::default()
        }
    }

    #[test]
    fn only_the_conversations_still_marked_running_are_interrupted() {
        let root = std::env::temp_dir()
            .join(format!("cairn-interrupted-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let path = |project: &str, instance: Option<&str>| -> Result<PathBuf, String> {
            Ok(match instance {
                Some(id) => root.join(project).join(id).join("index.json"),
                None => root.join(project).join("index.json"),
            })
        };
        write_index(
            &path("p1", None).unwrap(),
            vec![conversation("shared", Some("i1")), conversation("idle", None)],
        );
        write_index(&path("p1", Some("i1")).unwrap(), vec![conversation("local", Some("i1"))]);

        let scopes = vec![
            ("p1".to_string(), None),
            ("p1".to_string(), Some("i1".to_string())),
            ("p2".to_string(), None),
        ];
        let mut found = interrupted_in(scopes, path);
        found.sort_by(|a, b| a.conversation.id.cmp(&b.conversation.id));
        let ids: Vec<_> = found
            .iter()
            .map(|f| (f.conversation.id.as_str(), f.instance_id.as_deref()))
            .collect();
        assert_eq!(ids, vec![("local", Some("i1")), ("shared", None)]);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn only_directories_are_taken_for_scopes() {
        let root = std::env::temp_dir()
            .join(format!("cairn-subdirs-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("p1")).unwrap();
        fs::write(root.join("projects.json"), "[]").unwrap();

        assert_eq!(subdir_names(&root), vec!["p1".to_string()]);
        assert!(subdir_names(&root.join("missing")).is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_stopped_conversation_writes_no_running_mark() {
        let json = serde_json::to_string(&conversation("a", None)).unwrap();
        assert!(!json.contains("runningIn"), "{json}");
    }
}
