use std::fs;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use crate::storage::{
    instance_conversations_dir, instances_file, project_conversations_dir, usage_file,
    write_json_atomic,
};
use super::conversations::{ConversationBody, ConversationIndex};
use super::instances::StoredInstance;
use super::projects::read_projects;

/// How many turns the ledger keeps. A turn weighs about 300 bytes, so this is a
/// few megabytes at worst - enough for a year of heavy use, and the stats page
/// never needs more history than a user can remember having produced.
const LEDGER_LIMIT: usize = 20_000;

/// One answered turn, with what it consumed. Everything the stats page groups by
/// is denormalized onto the entry: a project can be removed, a conversation
/// deleted or an agent renamed, and what was spent still has to read correctly.
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct UsageEntry {
    pub id: String,
    /// When the turn came back, in milliseconds.
    #[serde(default)]
    pub ts: i64,
    #[serde(default)]
    pub project_id: String,
    #[serde(default)]
    pub project_name: String,
    #[serde(default)]
    pub instance_id: String,
    #[serde(default)]
    pub instance_name: String,
    #[serde(default)]
    pub conversation_id: String,
    #[serde(default)]
    pub conversation_title: String,
    #[serde(default)]
    pub scope: String,
    #[serde(default)]
    pub provider_id: String,
    #[serde(default)]
    pub model: String,
    /// Set when the turn was answered by a custom agent rather than the
    /// conversation's own provider.
    #[serde(default)]
    pub agent_id: String,
    #[serde(default)]
    pub agent_name: String,
    #[serde(default)]
    pub input_tokens: i64,
    #[serde(default)]
    pub output_tokens: i64,
    #[serde(default)]
    pub cache_read_tokens: i64,
    #[serde(default)]
    pub cache_creation_tokens: i64,
    #[serde(default)]
    pub cost_usd: f64,
    #[serde(default)]
    pub duration_ms: i64,
    #[serde(default)]
    pub num_turns: i64,
    /// Set on a turn recovered from a conversation written before the ledger
    /// existed. Such a turn carries no timestamp of its own, so it is dated at
    /// the conversation's last activity and the stats page says so.
    #[serde(default)]
    pub backfilled: bool,
}

fn read_ledger() -> Result<Vec<UsageEntry>, String> {
    let path = usage_file()?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

/// Folds new turns into the ledger: an id already recorded is left untouched -
/// a run is replayed to the frontend whenever its conversation is reopened
/// mid-answer, and a backfill may be asked for twice. The result is kept in
/// chronological order, so trimming to the limit only ever drops old history.
fn merge(mut ledger: Vec<UsageEntry>, incoming: Vec<UsageEntry>) -> Vec<UsageEntry> {
    for entry in incoming {
        if ledger.iter().any(|e| e.id == entry.id) {
            continue;
        }
        ledger.push(entry);
    }
    ledger.sort_by_key(|e| e.ts);
    if ledger.len() > LEDGER_LIMIT {
        ledger.drain(..ledger.len() - LEDGER_LIMIT);
    }
    ledger
}

#[tauri::command]
pub fn get_usage_entries() -> Result<Vec<UsageEntry>, String> {
    read_ledger()
}

/// Appends turns to the ledger, ignoring any id already recorded. The frontend
/// replays a run when a conversation is reopened mid-answer, so the same turn
/// can be handed over twice.
#[tauri::command]
pub async fn append_usage_entries(entries: Vec<UsageEntry>) -> Result<(), String> {
    if entries.is_empty() {
        return Ok(());
    }
    let ledger = merge(read_ledger()?, entries);
    write_json_atomic(&usage_file()?, &ledger)
}

fn num(value: &Value, key: &str) -> i64 {
    value.get(key).and_then(Value::as_i64).unwrap_or(0)
}

fn read_json<T: serde::de::DeserializeOwned>(path: &PathBuf) -> Option<T> {
    let content = fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

/// Turns one stored conversation into ledger entries: one per answer that
/// recorded what it consumed. A turn written since messages carry a timestamp
/// is dated by its own; an older one only ever recorded a clock face, so it
/// falls back to the conversation's last activity and says it is approximate.
fn entries_from_conversation(
    dir: &Path,
    project_id: &str,
    project_name: &str,
    instance_id: &str,
    instance_name: &str,
    scope: &str,
) -> Vec<UsageEntry> {
    let Some(index) = read_json::<ConversationIndex>(&dir.join("index.json")) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for meta in index.conversations {
        let Some(body) = read_json::<ConversationBody>(&dir.join(format!("{}.json", meta.id)))
        else {
            continue;
        };
        let fallback =
            if meta.last_message_at > 0 { meta.last_message_at } else { meta.updated_at };
        for (i, message) in body.messages.iter().enumerate() {
            let Some(usage) = message.get("usage").filter(|u| u.is_object()) else {
                continue;
            };
            let own_ts = message.get("ts").and_then(Value::as_i64).filter(|ts| *ts > 0);
            out.push(UsageEntry {
                id: format!("backfill:{project_id}:{scope}:{}:{i}", meta.id),
                ts: own_ts.unwrap_or(fallback),
                project_id: project_id.into(),
                project_name: project_name.into(),
                instance_id: instance_id.into(),
                instance_name: instance_name.into(),
                conversation_id: meta.id.clone(),
                conversation_title: meta.title.clone(),
                scope: scope.into(),
                provider_id: if meta.last_provider_id.is_empty() {
                    meta.provider_id.clone()
                } else {
                    meta.last_provider_id.clone()
                },
                model: usage
                    .get("model")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                agent_id: String::new(),
                agent_name: String::new(),
                input_tokens: num(usage, "inputTokens"),
                output_tokens: num(usage, "outputTokens"),
                cache_read_tokens: num(usage, "cacheReadTokens"),
                cache_creation_tokens: num(usage, "cacheCreationTokens"),
                cost_usd: usage.get("costUsd").and_then(Value::as_f64).unwrap_or(0.0),
                duration_ms: num(usage, "durationMs"),
                num_turns: num(usage, "numTurns"),
                backfilled: own_ts.is_none(),
            });
        }
    }
    out
}

/// Recovers every turn already on disk that the ledger never saw, so the stats
/// page opens on real history instead of an empty page. Idempotent: entries
/// carry a stable id, so running it again adds nothing. Returns how many turns
/// were added.
#[tauri::command]
pub async fn backfill_usage_entries() -> Result<usize, String> {
    let mut found = Vec::new();
    for project in read_projects()? {
        found.extend(entries_from_conversation(
            &project_conversations_dir(&project.id)?,
            &project.id,
            &project.name,
            "",
            "",
            "project",
        ));
        let instances: Vec<StoredInstance> =
            read_json(&instances_file(&project.id)?).unwrap_or_default();
        for instance in instances {
            found.extend(entries_from_conversation(
                &instance_conversations_dir(&project.id, &instance.id)?,
                &project.id,
                &project.name,
                &instance.id,
                &instance.ticket.title,
                "instance",
            ));
        }
    }

    let ledger = read_ledger()?;
    let before = ledger.len();
    let merged = merge(ledger, found);
    let added = merged.len().saturating_sub(before);
    write_json_atomic(&usage_file()?, &merged)?;
    Ok(added)
}

#[tauri::command]
pub fn clear_usage_entries() -> Result<(), String> {
    write_json_atomic(&usage_file()?, &Vec::<UsageEntry>::new())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: &str, ts: i64) -> UsageEntry {
        UsageEntry { id: id.into(), ts, ..Default::default() }
    }

    #[test]
    fn the_ledger_drops_the_oldest_entries_first() {
        let entries: Vec<UsageEntry> =
            (0..LEDGER_LIMIT + 5).map(|i| entry(&format!("t{i}"), i as i64)).collect();
        let kept = merge(Vec::new(), entries);
        assert_eq!(kept.len(), LEDGER_LIMIT);
        assert_eq!(kept[0].id, "t5");
        assert_eq!(kept[LEDGER_LIMIT - 1].id, format!("t{}", LEDGER_LIMIT + 4));
    }

    #[test]
    fn a_turn_already_recorded_is_never_counted_twice() {
        let ledger = merge(vec![entry("a", 1)], vec![entry("a", 1), entry("b", 2)]);
        assert_eq!(ledger.len(), 2);
        assert_eq!(ledger[1].id, "b");
    }

    #[test]
    fn backfilled_history_lands_before_what_the_ledger_already_holds() {
        let ledger = merge(vec![entry("live", 500)], vec![entry("old", 100)]);
        assert_eq!(ledger[0].id, "old");
        assert_eq!(ledger[1].id, "live");
    }
}
