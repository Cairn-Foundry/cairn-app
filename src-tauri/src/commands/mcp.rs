use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::commands::agent::platform::{new_command, resolve_binary};
use crate::commands::cli_providers::{
    mcp_locations, mcp_providers_at, unique_providers, McpLocation, McpStore, ANTIGRAVITY,
    CLAUDE_CODE, CLI_PROVIDERS, CODEX, VIBE,
};

const PROTOCOL_VERSION: &str = "2025-06-18";
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(20);
const LIST_TIMEOUT: Duration = Duration::from_secs(10);

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

/// One file a server is declared in, and the agents that read that file.
/// `.mcp.json` is read by Claude Code and Copilot alike, so a location carries
/// a list rather than a single provider.
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct McpServerLocation {
    pub path: String,
    pub providers: Vec<String>,
    pub dialect: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct McpServer {
    #[serde(default)]
    pub id: String,
    pub name: String,
    /// `user` (every project), `local` (this project, only you - Claude Code
    /// alone has it) or `project` (committed with the repository).
    pub scope: String,
    #[serde(default)]
    pub project_id: String,
    #[serde(default)]
    pub project_name: String,
    #[serde(default)]
    pub project_path: String,
    pub transport: String,
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
    /// Only Codex and Vibe carry an off switch on the entry itself; the others
    /// are always on once declared.
    #[serde(default = "yes")]
    pub enabled: bool,
    /// `approved`, `rejected` or `pending`. Only a Claude `.mcp.json` server
    /// has one: it is the only kind Claude Code asks you to accept.
    #[serde(default)]
    pub approval: String,
    /// The agents this server should be declared for. Empty on a read; the UI
    /// fills it to say where a save should land.
    #[serde(default)]
    pub targets: Vec<String>,
    #[serde(default)]
    pub locations: Vec<McpServerLocation>,
    #[serde(default)]
    pub providers: Vec<String>,
    /// Two declarations of this server disagree. Saving realigns them.
    #[serde(default)]
    pub divergent: bool,
    #[serde(default)]
    pub source_path: String,
}

fn yes() -> bool {
    true
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct McpProject {
    pub id: String,
    pub name: String,
    pub path: String,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct McpTool {
    pub name: String,
    pub description: String,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct McpProbe {
    pub ok: bool,
    pub error: String,
    pub server_name: String,
    pub server_version: String,
    pub protocol_version: String,
    pub tools: Vec<McpTool>,
    pub prompt_count: usize,
    pub resource_count: usize,
    pub duration_ms: u64,
    /// The server answered, but this transport cannot enumerate what it offers.
    pub partial: bool,
    pub logs: String,
}

// ---------------------------------------------------------------------------
// Documents: JSON and TOML, read and written without disturbing the rest
// ---------------------------------------------------------------------------

fn claude_json_path() -> Result<PathBuf, String> {
    Ok(dirs::home_dir()
        .ok_or("Cannot resolve home directory")?
        .join(".claude.json"))
}

fn read_json_doc(path: &Path) -> Result<Value, String> {
    if !path.exists() {
        return Ok(Value::Object(Map::new()));
    }
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    if raw.trim().is_empty() {
        return Ok(Value::Object(Map::new()));
    }
    serde_json::from_str(&raw).map_err(|e| format!("{} is not readable: {e}", path.display()))
}

/// Walks a slash-separated pointer, creating the objects it crosses. Only the
/// collection at the end is ever replaced: `~/.claude.json` carries the CLI's
/// whole state and everything beside the MCP keys is written back untouched.
fn json_collection<'a>(root: &'a mut Value, pointer: &[String]) -> &'a mut Map<String, Value> {
    let mut node = root;
    for segment in pointer {
        if !node.is_object() {
            *node = Value::Object(Map::new());
        }
        let map = node.as_object_mut().expect("just made an object");
        map.entry(segment.clone())
            .or_insert_with(|| Value::Object(Map::new()));
        node = map.get_mut(segment).expect("just inserted");
    }
    if !node.is_object() {
        *node = Value::Object(Map::new());
    }
    node.as_object_mut().expect("just made an object")
}

fn json_collection_ref<'a>(root: &'a Value, pointer: &[String]) -> Option<&'a Map<String, Value>> {
    let mut node = root;
    for segment in pointer {
        node = node.get(segment)?;
    }
    node.as_object()
}

fn read_toml_doc(path: &Path) -> Result<toml_edit::DocumentMut, String> {
    if !path.exists() {
        return Ok(toml_edit::DocumentMut::new());
    }
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    raw.parse::<toml_edit::DocumentMut>()
        .map_err(|e| format!("{} is not readable: {e}", path.display()))
}

/// Written through `toml_edit` rather than re-serialized, so the comments and
/// the layout of a config file people edit by hand survive the round trip.
fn write_toml_doc(path: &Path, doc: &toml_edit::DocumentMut) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension(format!("tmp.{}", std::process::id()));
    fs::write(&tmp, doc.to_string()).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })
}

fn toml_to_json(item: &toml_edit::Item) -> Value {
    match item {
        toml_edit::Item::Value(value) => toml_value_to_json(value),
        toml_edit::Item::Table(table) => Value::Object(
            table
                .iter()
                .map(|(k, v)| (k.to_string(), toml_to_json(v)))
                .collect(),
        ),
        toml_edit::Item::ArrayOfTables(array) => Value::Array(
            array
                .iter()
                .map(|t| {
                    Value::Object(
                        t.iter()
                            .map(|(k, v)| (k.to_string(), toml_to_json(v)))
                            .collect(),
                    )
                })
                .collect(),
        ),
        toml_edit::Item::None => Value::Null,
    }
}

fn toml_value_to_json(value: &toml_edit::Value) -> Value {
    match value {
        toml_edit::Value::String(s) => json!(s.value()),
        toml_edit::Value::Integer(i) => json!(i.value()),
        toml_edit::Value::Float(f) => json!(f.value()),
        toml_edit::Value::Boolean(b) => json!(b.value()),
        toml_edit::Value::Datetime(d) => json!(d.value().to_string()),
        toml_edit::Value::Array(a) => Value::Array(a.iter().map(toml_value_to_json).collect()),
        toml_edit::Value::InlineTable(t) => Value::Object(
            t.iter()
                .map(|(k, v)| (k.to_string(), toml_value_to_json(v)))
                .collect(),
        ),
    }
}

fn json_to_toml(value: &Value) -> Option<toml_edit::Value> {
    Some(match value {
        Value::String(s) => toml_edit::Value::from(s.as_str()),
        Value::Bool(b) => toml_edit::Value::from(*b),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                toml_edit::Value::from(i)
            } else {
                toml_edit::Value::from(n.as_f64()?)
            }
        }
        Value::Array(items) => {
            let mut array = toml_edit::Array::new();
            for item in items {
                array.push(json_to_toml(item)?);
            }
            toml_edit::Value::Array(array)
        }
        Value::Object(map) => {
            let mut table = toml_edit::InlineTable::new();
            for (key, item) in map {
                table.insert(key, json_to_toml(item)?);
            }
            toml_edit::Value::InlineTable(table)
        }
        Value::Null => return None,
    })
}

/// Everything declared in one location, as neutral JSON whatever the file is.
fn read_location(loc: &McpLocation) -> Vec<(String, Value)> {
    match loc.store {
        McpStore::JsonMap => {
            let Ok(doc) = read_json_doc(&loc.path) else { return Vec::new() };
            json_collection_ref(&doc, &loc.pointer)
                .map(|map| map.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
                .unwrap_or_default()
        }
        McpStore::TomlTable => {
            let Ok(doc) = read_toml_doc(&loc.path) else { return Vec::new() };
            let Some(table) = doc.get(&loc.pointer[0]).and_then(|i| i.as_table_like()) else {
                return Vec::new();
            };
            table
                .iter()
                .map(|(name, item)| (name.to_string(), toml_to_json(item)))
                .collect()
        }
        McpStore::TomlArray => {
            let Ok(doc) = read_toml_doc(&loc.path) else { return Vec::new() };
            let Value::Array(items) = doc
                .get(&loc.pointer[0])
                .map(toml_to_json)
                .unwrap_or(Value::Null)
            else {
                return Vec::new();
            };
            items
                .into_iter()
                .filter_map(|entry| {
                    let name = entry.get("name")?.as_str()?.to_string();
                    Some((name, entry))
                })
                .collect()
        }
    }
}

// ---------------------------------------------------------------------------
// Dialects: the same server, spelled the way each agent expects
// ---------------------------------------------------------------------------

fn string_list(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(|v| v.as_array())
        .map(|items| items.iter().filter_map(|i| i.as_str().map(String::from)).collect())
        .unwrap_or_default()
}

fn map_of_strings(value: Option<&Value>) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    let Some(map) = value.and_then(|v| v.as_object()) else { return out };
    for (key, item) in map {
        out.insert(
            key.clone(),
            match item {
                Value::String(s) => s.clone(),
                other => other.to_string(),
            },
        );
    }
    out
}

fn text(entry: &Value, key: &str) -> String {
    entry.get(key).and_then(|v| v.as_str()).unwrap_or_default().to_string()
}

/// Vibe allows `command` to be a whole argv rather than a program name.
fn command_and_args(entry: &Value) -> (String, Vec<String>) {
    let mut args = string_list(entry.get("args"));
    match entry.get("command") {
        Some(Value::Array(items)) => {
            let mut argv: Vec<String> = items.iter().filter_map(|i| i.as_str().map(String::from)).collect();
            let command = if argv.is_empty() { String::new() } else { argv.remove(0) };
            argv.append(&mut args);
            (command, argv)
        }
        _ => (text(entry, "command"), args),
    }
}

fn decode(dialect: &str, name: &str, entry: &Value) -> McpServer {
    let (command, args) = command_and_args(entry);
    let mut server = McpServer {
        name: name.to_string(),
        command,
        args,
        env: map_of_strings(entry.get("env")),
        enabled: true,
        ..Default::default()
    };

    match dialect {
        CODEX => {
            server.url = text(entry, "url");
            server.headers = map_of_strings(entry.get("http_headers"));
            server.transport = if server.url.is_empty() { "stdio" } else { "http" }.into();
            server.enabled = entry.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true);
        }
        ANTIGRAVITY => {
            server.url = text(entry, "serverUrl");
            server.transport = if server.url.is_empty() { "stdio" } else { "sse" }.into();
        }
        VIBE => {
            server.url = text(entry, "url");
            server.headers = entry
                .get("auth")
                .map(|auth| map_of_strings(auth.get("headers")))
                .unwrap_or_default();
            server.transport = match text(entry, "transport").as_str() {
                "streamable-http" => "http",
                "http" => "sse",
                _ => "stdio",
            }
            .into();
            server.enabled = !entry.get("disabled").and_then(|v| v.as_bool()).unwrap_or(false);
        }
        // Claude Code, and Copilot which reads the same spelling.
        _ => {
            server.url = text(entry, "url");
            server.headers = map_of_strings(entry.get("headers"));
            let declared = text(entry, "type");
            server.transport = match declared.as_str() {
                "stdio" | "http" | "sse" => declared,
                // The type is optional in the wild: a url means remote.
                _ if !server.url.is_empty() => "http".into(),
                _ => "stdio".into(),
            };
        }
    }
    server
}

/// The keys Cairn owns in a given dialect. Anything else found in an existing
/// entry is left exactly as it was.
fn managed_keys(dialect: &str) -> &'static [&'static str] {
    match dialect {
        CODEX => &["command", "args", "env", "url", "http_headers", "enabled"],
        ANTIGRAVITY => &["command", "args", "env", "serverUrl"],
        VIBE => &["name", "transport", "command", "args", "env", "url", "auth", "disabled"],
        _ => &["type", "command", "args", "env", "url", "headers"],
    }
}

fn encode(dialect: &str, server: &McpServer, existing: Option<&Value>) -> Value {
    let is_stdio = server.transport == "stdio";
    let mut entry = Map::new();

    // Whatever this agent understands and Cairn does not stays where it was.
    if let Some(Value::Object(previous)) = existing {
        for (key, value) in previous {
            if !managed_keys(dialect).contains(&key.as_str()) {
                entry.insert(key.clone(), value.clone());
            }
        }
    }

    match dialect {
        CODEX => {
            if is_stdio {
                entry.insert("command".into(), json!(server.command.trim()));
                entry.insert("args".into(), json!(server.args));
                entry.insert("env".into(), json!(server.env));
            } else {
                entry.insert("url".into(), json!(server.url.trim()));
                if !server.headers.is_empty() {
                    entry.insert("http_headers".into(), json!(server.headers));
                }
            }
            if !server.enabled {
                entry.insert("enabled".into(), json!(false));
            }
        }
        ANTIGRAVITY => {
            if is_stdio {
                entry.insert("command".into(), json!(server.command.trim()));
                entry.insert("args".into(), json!(server.args));
                entry.insert("env".into(), json!(server.env));
            } else {
                entry.insert("serverUrl".into(), json!(server.url.trim()));
            }
        }
        VIBE => {
            entry.insert("name".into(), json!(server.name.trim()));
            entry.insert(
                "transport".into(),
                json!(match server.transport.as_str() {
                    "stdio" => "stdio",
                    // Vibe calls the modern transport streamable-http and keeps
                    // plain http for the one-endpoint style Cairn shows as SSE.
                    "http" => "streamable-http",
                    _ => "http",
                }),
            );
            if is_stdio {
                entry.insert("command".into(), json!(server.command.trim()));
                entry.insert("args".into(), json!(server.args));
                entry.insert("env".into(), json!(server.env));
            } else {
                entry.insert("url".into(), json!(server.url.trim()));
                if !server.headers.is_empty() {
                    entry.insert(
                        "auth".into(),
                        json!({ "type": "static", "headers": server.headers }),
                    );
                }
            }
            if !server.enabled {
                entry.insert("disabled".into(), json!(true));
            }
        }
        _ => {
            entry.insert("type".into(), json!(server.transport));
            if is_stdio {
                entry.insert("command".into(), json!(server.command.trim()));
                entry.insert("args".into(), json!(server.args));
                entry.insert("env".into(), json!(server.env));
            } else {
                entry.insert("url".into(), json!(server.url.trim()));
                if !server.headers.is_empty() {
                    entry.insert("headers".into(), json!(server.headers));
                }
            }
        }
    }
    Value::Object(entry)
}

// ---------------------------------------------------------------------------
// Writing one location
// ---------------------------------------------------------------------------

fn toml_table(entry: &Value) -> toml_edit::Table {
    let mut table = toml_edit::Table::new();
    if let Value::Object(map) = entry {
        for (key, value) in map {
            if let Some(item) = json_to_toml(value) {
                table.insert(key, toml_edit::Item::Value(item));
            }
        }
    }
    table
}

fn toml_inline_table(entry: &Value) -> toml_edit::InlineTable {
    let mut table = toml_edit::InlineTable::new();
    if let Value::Object(map) = entry {
        for (key, value) in map {
            if let Some(item) = json_to_toml(value) {
                table.insert(key, item);
            }
        }
    }
    table
}

/// A TOML key can be spelled two ways and a config ships with either: Vibe
/// starts life with `mcp_servers = []` - an empty *inline* array, not an array
/// of tables - and a table key could equally arrive as `mcp_servers = {}`.
/// An empty one becomes the sectioned form both documentations show. The key is
/// removed and re-added rather than having its value swapped, because the
/// spacing of `mcp_servers = []` would otherwise survive into the header and
/// print as `[[mcp_servers ]]`.
fn promote_empty_inline(doc: &mut toml_edit::DocumentMut, key: &str, array: bool) {
    let empty = doc.get(key).is_some_and(|item| {
        if array {
            item.as_array().is_some_and(|a| a.is_empty())
        } else {
            item.as_inline_table().is_some_and(|t| t.is_empty())
        }
    });
    if !empty {
        return;
    }
    doc.remove(key);
    let fresh = if array {
        toml_edit::Item::ArrayOfTables(toml_edit::ArrayOfTables::new())
    } else {
        toml_edit::Item::Table(toml_edit::Table::new())
    };
    doc.insert(key, fresh);
}

fn upsert(loc: &McpLocation, name: &str, server: &McpServer) -> Result<(), String> {
    match loc.store {
        McpStore::JsonMap => {
            let mut doc = read_json_doc(&loc.path)?;
            let existing = json_collection_ref(&doc, &loc.pointer)
                .and_then(|map| map.get(name))
                .cloned();
            let entry = encode(loc.dialect, server, existing.as_ref());
            json_collection(&mut doc, &loc.pointer).insert(name.to_string(), entry);
            crate::storage::write_json_atomic(&loc.path, &doc)
        }
        McpStore::TomlTable => {
            let mut doc = read_toml_doc(&loc.path)?;
            let existing = doc
                .get(&loc.pointer[0])
                .and_then(|i| i.as_table_like())
                .and_then(|t| t.get(name))
                .map(toml_to_json);
            let entry = encode(loc.dialect, server, existing.as_ref());

            promote_empty_inline(&mut doc, &loc.pointer[0], false);
            let root = doc
                .entry(&loc.pointer[0])
                .or_insert(toml_edit::Item::Table(toml_edit::Table::new()));
            if let Some(table) = root.as_table_mut() {
                table.set_implicit(true);
                table.insert(name, toml_edit::Item::Table(toml_table(&entry)));
            } else if let Some(table) = root.as_inline_table_mut() {
                table.insert(name, toml_edit::Value::InlineTable(toml_inline_table(&entry)));
            } else {
                return Err(format!("{} is not a table in {}", loc.pointer[0], loc.path.display()));
            }
            write_toml_doc(&loc.path, &doc)
        }
        McpStore::TomlArray => {
            let mut doc = read_toml_doc(&loc.path)?;
            let existing = read_location(loc)
                .into_iter()
                .find(|(n, _)| n == name)
                .map(|(_, v)| v);
            let entry = encode(loc.dialect, server, existing.as_ref());

            promote_empty_inline(&mut doc, &loc.pointer[0], true);
            let root = doc
                .entry(&loc.pointer[0])
                .or_insert(toml_edit::Item::ArrayOfTables(toml_edit::ArrayOfTables::new()));

            if let Some(array) = root.as_array_of_tables_mut() {
                let written = toml_table(&entry);
                let at = array
                    .iter()
                    .position(|t| t.get("name").and_then(|n| n.as_str()) == Some(name));
                match at {
                    Some(index) => *array.get_mut(index).expect("just found") = written,
                    None => array.push(written),
                }
            } else if let Some(array) = root.as_array_mut() {
                // Already written as inline tables: keep that style.
                let written = toml_edit::Value::InlineTable(toml_inline_table(&entry));
                let at = array.iter().position(|v| {
                    v.as_inline_table()
                        .and_then(|t| t.get("name"))
                        .and_then(|n| n.as_str())
                        == Some(name)
                });
                match at {
                    Some(index) => {
                        array.replace(index, written);
                    }
                    None => array.push(written),
                }
            } else {
                return Err(format!("{} is not an array in {}", loc.pointer[0], loc.path.display()));
            }
            write_toml_doc(&loc.path, &doc)
        }
    }
}

fn remove(loc: &McpLocation, name: &str) -> Result<(), String> {
    if !loc.path.exists() {
        return Ok(());
    }
    match loc.store {
        McpStore::JsonMap => {
            let mut doc = read_json_doc(&loc.path)?;
            if json_collection_ref(&doc, &loc.pointer).is_none_or(|m| !m.contains_key(name)) {
                return Ok(());
            }
            json_collection(&mut doc, &loc.pointer).remove(name);
            crate::storage::write_json_atomic(&loc.path, &doc)
        }
        McpStore::TomlTable => {
            let mut doc = read_toml_doc(&loc.path)?;
            let Some(table) = doc.get_mut(&loc.pointer[0]).and_then(|i| i.as_table_like_mut()) else {
                return Ok(());
            };
            if table.remove(name).is_none() {
                return Ok(());
            }
            write_toml_doc(&loc.path, &doc)
        }
        McpStore::TomlArray => {
            let mut doc = read_toml_doc(&loc.path)?;
            let Some(root) = doc.get_mut(&loc.pointer[0]) else {
                return Ok(());
            };
            if let Some(array) = root.as_array_mut() {
                let before = array.len();
                array.retain(|v| {
                    v.as_inline_table()
                        .and_then(|t| t.get("name"))
                        .and_then(|n| n.as_str())
                        != Some(name)
                });
                if array.len() == before {
                    return Ok(());
                }
                return write_toml_doc(&loc.path, &doc);
            }
            let Some(array) = root.as_array_of_tables_mut() else {
                return Ok(());
            };
            let before = array.len();
            array.retain(|t| t.get("name").and_then(|n| n.as_str()) != Some(name));
            if array.len() == before {
                return Ok(());
            }
            write_toml_doc(&loc.path, &doc)
        }
    }
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

fn approval_lists(project_path: &str) -> (Vec<String>, Vec<String>) {
    let Ok(path) = claude_json_path() else { return (Vec::new(), Vec::new()) };
    let Ok(doc) = read_json_doc(&path) else { return (Vec::new(), Vec::new()) };
    let node = doc.get("projects").and_then(|p| p.get(project_path));
    (
        string_list(node.and_then(|n| n.get("enabledMcpjsonServers"))),
        string_list(node.and_then(|n| n.get("disabledMcpjsonServers"))),
    )
}

/// Scans every file of every agent for one scope, folding the copies of a
/// server into a single entry that knows where it lives.
fn scan_scope(
    scope: &str,
    project: Option<&McpProject>,
    project_path: &str,
    out: &mut Vec<McpServer>,
) {
    let mut seen: BTreeSet<(PathBuf, Vec<String>)> = BTreeSet::new();
    let mut groups: BTreeMap<String, Vec<(McpLocation, Value)>> = BTreeMap::new();

    for provider in CLI_PROVIDERS {
        for loc in mcp_locations(provider.id, scope, project_path) {
            let key = (loc.path.clone(), loc.pointer.clone());
            if !seen.insert(key) {
                continue;
            }
            for (name, entry) in read_location(&loc) {
                groups.entry(name).or_default().push((loc.clone(), entry));
            }
        }
    }

    let (approved, rejected) = if scope == "project" { approval_lists(project_path) } else { (Vec::new(), Vec::new()) };

    for (name, copies) in groups {
        let Some((first_loc, first_entry)) = copies.first() else { continue };
        let mut server = decode(first_loc.dialect, &name, first_entry);
        let project_id = project.map(|p| p.id.clone()).unwrap_or_default();

        server.id = format!("{scope}:{project_id}:{name}");
        server.scope = scope.to_string();
        server.project_id = project_id;
        server.project_name = project.map(|p| p.name.clone()).unwrap_or_default();
        server.project_path = project_path.to_string();
        server.source_path = first_loc.path.to_string_lossy().to_string();

        server.locations = copies
            .iter()
            .map(|(loc, _)| McpServerLocation {
                path: loc.path.to_string_lossy().to_string(),
                providers: mcp_providers_at(&loc.path, &loc.pointer, scope, project_path),
                dialect: loc.dialect.to_string(),
            })
            .collect();
        server.providers =
            unique_providers(server.locations.iter().flat_map(|l| l.providers.clone()));
        server.targets = server.providers.clone();

        // Two agents can hold the same server with different arguments; that is
        // worth saying rather than silently showing only the first.
        server.divergent = copies.iter().any(|(loc, entry)| {
            let other = decode(loc.dialect, &name, entry);
            other.transport != server.transport
                || other.command != server.command
                || other.args != server.args
                || other.url != server.url
                || other.env != server.env
        });

        if scope == "project" && server.providers.iter().any(|p| p == CLAUDE_CODE) {
            server.approval = if rejected.contains(&name) {
                "rejected".into()
            } else if approved.contains(&name) {
                "approved".into()
            } else {
                "pending".into()
            };
        }

        out.push(server);
    }
}

#[tauri::command]
pub async fn list_mcp_servers(projects: Vec<McpProject>) -> Result<Vec<McpServer>, String> {
    let mut out = Vec::new();
    scan_scope("user", None, "", &mut out);
    for project in &projects {
        scan_scope("local", Some(project), &project.path, &mut out);
        scan_scope("project", Some(project), &project.path, &mut out);
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

fn validate(server: &McpServer) -> Result<(), String> {
    if server.name.trim().is_empty() {
        return Err("A server needs a name".to_string());
    }
    if server.transport == "stdio" {
        if server.command.trim().is_empty() {
            return Err("A stdio server needs a command".to_string());
        }
    } else if server.url.trim().is_empty() {
        return Err("A remote server needs a URL".to_string());
    }
    if server.scope != "user" && server.project_path.trim().is_empty() {
        return Err("That scope needs a project".to_string());
    }
    Ok(())
}

/// The files the chosen agents are written to, deduplicated: `.mcp.json` serves
/// Claude Code and Copilot at once and is written a single time.
fn write_locations(server: &McpServer) -> Result<Vec<McpLocation>, String> {
    if server.targets.is_empty() {
        return Err("Pick at least one agent for this server".to_string());
    }
    let mut out: Vec<McpLocation> = Vec::new();
    for target in &server.targets {
        let Some(loc) = mcp_locations(target, &server.scope, &server.project_path).into_iter().next()
        else {
            return Err(format!("{target} has no {} MCP configuration", server.scope));
        };
        if !out.iter().any(|l| l.path == loc.path && l.pointer == loc.pointer) {
            out.push(loc);
        }
    }
    Ok(out)
}

/// Every file the server is currently declared in, whether or not it stays.
fn previous_locations(previous: &McpServer) -> Vec<McpLocation> {
    let mut out: Vec<McpLocation> = Vec::new();
    for provider in CLI_PROVIDERS {
        for loc in mcp_locations(provider.id, &previous.scope, &previous.project_path) {
            let declared = previous
                .locations
                .iter()
                .any(|l| Path::new(&l.path) == loc.path);
            if declared && !out.iter().any(|l| l.path == loc.path && l.pointer == loc.pointer) {
                out.push(loc);
            }
        }
    }
    out
}

#[tauri::command]
pub async fn save_mcp_server(
    original: Option<McpServer>,
    server: McpServer,
) -> Result<(), String> {
    validate(&server)?;
    let name = server.name.trim().to_string();
    let targets = write_locations(&server)?;

    // A rename, a scope change or an agent dropped from the list: the old
    // declaration goes before the new one is written.
    if let Some(previous) = &original {
        let renamed = previous.name != name
            || previous.scope != server.scope
            || previous.project_path != server.project_path;
        for loc in previous_locations(previous) {
            let kept = !renamed
                && targets.iter().any(|t| t.path == loc.path && t.pointer == loc.pointer);
            if !kept {
                remove(&loc, &previous.name)?;
            }
        }
    }

    for loc in &targets {
        upsert(loc, &name, &server)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn delete_mcp_server(server: McpServer) -> Result<(), String> {
    for loc in previous_locations(&server) {
        remove(&loc, &server.name)?;
    }
    Ok(())
}

/// Approving or rejecting a committed server is the one switch Claude Code
/// has: the two lists it keeps per project, kept mutually exclusive here.
#[tauri::command]
pub async fn set_mcp_approval(
    project_path: String,
    name: String,
    approved: bool,
) -> Result<(), String> {
    let path = claude_json_path()?;
    let mut doc = read_json_doc(&path)?;
    let node = json_collection(&mut doc, &["projects".to_string(), project_path]);

    let mut enabled = string_list(node.get("enabledMcpjsonServers"));
    let mut disabled = string_list(node.get("disabledMcpjsonServers"));
    enabled.retain(|n| n != &name);
    disabled.retain(|n| n != &name);
    if approved {
        enabled.push(name);
    } else {
        disabled.push(name);
    }
    node.insert("enabledMcpjsonServers".into(), json!(enabled));
    node.insert("disabledMcpjsonServers".into(), json!(disabled));

    crate::storage::write_json_atomic(&path, &doc)
}

/// Accepts either a bare `{ "name": {...} }` map or the `{ "mcpServers": {...} }`
/// wrapper every documentation snippet is written with.
#[tauri::command]
pub async fn import_mcp_servers(
    scope: String,
    project_id: String,
    project_path: String,
    targets: Vec<String>,
    raw: String,
) -> Result<Vec<String>, String> {
    let parsed: Value = serde_json::from_str(&raw).map_err(|e| format!("Invalid JSON: {e}"))?;
    let source = parsed.get("mcpServers").unwrap_or(&parsed);
    let Some(entries) = source.as_object() else {
        return Err("No server found in that JSON".to_string());
    };
    if entries.is_empty() {
        return Err("No server found in that JSON".to_string());
    }

    let mut imported = Vec::new();
    for (name, entry) in entries {
        let mut server = decode(CLAUDE_CODE, name, entry);
        server.scope = scope.clone();
        server.project_id = project_id.clone();
        server.project_path = project_path.clone();
        server.targets = targets.clone();
        validate(&server)?;
        save_mcp_server(None, server).await?;
        imported.push(name.clone());
    }
    Ok(imported)
}

#[tauri::command]
pub async fn export_mcp_servers(servers: Vec<McpServer>) -> Result<String, String> {
    let mut map = Map::new();
    for server in &servers {
        map.insert(server.name.clone(), encode(CLAUDE_CODE, server, None));
    }
    serde_json::to_string_pretty(&json!({ "mcpServers": map })).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Probing: the same handshake the agent would run
// ---------------------------------------------------------------------------

/// `${VAR}` and `${VAR:-fallback}`, the two forms `.mcp.json` documents.
fn expand_env(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut rest = raw;
    while let Some(start) = rest.find("${") {
        out.push_str(&rest[..start]);
        let Some(end) = rest[start..].find('}') else {
            out.push_str(&rest[start..]);
            return out;
        };
        let token = &rest[start + 2..start + end];
        let (name, fallback) = match token.split_once(":-") {
            Some((name, fallback)) => (name, fallback),
            None => (token, ""),
        };
        out.push_str(&std::env::var(name).unwrap_or_else(|_| fallback.to_string()));
        rest = &rest[start + end + 1..];
    }
    out.push_str(rest);
    out
}

fn request(id: u64, method: &str) -> String {
    format!(
        "{}\n",
        json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": {} })
    )
}

fn initialize_request(id: u64) -> String {
    format!(
        "{}\n",
        json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": "initialize",
            "params": {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": { "name": "cairn", "version": env!("CARGO_PKG_VERSION") },
            },
        })
    )
}

fn read_tools(result: &Value) -> Vec<McpTool> {
    result
        .get("tools")
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .map(|tool| McpTool {
                    name: tool.get("name").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                    description: tool
                        .get("description")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .lines()
                        .next()
                        .unwrap_or_default()
                        .to_string(),
                })
                .collect()
        })
        .unwrap_or_default()
}

fn count_of(result: &Value, key: &str) -> usize {
    result.get(key).and_then(|v| v.as_array()).map_or(0, |a| a.len())
}

fn apply_result(probe: &mut McpProbe, method: &str, result: &Value) {
    match method {
        "initialize" => {
            let info = result.get("serverInfo");
            probe.server_name = info
                .and_then(|i| i.get("name"))
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            probe.server_version = info
                .and_then(|i| i.get("version"))
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            probe.protocol_version = result
                .get("protocolVersion")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
        }
        "tools/list" => probe.tools = read_tools(result),
        "prompts/list" => probe.prompt_count = count_of(result, "prompts"),
        "resources/list" => probe.resource_count = count_of(result, "resources"),
        _ => {}
    }
}

fn probe_stdio(server: &McpServer) -> McpProbe {
    let started = Instant::now();
    let mut probe = McpProbe::default();

    let command = expand_env(server.command.trim());
    let Some(binary) = resolve_binary(&command, Some(&command)).or_else(|| resolve_binary(&command, None))
    else {
        probe.error = format!("{command} was not found on this machine");
        return probe;
    };

    let mut cmd = new_command(&binary);
    for arg in &server.args {
        cmd.arg(expand_env(arg));
    }
    for (key, value) in &server.env {
        cmd.env(key, expand_env(value));
    }
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(e) => {
            probe.error = format!("Could not start {command}: {e}");
            return probe;
        }
    };

    let (tx, rx) = mpsc::channel::<String>();
    if let Some(stdout) = child.stdout.take() {
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if tx.send(line).is_err() {
                    return;
                }
            }
        });
    }

    let logs = Arc::new(Mutex::new(String::new()));
    if let Some(stderr) = child.stderr.take() {
        let sink = Arc::clone(&logs);
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                let mut held = sink.lock().expect("stderr sink");
                if held.len() < 4000 {
                    held.push_str(&line);
                    held.push('\n');
                }
            }
        });
    }

    let mut stdin = child.stdin.take();
    let mut write = |payload: String| -> bool {
        stdin
            .as_mut()
            .is_some_and(|pipe| pipe.write_all(payload.as_bytes()).and_then(|_| pipe.flush()).is_ok())
    };

    /// Reads until the answer to `id` arrives, ignoring the logs and
    /// notifications a server interleaves with it.
    fn await_reply(rx: &mpsc::Receiver<String>, id: u64, timeout: Duration) -> Result<Value, String> {
        let deadline = Instant::now() + timeout;
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return Err("The server did not answer in time".to_string());
            }
            let line = rx
                .recv_timeout(left)
                .map_err(|_| "The server did not answer in time".to_string())?;
            let Ok(message) = serde_json::from_str::<Value>(&line) else { continue };
            if message.get("id").and_then(|v| v.as_u64()) != Some(id) {
                continue;
            }
            if let Some(error) = message.get("error") {
                let text = error
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown error");
                return Err(text.to_string());
            }
            return Ok(message.get("result").cloned().unwrap_or(json!({})));
        }
    }

    let finish = |probe: &mut McpProbe, child: &mut std::process::Child| {
        let _ = child.kill();
        let _ = child.wait();
        probe.logs = logs.lock().map(|l| l.trim_end().to_string()).unwrap_or_default();
        probe.duration_ms = started.elapsed().as_millis() as u64;
    };

    if !write(initialize_request(1)) {
        probe.error = "Could not write to the server".to_string();
        finish(&mut probe, &mut child);
        return probe;
    }
    match await_reply(&rx, 1, HANDSHAKE_TIMEOUT) {
        Ok(result) => apply_result(&mut probe, "initialize", &result),
        Err(error) => {
            probe.error = error;
            finish(&mut probe, &mut child);
            return probe;
        }
    }

    probe.ok = true;
    write(format!(
        "{}\n",
        json!({ "jsonrpc": "2.0", "method": "notifications/initialized" })
    ));

    for (id, method) in [(2, "tools/list"), (3, "prompts/list"), (4, "resources/list")] {
        if !write(request(id, method)) {
            break;
        }
        // A server that does not implement a list simply has none of that kind.
        if let Ok(result) = await_reply(&rx, id, LIST_TIMEOUT) {
            apply_result(&mut probe, method, &result);
        }
    }

    finish(&mut probe, &mut child);
    probe
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(HANDSHAKE_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())
}

/// A streamable HTTP server may answer a POST with plain JSON or with a single
/// SSE frame; both carry the same JSON-RPC message.
fn parse_http_body(body: &str) -> Result<Value, String> {
    let trimmed = body.trim();
    if trimmed.starts_with('{') {
        return serde_json::from_str(trimmed).map_err(|e| e.to_string());
    }
    for line in trimmed.lines() {
        if let Some(data) = line.strip_prefix("data:") {
            let data = data.trim();
            if data.starts_with('{') {
                return serde_json::from_str(data).map_err(|e| e.to_string());
            }
        }
    }
    Err("The server did not answer with a JSON-RPC message".to_string())
}

async fn post_rpc(
    client: &reqwest::Client,
    server: &McpServer,
    session: &Option<String>,
    payload: String,
) -> Result<(Value, Option<String>), String> {
    let mut request = client
        .post(expand_env(server.url.trim()))
        .header("content-type", "application/json")
        .header("accept", "application/json, text/event-stream")
        .header("mcp-protocol-version", PROTOCOL_VERSION);
    for (key, value) in &server.headers {
        request = request.header(key, expand_env(value));
    }
    if let Some(id) = session {
        request = request.header("mcp-session-id", id);
    }

    let response = request
        .body(payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = response.status();
    let returned = response
        .headers()
        .get("mcp-session-id")
        .and_then(|v| v.to_str().ok())
        .map(String::from);

    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Err("The server requires authentication".to_string());
    }
    let body = response.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        let detail = body.trim().chars().take(200).collect::<String>();
        return Err(format!("HTTP {status}{}", if detail.is_empty() { String::new() } else { format!(": {detail}") }));
    }

    let message = parse_http_body(&body)?;
    if let Some(error) = message.get("error") {
        let text = error.get("message").and_then(|v| v.as_str()).unwrap_or("unknown error");
        return Err(text.to_string());
    }
    Ok((message.get("result").cloned().unwrap_or(json!({})), returned))
}

async fn probe_http(server: &McpServer) -> McpProbe {
    let started = Instant::now();
    let mut probe = McpProbe::default();
    let client = match http_client() {
        Ok(client) => client,
        Err(error) => {
            probe.error = error;
            return probe;
        }
    };

    let mut session: Option<String> = None;
    match post_rpc(&client, server, &session, initialize_request(1)).await {
        Ok((result, returned)) => {
            apply_result(&mut probe, "initialize", &result);
            session = returned;
            probe.ok = true;
        }
        Err(error) => {
            probe.error = error;
            probe.duration_ms = started.elapsed().as_millis() as u64;
            return probe;
        }
    }

    let _ = post_rpc(
        &client,
        server,
        &session,
        format!("{}\n", json!({ "jsonrpc": "2.0", "method": "notifications/initialized" })),
    )
    .await;

    for (id, method) in [(2u64, "tools/list"), (3, "prompts/list"), (4, "resources/list")] {
        if let Ok((result, _)) = post_rpc(&client, server, &session, request(id, method)).await {
            apply_result(&mut probe, method, &result);
        }
    }

    probe.duration_ms = started.elapsed().as_millis() as u64;
    probe
}

/// Legacy SSE answers every call on a GET stream that has to stay open for the
/// whole session, which a one-shot probe cannot hold. Reachability is all this
/// can honestly report.
async fn probe_sse(server: &McpServer) -> McpProbe {
    let started = Instant::now();
    let mut probe = McpProbe { partial: true, ..Default::default() };
    let client = match http_client() {
        Ok(client) => client,
        Err(error) => {
            probe.error = error;
            return probe;
        }
    };

    let mut request = client
        .get(expand_env(server.url.trim()))
        .header("accept", "text/event-stream");
    for (key, value) in &server.headers {
        request = request.header(key, expand_env(value));
    }

    match request.send().await {
        Ok(response) if response.status().is_success() => probe.ok = true,
        Ok(response) => probe.error = format!("HTTP {}", response.status()),
        Err(e) => probe.error = e.to_string(),
    }
    probe.duration_ms = started.elapsed().as_millis() as u64;
    probe
}

#[tauri::command]
pub async fn test_mcp_server(server: McpServer) -> Result<McpProbe, String> {
    validate(&server)?;
    match server.transport.as_str() {
        "stdio" => tauri::async_runtime::spawn_blocking(move || probe_stdio(&server))
            .await
            .map_err(|e| e.to_string()),
        "sse" => Ok(probe_sse(&server).await),
        _ => Ok(probe_http(&server).await),
    }
}


// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::cli_providers::COPILOT;

    #[test]
    fn an_entry_without_a_type_is_read_from_its_shape() {
        let stdio = decode(CLAUDE_CODE, "a", &json!({ "command": "npx", "args": ["-y", "x"] }));
        assert_eq!(stdio.transport, "stdio");
        assert_eq!(stdio.args, vec!["-y", "x"]);

        let remote = decode(CLAUDE_CODE, "b", &json!({ "url": "https://example.test/mcp" }));
        assert_eq!(remote.transport, "http");
    }

    #[test]
    fn each_agent_reads_its_own_spelling_of_a_remote_server() {
        let codex = decode(CODEX, "a", &json!({ "url": "https://e.test", "http_headers": { "X": "1" } }));
        assert_eq!(codex.transport, "http");
        assert_eq!(codex.headers["X"], "1");

        let antigravity = decode(ANTIGRAVITY, "a", &json!({ "serverUrl": "https://e.test/sse" }));
        assert_eq!(antigravity.transport, "sse");
        assert_eq!(antigravity.url, "https://e.test/sse");

        let vibe = decode(
            VIBE,
            "a",
            &json!({ "transport": "streamable-http", "url": "https://e.test", "auth": { "headers": { "X": "1" } } }),
        );
        assert_eq!(vibe.transport, "http");
        assert_eq!(vibe.headers["X"], "1");
    }

    #[test]
    fn a_disabled_server_reads_the_same_from_both_spellings() {
        assert!(!decode(CODEX, "a", &json!({ "command": "x", "enabled": false })).enabled);
        assert!(!decode(VIBE, "a", &json!({ "transport": "stdio", "command": "x", "disabled": true })).enabled);
        // The others have no switch, so a declared server is simply on.
        assert!(decode(CLAUDE_CODE, "a", &json!({ "command": "x" })).enabled);
    }

    #[test]
    fn an_argv_command_splits_into_program_and_arguments() {
        let server = decode(VIBE, "a", &json!({ "transport": "stdio", "command": ["npx", "-y"], "args": ["pkg"] }));

        assert_eq!(server.command, "npx");
        assert_eq!(server.args, vec!["-y", "pkg"]);
    }

    #[test]
    fn a_round_trip_through_a_dialect_keeps_the_server_intact() {
        let server = McpServer {
            name: "a".into(),
            transport: "http".into(),
            url: "https://e.test/mcp".into(),
            headers: [("Authorization".to_string(), "Bearer x".to_string())].into_iter().collect(),
            enabled: false,
            ..Default::default()
        };

        for dialect in [CLAUDE_CODE, CODEX, VIBE] {
            let back = decode(dialect, "a", &encode(dialect, &server, None));
            assert_eq!(back.url, server.url, "{dialect}");
            assert_eq!(back.headers, server.headers, "{dialect}");
            if dialect != CLAUDE_CODE {
                assert!(!back.enabled, "{dialect} keeps the off switch");
            }
        }
    }

    #[test]
    fn a_key_this_agent_understands_and_cairn_does_not_is_left_alone() {
        let existing = json!({ "command": "npx", "startup_timeout_sec": 30, "required": true });
        let server = McpServer {
            name: "a".into(),
            transport: "stdio".into(),
            command: "node".into(),
            enabled: true,
            ..Default::default()
        };

        let entry = encode(CODEX, &server, Some(&existing));

        assert_eq!(entry["command"], json!("node"), "the managed key is updated");
        assert_eq!(entry["startup_timeout_sec"], json!(30), "the rest survives");
        assert_eq!(entry["required"], json!(true));
    }

    #[test]
    fn a_rendered_entry_carries_only_the_keys_of_its_transport() {
        let server = McpServer {
            name: "a".into(),
            transport: "http".into(),
            url: "https://example.test/mcp".into(),
            command: "leftover".into(),
            enabled: true,
            ..Default::default()
        };

        assert!(encode(CLAUDE_CODE, &server, None).get("command").is_none());
    }

    #[test]
    fn env_references_expand_with_their_fallback() {
        std::env::set_var("CAIRN_MCP_TEST", "value");

        assert_eq!(expand_env("${CAIRN_MCP_TEST}/x"), "value/x");
        assert_eq!(expand_env("${CAIRN_MCP_ABSENT:-fallback}"), "fallback");
        assert_eq!(expand_env("plain"), "plain");
    }

    #[test]
    fn an_sse_framed_answer_reads_as_json() {
        let body = "event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"ok\":true}}\n\n";

        assert_eq!(parse_http_body(body).unwrap()["result"]["ok"], json!(true));
    }

    #[test]
    fn writing_a_key_never_disturbs_the_rest_of_the_document() {
        let mut root = json!({ "numStartups": 42, "mcpServers": { "a": { "type": "stdio" } } });

        json_collection(&mut root, &["mcpServers".to_string()]).insert("b".into(), json!({ "type": "http" }));

        assert_eq!(root["numStartups"], json!(42));
        assert!(root["mcpServers"]["a"].is_object());
        assert!(root["mcpServers"]["b"].is_object());
    }

    #[test]
    fn a_nested_pointer_reaches_the_private_project_list() {
        let mut root = json!({ "projects": { "/repo": { "hasTrustDialogAccepted": true } } });

        json_collection(&mut root, &["projects".to_string(), "/repo".to_string(), "mcpServers".to_string()]).insert("a".into(), json!({}));

        assert_eq!(root["projects"]["/repo"]["hasTrustDialogAccepted"], json!(true));
        assert!(root["projects"]["/repo"]["mcpServers"]["a"].is_object());
    }

    #[tokio::test]
    async fn a_toml_agent_keeps_its_comments_and_its_own_keys() {
        let dir = std::env::temp_dir().join("cairn-mcp-toml");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join(".codex")).unwrap();
        fs::write(
            dir.join(".codex").join("config.toml"),
            "# hand written\nmodel = \"gpt-5.1\"\n\n[mcp_servers.legacy]\ncommand = \"old\"\nstartup_timeout_sec = 30\n",
        )
        .unwrap();
        let root = dir.to_string_lossy().to_string();

        let server = McpServer {
            name: "added".into(),
            scope: "project".into(),
            project_path: root.clone(),
            transport: "stdio".into(),
            command: "npx".into(),
            enabled: true,
            targets: vec![CODEX.into()],
            ..Default::default()
        };
        save_mcp_server(None, server).await.unwrap();

        let written = fs::read_to_string(dir.join(".codex").join("config.toml")).unwrap();
        assert!(written.contains("# hand written"), "comments survive");
        assert!(written.contains("startup_timeout_sec = 30"), "an unmanaged key survives");
        assert!(written.contains("[mcp_servers.added]"));

        let listed = list_mcp_servers(vec![McpProject { id: "p1".into(), name: "P".into(), path: root }])
            .await
            .unwrap();
        assert!(listed.iter().any(|s| s.name == "added" && s.providers == vec![CODEX.to_string()]));
        assert!(listed.iter().any(|s| s.name == "legacy"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn a_config_that_ships_an_empty_inline_array_still_takes_a_server() {
        // Vibe starts life with `mcp_servers = []`, not `[[mcp_servers]]`.
        let dir = std::env::temp_dir().join("cairn-mcp-inline-array");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join(".vibe")).unwrap();
        fs::write(
            dir.join(".vibe").join("config.toml"),
            "# hand written\nactive_model = \"mistral-medium-3.5\"\nmcp_servers = []\nskill_paths = []\n",
        )
        .unwrap();
        let root = dir.to_string_lossy().to_string();

        let server = McpServer {
            name: "added".into(),
            scope: "project".into(),
            project_path: root.clone(),
            transport: "stdio".into(),
            command: "npx".into(),
            enabled: true,
            targets: vec![VIBE.into()],
            ..Default::default()
        };
        save_mcp_server(None, server.clone()).await.unwrap();

        let written = fs::read_to_string(dir.join(".vibe").join("config.toml")).unwrap();
        assert!(written.contains("[[mcp_servers]]"), "written as a section: {written}");
        assert!(written.contains("# hand written"));
        assert!(written.contains("skill_paths = []"), "the other empty arrays are left alone");

        let listed = list_mcp_servers(vec![McpProject { id: "p1".into(), name: "P".into(), path: root }])
            .await
            .unwrap();
        let found = listed.iter().find(|s| s.name == "added").expect("read back");
        assert_eq!(found.providers, vec![VIBE.to_string()]);

        delete_mcp_server(found.clone()).await.unwrap();
        let after = fs::read_to_string(dir.join(".vibe").join("config.toml")).unwrap();
        assert!(!after.contains("added"), "removed again: {after}");

        let _ = fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn a_config_holding_inline_tables_keeps_that_style() {
        let dir = std::env::temp_dir().join("cairn-mcp-inline-style");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join(".vibe")).unwrap();
        fs::write(
            dir.join(".vibe").join("config.toml"),
            "mcp_servers = [{ name = \"old\", transport = \"stdio\", command = \"x\" }]\n",
        )
        .unwrap();
        let root = dir.to_string_lossy().to_string();

        let server = McpServer {
            name: "added".into(),
            scope: "project".into(),
            project_path: root.clone(),
            transport: "stdio".into(),
            command: "npx".into(),
            enabled: true,
            targets: vec![VIBE.into()],
            ..Default::default()
        };
        save_mcp_server(None, server).await.unwrap();

        let written = fs::read_to_string(dir.join(".vibe").join("config.toml")).unwrap();
        assert!(!written.contains("[[mcp_servers]]"), "style kept: {written}");
        let listed = list_mcp_servers(vec![McpProject { id: "p1".into(), name: "P".into(), path: root }])
            .await
            .unwrap();
        let mine: Vec<_> = listed.iter().filter(|s| s.scope == "project").collect();
        assert_eq!(mine.len(), 2, "both the old and the new one are read");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn one_file_two_agents_is_written_once() {
        let server = McpServer {
            name: "a".into(),
            scope: "project".into(),
            project_path: "/repo".into(),
            transport: "stdio".into(),
            command: "npx".into(),
            targets: vec![CLAUDE_CODE.into(), COPILOT.into()],
            ..Default::default()
        };

        let locations = write_locations(&server).unwrap();

        // Claude writes .mcp.json, Copilot writes .github/mcp.json: two files,
        // and neither is written twice.
        assert_eq!(locations.len(), 2);
        assert!(locations.iter().any(|l| l.path.ends_with(".mcp.json")));
        assert!(locations.iter().any(|l| l.path.ends_with("mcp.json") && l.path.to_string_lossy().contains(".github")));
    }
}
