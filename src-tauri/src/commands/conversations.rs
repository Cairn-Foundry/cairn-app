use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use crate::storage::{instance_conversations_dir, project_conversations_dir, write_json_atomic};

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct ConversationMeta {
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(rename = "createdAt", default)]
    pub created_at: i64,
    #[serde(rename = "updatedAt", default)]
    pub updated_at: i64,
    #[serde(rename = "lastMessageAt", default)]
    pub last_message_at: i64,
    #[serde(rename = "providerId", default)]
    pub provider_id: String,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub archived: bool,
    /// Superseded by `sessions`; still read so an existing session survives.
    #[serde(rename = "sessionId", default, skip_serializing)]
    pub session_id: Option<String>,
    /// One CLI session per provider: a session id only means something to the
    /// provider that minted it, and a conversation may talk to several.
    #[serde(default)]
    pub sessions: HashMap<String, String>,
    /// The provider that answered last here. A chat API never mints a session,
    /// so its presence in `sessions` cannot tell us whether it has spoken.
    #[serde(rename = "lastProviderId", default)]
    pub last_provider_id: String,
    #[serde(rename = "messageCount", default)]
    pub message_count: u32,
    #[serde(rename = "modelId", default)]
    pub model_id: Option<String>,
    #[serde(default)]
    pub effort: Option<String>,
    #[serde(rename = "permissionMode", default)]
    pub permission_mode: Option<String>,
    #[serde(default)]
    pub preview: String,
}


#[derive(Serialize, Deserialize, Clone, Default)]
pub struct ConversationIndex {
    #[serde(default)]
    pub conversations: Vec<ConversationMeta>,
    #[serde(rename = "activeId", default)]
    pub active_id: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct ConversationBody {
    #[serde(default)]
    pub messages: Vec<Value>,
    #[serde(default)]
    pub activity: Vec<Value>,
}

fn scope_dir(project_id: &str, instance_id: Option<&str>) -> Result<PathBuf, String> {
    match instance_id {
        Some(id) => instance_conversations_dir(project_id, id),
        None => project_conversations_dir(project_id),
    }
}

fn body_path(
    project_id: &str,
    instance_id: Option<&str>,
    conversation_id: &str,
) -> Result<PathBuf, String> {
    let valid = !conversation_id.is_empty()
        && conversation_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if !valid {
        return Err(format!("Invalid conversation id: {conversation_id}"));
    }
    Ok(scope_dir(project_id, instance_id)?.join(format!("{conversation_id}.json")))
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &PathBuf) -> Result<Option<T>, String> {
    if !path.exists() { return Ok(None); }
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map(Some).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_conversation_index(
    project_id: String,
    instance_id: Option<String>,
) -> Result<Option<ConversationIndex>, String> {
    let index: Option<ConversationIndex> =
        read_json(&scope_dir(&project_id, instance_id.as_deref())?.join("index.json"))?;
    Ok(index.map(migrate_index))
}

/// A conversation written before sessions were per provider carries a single
/// `sessionId`; it belongs to the provider that conversation was talking to.
fn migrate_index(mut index: ConversationIndex) -> ConversationIndex {
    for meta in &mut index.conversations {
        if let Some(session) = meta.session_id.take() {
            if meta.sessions.is_empty() && !meta.provider_id.is_empty() {
                meta.sessions.insert(meta.provider_id.clone(), session);
            }
        }
    }
    index
}

#[tauri::command]
pub fn save_conversation_index(
    project_id: String,
    instance_id: Option<String>,
    index: ConversationIndex,
) -> Result<(), String> {
    write_json_atomic(
        &scope_dir(&project_id, instance_id.as_deref())?.join("index.json"),
        &index,
    )
}

#[tauri::command]
pub fn get_conversation_body(
    project_id: String,
    instance_id: Option<String>,
    conversation_id: String,
) -> Result<Option<ConversationBody>, String> {
    read_json(&body_path(&project_id, instance_id.as_deref(), &conversation_id)?)
}

#[tauri::command]
pub fn save_conversation_body(
    project_id: String,
    instance_id: Option<String>,
    conversation_id: String,
    body: ConversationBody,
) -> Result<(), String> {
    write_json_atomic(
        &body_path(&project_id, instance_id.as_deref(), &conversation_id)?,
        &body,
    )
}

#[tauri::command]
pub fn delete_conversation_body(
    project_id: String,
    instance_id: Option<String>,
    conversation_id: String,
) -> Result<(), String> {
    let path = body_path(&project_id, instance_id.as_deref(), &conversation_id)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn body_path_rejects_traversal_ids() {
        assert!(body_path("p", None, "../../escape").is_err());
        assert!(body_path("p", None, "a/b").is_err());
        assert!(body_path("p", None, "").is_err());
    }

    #[test]
    fn body_path_accepts_uuid_like_ids() {
        let path = body_path("p", None, "3f2b1a10-0c4d-4e8a-9f11-2b3c4d5e6f70").unwrap();
        assert!(path.ends_with("3f2b1a10-0c4d-4e8a-9f11-2b3c4d5e6f70.json"));
    }

    fn index_from(json: &str) -> ConversationIndex {
        migrate_index(serde_json::from_str(json).unwrap())
    }

    #[test]
    fn a_legacy_session_id_becomes_the_entry_of_its_provider() {
        let index = index_from(
            r#"{"conversations":[{"id":"a","providerId":"claude-code-cli","sessionId":"s-1"}]}"#,
        );
        let meta = &index.conversations[0];
        assert_eq!(meta.sessions.get("claude-code-cli").map(String::as_str), Some("s-1"));
        assert!(meta.session_id.is_none());
    }

    #[test]
    fn an_existing_session_map_is_left_alone() {
        let index = index_from(
            r#"{"conversations":[{"id":"a","providerId":"openai",
                "sessionId":"stale","sessions":{"openai":"fresh"}}]}"#,
        );
        assert_eq!(index.conversations[0].sessions.get("openai").map(String::as_str), Some("fresh"));
    }

    #[test]
    fn a_session_without_a_provider_is_dropped_rather_than_misfiled() {
        let index = index_from(r#"{"conversations":[{"id":"a","sessionId":"s-1"}]}"#);
        assert!(index.conversations[0].sessions.is_empty());
    }

    #[test]
    fn the_legacy_field_is_no_longer_written_back() {
        let index = index_from(
            r#"{"conversations":[{"id":"a","providerId":"openai","sessionId":"s-1"}]}"#,
        );
        let json = serde_json::to_string(&index).unwrap();
        assert!(!json.contains("sessionId"), "{json}");
        assert!(json.contains("\"sessions\""), "{json}");
    }
}
