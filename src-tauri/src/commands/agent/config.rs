//! Provider configuration: the settings file, the encrypted API keys, and what
//! Cairn asks the installed CLIs and the remote APIs about themselves.

use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::RwLock;
use serde::{Deserialize, Serialize};
use crate::storage::{ai_providers_file, api_keys_file, api_keys_secret_file, write_json_atomic};
use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::ChaCha20Poly1305;
use super::platform;

const NONCE_LEN: usize = 12;

/// The persisted configuration of one provider. Fields that do not apply to it
/// (a binary path for an HTTP provider, a temperature for a CLI) simply stay
/// at their default.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSettings {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub model: String,
    /// Model names the user added by hand, offered alongside the catalogue the
    /// provider reports - the way to keep running an older release.
    #[serde(default)]
    pub custom_models: Vec<String>,
    /// Superseded by `custom_models`; still read so an existing pin survives.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub custom_model: String,
    #[serde(default = "default_temperature")]
    pub temperature: f64,
    #[serde(default = "default_max_tokens")]
    pub max_tokens: u32,
    #[serde(default = "default_timeout")]
    pub timeout: u32,
    #[serde(default = "default_streaming")]
    pub streaming: bool,
    #[serde(default)]
    pub binary_path: String,
    #[serde(default)]
    pub effort: String,
    #[serde(default)]
    pub permission_mode: String,
    #[serde(default)]
    pub extra_args: Vec<String>,
}

fn default_temperature() -> f64 { 1.0 }
fn default_max_tokens() -> u32 { 8192 }
fn default_timeout() -> u32 { 60 }
fn default_streaming() -> bool { true }

impl Default for ProviderSettings {
    fn default() -> Self {
        ProviderSettings {
            enabled: false,
            base_url: String::new(),
            model: String::new(),
            custom_models: Vec::new(),
            custom_model: String::new(),
            temperature: default_temperature(),
            max_tokens: default_max_tokens(),
            timeout: default_timeout(),
            streaming: default_streaming(),
            binary_path: String::new(),
            effort: String::new(),
            permission_mode: String::new(),
            extra_args: Vec::new(),
        }
    }
}

/// The whole `ai-providers.json`: settings per provider id, plus the one the
/// app starts on.
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct AiProvidersConfig {
    #[serde(default)]
    pub providers: HashMap<String, ProviderSettings>,
    #[serde(default)]
    pub default_provider_id: String,
}

/// Every write to `ai-providers.json` goes through `save_ai_providers_config`,
/// so caching the parse is safe and spares a read plus a deserialisation on
/// every prompt sent.
static PROVIDERS_CACHE: RwLock<Option<AiProvidersConfig>> = RwLock::new(None);

/// Reads the config file, treating a missing one as the defaults rather than
/// an error.
pub fn read_ai_providers_config() -> Result<AiProvidersConfig, String> {
    if let Ok(cache) = PROVIDERS_CACHE.read()
        && let Some(config) = cache.as_ref()
    {
        return Ok(config.clone());
    }
    let path = ai_providers_file()?;
    let config = if path.exists() {
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())?
    } else {
        AiProvidersConfig::default()
    };
    if let Ok(mut cache) = PROVIDERS_CACHE.write() {
        *cache = Some(config.clone());
    }
    Ok(config)
}

/// The provider configuration, as the frontend sees it. Never carries a key.
#[tauri::command]
pub fn get_ai_providers_config() -> Result<AiProvidersConfig, String> {
    read_ai_providers_config()
}

/// Replaces the whole configuration file.
#[tauri::command]
pub async fn save_ai_providers_config(config: AiProvidersConfig) -> Result<(), String> {
    write_json_atomic(&ai_providers_file()?, &config)?;
    if let Ok(mut cache) = PROVIDERS_CACHE.write() {
        *cache = Some(config);
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// API keys: encrypted in ~/.cairn, never in the OS keychain. A keychain read
// prompts for authorisation on every launch of an unsigned or rebuilt binary,
// once per stored item, which made simply opening the Providers screen a wall
// of dialogs. The UI only ever learns whether a key exists, never the key.
// ---------------------------------------------------------------------------

/// Restrict a file to its owner. A no-op on Windows, where the user profile
/// directory is already the boundary.
fn restrict_to_owner(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
    #[cfg(not(unix))]
    let _ = path;
}

/// The secret the key file is encrypted with, created on first use.
///
/// It lives next to the ciphertext, so this is not protection against someone
/// who already reads your home directory - nothing stored locally could be.
/// What it does buy: an API key never sits in a plaintext file, so it cannot
/// leak through a backup, a synced folder, a screen share or a stray grep.
fn encryption_secret() -> Result<[u8; 32], String> {
    let path = api_keys_secret_file()?;
    if let Ok(existing) = fs::read(&path)
        && existing.len() == 32 {
            let mut secret = [0u8; 32];
            secret.copy_from_slice(&existing);
            return Ok(secret);
        }
    let mut secret = [0u8; 32];
    getrandom::fill(&mut secret).map_err(|e| e.to_string())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, secret).map_err(|e| e.to_string())?;
    restrict_to_owner(&path);
    Ok(secret)
}

/// The ChaCha20-Poly1305 cipher the key file is sealed with.
fn cipher() -> Result<ChaCha20Poly1305, String> {
    Ok(ChaCha20Poly1305::new(&encryption_secret()?.into()))
}

/// Decrypting `ai-keys.enc` costs a read plus a ChaCha20-Poly1305 pass, and
/// every prompt needs a key; `write_stored_keys` is the only writer, so the
/// plaintext map is kept here between writes.
static KEYS_CACHE: RwLock<Option<HashMap<String, String>>> = RwLock::new(None);

/// The stored keys, or an empty map when the file is missing, unreadable or
/// fails authentication - a tampered file is never half-read.
fn read_stored_keys() -> HashMap<String, String> {
    if let Ok(cache) = KEYS_CACHE.read()
        && let Some(keys) = cache.as_ref()
    {
        return keys.clone();
    }
    let keys = decrypt_stored_keys();
    if let Ok(mut cache) = KEYS_CACHE.write() {
        *cache = Some(keys.clone());
    }
    keys
}

fn decrypt_stored_keys() -> HashMap<String, String> {
    let Ok(path) = api_keys_file() else { return HashMap::new() };
    let Ok(raw) = fs::read(&path) else { return HashMap::new() };
    if raw.len() < NONCE_LEN {
        return HashMap::new();
    }
    let (nonce, ciphertext) = raw.split_at(NONCE_LEN);
    let Ok(nonce) = <&[u8; NONCE_LEN]>::try_from(nonce) else { return HashMap::new() };
    let Ok(cipher) = cipher() else { return HashMap::new() };
    cipher
        .decrypt(nonce.into(), ciphertext)
        .ok()
        .and_then(|plain| serde_json::from_slice(&plain).ok())
        .unwrap_or_default()
}

/// Seals the keys under a fresh nonce, prefixed to the ciphertext. An empty
/// map removes the file instead of writing an encrypted nothing.
fn write_stored_keys(keys: &HashMap<String, String>) -> Result<(), String> {
    if let Ok(mut cache) = KEYS_CACHE.write() {
        *cache = Some(keys.clone());
    }
    let path = api_keys_file()?;
    if keys.is_empty() {
        let _ = fs::remove_file(&path);
        return Ok(());
    }
    let plain = serde_json::to_vec(keys).map_err(|e| e.to_string())?;
    let mut nonce = [0u8; NONCE_LEN];
    getrandom::fill(&mut nonce).map_err(|e| e.to_string())?;
    let ciphertext = cipher()?
        .encrypt(&nonce.into(), plain.as_slice())
        .map_err(|e| e.to_string())?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut blob = nonce.to_vec();
    blob.extend_from_slice(&ciphertext);
    fs::write(&path, blob).map_err(|e| e.to_string())?;
    restrict_to_owner(&path);
    Ok(())
}

/// All the frontend is ever told about a key: whether there is one.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ApiKeyStatus {
    pub set: bool,
}

/// Stores a provider's key, replacing any previous one.
#[tauri::command]
pub async fn set_provider_api_key(provider_id: String, key: String) -> Result<ApiKeyStatus, String> {
    let mut keys = read_stored_keys();
    keys.insert(provider_id, key);
    write_stored_keys(&keys)?;
    Ok(ApiKeyStatus { set: true })
}

/// Every provider's key state in one call: the UI asks about all of them at
/// once, and asking one command per provider is what made this expensive.
#[tauri::command]
pub async fn get_api_key_statuses() -> Result<HashMap<String, bool>, String> {
    Ok(read_stored_keys()
        .into_iter()
        .map(|(provider, key)| (provider, !key.is_empty()))
        .collect())
}

/// Forgets a provider's key; unknown ids are not an error.
#[tauri::command]
pub async fn delete_provider_api_key(provider_id: String) -> Result<(), String> {
    let mut keys = read_stored_keys();
    if keys.remove(&provider_id).is_some() {
        write_stored_keys(&keys)?;
    }
    Ok(())
}

/// A provider's key for a run. Rust-side only - it never crosses to the
/// frontend.
pub fn get_api_key(provider_id: &str) -> Option<String> {
    read_stored_keys().remove(provider_id).filter(|k| !k.is_empty())
}

// ---------------------------------------------------------------------------
// Provider availability probe
// ---------------------------------------------------------------------------

/// Whether a provider is usable right now, and why not when it is not.
#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
    pub available: bool,
    pub version: Option<String>,
    pub detail: Option<String>,
    pub models: Vec<String>,
}

/// Checks a provider is reachable: a CLI answers `--version`, Ollama answers
/// its tag list, and any other HTTP provider only needs a key to count.
#[tauri::command]
pub async fn probe_provider(
    provider_id: String,
    kind: String,
    binary: Option<String>,
    base_url: Option<String>,
) -> Result<ProbeResult, String> {
    let config = read_ai_providers_config()?;
    let settings = config.providers.get(&provider_id).cloned().unwrap_or_default();

    if kind == "cli" {
        let name = binary.ok_or("Missing binary name")?;
        let override_path = (!settings.binary_path.is_empty()).then_some(settings.binary_path.as_str());
        let Some(path) = platform::resolve_binary(&name, override_path) else {
            return Ok(ProbeResult { available: false, detail: Some(format!("{name} not found")), ..Default::default() });
        };
        let output = platform::new_command(&path).arg("--version").output();
        return Ok(match output {
            Ok(out) if out.status.success() => ProbeResult {
                available: true,
                version: Some(String::from_utf8_lossy(&out.stdout).trim().to_string()),
                detail: Some(path.to_string_lossy().to_string()),
                models: Vec::new(),
            },
            Ok(out) => ProbeResult {
                available: false,
                detail: Some(String::from_utf8_lossy(&out.stderr).trim().to_string()),
                ..Default::default()
            },
            Err(e) => ProbeResult { available: false, detail: Some(e.to_string()), ..Default::default() },
        });
    }

    if provider_id == "ollama" {
        let base = base_url
            .filter(|u| !u.trim().is_empty())
            .unwrap_or_else(|| "http://localhost:11434".to_string());
        let url = format!("{}/api/tags", base.trim_end_matches('/'));
        let response = http_client(5)?.get(&url).send().await;
        return Ok(match response {
            Ok(resp) if resp.status().is_success() => {
                let models = resp
                    .json::<serde_json::Value>()
                    .await
                    .ok()
                    .and_then(|v| v.get("models").and_then(|m| m.as_array()).map(|arr| {
                        arr.iter()
                            .filter_map(|m| m.get("name").and_then(|n| n.as_str()).map(String::from))
                            .collect()
                    }))
                    .unwrap_or_default();
                ProbeResult { available: true, models, ..Default::default() }
            }
            Ok(resp) => ProbeResult { available: false, detail: Some(format!("HTTP {}", resp.status())), ..Default::default() },
            Err(e) => ProbeResult { available: false, detail: Some(e.to_string()), ..Default::default() },
        });
    }

    let has_key = get_api_key(&provider_id).is_some();
    Ok(ProbeResult {
        available: has_key,
        detail: (!has_key).then(|| "API key missing".to_string()),
        ..Default::default()
    })
}

// ---------------------------------------------------------------------------
// Model catalogue, asked to the provider rather than hardcoded
// ---------------------------------------------------------------------------

/// A model the provider reported: the id to send, and the name to show.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredModel {
    pub id: String,
    pub label: String,
}

/// Async on purpose: every caller here runs inside a `#[tauri::command] async
/// fn`, and `reqwest::blocking` builds a tokio runtime of its own whose drop
/// panics in an async context ("Cannot drop a runtime in a context where
/// blocking is not allowed"). Tauri does not catch that panic, so the command
/// never answers and the UI spins forever. The blocking client is still the
/// right one in `providers/api_chat.rs`, which runs on a plain thread.
fn http_client(timeout_secs: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| e.to_string())
}

/// GET a JSON body, turning a non-2xx status into the error.
async fn json_get(
    url: &str,
    headers: &[(&str, String)],
) -> Result<serde_json::Value, String> {
    let mut request = http_client(10)?.get(url);
    for (name, value) in headers {
        request = request.header(*name, value);
    }
    let response = request.send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    response.json::<serde_json::Value>().await.map_err(|e| e.to_string())
}

/// The array under `key`, or an empty slice for anything else.
fn array_of<'a>(value: &'a serde_json::Value, key: &str) -> &'a [serde_json::Value] {
    value.get(key).and_then(|v| v.as_array()).map_or(&[], |v| v.as_slice())
}

/// The string under `key`, if it is one.
fn str_of(value: &serde_json::Value, key: &str) -> Option<String> {
    value.get(key).and_then(|v| v.as_str()).map(String::from)
}

/// What a provider says it accepts, as the pickers offer it.
#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCapabilities {
    pub models: Vec<DiscoveredModel>,
    pub efforts: Vec<String>,
    pub permission_modes: Vec<String>,
}

/// Whether a token read out of help text can plausibly be an option value
/// rather than a fragment of prose.
fn is_option_value(token: &str) -> bool {
    !token.is_empty()
        && token.len() < 60
        && token.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.')
}

/// Pairs quotes greedily, and on a pair that holds no plausible value retries
/// from its closing quote: help text says things like `model's full name`, and
/// a stray apostrophe must not shift every pair that follows it.
fn collect_quoted(text: &str, quote: char, values: &mut Vec<String>) {
    let marks: Vec<usize> = text
        .char_indices()
        .filter(|(_, c)| *c == quote)
        .map(|(i, _)| i)
        .collect();
    let mut i = 0;
    while i + 1 < marks.len() {
        let token = text[marks[i] + quote.len_utf8()..marks[i + 1]].trim();
        if is_option_value(token) {
            if !values.iter().any(|v| v == token) {
                values.push(token.to_string());
            }
            i += 2;
        } else {
            i += 1;
        }
    }
}

/// The values a CLI option accepts, read out of its own `--help`.
///
/// Only the first parenthesised group of the description is read: that is where
/// an option spells out what it takes, either as a quoted choice list
/// (`choices: "auto", "plan"`) or as a plain enumeration (`(low, medium)`).
/// Later groups illustrate something else - `--model` for instance follows its
/// alias list with an example of a full model name, which is not a choice.
fn cli_option_values(help: &str, flag: &str) -> Vec<String> {
    let Some(start) = help.find(flag) else { return Vec::new() };
    // The description runs until the next option starts.
    let rest = &help[start + flag.len()..];
    let block = rest.find("\n  -").map_or(rest, |end| &rest[..end]);
    let flat = block.split_whitespace().collect::<Vec<_>>().join(" ");

    let Some(open) = flat.find('(') else { return Vec::new() };
    let Some(close) = flat[open..].find(')') else { return Vec::new() };
    let group = &flat[open + 1..open + close];

    let mut values: Vec<String> = Vec::new();
    for quote in ['"', '\''] {
        collect_quoted(group, quote, &mut values);
    }
    if !values.is_empty() { return values; }

    for token in group.split(',') {
        let token = token.trim();
        if is_option_value(token) && !values.iter().any(|v| v == token) {
            values.push(token.to_string());
        }
    }
    values
}

/// What the installed Claude Code CLI says it accepts. Reading it back is what
/// keeps Cairn in step with the CLI the user actually runs, instead of freezing
/// whatever the lists looked like the day this shipped.
fn claude_cli_capabilities(binary_path: &str) -> ProviderCapabilities {
    let Some(path) = platform::resolve_binary("claude", (!binary_path.is_empty()).then_some(binary_path)) else {
        return ProviderCapabilities::default();
    };
    let Ok(output) = platform::new_command(&path).arg("--help").output() else {
        return ProviderCapabilities::default();
    };
    let help = String::from_utf8_lossy(&output.stdout);
    ProviderCapabilities {
        models: cli_option_values(&help, "--model <model>")
            .into_iter()
            .map(|id| DiscoveredModel { label: id.clone(), id })
            .collect(),
        efforts: cli_option_values(&help, "--effort <level>"),
        permission_modes: cli_option_values(&help, "--permission-mode <mode>"),
    }
}

/// The models, efforts and permission modes to offer for a provider, asked to
/// the provider itself rather than hardcoded.
#[tauri::command]
pub async fn discover_provider(
    provider_id: String,
    base_url: Option<String>,
) -> Result<ProviderCapabilities, String> {
    if provider_id == "claude-code-cli" {
        let config = read_ai_providers_config()?;
        let settings = config.providers.get(&provider_id).cloned().unwrap_or_default();
        let mut capabilities = claude_cli_capabilities(&settings.binary_path);
        // The CLI only documents its aliases, but it accepts full model names,
        // and the Anthropic API is where those are published. Asking it - when
        // the user configured a key - is what turns "Opus" into the list of
        // Opus releases they can actually pin.
        if let Ok(models) = list_provider_models("anthropic".to_string(), None).await {
            for model in models {
                if !capabilities.models.iter().any(|m| m.id == model.id) {
                    capabilities.models.push(model);
                }
            }
        }
        return Ok(capabilities);
    }
    Ok(ProviderCapabilities {
        models: list_provider_models(provider_id, base_url).await?,
        ..Default::default()
    })
}

/// The model catalogue of one HTTP provider, each having its own endpoint and
/// its own shape. An unknown id returns nothing rather than failing.
async fn list_provider_models(
    provider_id: String,
    base_url: Option<String>,
) -> Result<Vec<DiscoveredModel>, String> {
    let config = read_ai_providers_config()?;
    let settings = config.providers.get(&provider_id).cloned().unwrap_or_default();
    let base = base_url
        .filter(|u| !u.trim().is_empty())
        .unwrap_or_else(|| settings.base_url.clone());
    let base = base.trim_end_matches('/').to_string();
    let key = get_api_key(&provider_id);

    match provider_id.as_str() {
        "anthropic" => {
            let key = key.ok_or("API key missing")?;
            let base = if base.is_empty() { "https://api.anthropic.com".to_string() } else { base };
            let body = json_get(
                &format!("{base}/v1/models?limit=100"),
                &[("x-api-key", key), ("anthropic-version", "2023-06-01".into())],
            )
            .await?;
            Ok(array_of(&body, "data")
                .iter()
                .filter_map(|m| {
                    let id = str_of(m, "id")?;
                    let label = str_of(m, "display_name").unwrap_or_else(|| id.clone());
                    Some(DiscoveredModel { id, label })
                })
                .collect())
        }

        "openai" | "mistral" => {
            let key = key.ok_or("API key missing")?;
            let base = if base.is_empty() {
                if provider_id == "openai" { "https://api.openai.com/v1".into() } else { "https://api.mistral.ai/v1".to_string() }
            } else {
                base
            };
            let body = json_get(
                &format!("{base}/models"),
                &[("Authorization", format!("Bearer {key}"))],
            )
            .await?;
            let mut models: Vec<DiscoveredModel> = array_of(&body, "data")
                .iter()
                .filter_map(|m| {
                    let id = str_of(m, "id")?;
                    Some(DiscoveredModel { label: id.clone(), id })
                })
                .collect();
            models.sort_by(|a, b| a.id.cmp(&b.id));
            Ok(models)
        }

        "gemini" => {
            let key = key.ok_or("API key missing")?;
            let body = json_get(
                &format!("https://generativelanguage.googleapis.com/v1beta/models?key={key}&pageSize=200"),
                &[],
            )
            .await?;
            Ok(array_of(&body, "models")
                .iter()
                .filter(|m| {
                    array_of(m, "supportedGenerationMethods")
                        .iter()
                        .any(|v| v.as_str() == Some("generateContent"))
                })
                .filter_map(|m| {
                    let name = str_of(m, "name")?;
                    let id = name.strip_prefix("models/").unwrap_or(&name).to_string();
                    let label = str_of(m, "displayName").unwrap_or_else(|| id.clone());
                    Some(DiscoveredModel { id, label })
                })
                .collect())
        }

        "ollama" => {
            let base = if base.is_empty() { "http://localhost:11434".to_string() } else { base };
            // The model list lives on the native API, next to the OpenAI-compatible /v1.
            let base = base.strip_suffix("/v1").unwrap_or(&base).to_string();
            let body = json_get(&format!("{base}/api/tags"), &[]).await?;
            Ok(array_of(&body, "models")
                .iter()
                .filter_map(|m| {
                    let id = str_of(m, "name")?;
                    Some(DiscoveredModel { label: id.clone(), id })
                })
                .collect())
        }

        _ => Ok(Vec::new()),
    }
}

// ---------------------------------------------------------------------------
// Slash commands available to the agent: commands, skills and plugins, in the
// project and in the user's home
// ---------------------------------------------------------------------------

/// A slash command the agent can be asked to run, with where it came from
/// (`project`, `global` or `plugin`).
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentSlashCommand {
    pub name: String,
    pub description: String,
    pub scope: String,
}

/// The one-line description of a command or skill file.
fn describe(path: &Path) -> String {
    fs::read_to_string(path)
        .ok()
        .and_then(|c| extract_description(&c))
        .unwrap_or_default()
}

/// `.md` files of a commands directory. A subdirectory is a namespace, which
/// Claude Code invokes as `/dir:name`, so the nesting is kept in the name.
fn collect_commands(dir: &Path, prefix: &str, scope: &str, out: &mut Vec<AgentSlashCommand>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let Some(sub) = path.file_name().and_then(|s| s.to_str()) else { continue };
            collect_commands(&path, &format!("{prefix}{sub}:"), scope, out);
            continue;
        }
        if path.extension().is_none_or(|e| e != "md") { continue; }
        let Some(name) = path.file_stem().and_then(|s| s.to_str()) else { continue };
        out.push(AgentSlashCommand {
            name: format!("{prefix}{name}"),
            description: describe(&path),
            scope: scope.to_string(),
        });
    }
}

/// A skills directory holds one directory per skill, each with a `SKILL.md`.
/// A user-invocable skill is reached by its own name, `/name`.
fn collect_skills(dir: &Path, scope: &str, plugin: &str, out: &mut Vec<AgentSlashCommand>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let manifest = path.join("SKILL.md");
        if !manifest.is_file() { continue; }
        let Some(name) = path.file_name().and_then(|s| s.to_str()) else { continue };
        out.push(AgentSlashCommand {
            name: if plugin.is_empty() { name.to_string() } else { format!("{plugin}:{name}") },
            description: describe(&manifest),
            scope: scope.to_string(),
        });
    }
}

/// One entry of Claude Code's `installed_plugins.json`.
#[derive(Deserialize)]
struct InstalledPlugin {
    #[serde(rename = "installPath")]
    install_path: String,
}

/// The plugin manifest, keyed by `name@marketplace`.
#[derive(Deserialize)]
struct InstalledPlugins {
    #[serde(default)]
    plugins: HashMap<String, Vec<InstalledPlugin>>,
}

/// Every installed plugin contributes its own commands and skills, namespaced
/// by the plugin name (`/plugin:command`).
fn collect_plugins(home: &Path, out: &mut Vec<AgentSlashCommand>) {
    let manifest = home.join(".claude").join("plugins").join("installed_plugins.json");
    let Ok(raw) = fs::read_to_string(&manifest) else { return };
    let Ok(installed) = serde_json::from_str::<InstalledPlugins>(&raw) else { return };
    for (key, entries) in &installed.plugins {
        let plugin = key.split('@').next().unwrap_or(key);
        for entry in entries {
            let root = Path::new(&entry.install_path);
            collect_commands(&root.join("commands"), &format!("{plugin}:"), "plugin", out);
            collect_skills(&root.join("skills"), "plugin", plugin, out);
        }
    }
}

/// The `description` of the frontmatter, falling back to the first meaningful
/// line when the file has none.
fn extract_description(content: &str) -> Option<String> {
    let mut lines = content.lines();
    if content.starts_with("---") {
        lines.next();
        for line in lines.by_ref() {
            if line.trim() == "---" { break; }
            if let Some(desc) = line.strip_prefix("description:") {
                return Some(desc.trim().to_string());
            }
        }
    }
    content
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty() && !l.starts_with("---"))
        .map(|l| l.trim_start_matches('#').trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("cairn-cmds-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn nests_a_command_directory_into_a_namespace() {
        let dir = scratch("nested");
        fs::create_dir_all(dir.join("git")).unwrap();
        fs::write(dir.join("review.md"), "---\ndescription: Review\n---\n").unwrap();
        fs::write(dir.join("git/sync.md"), "# Sync the branch\n").unwrap();
        let mut out = Vec::new();
        collect_commands(&dir, "", "project", &mut out);
        out.sort_by(|a, b| a.name.cmp(&b.name));
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].name, "git:sync");
        assert_eq!(out[0].description, "Sync the branch");
        assert_eq!(out[1].name, "review");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn reads_skills_and_namespaces_the_ones_of_a_plugin() {
        let dir = scratch("skills");
        fs::create_dir_all(dir.join("commit")).unwrap();
        fs::create_dir_all(dir.join("empty")).unwrap();
        fs::write(dir.join("commit/SKILL.md"), "---\nname: commit\ndescription: Commit work\n---\n").unwrap();
        let mut out = Vec::new();
        collect_skills(&dir, "global", "", &mut out);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].name, "commit");
        assert_eq!(out[0].description, "Commit work");

        let mut plugged = Vec::new();
        collect_skills(&dir, "plugin", "caveman", &mut plugged);
        assert_eq!(plugged[0].name, "caveman:commit");
        let _ = fs::remove_dir_all(&dir);
    }

    const HELP: &str = concat!(
        "  --effort <level>                      Effort level for the current session\n",
        "                                        (low, medium, high, xhigh, max)\n",
        "  --model <model>                       Model for the current session. Provide\n",
        "                                        an alias for the latest model (e.g.\n",
        "                                        'fable', 'opus', or 'sonnet') or a\n",
        "                                        model's full name (e.g.\n",
        "                                        'claude-fable-5').\n",
        "  --permission-mode <mode>              Permission mode to use for the session\n",
        "                                        (choices: \"acceptEdits\", \"auto\",\n",
        "                                        \"bypassPermissions\")\n",
        "  --session-id <uuid>                   Use a specific session ID\n",
    );

    #[test]
    fn reads_an_unquoted_enumeration() {
        assert_eq!(
            cli_option_values(HELP, "--effort <level>"),
            vec!["low", "medium", "high", "xhigh", "max"],
        );
    }

    #[test]
    fn reads_a_quoted_choice_list() {
        assert_eq!(
            cli_option_values(HELP, "--permission-mode <mode>"),
            vec!["acceptEdits", "auto", "bypassPermissions"],
        );
    }

    #[test]
    fn reads_the_aliases_and_not_the_full_name_example() {
        assert_eq!(
            cli_option_values(HELP, "--model <model>"),
            vec!["fable", "opus", "sonnet"],
        );
    }

    #[test]
    fn returns_nothing_for_an_option_the_cli_does_not_have() {
        assert!(cli_option_values(HELP, "--nope <x>").is_empty());
    }

    #[test]
    fn provider_settings_defaults_from_empty_json() {
        let s: ProviderSettings = serde_json::from_str("{}").unwrap();
        assert!(!s.enabled);
        assert_eq!(s.temperature, 1.0);
        assert_eq!(s.max_tokens, 8192);
        assert_eq!(s.timeout, 60);
        assert!(s.streaming);
        assert!(s.extra_args.is_empty());
    }

    #[test]
    fn provider_settings_roundtrip_keeps_values() {
        let s = ProviderSettings {
            enabled: true,
            model: "opus".into(),
            permission_mode: "plan".into(),
            ..Default::default()
        };
        let json = serde_json::to_string(&s).unwrap();
        let back: ProviderSettings = serde_json::from_str(&json).unwrap();
        assert!(back.enabled);
        assert_eq!(back.model, "opus");
        assert_eq!(back.permission_mode, "plan");
    }

    #[test]
    fn ai_providers_config_defaults_from_empty_json() {
        let c: AiProvidersConfig = serde_json::from_str("{}").unwrap();
        assert!(c.providers.is_empty());
        assert!(c.default_provider_id.is_empty());
    }


    /// Round-trips through the real cipher without touching the user's files.
    fn seal(secret: &[u8; 32], keys: &HashMap<String, String>) -> Vec<u8> {
        let cipher = ChaCha20Poly1305::new(secret.into());
        let nonce = [7u8; NONCE_LEN];
        let plain = serde_json::to_vec(keys).unwrap();
        let mut blob = nonce.to_vec();
        blob.extend_from_slice(&cipher.encrypt(&nonce.into(), plain.as_slice()).unwrap());
        blob
    }

    fn open(secret: &[u8; 32], blob: &[u8]) -> Option<HashMap<String, String>> {
        let (nonce, ciphertext) = blob.split_at(NONCE_LEN);
        let nonce = <&[u8; NONCE_LEN]>::try_from(nonce).ok()?;
        ChaCha20Poly1305::new(secret.into())
            .decrypt(nonce.into(), ciphertext)
            .ok()
            .and_then(|plain| serde_json::from_slice(&plain).ok())
    }

    #[test]
    fn a_stored_key_survives_the_round_trip() {
        let secret = [3u8; 32];
        let mut keys = HashMap::new();
        keys.insert("mistral".to_string(), "sk-secret-value".to_string());
        assert_eq!(open(&secret, &seal(&secret, &keys)), Some(keys));
    }

    #[test]
    fn the_key_never_appears_in_the_bytes_written_to_disk() {
        let mut keys = HashMap::new();
        keys.insert("mistral".to_string(), "sk-secret-value".to_string());
        let blob = seal(&[3u8; 32], &keys);
        let haystack = String::from_utf8_lossy(&blob);
        assert!(!haystack.contains("sk-secret-value"));
        assert!(!haystack.contains("mistral"));
    }

    #[test]
    fn another_secret_cannot_read_the_file() {
        let mut keys = HashMap::new();
        keys.insert("openai".to_string(), "sk-1".to_string());
        let blob = seal(&[3u8; 32], &keys);
        assert!(open(&[4u8; 32], &blob).is_none());
    }

    #[test]
    fn a_tampered_file_is_rejected_rather_than_half_read() {
        let secret = [3u8; 32];
        let mut keys = HashMap::new();
        keys.insert("openai".to_string(), "sk-1".to_string());
        let mut blob = seal(&secret, &keys);
        let last = blob.len() - 1;
        blob[last] ^= 0xff;
        assert!(open(&secret, &blob).is_none());
    }














    #[test]
    fn extract_description_reads_frontmatter() {
        let content = "---\ndescription: Commit helper\n---\n# Body";
        assert_eq!(extract_description(content).as_deref(), Some("Commit helper"));
    }

    #[test]
    fn extract_description_falls_back_to_first_line() {
        let content = "# Do the thing\n\nMore text";
        assert_eq!(extract_description(content).as_deref(), Some("Do the thing"));
    }



}

/// Every slash command available in this working directory, deduplicated so a
/// project entry shadows a global one, which shadows a plugin's.
#[tauri::command]
pub async fn list_agent_commands(working_dir: String) -> Result<Vec<AgentSlashCommand>, String> {
    let mut out = Vec::new();
    let project = Path::new(&working_dir).join(".claude");
    collect_commands(&project.join("commands"), "", "project", &mut out);
    collect_skills(&project.join("skills"), "project", "", &mut out);
    if let Some(home) = dirs::home_dir() {
        let global = home.join(".claude");
        collect_commands(&global.join("commands"), "", "global", &mut out);
        collect_skills(&global.join("skills"), "global", "", &mut out);
        collect_plugins(&home, &mut out);
    }
    // A project entry shadows the same name defined globally, which in turn
    // shadows a plugin's.
    let rank = |c: &AgentSlashCommand| match c.scope.as_str() {
        "project" => 0,
        "global" => 1,
        _ => 2,
    };
    out.sort_by(|a, b| a.name.cmp(&b.name).then(rank(a).cmp(&rank(b))));
    out.dedup_by(|a, b| a.name == b.name);
    Ok(out)
}
