use std::collections::HashMap;
use std::fs;
use std::path::Path;
use serde::{Deserialize, Serialize};
use crate::storage::{ai_providers_file, api_key_fallback_file, custom_agents_file, write_json_atomic};
use super::platform;

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

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct AiProvidersConfig {
    #[serde(default)]
    pub providers: HashMap<String, ProviderSettings>,
    #[serde(default)]
    pub default_provider_id: String,
}

pub fn read_ai_providers_config() -> Result<AiProvidersConfig, String> {
    let path = ai_providers_file()?;
    if !path.exists() { return Ok(AiProvidersConfig::default()); }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_ai_providers_config() -> Result<AiProvidersConfig, String> {
    read_ai_providers_config()
}

#[tauri::command]
pub fn save_ai_providers_config(config: AiProvidersConfig) -> Result<(), String> {
    write_json_atomic(&ai_providers_file()?, &config)
}

// ---------------------------------------------------------------------------
// API keys: OS keychain first, restricted-permission file as a last resort
// (headless Linux without a secret service). The UI only learns whether a key
// exists and where it lives, never the key itself.
// ---------------------------------------------------------------------------

const KEYRING_SERVICE: &str = "cairn";

fn keyring_entry(provider_id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, provider_id).map_err(|e| e.to_string())
}

fn read_fallback_keys() -> HashMap<String, String> {
    api_key_fallback_file()
        .ok()
        .filter(|p| p.exists())
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or_default()
}

fn write_fallback_keys(keys: &HashMap<String, String>) -> Result<(), String> {
    let path = api_key_fallback_file()?;
    if keys.is_empty() {
        let _ = fs::remove_file(&path);
        return Ok(());
    }
    write_json_atomic(&path, keys)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ApiKeyStatus {
    pub set: bool,
    pub fallback: bool,
}

#[tauri::command]
pub async fn set_provider_api_key(provider_id: String, key: String) -> Result<ApiKeyStatus, String> {
    match keyring_entry(&provider_id).and_then(|e| e.set_password(&key).map_err(|e| e.to_string())) {
        Ok(()) => {
            let mut keys = read_fallback_keys();
            if keys.remove(&provider_id).is_some() { write_fallback_keys(&keys)?; }
            Ok(ApiKeyStatus { set: true, fallback: false })
        }
        Err(_) => {
            let mut keys = read_fallback_keys();
            keys.insert(provider_id, key);
            write_fallback_keys(&keys)?;
            Ok(ApiKeyStatus { set: true, fallback: true })
        }
    }
}

#[tauri::command]
pub async fn has_provider_api_key(provider_id: String) -> Result<ApiKeyStatus, String> {
    if let Ok(entry) = keyring_entry(&provider_id) {
        if entry.get_password().is_ok() {
            return Ok(ApiKeyStatus { set: true, fallback: false });
        }
    }
    let fallback = read_fallback_keys().contains_key(&provider_id);
    Ok(ApiKeyStatus { set: fallback, fallback })
}

#[tauri::command]
pub async fn delete_provider_api_key(provider_id: String) -> Result<(), String> {
    if let Ok(entry) = keyring_entry(&provider_id) {
        let _ = entry.delete_credential();
    }
    let mut keys = read_fallback_keys();
    if keys.remove(&provider_id).is_some() { write_fallback_keys(&keys)?; }
    Ok(())
}

pub fn get_api_key(provider_id: &str) -> Option<String> {
    if let Ok(entry) = keyring_entry(provider_id) {
        if let Ok(key) = entry.get_password() {
            return Some(key);
        }
    }
    read_fallback_keys().remove(provider_id)
}

// ---------------------------------------------------------------------------
// Custom agents
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct CustomAgent {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub provider_id: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub system_prompt: String,
    #[serde(default)]
    pub effort: String,
    #[serde(default)]
    pub permission_mode: String,
    #[serde(default)]
    pub allowed_tools: Vec<String>,
    #[serde(default)]
    pub disallowed_tools: Vec<String>,
    #[serde(default)]
    pub override_params: bool,
    #[serde(default = "default_temperature")]
    pub temperature: f64,
    #[serde(default = "default_max_tokens")]
    pub max_tokens: u32,
}

#[tauri::command]
pub fn get_custom_agents() -> Result<Vec<CustomAgent>, String> {
    let path = custom_agents_file()?;
    if !path.exists() { return Ok(Vec::new()); }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_custom_agents(agents: Vec<CustomAgent>) -> Result<(), String> {
    write_json_atomic(&custom_agents_file()?, &agents)
}

// ---------------------------------------------------------------------------
// Provider availability probe
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
    pub available: bool,
    pub version: Option<String>,
    pub detail: Option<String>,
    pub models: Vec<String>,
}

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
        let response = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .map_err(|e| e.to_string())?
            .get(&url)
            .send();
        return Ok(match response {
            Ok(resp) if resp.status().is_success() => {
                let models = resp
                    .json::<serde_json::Value>()
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

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredModel {
    pub id: String,
    pub label: String,
}

fn http_client(timeout_secs: u64) -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| e.to_string())
}

fn json_get(
    url: &str,
    headers: &[(&str, String)],
) -> Result<serde_json::Value, String> {
    let mut request = http_client(10)?.get(url);
    for (name, value) in headers {
        request = request.header(*name, value);
    }
    let response = request.send().map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    response.json::<serde_json::Value>().map_err(|e| e.to_string())
}

fn array_of<'a>(value: &'a serde_json::Value, key: &str) -> &'a [serde_json::Value] {
    value.get(key).and_then(|v| v.as_array()).map_or(&[], |v| v.as_slice())
}

fn str_of(value: &serde_json::Value, key: &str) -> Option<String> {
    value.get(key).and_then(|v| v.as_str()).map(String::from)
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCapabilities {
    pub models: Vec<DiscoveredModel>,
    pub efforts: Vec<String>,
    pub permission_modes: Vec<String>,
}

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
            )?;
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
            )?;
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
            )?;
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
            let body = json_get(&format!("{base}/api/tags"), &[])?;
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
// Slash commands available to the agent (project + global Claude commands)
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentSlashCommand {
    pub name: String,
    pub description: String,
    pub scope: String,
}

fn collect_commands(dir: &Path, scope: &str, out: &mut Vec<AgentSlashCommand>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().is_none_or(|e| e != "md") { continue; }
        let Some(name) = path.file_stem().and_then(|s| s.to_str()) else { continue };
        let description = fs::read_to_string(&path)
            .ok()
            .and_then(|c| extract_description(&c))
            .unwrap_or_default();
        out.push(AgentSlashCommand {
            name: name.to_string(),
            description,
            scope: scope.to_string(),
        });
    }
}

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
        let mut s = ProviderSettings::default();
        s.enabled = true;
        s.model = "opus".into();
        s.permission_mode = "plan".into();
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

    #[test]
    fn splits_frontmatter_from_body() {
        let content = "---\nname: argus\ndescription: Test auditor\n---\nYou are Argus.\n";
        let (fields, body) = split_frontmatter(content);
        assert_eq!(fields.len(), 2);
        assert_eq!(fields[0], ("name".to_string(), "argus".to_string()));
        assert_eq!(body, "You are Argus.");
    }

    #[test]
    fn folds_a_block_scalar_description_into_one_value() {
        let content = concat!(
            "---\n",
            "name: argus\n",
            "description: >\n",
            "  Runs the test suite and audits its quality.\n",
            "  Delegate after a feature is implemented.\n",
            "model: opus\n",
            "---\n",
            "You are Argus.",
        );
        let (fields, body) = split_frontmatter(content);
        let get = |k: &str| {
            fields.iter().find(|(key, _)| key == k).map(|(_, v)| v.as_str()).unwrap_or("")
        };
        assert_eq!(
            get("description"),
            "Runs the test suite and audits its quality. Delegate after a feature is implemented.",
        );
        assert_eq!(get("name"), "argus");
        assert_eq!(get("model"), "opus");
        assert_eq!(body, "You are Argus.");
    }

    #[test]
    fn folds_a_plain_multi_line_value_too() {
        let (fields, _) = split_frontmatter("---\ndescription: Starts here\n  and ends here\n---\nBody");
        assert_eq!(fields[0].1, "Starts here and ends here");
    }

    #[test]
    fn every_block_scalar_marker_is_dropped_from_the_value() {
        for marker in ["|", ">-", "|-", ">+", "|+"] {
            let content = format!("---\ndescription: {marker}\n  Text\n---\nBody");
            let (fields, _) = split_frontmatter(&content);
            assert_eq!(fields[0].1, "Text", "marker {marker}");
        }
    }

    #[test]
    fn maps_the_claude_colour_names_to_hex() {
        assert_eq!(hex_for_color_name("cyan"), "#06b6d4");
        assert_eq!(hex_for_color_name(" Purple "), "#a855f7");
        assert_eq!(hex_for_color_name("#123456"), "#123456");
        assert_eq!(hex_for_color_name("chartreuse"), "");
    }

    #[test]
    fn a_file_without_frontmatter_is_all_body() {
        let (fields, body) = split_frontmatter("You are a helper.");
        assert!(fields.is_empty());
        assert_eq!(body, "You are a helper.");
    }

    #[test]
    fn an_unterminated_frontmatter_is_not_parsed_as_fields() {
        let (fields, body) = split_frontmatter("---\nname: broken\nstill going");
        assert!(fields.is_empty());
        assert!(body.starts_with("---"));
    }

    #[test]
    fn parses_both_tool_list_spellings() {
        assert_eq!(parse_tool_list("Read, Grep, Bash"), vec!["Read", "Grep", "Bash"]);
        assert_eq!(parse_tool_list("[Read, Grep]"), vec!["Read", "Grep"]);
        assert_eq!(parse_tool_list("\"Read\", 'Grep'"), vec!["Read", "Grep"]);
    }

    #[test]
    fn a_wildcard_tool_list_means_no_restriction() {
        assert!(parse_tool_list("*").is_empty());
        assert!(parse_tool_list("").is_empty());
    }

    #[test]
    fn quoted_frontmatter_values_lose_their_quotes() {
        let (fields, _) = split_frontmatter("---\ndescription: \"Runs the tests\"\n---\nBody");
        assert_eq!(fields[0].1, "Runs the tests");
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

// ---------------------------------------------------------------------------
// Claude Code subagents defined on disk, offered for import
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone, Default, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredAgent {
    pub name: String,
    pub description: String,
    pub model: String,
    pub effort: String,
    pub permission_mode: String,
    pub color: String,
    pub tools: Vec<String>,
    pub system_prompt: String,
    pub scope: String,
    pub path: String,
}

/// Splits `---\nkey: value\n---\nbody` into its frontmatter fields and its body.
/// A file without frontmatter is all body, which is what a bare prompt file is.
///
/// Values may span several lines: `description: >` (or `|`) folds the indented
/// block that follows into one value, and a plain key whose value continues on
/// indented lines is folded the same way. Without that, a folded description
/// imports as the single character `>`.
fn split_frontmatter(content: &str) -> (Vec<(String, String)>, String) {
    let Some(rest) = content.strip_prefix("---") else {
        return (Vec::new(), content.trim().to_string());
    };
    let rest = rest.trim_start_matches(['\r', '\n']);
    let Some(end) = rest.find("\n---") else {
        return (Vec::new(), content.trim().to_string());
    };
    let (head, tail) = rest.split_at(end);

    let mut fields: Vec<(String, String)> = Vec::new();
    for line in head.lines() {
        let is_continuation = line.starts_with(' ') || line.starts_with('\t');
        if is_continuation {
            if let Some((_, value)) = fields.last_mut() {
                let piece = line.trim();
                if !piece.is_empty() {
                    if !value.is_empty() {
                        value.push(' ');
                    }
                    value.push_str(piece);
                }
            }
            continue;
        }
        let Some((key, value)) = line.split_once(':') else { continue };
        // `>` and `|` announce a block; the text itself is on the lines below.
        let value = value.trim();
        let value = if matches!(value, ">" | "|" | ">-" | "|-" | ">+" | "|+") {
            ""
        } else {
            value
        };
        fields.push((
            key.trim().to_lowercase(),
            value.trim_matches('"').trim_matches('\'').to_string(),
        ));
    }

    let body = tail
        .trim_start_matches('\n')
        .trim_start_matches("---")
        .trim()
        .to_string();
    (fields, body)
}

/// Claude Code names its agent colours; Cairn stores a hex. An unknown name is
/// left to the caller, which falls back to a Cairn preset.
fn hex_for_color_name(name: &str) -> String {
    match name.trim().to_lowercase().as_str() {
        "red" => "#ef4444",
        "orange" => "#f97316",
        "yellow" => "#eab308",
        "green" => "#22c55e",
        "cyan" => "#06b6d4",
        "blue" => "#6c8eff",
        "purple" => "#a855f7",
        "pink" => "#ec4899",
        other if other.starts_with('#') => other,
        _ => "",
    }
    .to_string()
}

/// `tools: Read, Grep, Bash` and `tools: [Read, Grep]` both mean the same list.
/// `*` is Claude Code's "everything", which Cairn expresses as no restriction.
fn parse_tool_list(raw: &str) -> Vec<String> {
    raw.trim()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .split(',')
        .map(|t| t.trim().trim_matches('"').trim_matches('\''))
        .filter(|t| !t.is_empty() && *t != "*")
        .map(str::to_string)
        .collect()
}

fn collect_claude_agents(dir: &Path, scope: &str, out: &mut Vec<DiscoveredAgent>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().is_none_or(|e| e != "md") {
            continue;
        }
        let Ok(content) = fs::read_to_string(&path) else { continue };
        let (fields, body) = split_frontmatter(&content);
        let field = |key: &str| {
            fields
                .iter()
                .find(|(k, _)| k == key)
                .map(|(_, v)| v.clone())
                .unwrap_or_default()
        };

        let name = match field("name") {
            n if !n.is_empty() => n,
            _ => match path.file_stem().and_then(|s| s.to_str()) {
                Some(stem) => stem.to_string(),
                None => continue,
            },
        };

        // Claude Code's `default` permission mode is "whatever the CLI does",
        // which Cairn expresses by leaving the field empty.
        let permission_mode = match field("permissionmode") {
            m if !m.is_empty() => m,
            _ => field("permission-mode"),
        };
        let permission_mode = if permission_mode == "default" {
            String::new()
        } else {
            permission_mode
        };

        out.push(DiscoveredAgent {
            name,
            description: field("description"),
            model: field("model"),
            effort: field("effort"),
            permission_mode,
            color: hex_for_color_name(&field("color")),
            tools: parse_tool_list(&field("tools")),
            system_prompt: body,
            scope: scope.to_string(),
            path: path.to_string_lossy().to_string(),
        });
    }
}

/// Every `.claude/agents` Cairn can see: one per known project, plus the user's
/// own. The same definition reached through two paths is listed once.
#[tauri::command]
pub async fn list_claude_agents(working_dirs: Vec<String>) -> Result<Vec<DiscoveredAgent>, String> {
    let mut out = Vec::new();
    for dir in &working_dirs {
        collect_claude_agents(
            &Path::new(dir).join(".claude").join("agents"),
            "project",
            &mut out,
        );
    }
    if let Some(home) = dirs::home_dir() {
        collect_claude_agents(&home.join(".claude").join("agents"), "global", &mut out);
    }
    out.sort_by(|a, b| a.name.cmp(&b.name).then(a.path.cmp(&b.path)));
    out.dedup_by(|a, b| a.path == b.path);
    Ok(out)
}

#[tauri::command]
pub async fn list_agent_commands(working_dir: String) -> Result<Vec<AgentSlashCommand>, String> {
    let mut out = Vec::new();
    collect_commands(&Path::new(&working_dir).join(".claude").join("commands"), "project", &mut out);
    if let Some(home) = dirs::home_dir() {
        collect_commands(&home.join(".claude").join("commands"), "global", &mut out);
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out.dedup_by(|a, b| a.name == b.name);
    Ok(out)
}
