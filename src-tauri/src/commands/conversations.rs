//! Agent conversations, stored per scope (project, or one instance) as a single
//! light `index.json`.
//!
//! Cairn keeps metadata only. The conversation itself is the CLI, running in a
//! PTY, and its transcript lives wherever that CLI keeps it - so there is no
//! transcript file here, and nothing to read back beyond what the history panel
//! draws.

use std::fs;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};

use crate::storage::{instance_conversations_dir, project_conversations_dir, write_json_atomic};

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
    /// Directory the CLI was launched in, kept so a resume lands in the same
    /// worktree even when the instance is reopened from elsewhere.
    #[serde(default)]
    pub cwd: String,
    #[serde(rename = "createdAt", default)]
    pub created_at: i64,
    #[serde(rename = "lastOpenedAt", default)]
    pub last_opened_at: i64,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub archived: bool,
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

/// One small read that backs the whole history panel.
#[tauri::command]
pub fn get_conversation_index(
    project_id: String,
    instance_id: Option<String>,
) -> Result<Option<ConversationIndex>, String> {
    let path = scope_dir(&project_id, instance_id.as_deref())?.join("index.json");
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
        &scope_dir(&project_id, instance_id.as_deref())?.join("index.json"),
        &index,
    )
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
            cwd: "/repo/worktrees/x".into(),
            created_at: 1,
            last_opened_at: 2,
            pinned: true,
            archived: false,
        };
        let json = serde_json::to_string(&meta).unwrap();
        assert!(json.contains("\"sessionId\""), "{json}");
        assert!(json.contains("\"lastOpenedAt\""), "{json}");
        let back: ConversationMeta = serde_json::from_str(&json).unwrap();
        assert_eq!(back.session_id.as_deref(), Some("3f2b1a10-0c4d-4e8a-9f11-2b3c4d5e6f70"));
        assert!(back.session_started);
        assert_eq!(back.cli, "claude-code");
    }
}
