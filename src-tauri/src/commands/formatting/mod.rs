// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Code formatting: the per-project formatter configuration, running a
//! formatter over a document, and detecting what the repo already uses.

pub mod adapters;
pub mod catalog;

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::child_env;
use crate::commands::toolchain::{
    detect_version, manager_options, owning_manager, resolve_binary, resolve_command,
    spawn_shell, BinaryCache, ManagerOption,
};
use crate::storage::{project_formatting_file, write_json_atomic};
use catalog::{
    find_formatter, formatters_for_extension, language_for_extension,
    StyleSet, FORMATTERS, LSP_FORMATTER_ID, STYLE_OPTIONS,
};

fn default_true() -> bool { true }

/// How one language is formatted. Any style key absent here is inherited.
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct LanguageFormatting {
    pub language_id: String,
    #[serde(default = "default_true")]
    pub enabled:     bool,
    /// Empty falls back to the first catalogue formatter for the language, and
    /// failing that to the language server.
    #[serde(default)]
    pub formatter_id: String,
    /// A binary the user brought themselves. Empty uses the catalogue one.
    #[serde(default)]
    pub command:     String,
    #[serde(default)]
    pub args:        Vec<String>,
    #[serde(default)]
    pub style:       StyleSet,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FormattingConfig {
    #[serde(default = "default_true")]
    pub enabled:            bool,
    #[serde(default)]
    pub format_on_save:     bool,
    /// A config file of the tool itself, at the worktree root, wins over what
    /// Cairn would generate. On by default: matching the repository is almost
    /// always what the user means.
    #[serde(default = "default_true")]
    pub respect_repo_config: bool,
    #[serde(default)]
    pub base:               StyleSet,
    #[serde(default)]
    pub languages:          Vec<LanguageFormatting>,
}

impl Default for FormattingConfig {
    fn default() -> Self {
        Self {
            enabled:             true,
            format_on_save:      false,
            respect_repo_config: true,
            base:                StyleSet::new(),
            languages:           Vec::new(),
        }
    }
}

fn read_config(path: &Path) -> Result<FormattingConfig, String> {
    match std::fs::read_to_string(path) {
        Ok(text) => serde_json::from_str(&text).map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(FormattingConfig::default()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn get_project_formatting(project_id: String) -> Result<FormattingConfig, String> {
    read_config(&project_formatting_file(&project_id)?)
}

#[tauri::command]
pub async fn save_project_formatting(
    project_id: String,
    config: FormattingConfig,
) -> Result<(), String> {
    write_json_atomic(&project_formatting_file(&project_id)?, &config)
}

fn language_entry<'a>(
    config: &'a FormattingConfig,
    language_id: &str,
) -> Option<&'a LanguageFormatting> {
    config.languages.iter().find(|l| l.language_id == language_id)
}

/// The style that applies to one language: the catalogue defaults, then the
/// project's common style, then what the language overrides on top.
pub fn resolve_style(config: &FormattingConfig, language_id: &str) -> StyleSet {
    let mut style = StyleSet::new();
    for def in STYLE_OPTIONS {
        if def.languages.is_empty() || def.languages.contains(&language_id) {
            style.insert(def.id.to_string(), def.default.to_json());
        }
    }
    let mut layer = |set: &StyleSet| {
        for (key, value) in set {
            style.insert(key.clone(), value.clone());
        }
    };
    layer(&config.base);
    if let Some(entry) = language_entry(config, language_id) {
        layer(&entry.style);
    }
    style
}

/// The settings that decide *how* a language is formatted, as opposed to the
/// style itself. A language the project never touched formats with the
/// catalogue's own answer rather than not at all.
fn resolve_entry(config: &FormattingConfig, language_id: &str) -> LanguageFormatting {
    language_entry(config, language_id).cloned().unwrap_or(LanguageFormatting {
        language_id: language_id.to_string(),
        enabled: true,
        ..Default::default()
    })
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FormatterStatus {
    pub id:                &'static str,
    pub name:              &'static str,
    pub binary:            &'static str,
    pub language_ids:      Vec<&'static str>,
    pub extensions:        Vec<&'static str>,
    pub supported:         Vec<&'static str>,
    pub config_files:      Vec<&'static str>,
    pub doc_url:           &'static str,
    /// Ships with its language toolchain: Cairn points at the toolchain rather
    /// than offering an install that would only half work.
    pub toolchain:         bool,
    pub installed:         bool,
    pub binary_path:       Option<String>,
    pub version:           Option<String>,
    /// Found inside the project rather than on the PATH. Nothing is offered for
    /// installation in that case: a second global copy is how versions drift.
    pub project_local:     bool,
    pub install_options:   Vec<ManagerOption>,
    pub uninstall_options: Vec<ManagerOption>,
    pub update_options:    Vec<ManagerOption>,
}

/// Every formatter with its state on this machine. `root` is the worktree, so a
/// binary living in the project's own `node_modules/.bin` is found and reported
/// as the project's rather than as a global install.
#[tauri::command]
pub async fn list_formatters(root: Option<String>) -> Result<Vec<FormatterStatus>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = root.map(PathBuf::from);
        let mut cache = BinaryCache::default();
        FORMATTERS
            .iter()
            .map(|def| {
                let path = cache.resolve(def.binary, root.as_deref());
                let project_local = path
                    .as_ref()
                    .zip(root.as_ref())
                    .map(|(p, root)| p.starts_with(root))
                    .unwrap_or(false);
                let version = path.as_deref().and_then(detect_version);
                FormatterStatus {
                    id: def.id,
                    name: def.name,
                    binary: def.binary,
                    language_ids: def.language_ids.to_vec(),
                    extensions: def.extensions.to_vec(),
                    supported: def.supported.to_vec(),
                    config_files: def.config_files.to_vec(),
                    doc_url: def.doc_url,
                    toolchain: def.toolchain,
                    installed: path.is_some(),
                    binary_path: path.as_ref().map(|p| p.to_string_lossy().to_string()),
                    version,
                    project_local,
                    install_options: if project_local {
                        Vec::new()
                    } else {
                        manager_options(&def.install, &mut cache)
                    },
                    uninstall_options: manager_options(&def.uninstall, &mut cache),
                    update_options: manager_options(&def.update, &mut cache),
                }
            })
            .collect()
    })
    .await
    .map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StyleOptionInfo {
    pub id:        &'static str,
    pub kind:      &'static str,
    pub choices:   Vec<&'static str>,
    pub min:       Option<f64>,
    pub max:       Option<f64>,
    pub default:   Value,
    pub languages: Vec<&'static str>,
}

#[tauri::command]
pub fn list_style_options() -> Vec<StyleOptionInfo> {
    STYLE_OPTIONS
        .iter()
        .map(|o| StyleOptionInfo {
            id:        o.id,
            kind:      o.kind,
            choices:   o.choices.to_vec(),
            min:       o.min,
            max:       o.max,
            default:   o.default.to_json(),
            languages: o.languages.to_vec(),
        })
        .collect()
}

fn extension_of(path: &str) -> String {
    Path::new(path)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

fn temp_config(formatter_id: &str, name: &str, text: &str) -> Result<PathBuf, String> {
    let dir = crate::storage::cairn_dir()?.join("tmp").join("format").join(formatter_id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(name);
    std::fs::write(&path, text).map_err(|e| e.to_string())?;
    Ok(path)
}

/// Substitutes the placeholders in a formatter's argument list. An argument
/// naming a config file that was not generated is dropped, together with the
/// flag in front of it, so a tool is never handed a dangling `--config`.
fn build_args(
    template: &[&str],
    extra: &[String],
    config: Option<&Path>,
    path: &str,
) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();
    for arg in template {
        if arg.contains("{config}") {
            match config {
                Some(config) => {
                    args.push(arg.replace("{config}", &config.to_string_lossy()));
                }
                None => {
                    if args.last().map(|a| a.starts_with('-')).unwrap_or(false) {
                        args.pop();
                    }
                }
            }
            continue;
        }
        args.push(arg.replace("{path}", path));
    }
    args.extend(extra.iter().cloned());
    args
}

fn repo_config_present(def: &catalog::FormatterDef, root: &Path) -> Option<String> {
    def.config_files
        .iter()
        .find(|name| root.join(name).exists())
        .map(|name| name.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatOutcome {
    /// The formatted text. Identical to the input when nothing changed.
    pub text:         String,
    pub changed:      bool,
    /// What did the work, for the status bar: a formatter id, `lsp`, or
    /// `builtin` for the minimal internal pass.
    pub formatter_id: String,
    /// The repository's own config file, when that is what was honoured.
    pub repo_config:  Option<String>,
    /// The style that was in force for this document. Handed back so the caller
    /// can hold the language server to the same indentation when no binary
    /// could be reached, rather than falling back to guessing it from the text.
    pub style:        StyleSet,
}

/// The fallback that runs when no formatter and no language server can be
/// reached. Deliberately incapable of restructuring code: it only touches
/// trailing whitespace and the final newline, so it can never produce a diff
/// the project's own tooling would undo.
fn builtin_format(text: &str, style: &StyleSet) -> String {
    let trim = style.get("trimTrailingWhitespace").and_then(Value::as_bool).unwrap_or(true);
    let final_newline = style.get("finalNewline").and_then(Value::as_bool).unwrap_or(true);
    let crlf = style.get("lineEnding").and_then(Value::as_str) == Some("crlf");

    let mut out = String::with_capacity(text.len());
    let ending = if crlf { "\r\n" } else { "\n" };
    let lines: Vec<&str> = text.split('\n').collect();
    let count = lines.len();
    for (i, line) in lines.into_iter().enumerate() {
        let line = line.strip_suffix('\r').unwrap_or(line);
        out.push_str(if trim { line.trim_end() } else { line });
        if i + 1 < count {
            out.push_str(ending);
        }
    }
    if final_newline && !out.ends_with(ending) && !out.is_empty() {
        out.push_str(ending);
    }
    out
}

/// Formats one document and hands the text back. Never writes to disk: the
/// caller applies the result as an editor transaction, so an undo puts the
/// document back exactly as it was.
#[tauri::command]
pub async fn format_document(
    project_id: Option<String>,
    worktree: String,
    path: String,
    content: String,
) -> Result<FormatOutcome, String> {
    tauri::async_runtime::spawn_blocking(move || {
        // Formatting belongs to a project: with no project there is no config,
        // and the catalogue defaults are what applies.
        let config = match project_id.as_deref() {
            Some(id) => read_config(&project_formatting_file(id)?)?,
            None => FormattingConfig::default(),
        };
        if !config.enabled {
            return Err("formatting is disabled".to_string());
        }

        let ext = extension_of(&path);
        let language_id = language_for_extension(&ext)
            .ok_or_else(|| format!("no formatter knows the .{ext} extension"))?;

        let entry = resolve_entry(&config, language_id);
        if !entry.enabled {
            return Err(format!("formatting is off for {language_id}"));
        }
        let style = resolve_style(&config, language_id);
        let root = PathBuf::from(&worktree);

        // The language server was asked for by name. Nothing is run here: the
        // caller owns the server, and falling through to the catalogue would
        // silently run a tool the project deliberately turned down.
        if entry.formatter_id == LSP_FORMATTER_ID {
            return Ok(FormatOutcome {
                changed: false,
                text: content,
                formatter_id: LSP_FORMATTER_ID.to_string(),
                repo_config: None,
                style,
            });
        }

        let def = if entry.formatter_id.is_empty() {
            formatters_for_extension(&ext).first().copied()
        } else {
            find_formatter(&entry.formatter_id)
        };

        let Some(def) = def else {
            return Ok(FormatOutcome {
                changed: builtin_format(&content, &style) != content,
                text: builtin_format(&content, &style),
                formatter_id: "builtin".into(),
                repo_config: None,
                style,
            });
        };

        let binary = if entry.command.is_empty() {
            resolve_binary(def.binary, Some(&root))
        } else {
            resolve_binary(&entry.command, Some(&root))
        };

        let Some(binary) = binary else {
            // No binary: the caller falls back to the language server, and to
            // the builtin pass only if that is not running either.
            return Ok(FormatOutcome {
                changed: false,
                text: content,
                formatter_id: String::new(),
                repo_config: None,
                style,
            });
        };

        let repo_config = if config.respect_repo_config {
            repo_config_present(def, &root)
        } else {
            None
        };

        let config = match repo_config {
            // The tool reads the repository's file on its own; handing it a
            // generated one would override exactly what we mean to defer to.
            Some(_) => None,
            None => match adapters::generate_config(def.id, &style) {
                Some((name, text)) => Some(temp_config(def.id, &name, &text)?),
                None => None,
            },
        };

        let template: Vec<&str> = if entry.args.is_empty() {
            def.args.to_vec()
        } else {
            entry.args.iter().map(String::as_str).collect()
        };
        let extra = adapters::extra_args(def.id, &style);
        let args = build_args(&template, &extra, config.as_deref(), &path);

        let mut child = child_env::command(&binary)
            .args(&args)
            .current_dir(&root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("could not run {}: {e}", def.name))?;

        child
            .stdin
            .take()
            .ok_or("the formatter refused its input")?
            .write_all(content.as_bytes())
            .map_err(|e| e.to_string())?;

        let output = child.wait_with_output().map_err(|e| e.to_string())?;
        if !output.status.success() {
            let error = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(if error.is_empty() {
                format!("{} failed", def.name)
            } else {
                error
            });
        }

        let text = String::from_utf8(output.stdout)
            .map_err(|_| format!("{} answered with something that is not text", def.name))?;
        // A formatter that printed nothing has not "emptied the file": it
        // failed quietly, and applying that would destroy the document.
        if text.is_empty() && !content.is_empty() {
            return Err(format!("{} returned nothing", def.name));
        }

        Ok(FormatOutcome {
            changed: text != content,
            text,
            formatter_id: def.id.to_string(),
            repo_config,
            style,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedConfig {
    pub formatter_id: String,
    pub file:         String,
}

/// The formatter config files sitting at the root of a worktree, so a project
/// whose formatting is not set up yet can be offered what it already uses.
#[tauri::command]
pub async fn detect_repo_formatters(worktree: String) -> Result<Vec<DetectedConfig>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = PathBuf::from(worktree);
        let mut found = Vec::new();
        for def in FORMATTERS {
            if let Some(file) = repo_config_present(def, &root) {
                found.push(DetectedConfig { formatter_id: def.id.to_string(), file });
            }
        }
        if root.join(".editorconfig").exists() {
            found.push(DetectedConfig {
                formatter_id: "editorconfig".into(),
                file: ".editorconfig".into(),
            });
        }
        found
    })
    .await
    .map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    #[serde(flatten)]
    pub report: adapters::ImportReport,
    /// A whole config, when the file was Cairn's own export rather than a
    /// foreign tool's.
    pub config: Option<FormattingConfig>,
}

/// Reads a foreign or native config file into Cairn's model. The result is a
/// report the UI shows before anything is applied.
#[tauri::command]
pub async fn import_formatting_config(path: String) -> Result<ImportResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let file = PathBuf::from(&path);
        let name = file
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let text = std::fs::read_to_string(&file).map_err(|e| e.to_string())?;
        let empty = adapters::ImportReport::default();

        let json_object = |text: &str| -> Result<Map<String, Value>, String> {
            match serde_json::from_str::<Value>(text) {
                Ok(Value::Object(map)) => Ok(map),
                Ok(_) => Err(format!("{name} is not a configuration object")),
                Err(e) => Err(format!("{name} is not valid JSON: {e}")),
            }
        };
        let toml_table = |text: &str| -> Result<toml::value::Table, String> {
            toml::from_str(text).map_err(|e| format!("{name} is not valid TOML: {e}"))
        };

        let report = match name.as_str() {
            ".cairnformat" | ".cairnformat.json" => {
                let config: FormattingConfig = serde_json::from_str(&text)
                    .map_err(|e| format!("{name} is not a Cairn formatting config: {e}"))?;
                return Ok(ImportResult {
                    report: adapters::ImportReport {
                        source: "cairn".into(),
                        style: config.base.clone(),
                        ..empty
                    },
                    config: Some(config),
                });
            }
            ".editorconfig" => adapters::import_editorconfig(&text),
            ".clang-format" | "_clang-format" => {
                adapters::import_clang_format(&adapters::parse_flat_yaml(&text))
            }
            "biome.json" | "biome.jsonc" => adapters::import_biome(&json_object(&text)?),
            "rustfmt.toml" | ".rustfmt.toml" => adapters::import_rustfmt(&toml_table(&text)?),
            "pyproject.toml" => adapters::import_pyproject(&toml_table(&text)?),
            "ruff.toml" | ".ruff.toml" => {
                let table = toml_table(&text)?;
                let mut wrapped = toml::value::Table::new();
                let mut tool = toml::value::Table::new();
                tool.insert("ruff".into(), toml::Value::Table(table));
                wrapped.insert("tool".into(), toml::Value::Table(tool));
                adapters::import_pyproject(&wrapped)
            }
            "package.json" => {
                let map = json_object(&text)?;
                match map.get("prettier").and_then(Value::as_object) {
                    Some(section) => adapters::import_prettier(section),
                    None => {
                        return Err("package.json carries no prettier section".to_string());
                    }
                }
            }
            _ if name.starts_with(".prettierrc") || name.starts_with("prettier.config") => {
                if name.ends_with(".js") || name.ends_with(".mjs") || name.ends_with(".cjs") {
                    return Err(format!(
                        "{name} is JavaScript: Cairn reads the JSON and YAML forms, not code"
                    ));
                }
                if name.ends_with(".yaml") || name.ends_with(".yml") {
                    adapters::import_prettier(&adapters::flat_yaml_as_json(&text))
                } else {
                    // A bare `.prettierrc` is JSON in the common case, and YAML
                    // in the rest; the JSON reading is tried first.
                    match serde_json::from_str::<Value>(&text) {
                        Ok(Value::Object(map)) => adapters::import_prettier(&map),
                        _ => adapters::import_prettier(&adapters::flat_yaml_as_json(&text)),
                    }
                }
            }
            _ => return Err(format!("Cairn does not know how to read {name}")),
        };

        Ok(ImportResult { report, config: None })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub path:    String,
    /// Style options the target format cannot express.
    pub dropped: Vec<String>,
}

/// Writes the resolved style out, either as Cairn's own format or as a tool's.
#[tauri::command]
pub async fn export_formatting_config(
    path: String,
    target: String,
    config: FormattingConfig,
    style: StyleSet,
) -> Result<ExportResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exported = match target.as_str() {
            "cairn" => adapters::Exported {
                text: serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?,
                dropped: Vec::new(),
            },
            "prettier" => adapters::export_prettier(&style),
            "biome" => adapters::export_biome(&style),
            "rustfmt" => adapters::export_rustfmt(&style),
            "ruff" => adapters::export_ruff(&style),
            "black" => adapters::export_black(&style),
            "clang-format" => adapters::export_clang_format(&style),
            "editorconfig" => adapters::export_editorconfig(&style),
            other => return Err(format!("no exporter for {other}")),
        };
        std::fs::write(&path, &exported.text).map_err(|e| e.to_string())?;
        Ok(ExportResult { path, dropped: exported.dropped })
    })
    .await
    .map_err(|e| e.to_string())?
}

fn manager_for(formatter_id: &str, kind: &str) -> Result<Option<String>, String> {
    let def = find_formatter(formatter_id)
        .ok_or_else(|| format!("unknown formatter: {formatter_id}"))?;
    let commands = match kind {
        "uninstall" => &def.uninstall,
        _ => &def.update,
    };
    let mut cache = BinaryCache::default();
    let options = manager_options(commands, &mut cache);
    let owner = cache.resolve(def.binary, None).as_deref().and_then(owning_manager);
    let chosen = owner
        .and_then(|owner| options.iter().find(|o| o.manager == owner && o.available))
        .or_else(|| options.iter().find(|o| o.available));
    Ok(chosen.map(|o| o.manager.to_string()))
}

#[tauri::command]
pub async fn uninstall_manager_for_formatter(formatter_id: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || manager_for(&formatter_id, "uninstall"))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn update_manager_for_formatter(formatter_id: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || manager_for(&formatter_id, "update"))
        .await
        .map_err(|e| e.to_string())?
}

async fn run_formatter_manager(
    formatter_id: String,
    manager: String,
    kind: &'static str,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let def = find_formatter(&formatter_id)
            .ok_or_else(|| format!("unknown formatter: {formatter_id}"))?;
        if def.toolchain {
            return Err(format!(
                "{} ships with its toolchain: install the toolchain instead",
                def.name
            ));
        }
        let commands = match kind {
            "install" => &def.install,
            "uninstall" => &def.uninstall,
            _ => &def.update,
        };
        let command = resolve_command(commands, &manager)
            .ok_or_else(|| format!("{} has no {manager} command", def.name))?;

        let child = spawn_shell(command).map_err(|e| format!("failed to run the command: {e}"))?;
        let output = child.wait_with_output().map_err(|e| e.to_string())?;
        let text = format!(
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        if output.status.success() {
            Ok(text)
        } else {
            Err(if text.trim().is_empty() { "the command failed".into() } else { text })
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn install_formatter(formatter_id: String, manager: String) -> Result<String, String> {
    run_formatter_manager(formatter_id, manager, "install").await
}

#[tauri::command]
pub async fn uninstall_formatter(formatter_id: String, manager: String) -> Result<String, String> {
    run_formatter_manager(formatter_id, manager, "uninstall").await
}

#[tauri::command]
pub async fn update_formatter(formatter_id: String, manager: String) -> Result<String, String> {
    run_formatter_manager(formatter_id, manager, "update").await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn config(base: &[(&str, Value)], languages: Vec<LanguageFormatting>) -> FormattingConfig {
        FormattingConfig {
            base: base.iter().map(|(k, v)| (k.to_string(), v.clone())).collect(),
            languages,
            ..Default::default()
        }
    }

    fn language(id: &str, style: &[(&str, Value)]) -> LanguageFormatting {
        LanguageFormatting {
            language_id: id.to_string(),
            enabled: true,
            style: style.iter().map(|(k, v)| (k.to_string(), v.clone())).collect(),
            ..Default::default()
        }
    }

    #[test]
    fn the_catalogue_default_is_the_floor() {
        let style = resolve_style(&FormattingConfig::default(), "typescript");
        assert_eq!(style["indentSize"], json!(2.0));
        assert_eq!(style["lineWidth"], json!(80.0));
    }

    #[test]
    fn a_language_override_wins_over_the_common_style() {
        let config = config(&[("lineWidth", json!(100.0))], vec![
            language("typescript", &[("lineWidth", json!(120.0))]),
        ]);
        assert_eq!(resolve_style(&config, "typescript")["lineWidth"], json!(120.0));
        // A language that overrides nothing still follows the common style.
        assert_eq!(resolve_style(&config, "rust")["lineWidth"], json!(100.0));
    }

    #[test]
    fn a_partial_override_leaves_the_rest_on_the_common_style() {
        let config = config(&[("lineWidth", json!(100.0)), ("indentSize", json!(4.0))], vec![
            language("rust", &[("indentSize", json!(8.0))]),
        ]);
        let resolved = resolve_style(&config, "rust");
        assert_eq!(resolved["indentSize"], json!(8.0));
        assert_eq!(resolved["lineWidth"], json!(100.0));
    }

    #[test]
    fn a_language_only_option_stays_out_of_other_languages() {
        let rust = resolve_style(&FormattingConfig::default(), "rust");
        assert!(rust.contains_key("reorderImports"));
        assert!(!rust.contains_key("quoteStyle"));

        let ts = resolve_style(&FormattingConfig::default(), "typescript");
        assert!(ts.contains_key("quoteStyle"));
        assert!(!ts.contains_key("reorderImports"));
    }

    #[test]
    fn a_language_the_project_never_touched_still_formats() {
        let entry = resolve_entry(&FormattingConfig::default(), "typescript");
        assert!(entry.enabled);
        assert!(entry.formatter_id.is_empty());
    }

    #[test]
    fn the_language_server_is_a_choice_of_its_own() {
        // Empty means "whatever the catalogue picks"; the sentinel means the
        // catalogue is not consulted at all. The two must never collapse.
        let config = config(&[], vec![LanguageFormatting {
            language_id: "typescript".into(),
            enabled: true,
            formatter_id: LSP_FORMATTER_ID.into(),
            ..Default::default()
        }]);
        assert_eq!(resolve_entry(&config, "typescript").formatter_id, LSP_FORMATTER_ID);
        assert!(find_formatter(LSP_FORMATTER_ID).is_none());
        assert!(resolve_entry(&FormattingConfig::default(), "typescript").formatter_id.is_empty());
    }

    #[test]
    fn the_project_entry_is_what_decides() {
        let config = config(&[], vec![LanguageFormatting {
            language_id: "typescript".into(),
            enabled: false,
            formatter_id: "biome".into(),
            command: "/usr/bin/biome".into(),
            ..Default::default()
        }]);
        let entry = resolve_entry(&config, "typescript");
        assert!(!entry.enabled);
        assert_eq!(entry.formatter_id, "biome");
        assert_eq!(entry.command, "/usr/bin/biome");
    }

    #[test]
    fn a_missing_config_drops_its_flag_with_it() {
        let template = ["--config", "{config}", "--stdin-filepath", "{path}"];
        let args = build_args(&template, &[], None, "a.ts");
        assert_eq!(args, vec!["--stdin-filepath", "a.ts"]);
    }

    #[test]
    fn a_config_fills_its_placeholder() {
        let template = ["--style=file:{config}", "--assume-filename={path}"];
        let args = build_args(&template, &[], Some(Path::new("/tmp/.clang-format")), "a.c");
        assert_eq!(args, vec!["--style=file:/tmp/.clang-format", "--assume-filename=a.c"]);
    }

    #[test]
    fn extra_args_land_after_the_template() {
        let args = build_args(&[], &["-i".to_string(), "4".to_string()], None, "a.sh");
        assert_eq!(args, vec!["-i", "4"]);
    }

    #[test]
    fn the_builtin_pass_only_touches_whitespace() {
        let style: StyleSet = [
            ("trimTrailingWhitespace".to_string(), json!(true)),
            ("finalNewline".to_string(), json!(true)),
        ]
        .into_iter()
        .collect();
        assert_eq!(builtin_format("a   \nb\t\n", &style), "a\nb\n");
        assert_eq!(builtin_format("no newline   ", &style), "no newline\n");
        // Structure is left exactly as it was.
        assert_eq!(builtin_format("if(x){y}\n", &style), "if(x){y}\n");
    }

    #[test]
    fn the_builtin_pass_can_write_crlf() {
        let style: StyleSet = [("lineEnding".to_string(), json!("crlf"))].into_iter().collect();
        assert_eq!(builtin_format("a\nb\n", &style), "a\r\nb\r\n");
    }

    #[test]
    fn an_empty_document_stays_empty() {
        let style: StyleSet = [("finalNewline".to_string(), json!(true))].into_iter().collect();
        assert_eq!(builtin_format("", &style), "");
    }

    #[test]
    fn an_extension_is_read_case_insensitively() {
        assert_eq!(extension_of("/a/b/File.TS"), "ts");
        assert_eq!(extension_of("/a/b/noext"), "");
    }

    #[test]
    fn a_config_from_an_older_version_still_loads() {
        let older = r#"{"enabled":true,"base":{"lineWidth":100}}"#;
        let config: FormattingConfig = serde_json::from_str(older).unwrap();
        assert!(config.respect_repo_config);
        assert!(!config.format_on_save);
        assert!(config.languages.is_empty());
    }
}
