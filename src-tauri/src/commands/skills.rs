// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Agent skills: the skill files on disk, their resources, and the commands the
//! frontend edits them through.

use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::commands::cli_providers::{
    skill_providers_at, skill_roots, unique_providers, CLI_PROVIDERS,
};

const MAX_RESOURCE_DEPTH: usize = 4;
const MANIFEST: &str = "SKILL.md";

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SkillResource {
    pub name: String,
    pub path: String,
    pub size: u64,
}

/// One directory a skill lives in, and the agents that read that directory.
/// Several agents share roots - `~/.agents/skills` is read by Codex, Copilot
/// and Vibe - so a location carries a list, not a single provider.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SkillLocation {
    pub path: String,
    pub providers: Vec<String>,
    pub read_only: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    pub id: String,
    pub name: String,
    pub description: String,
    pub when_to_use: String,
    pub allowed_tools: Vec<String>,
    pub paths: String,
    pub model: String,
    pub license: String,
    pub disable_model_invocation: bool,
    pub extra_frontmatter: String,
    pub body: String,
    pub scope: String,
    pub project_id: String,
    pub project_name: String,
    pub plugin: String,
    /// The location the editor reads from: the first one found.
    pub path: String,
    pub locations: Vec<SkillLocation>,
    /// Union of every location's providers.
    pub providers: Vec<String>,
    /// Two copies of this skill hold a different `SKILL.md`. Saving realigns
    /// them on whatever the editor is showing.
    pub divergent: bool,
    pub read_only: bool,
    pub resources: Vec<SkillResource>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SkillProject {
    pub id: String,
    pub name: String,
    pub path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInput {
    #[serde(default)]
    pub original_paths: Vec<String>,
    /// The agents this skill should be readable by after the save. Anything it
    /// currently lives in and that is not listed here is removed.
    #[serde(default)]
    pub targets: Vec<String>,
    pub scope: String,
    #[serde(default)]
    pub project_id: String,
    #[serde(default)]
    pub project_path: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub when_to_use: String,
    #[serde(default)]
    pub allowed_tools: Vec<String>,
    #[serde(default)]
    pub paths: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub license: String,
    #[serde(default)]
    pub disable_model_invocation: bool,
    #[serde(default)]
    pub extra_frontmatter: String,
    #[serde(default)]
    pub body: String,
}

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

/// The frontmatter of a `SKILL.md`, split into the keys Cairn edits and the raw
/// lines it does not understand. Those lines are written back untouched, so a
/// field Cairn never heard of survives a round trip through the editor.
#[derive(Default)]
pub(crate) struct Frontmatter {
    pub known: HashMap<String, String>,
    pub extra: String,
}

fn canonical_key(key: &str) -> String {
    key.trim().to_lowercase().replace('_', "-")
}

/// Unwraps a YAML scalar: a quoted string loses its quotes and its escapes, a
/// plain one only loses a trailing comment it never meant to carry.
pub(crate) fn parse_scalar(raw: &str) -> String {
    let value = raw.trim();
    if value.len() >= 2 && value.starts_with('"') && value.ends_with('"') {
        let inner = &value[1..value.len() - 1];
        let mut out = String::with_capacity(inner.len());
        let mut chars = inner.chars();
        while let Some(c) = chars.next() {
            if c != '\\' {
                out.push(c);
                continue;
            }
            match chars.next() {
                Some('n') => out.push('\n'),
                Some('t') => out.push('\t'),
                Some(other) => out.push(other),
                None => {}
            }
        }
        return out;
    }
    if value.len() >= 2 && value.starts_with('\'') && value.ends_with('\'') {
        return value[1..value.len() - 1].replace("''", "'");
    }
    value.to_string()
}

/// Splits on the commas that separate items, not on the ones nested inside a
/// tool pattern such as `Bash(git add, git commit)`.
fn split_items(raw: &str) -> Vec<String> {
    let mut items = Vec::new();
    let mut current = String::new();
    let mut depth = 0usize;
    for c in raw.chars() {
        match c {
            '(' | '[' => {
                depth += 1;
                current.push(c);
            }
            ')' | ']' => {
                depth = depth.saturating_sub(1);
                current.push(c);
            }
            ',' if depth == 0 => {
                items.push(current.trim().to_string());
                current.clear();
            }
            _ => current.push(c),
        }
    }
    items.push(current.trim().to_string());
    items.into_iter().filter(|s| !s.is_empty()).collect()
}

pub fn parse_tool_list(raw: &str) -> Vec<String> {
    let trimmed = raw.trim();
    let inner = trimmed
        .strip_prefix('[')
        .and_then(|s| s.strip_suffix(']'))
        .unwrap_or(trimmed);
    split_items(inner)
        .into_iter()
        .map(|item| parse_scalar(&item))
        .filter(|item| !item.is_empty())
        .collect()
}

fn is_top_level_key(line: &str) -> Option<(String, String)> {
    if line.starts_with(char::is_whitespace) || line.starts_with('-') || line.starts_with('#') {
        return None;
    }
    let (key, rest) = line.split_once(':')?;
    if key.is_empty() || !key.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '-') {
        return None;
    }
    Some((canonical_key(key), rest.to_string()))
}

const KNOWN_KEYS: [&str; 8] = [
    "name",
    "description",
    "when-to-use",
    "allowed-tools",
    "paths",
    "model",
    "license",
    "disable-model-invocation",
];

/// Splits a markdown manifest into its frontmatter and its body. A file without
/// frontmatter is all body, which is what a hand-written skill often is.
///
/// `known` is the set of keys the caller edits; everything else is collected
/// verbatim into `extra` and written back untouched, so a field this Cairn
/// never heard of survives a round trip through the editor.
pub(crate) fn split_manifest(content: &str, known: &[&str]) -> (Frontmatter, String) {
    let normalized = content.replace("\r\n", "\n");
    let Some(rest) = normalized.strip_prefix("---\n") else {
        return (Frontmatter::default(), normalized);
    };
    let Some(end) = rest.find("\n---") else {
        return (Frontmatter::default(), normalized);
    };
    let raw = &rest[..end];
    let body = rest[end + 4..].trim_start_matches('\n').to_string();

    let mut front = Frontmatter::default();
    let mut extra_lines: Vec<String> = Vec::new();
    let mut current_known: Option<String> = None;
    let mut current_extra = false;
    // `>` folds its lines into one sentence, `|` keeps the breaks. Either way
    // the value is on the lines below, never on the key line.
    let mut block: Option<char> = None;

    for line in raw.lines() {
        if let Some((key, value)) = is_top_level_key(line) {
            current_extra = !known.contains(&key.as_str());
            if current_extra {
                current_known = None;
                block = None;
                extra_lines.push(line.to_string());
                continue;
            }
            let value = value.trim();
            block = value.starts_with(['>', '|']).then(|| value.as_bytes()[0] as char);
            front.known.insert(
                key.clone(),
                if block.is_some() { String::new() } else { value.to_string() },
            );
            current_known = Some(key);
            continue;
        }
        if current_extra {
            extra_lines.push(line.to_string());
            continue;
        }
        let Some(key) = &current_known else { continue };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let is_item = trimmed == "-" || trimmed.starts_with("- ");
        let text = if is_item { trimmed[1..].trim() } else { trimmed };
        if text.is_empty() {
            continue;
        }
        let entry = front.known.entry(key.clone()).or_default();
        if !entry.is_empty() {
            entry.push_str(match block {
                Some('|') => "\n",
                Some(_) => " ",
                None if is_item => ", ",
                None => " ",
            });
        }
        entry.push_str(text);
    }

    front.extra = extra_lines.join("\n");
    (front, body)
}

/// Emits a value that reads back as the same string: plain when YAML cannot
/// misread it, double quoted otherwise.
pub(crate) fn write_scalar(value: &str) -> String {
    if value.is_empty() {
        return "\"\"".to_string();
    }
    let risky = value.contains(": ")
        || value.contains(" #")
        || value.contains('\n')
        || value.contains('"')
        || value.ends_with(':')
        || value.trim() != value
        || value.starts_with(['&', '*', '!', '|', '>', '%', '@', '`', '{', '[', '\'', '"', '?', '-']);
    if !risky {
        return value.to_string();
    }
    let escaped = value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n");
    format!("\"{escaped}\"")
}

pub(crate) fn write_tool_list(tools: &[String]) -> String {
    tools
        .iter()
        .map(|tool| {
            if tool.contains(',') || tool.contains(": ") {
                format!("\"{}\"", tool.replace('"', "\\\""))
            } else {
                tool.clone()
            }
        })
        .collect::<Vec<_>>()
        .join(", ")
}

fn render_manifest(input: &SkillInput, name: &str) -> String {
    let mut out = String::from("---\n");
    out.push_str(&format!("name: {}\n", write_scalar(name)));
    out.push_str(&format!("description: {}\n", write_scalar(input.description.trim())));
    if !input.when_to_use.trim().is_empty() {
        out.push_str(&format!("when_to_use: {}\n", write_scalar(input.when_to_use.trim())));
    }
    let tools: Vec<String> = input
        .allowed_tools
        .iter()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .collect();
    if !tools.is_empty() {
        out.push_str(&format!("allowed-tools: {}\n", write_tool_list(&tools)));
    }
    if !input.paths.trim().is_empty() {
        out.push_str(&format!("paths: {}\n", write_scalar(input.paths.trim())));
    }
    if !input.model.trim().is_empty() {
        out.push_str(&format!("model: {}\n", write_scalar(input.model.trim())));
    }
    if !input.license.trim().is_empty() {
        out.push_str(&format!("license: {}\n", write_scalar(input.license.trim())));
    }
    if input.disable_model_invocation {
        out.push_str("disable-model-invocation: true\n");
    }
    let extra = input.extra_frontmatter.trim_end();
    if !extra.is_empty() {
        out.push_str(extra);
        out.push('\n');
    }
    out.push_str("---\n\n");
    out.push_str(input.body.trim_start_matches('\n').trim_end());
    out.push('\n');
    out
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

fn collect_resources(dir: &Path, prefix: &str, depth: usize, out: &mut Vec<SkillResource>) {
    if depth > MAX_RESOURCE_DEPTH {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else { return };
    let mut names: Vec<_> = entries.flatten().collect();
    names.sort_by_key(|e| e.file_name());
    for entry in names {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|s| s.to_str()) else { continue };
        if name.starts_with('.') || (depth == 0 && name == MANIFEST) {
            continue;
        }
        let relative = if prefix.is_empty() { name.to_string() } else { format!("{prefix}/{name}") };
        if path.is_dir() {
            collect_resources(&path, &relative, depth + 1, out);
            continue;
        }
        out.push(SkillResource {
            name: relative,
            path: path.to_string_lossy().to_string(),
            size: entry.metadata().map(|m| m.len()).unwrap_or(0),
        });
    }
}

/// One directory holding a `SKILL.md`, before the copies of the same skill are
/// folded together.
struct Found {
    slug: String,
    dir: PathBuf,
    raw: String,
}

fn collect_dir(dir: &Path, out: &mut Vec<Found>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    let mut paths: Vec<_> = entries.flatten().map(|e| e.path()).collect();
    paths.sort();
    for path in paths {
        if !path.is_dir() {
            continue;
        }
        let Ok(raw) = fs::read_to_string(path.join(MANIFEST)) else { continue };
        let Some(slug) = path.file_name().and_then(|s| s.to_str()) else { continue };
        out.push(Found { slug: slug.to_string(), dir: path.clone(), raw });
    }
}

#[derive(Deserialize)]
struct InstalledPlugin {
    #[serde(rename = "installPath")]
    install_path: String,
}

#[derive(Deserialize)]
struct InstalledPlugins {
    #[serde(default)]
    plugins: HashMap<String, Vec<InstalledPlugin>>,
}

fn collect_plugin_skills(home: &Path, out: &mut Vec<(String, Vec<Found>)>) {
    let manifest = home.join(".claude").join("plugins").join("installed_plugins.json");
    let Ok(raw) = fs::read_to_string(&manifest) else { return };
    let Ok(installed) = serde_json::from_str::<InstalledPlugins>(&raw) else { return };
    for (key, entries) in &installed.plugins {
        let plugin = key.split('@').next().unwrap_or(key);
        for entry in entries {
            let mut found = Vec::new();
            collect_dir(&Path::new(&entry.install_path).join("skills"), &mut found);
            if !found.is_empty() {
                out.push((plugin.to_string(), found));
            }
        }
    }
}

/// Turns the copies of one skill into a single entry. The first location is
/// the one the editor reads; the others are recorded so the save can realign
/// them, and a difference between the manifests is reported rather than hidden.
fn fold(
    scope: &str,
    project: Option<&SkillProject>,
    plugin: &str,
    project_path: &str,
    slug: String,
    copies: Vec<Found>,
) -> Option<Skill> {
    let first = copies.first()?;
    let (front, body) = split_manifest(&first.raw, &KNOWN_KEYS);
    let get = |key: &str| front.known.get(key).map(|v| parse_scalar(v)).unwrap_or_default();

    let project_id = project.map(|p| p.id.clone()).unwrap_or_default();
    let read_only = scope == "plugin";
    let mut resources = Vec::new();
    collect_resources(&first.dir, "", 0, &mut resources);

    let locations: Vec<SkillLocation> = copies
        .iter()
        .map(|copy| SkillLocation {
            path: copy.dir.to_string_lossy().to_string(),
            providers: if read_only {
                Vec::new()
            } else {
                skill_providers_at(copy.dir.parent().unwrap_or(&copy.dir), scope, project_path)
            },
            read_only,
        })
        .collect();

    let providers = unique_providers(locations.iter().flat_map(|l| l.providers.clone()));

    Some(Skill {
        id: format!("{scope}:{project_id}:{plugin}:{slug}"),
        name: slug,
        description: get("description"),
        when_to_use: get("when-to-use"),
        allowed_tools: front
            .known
            .get("allowed-tools")
            .map(|v| parse_tool_list(v))
            .unwrap_or_default(),
        paths: get("paths"),
        model: get("model"),
        license: get("license"),
        disable_model_invocation: get("disable-model-invocation") == "true",
        extra_frontmatter: front.extra,
        body,
        scope: scope.to_string(),
        project_id,
        project_name: project.map(|p| p.name.clone()).unwrap_or_default(),
        plugin: plugin.to_string(),
        path: first.dir.to_string_lossy().to_string(),
        locations,
        providers,
        divergent: copies.iter().any(|c| c.raw != first.raw),
        read_only,
        resources,
    })
}

/// Scans every root of every agent, keyed by skill name. A root two agents
/// share is scanned once, so a skill living there is one entry carrying both.
fn scan_scope(
    scope: &str,
    project: Option<&SkillProject>,
    project_path: &str,
    out: &mut Vec<Skill>,
) {
    let mut seen: Vec<PathBuf> = Vec::new();
    let mut groups: BTreeMap<String, Vec<Found>> = BTreeMap::new();

    for provider in CLI_PROVIDERS {
        for root in skill_roots(provider.id, scope, project_path) {
            if seen.contains(&root) {
                continue;
            }
            seen.push(root.clone());
            let mut found = Vec::new();
            collect_dir(&root, &mut found);
            for item in found {
                groups.entry(item.slug.clone()).or_default().push(item);
            }
        }
    }

    for (slug, copies) in groups {
        if let Some(skill) = fold(scope, project, "", project_path, slug, copies) {
            out.push(skill);
        }
    }
}

#[tauri::command]
pub async fn list_skills(projects: Vec<SkillProject>) -> Result<Vec<Skill>, String> {
    let mut out = Vec::new();
    scan_scope("global", None, "", &mut out);

    if let Some(home) = dirs::home_dir() {
        let mut plugins = Vec::new();
        collect_plugin_skills(&home, &mut plugins);
        for (plugin, found) in plugins {
            let mut groups: BTreeMap<String, Vec<Found>> = BTreeMap::new();
            for item in found {
                groups.entry(item.slug.clone()).or_default().push(item);
            }
            for (slug, copies) in groups {
                if let Some(skill) = fold("plugin", None, &plugin, "", slug, copies) {
                    out.push(skill);
                }
            }
        }
    }

    for project in &projects {
        scan_scope("project", Some(project), &project.path, &mut out);
    }

    out.sort_by_key(|a| a.name.to_lowercase());
    Ok(out)
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/// The directory name is what `/name` invokes, so it has to survive being typed
/// at a prompt: lowercase, no spaces, no separators of its own.
pub fn slugify(name: &str) -> String {
    let mut slug = String::new();
    let mut dash = false;
    for c in name.trim().chars() {
        if c.is_ascii_alphanumeric() {
            slug.push(c.to_ascii_lowercase());
            dash = false;
        } else if !slug.is_empty() && !dash {
            slug.push('-');
            dash = true;
        }
    }
    slug.trim_end_matches('-').to_string()
}

/// The directories the chosen agents write to, deduplicated: two agents that
/// share a root get one directory, written once.
fn write_roots(scope: &str, project_path: &str, targets: &[String]) -> Result<Vec<PathBuf>, String> {
    if scope != "global" && scope != "project" {
        return Err(format!("Cannot write a {scope} skill"));
    }
    if scope == "project" && project_path.is_empty() {
        return Err("A project skill needs a project".to_string());
    }
    if targets.is_empty() {
        return Err("Pick at least one agent for this skill".to_string());
    }

    let mut roots: Vec<PathBuf> = Vec::new();
    for target in targets {
        let Some(root) = skill_roots(target, scope, project_path).into_iter().next() else {
            return Err(format!("{target} has no skills directory in that scope"));
        };
        if !roots.contains(&root) {
            roots.push(root);
        }
    }
    Ok(roots)
}

/// A path is a skill directory only if it holds a `SKILL.md` and sits directly
/// under a `skills` directory. Anything else is refused rather than deleted.
fn ensure_skill_dir(path: &Path) -> Result<(), String> {
    if !path.join(MANIFEST).is_file() {
        return Err("Not a skill directory".to_string());
    }
    let parent = path.parent().and_then(|p| p.file_name()).and_then(|s| s.to_str());
    if parent != Some("skills") {
        return Err("Not a skill directory".to_string());
    }
    Ok(())
}

/// Writes the skill to every agent that should read it, and takes it out of the
/// ones that no longer should. A directory already in place is renamed rather
/// than recreated, so the files bundled next to the manifest stay put; a root
/// gaining the skill receives a copy of those files too.
#[tauri::command]
pub async fn save_skill(input: SkillInput) -> Result<Vec<String>, String> {
    let slug = slugify(&input.name);
    if slug.is_empty() {
        return Err("A skill needs a name".to_string());
    }
    let roots = write_roots(&input.scope, &input.project_path, &input.targets)?;
    let manifest = render_manifest(&input, &slug);

    let mut kept: Vec<PathBuf> = Vec::new();
    let mut dropped: Vec<PathBuf> = Vec::new();
    for original in &input.original_paths {
        let dir = PathBuf::from(original);
        ensure_skill_dir(&dir)?;
        let Some(parent) = dir.parent().map(PathBuf::from) else { continue };
        if roots.contains(&parent) {
            let target = parent.join(&slug);
            if target != dir {
                if target.exists() {
                    return Err(format!("A skill named {slug} already exists there"));
                }
                fs::rename(&dir, &target).map_err(|e| e.to_string())?;
            }
            kept.push(target);
        } else {
            dropped.push(dir);
        }
    }

    // Whatever the skill already ships travels with it to a new agent, taken
    // from the copy the editor was reading - the first one the caller listed -
    // so adding an agent never resurrects a stale copy's files.
    let source = input
        .original_paths
        .iter()
        .filter_map(|original| Path::new(original).parent().map(|p| p.join(&slug)))
        .find(|renamed| kept.contains(renamed))
        .or_else(|| kept.first().cloned());

    for root in &roots {
        let target = root.join(&slug);
        if kept.contains(&target) {
            continue;
        }
        if target.exists() {
            return Err(format!("A skill named {slug} already exists in {}", root.display()));
        }
        fs::create_dir_all(&target).map_err(|e| e.to_string())?;
        if let Some(from) = &source {
            crate::storage::copy_dir_recursive(from, &target)?;
        }
        kept.push(target);
    }

    for dir in dropped {
        fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }

    for dir in &kept {
        fs::write(dir.join(MANIFEST), &manifest).map_err(|e| e.to_string())?;
    }

    // Returned in the order the agents were asked for, so the first path stays
    // the canonical one across a save and its reload.
    Ok(roots.iter().map(|r| r.join(&slug).to_string_lossy().to_string()).collect())
}

/// Deletes every copy of the skill, so removing it from the list removes it
/// from all the agents that could read it, not just the first one.
#[tauri::command]
pub async fn delete_skill(paths: Vec<String>) -> Result<(), String> {
    for path in &paths {
        let dir = PathBuf::from(path);
        ensure_skill_dir(&dir)?;
    }
    for path in &paths {
        fs::remove_dir_all(PathBuf::from(path)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn duplicate_skill(path: String, name: String) -> Result<String, String> {
    let source = PathBuf::from(&path);
    ensure_skill_dir(&source)?;
    let slug = slugify(&name);
    if slug.is_empty() {
        return Err("A skill needs a name".to_string());
    }
    let target = source.parent().ok_or("Not a skill directory")?.join(&slug);
    if target.exists() {
        return Err(format!("A skill named {slug} already exists there"));
    }
    fs::create_dir_all(&target).map_err(|e| e.to_string())?;
    crate::storage::copy_dir_recursive(&source, &target)?;

    // The copy answers to its own directory name, so its frontmatter has to say so.
    let manifest = target.join(MANIFEST);
    if let Ok(content) = fs::read_to_string(&manifest) {
        let renamed = content
            .lines()
            .map(|line| {
                if is_top_level_key(line).map(|(k, _)| k) == Some("name".to_string()) {
                    format!("name: {slug}")
                } else {
                    line.to_string()
                }
            })
            .collect::<Vec<_>>()
            .join("\n");
        let _ = fs::write(&manifest, format!("{renamed}\n"));
    }
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn add_skill_resources(path: String, sources: Vec<String>) -> Result<(), String> {
    let dir = PathBuf::from(&path);
    ensure_skill_dir(&dir)?;
    for source in &sources {
        let from = PathBuf::from(source);
        let Some(name) = from.file_name() else { continue };
        let to = dir.join(name);
        if from.is_dir() {
            fs::create_dir_all(&to).map_err(|e| e.to_string())?;
            crate::storage::copy_dir_recursive(&from, &to)?;
        } else {
            fs::copy(&from, &to).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn delete_skill_resource(skill_path: String, path: String) -> Result<(), String> {
    let dir = PathBuf::from(&skill_path);
    ensure_skill_dir(&dir)?;
    let target = PathBuf::from(&path);
    if !target.starts_with(&dir) || target == dir.join(MANIFEST) {
        return Err("That file does not belong to this skill".to_string());
    }
    if target.is_dir() {
        fs::remove_dir_all(&target).map_err(|e| e.to_string())
    } else {
        fs::remove_file(&target).map_err(|e| e.to_string())
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_fields_it_knows_and_keeps_the_rest_verbatim() {
        let content = "---\nname: commit\ndescription: \"Stage, commit: and push\"\nallowed-tools: Bash(git status), Bash(git diff *)\nmetadata:\n  author: me\n---\n\n# Commit\n\nBody.\n";
        let (front, body) = split_manifest(content, &KNOWN_KEYS);

        assert_eq!(parse_scalar(&front.known["description"]), "Stage, commit: and push");
        assert_eq!(
            parse_tool_list(&front.known["allowed-tools"]),
            vec!["Bash(git status)", "Bash(git diff *)"],
        );
        assert_eq!(front.extra, "metadata:\n  author: me");
        assert_eq!(body, "# Commit\n\nBody.\n");
    }

    #[test]
    fn a_block_list_of_tools_reads_as_a_list() {
        let content = "---\nname: x\nallowed-tools:\n  - Read\n  - Write\n---\nBody\n";
        let (front, _) = split_manifest(content, &KNOWN_KEYS);

        assert_eq!(parse_tool_list(&front.known["allowed-tools"]), vec!["Read", "Write"]);
    }

    #[test]
    fn a_folded_description_reads_as_one_sentence() {
        let content = "---\nname: x\ndescription: >-\n  Ultra-compressed mode.\n  Cuts token usage.\n---\nBody\n";
        let (front, _) = split_manifest(content, &KNOWN_KEYS);

        assert_eq!(front.known["description"], "Ultra-compressed mode. Cuts token usage.");
    }

    #[test]
    fn a_literal_block_keeps_its_line_breaks() {
        let content = "---\nname: x\ndescription: |\n  First line.\n  Second line.\n---\nBody\n";
        let (front, _) = split_manifest(content, &KNOWN_KEYS);

        assert_eq!(front.known["description"], "First line.\nSecond line.");
    }

    #[test]
    fn a_file_without_frontmatter_is_all_body() {
        let (front, body) = split_manifest("# Just markdown\n", &KNOWN_KEYS);

        assert!(front.known.is_empty());
        assert_eq!(body, "# Just markdown\n");
    }

    #[test]
    fn a_written_description_reads_back_identical() {
        let input = SkillInput {
            original_paths: Vec::new(),
            targets: vec!["claude-code".into()],
            scope: "global".into(),
            project_id: String::new(),
            project_path: String::new(),
            name: "My Skill".into(),
            description: "Use when: a colon appears".into(),
            when_to_use: String::new(),
            allowed_tools: vec!["Read".into()],
            paths: String::new(),
            model: String::new(),
            license: String::new(),
            disable_model_invocation: false,
            extra_frontmatter: "metadata:\n  author: me".into(),
            body: "Body".into(),
        };

        let (front, body) = split_manifest(&render_manifest(&input, "my-skill"), &KNOWN_KEYS);

        assert_eq!(parse_scalar(&front.known["name"]), "my-skill");
        assert_eq!(parse_scalar(&front.known["description"]), "Use when: a colon appears");
        assert_eq!(front.extra, "metadata:\n  author: me");
        assert_eq!(body, "Body\n");
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("cairn-skills-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("scratch dir");
        dir
    }

    fn multi(name: &str, project: &str, originals: Vec<String>, targets: &[&str]) -> SkillInput {
        SkillInput {
            original_paths: originals,
            targets: targets.iter().map(|t| t.to_string()).collect(),
            scope: "project".into(),
            project_id: "p1".into(),
            project_path: project.into(),
            name: name.into(),
            description: "Reviews a diff".into(),
            when_to_use: String::new(),
            allowed_tools: Vec::new(),
            paths: String::new(),
            model: String::new(),
            license: String::new(),
            disable_model_invocation: false,
            extra_frontmatter: String::new(),
            body: "Body".into(),
        }
    }

    #[tokio::test]
    async fn a_root_two_agents_share_is_written_once_and_reported_for_both() {
        let dir = scratch("shared-root");
        let root = dir.to_string_lossy().to_string();

        // Codex and Vibe both write to the project's .agents/skills.
        let paths = save_skill(multi("Review", &root, vec![], &["codex", "vibe"])).await.unwrap();

        assert_eq!(paths.len(), 2, "Vibe has .vibe/skills of its own");
        let listed = list_skills(vec![SkillProject { id: "p1".into(), name: "P".into(), path: root }])
            .await
            .unwrap();
        let found = listed.iter().find(|s| s.name == "review").expect("the skill");
        assert!(found.providers.contains(&"antigravity".to_string()), ".agents/skills is read by Antigravity too");
        assert!(!found.divergent);

        let _ = fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn dropping_an_agent_removes_only_its_copy() {
        let dir = scratch("narrow");
        let root = dir.to_string_lossy().to_string();

        let paths = save_skill(multi("Review", &root, vec![], &["claude-code", "copilot"])).await.unwrap();
        fs::write(dir.join(".claude/skills/review/helper.sh"), "echo").unwrap();

        // Adding an agent carries the bundled files over from the canonical copy.
        let paths = save_skill(multi("Review", &root, paths, &["claude-code", "copilot", "codex"]))
            .await
            .unwrap();
        assert!(dir.join(".agents/skills/review/helper.sh").is_file());

        // Renaming moves every copy; dropping one deletes only that directory.
        let paths = save_skill(multi("Deep Review", &root, paths, &["claude-code"])).await.unwrap();

        assert_eq!(paths.len(), 1);
        assert!(dir.join(".claude/skills/deep-review").is_dir());
        assert!(!dir.join(".github/skills/review").exists());
        assert!(!dir.join(".agents/skills/review").exists());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_name_becomes_the_directory_that_answers_to_it() {
        assert_eq!(slugify("My Great Skill"), "my-great-skill");
        assert_eq!(slugify("  Réview!  "), "r-view");
        assert_eq!(slugify("---"), "");
    }
}
