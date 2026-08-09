//! The subagent definitions the coding CLIs already read.
//!
//! Cairn keeps no agents of its own: an agent is a markdown file with
//! frontmatter, in the directory its provider looks in, and this module lists,
//! edits and moves those files the way `skills.rs` does for `SKILL.md`. One
//! entry per name across every root, the copies folded together, a difference
//! between them reported rather than hidden.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::commands::cli_providers::{agent_providers_at, agent_roots, unique_providers, CLI_PROVIDERS};
use crate::commands::skills::{
    parse_scalar, parse_tool_list, slugify, split_manifest, write_scalar, write_tool_list,
    SkillProject,
};

/// The frontmatter keys Cairn edits. Everything else is re-emitted verbatim, so
/// a key one CLI understands survives an edit made for another.
///
/// `permissionMode` is the spelling the CLI itself writes, and keys are
/// canonicalised to lowercase, so it arrives here as `permissionmode`. The
/// hyphenated form is honoured too, since a hand-written file may use it.
const KNOWN_KEYS: [&str; 10] = [
    "name",
    "description",
    "tools",
    "model",
    "color",
    "permissionmode",
    "permission-mode",
    "effort",
    "memory",
    "skills",
];

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NativeAgentLocation {
    pub path: String,
    pub providers: Vec<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NativeAgent {
    pub id: String,
    /// The file stem, which is the name the roster is invoked by.
    pub name: String,
    pub description: String,
    pub model: String,
    pub effort: String,
    pub permission_mode: String,
    /// What the agent is allowed to remember between runs. The CLI accepts more
    /// than Cairn could enumerate, so it travels as the string it is.
    pub memory: String,
    /// Skills this agent loads on top of the ones the session already has.
    pub skills: Vec<String>,
    pub color: String,
    pub tools: Vec<String>,
    pub extra_frontmatter: String,
    pub system_prompt: String,
    pub scope: String,
    pub project_id: String,
    pub project_name: String,
    /// The location the editor reads from: the first one found.
    pub path: String,
    pub locations: Vec<NativeAgentLocation>,
    pub providers: Vec<String>,
    /// Two copies of this agent hold a different definition. Saving realigns
    /// them on whatever the editor is showing.
    pub divergent: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAgentInput {
    #[serde(default)]
    pub original_paths: Vec<String>,
    /// The providers this agent should be readable by after the save. Anything
    /// it currently lives in and that is not listed here is removed.
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
    pub model: String,
    #[serde(default)]
    pub effort: String,
    #[serde(default)]
    pub permission_mode: String,
    #[serde(default)]
    pub memory: String,
    #[serde(default)]
    pub skills: Vec<String>,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub tools: Vec<String>,
    #[serde(default)]
    pub extra_frontmatter: String,
    #[serde(default)]
    pub system_prompt: String,
}

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

/// Claude Code names its agent colours; the UI works in hex. A name it does not
/// know is left empty, and the caller falls back to a preset.
pub fn hex_for_color_name(name: &str) -> String {
    match name.trim().to_lowercase().as_str() {
        "red" => "#ef4444",
        "orange" => "#f97316",
        "yellow" => "#eab308",
        "green" => "#22c55e",
        "cyan" => "#06b6d4",
        "blue" => "#3b82f6",
        "purple" => "#a855f7",
        "pink" => "#ec4899",
        other if other.starts_with('#') => return other.to_string(),
        _ => "",
    }
    .to_string()
}

/// The reverse. A hex the CLI cannot name is left out of the frontmatter rather
/// than written as something it would reject.
pub fn color_name_for_hex(hex: &str) -> String {
    let value = hex.trim().to_lowercase();
    for name in ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink"] {
        if hex_for_color_name(name) == value {
            return name.to_string();
        }
    }
    String::new()
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/// One definition file, before the copies of the same agent are folded together.
struct Found {
    slug: String,
    path: PathBuf,
    raw: String,
}

fn collect_dir(dir: &Path, out: &mut Vec<Found>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    let mut paths: Vec<_> = entries.flatten().map(|e| e.path()).collect();
    paths.sort();
    for path in paths {
        if path.extension().is_none_or(|e| e != "md") {
            continue;
        }
        let Ok(raw) = fs::read_to_string(&path) else { continue };
        let Some(slug) = path.file_stem().and_then(|s| s.to_str()) else { continue };
        out.push(Found { slug: slug.to_string(), path: path.clone(), raw });
    }
}

fn fold(
    scope: &str,
    project: Option<&SkillProject>,
    project_path: &str,
    slug: String,
    copies: Vec<Found>,
) -> Option<NativeAgent> {
    let first = copies.first()?;
    let (front, body) = split_manifest(&first.raw, &KNOWN_KEYS);
    let get = |key: &str| front.known.get(key).map(|v| parse_scalar(v)).unwrap_or_default();

    let project_id = project.map(|p| p.id.clone()).unwrap_or_default();

    // The CLI writes `permissionMode`; a file written by hand may hyphenate it.
    let permission_mode = match get("permissionmode") {
        empty if empty.is_empty() => get("permission-mode"),
        found => found,
    };
    // `default` is "whatever the CLI does", which Cairn expresses as empty.
    let permission_mode = if permission_mode == "default" {
        String::new()
    } else {
        permission_mode
    };

    let locations: Vec<NativeAgentLocation> = copies
        .iter()
        .map(|copy| NativeAgentLocation {
            path: copy.path.to_string_lossy().to_string(),
            providers: agent_providers_at(
                copy.path.parent().unwrap_or(&copy.path),
                scope,
                project_path,
            ),
        })
        .collect();

    let providers = unique_providers(locations.iter().flat_map(|l| l.providers.clone()));

    Some(NativeAgent {
        id: format!("{scope}:{project_id}:{slug}"),
        name: slug,
        description: get("description"),
        model: get("model"),
        effort: get("effort"),
        permission_mode,
        memory: get("memory"),
        skills: parse_tool_list(&get("skills")),
        color: hex_for_color_name(&get("color")),
        tools: parse_tool_list(&get("tools"))
            .into_iter()
            // `*` is the CLI's "everything", which Cairn expresses as no restriction.
            .filter(|t| t != "*")
            .collect(),
        extra_frontmatter: front.extra,
        system_prompt: body,
        scope: scope.to_string(),
        project_id,
        project_name: project.map(|p| p.name.clone()).unwrap_or_default(),
        path: first.path.to_string_lossy().to_string(),
        locations,
        providers,
        divergent: copies.iter().any(|c| c.raw != first.raw),
    })
}

/// Scans every root of every provider, keyed by file stem. A root two providers
/// share is scanned once, so an agent living there is one entry carrying both.
fn scan_scope(
    scope: &str,
    project: Option<&SkillProject>,
    project_path: &str,
    out: &mut Vec<NativeAgent>,
) {
    let mut seen: Vec<PathBuf> = Vec::new();
    let mut groups: BTreeMap<String, Vec<Found>> = BTreeMap::new();

    for provider in CLI_PROVIDERS {
        for root in agent_roots(provider.id, scope, project_path) {
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
        if let Some(agent) = fold(scope, project, project_path, slug, copies) {
            out.push(agent);
        }
    }
}

#[tauri::command]
pub async fn list_native_agents(projects: Vec<SkillProject>) -> Result<Vec<NativeAgent>, String> {
    let mut out = Vec::new();
    scan_scope("global", None, "", &mut out);
    for project in &projects {
        scan_scope("project", Some(project), &project.path, &mut out);
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

pub fn render_definition(input: &NativeAgentInput, name: &str) -> String {
    let mut out = String::from("---\n");
    out.push_str(&format!("name: {}\n", write_scalar(name)));
    out.push_str(&format!("description: {}\n", write_scalar(input.description.trim())));
    let tools: Vec<String> = input
        .tools
        .iter()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .collect();
    if !tools.is_empty() {
        out.push_str(&format!("tools: {}\n", write_tool_list(&tools)));
    }
    if !input.model.trim().is_empty() {
        out.push_str(&format!("model: {}\n", write_scalar(input.model.trim())));
    }
    if !input.effort.trim().is_empty() {
        out.push_str(&format!("effort: {}\n", write_scalar(input.effort.trim())));
    }
    // The spelling the CLI writes itself, so a definition Cairn saves looks like
    // one the CLI saved.
    if !input.permission_mode.trim().is_empty() {
        out.push_str(&format!("permissionMode: {}\n", write_scalar(input.permission_mode.trim())));
    }
    if !input.memory.trim().is_empty() {
        out.push_str(&format!("memory: {}\n", write_scalar(input.memory.trim())));
    }
    let skills: Vec<String> = input
        .skills
        .iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    if !skills.is_empty() {
        out.push_str(&format!("skills: {}\n", write_tool_list(&skills)));
    }
    let color = color_name_for_hex(&input.color);
    if !color.is_empty() {
        out.push_str(&format!("color: {color}\n"));
    }
    let extra = input.extra_frontmatter.trim_end();
    if !extra.is_empty() {
        out.push_str(extra);
        out.push('\n');
    }
    out.push_str("---\n\n");
    out.push_str(input.system_prompt.trim_start_matches('\n').trim_end());
    out.push('\n');
    out
}

fn write_roots(scope: &str, project_path: &str, targets: &[String]) -> Result<Vec<PathBuf>, String> {
    if scope != "global" && scope != "project" {
        return Err(format!("Cannot write a {scope} agent"));
    }
    if scope == "project" && project_path.is_empty() {
        return Err("A project agent needs a project".to_string());
    }
    if targets.is_empty() {
        return Err("Pick at least one agent for this definition".to_string());
    }

    let mut roots: Vec<PathBuf> = Vec::new();
    for target in targets {
        let Some(root) = agent_roots(target, scope, project_path).into_iter().next() else {
            return Err(format!("{target} has no agents directory in that scope"));
        };
        if !roots.contains(&root) {
            roots.push(root);
        }
    }
    Ok(roots)
}

/// A path is a definition only if it is a `.md` sitting directly under an
/// `agents` directory. Anything else is refused rather than deleted.
fn ensure_definition(path: &Path) -> Result<(), String> {
    if path.extension().is_none_or(|e| e != "md") || !path.is_file() {
        return Err("Not an agent definition".to_string());
    }
    let parent = path.parent().and_then(|p| p.file_name()).and_then(|s| s.to_str());
    if parent != Some("agents") {
        return Err("Not an agent definition".to_string());
    }
    Ok(())
}

/// Writes the agent to every provider that should read it, and takes it out of
/// the ones that no longer should. Writing the same text to every kept path is
/// what realigns a divergent entry.
#[tauri::command]
pub async fn save_native_agent(input: NativeAgentInput) -> Result<Vec<String>, String> {
    let slug = slugify(&input.name);
    if slug.is_empty() {
        return Err("An agent needs a name".to_string());
    }
    let roots = write_roots(&input.scope, &input.project_path, &input.targets)?;
    let definition = render_definition(&input, &slug);

    let mut kept: Vec<PathBuf> = Vec::new();
    let mut dropped: Vec<PathBuf> = Vec::new();
    for original in &input.original_paths {
        let path = PathBuf::from(original);
        ensure_definition(&path)?;
        let Some(parent) = path.parent().map(PathBuf::from) else { continue };
        if roots.contains(&parent) {
            let target = parent.join(format!("{slug}.md"));
            if target != path {
                if target.exists() {
                    return Err(format!("An agent named {slug} already exists there"));
                }
                fs::rename(&path, &target).map_err(|e| e.to_string())?;
            }
            kept.push(target);
        } else {
            dropped.push(path);
        }
    }

    for root in &roots {
        let target = root.join(format!("{slug}.md"));
        if kept.contains(&target) {
            continue;
        }
        if target.exists() {
            return Err(format!("An agent named {slug} already exists in {}", root.display()));
        }
        fs::create_dir_all(root).map_err(|e| e.to_string())?;
        kept.push(target);
    }

    for path in dropped {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }

    for path in &kept {
        fs::write(path, &definition).map_err(|e| e.to_string())?;
    }

    Ok(roots
        .iter()
        .map(|r| r.join(format!("{slug}.md")).to_string_lossy().to_string())
        .collect())
}

/// Deletes every copy, so removing an agent from the list removes it from all
/// the providers that could read it, not just the first one.
#[tauri::command]
pub async fn delete_native_agent(paths: Vec<String>) -> Result<(), String> {
    for path in &paths {
        ensure_definition(&PathBuf::from(path))?;
    }
    for path in &paths {
        fs::remove_file(PathBuf::from(path)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn duplicate_native_agent(path: String, name: String) -> Result<String, String> {
    let source = PathBuf::from(&path);
    ensure_definition(&source)?;
    let slug = slugify(&name);
    if slug.is_empty() {
        return Err("An agent needs a name".to_string());
    }
    let target = source
        .parent()
        .ok_or("Not an agent definition")?
        .join(format!("{slug}.md"));
    if target.exists() {
        return Err(format!("An agent named {slug} already exists there"));
    }
    let raw = fs::read_to_string(&source).map_err(|e| e.to_string())?;
    let (front, body) = split_manifest(&raw, &KNOWN_KEYS);
    let renamed = render_definition(
        &NativeAgentInput {
            original_paths: Vec::new(),
            targets: Vec::new(),
            scope: String::new(),
            project_id: String::new(),
            project_path: String::new(),
            name: slug.clone(),
            description: front.known.get("description").map(|v| parse_scalar(v)).unwrap_or_default(),
            model: front.known.get("model").map(|v| parse_scalar(v)).unwrap_or_default(),
            effort: front.known.get("effort").map(|v| parse_scalar(v)).unwrap_or_default(),
            permission_mode: front
                .known
                .get("permissionmode")
                .or_else(|| front.known.get("permission-mode"))
                .map(|v| parse_scalar(v))
                .unwrap_or_default(),
            memory: front.known.get("memory").map(|v| parse_scalar(v)).unwrap_or_default(),
            skills: front.known.get("skills").map(|v| parse_tool_list(v)).unwrap_or_default(),
            color: hex_for_color_name(
                &front.known.get("color").map(|v| parse_scalar(v)).unwrap_or_default(),
            ),
            tools: front.known.get("tools").map(|v| parse_tool_list(v)).unwrap_or_default(),
            extra_frontmatter: front.extra,
            system_prompt: body,
        },
        &slug,
    );
    fs::write(&target, renamed).map_err(|e| e.to_string())?;
    Ok(target.to_string_lossy().to_string())
}

// ---------------------------------------------------------------------------
// Migration from the agents Cairn used to keep of its own
// ---------------------------------------------------------------------------

/// An agent as `~/.cairn/agents.json` held it. Read once, to write the
/// definitions out, and never again.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct LegacyAgent {
    #[serde(default)]
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    color: String,
    #[serde(default)]
    system_prompt: String,
    #[serde(default)]
    model: String,
    #[serde(default)]
    permission_mode: String,
    #[serde(default)]
    allowed_tools: Vec<String>,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct MigrationOutcome {
    /// Whether there was anything to migrate at all.
    pub ran: bool,
    pub written: Vec<String>,
    /// Names left alone because a definition of that name was already there.
    pub skipped: Vec<String>,
    /// Whether any migrated agent carried generation parameters, which no
    /// definition can hold. The notice says so rather than dropping them
    /// silently.
    pub dropped_params: bool,
}

/// Writes the agents Cairn used to keep into `~/.claude/agents`, then renames
/// `agents.json` to `agents.migrated.json` so this can never run twice. The original is left on disk under its
/// new name: a migration that deletes the only copy of something is one the
/// user cannot check afterwards.
#[tauri::command]
pub async fn migrate_custom_agents() -> Result<MigrationOutcome, String> {
    let Ok(source) = crate::storage::legacy_agents_file() else {
        return Ok(MigrationOutcome::default());
    };
    if !source.exists() {
        return Ok(MigrationOutcome::default());
    }
    let raw = fs::read_to_string(&source).map_err(|e| e.to_string())?;
    let legacy: Vec<LegacyAgent> = serde_json::from_str(&raw).unwrap_or_default();
    let dropped_params = raw.contains("\"overrideParams\":true");

    let Some(root) = agent_roots("claude-code", "global", "").into_iter().next() else {
        return Ok(MigrationOutcome::default());
    };
    let outcome = migrate_into(&root, legacy, dropped_params)?;

    let done = source.with_file_name("agents.migrated.json");
    fs::rename(&source, &done).map_err(|e| e.to_string())?;
    Ok(outcome)
}

fn migrate_into(
    root: &Path,
    legacy: Vec<LegacyAgent>,
    dropped_params: bool,
) -> Result<MigrationOutcome, String> {
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let mut outcome = MigrationOutcome { ran: true, dropped_params, ..Default::default() };
    for agent in legacy {
        let slug = slugify(&agent.name);
        if slug.is_empty() {
            continue;
        }
        let target = root.join(format!("{slug}.md"));
        if target.exists() {
            outcome.skipped.push(slug);
            continue;
        }
        let input = NativeAgentInput {
            original_paths: Vec::new(),
            targets: Vec::new(),
            scope: "global".into(),
            project_id: String::new(),
            project_path: String::new(),
            name: agent.name.clone(),
            description: agent.description,
            model: agent.model,
            effort: String::new(),
            permission_mode: agent.permission_mode,
            memory: String::new(),
            skills: Vec::new(),
            color: agent.color,
            tools: agent.allowed_tools,
            extra_frontmatter: String::new(),
            system_prompt: agent.system_prompt,
        };
        fs::write(&target, render_definition(&input, &slug)).map_err(|e| e.to_string())?;
        outcome.written.push(slug);
    }
    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(name: &str) -> NativeAgentInput {
        NativeAgentInput {
            original_paths: Vec::new(),
            targets: Vec::new(),
            scope: "global".into(),
            project_id: String::new(),
            project_path: String::new(),
            name: name.into(),
            description: "Reviews code".into(),
            model: "opus".into(),
            effort: "high".into(),
            permission_mode: "acceptEdits".into(),
            memory: String::new(),
            skills: Vec::new(),
            color: "#3b82f6".into(),
            tools: vec!["Read".into(), "Grep".into()],
            extra_frontmatter: String::new(),
            system_prompt: "You review code.".into(),
        }
    }

    #[test]
    fn a_definition_reads_back_as_it_was_written() {
        let rendered = render_definition(&input("Code Reviewer"), "code-reviewer");
        let (front, body) = split_manifest(&rendered, &KNOWN_KEYS);

        assert_eq!(parse_scalar(&front.known["name"]), "code-reviewer");
        assert_eq!(parse_scalar(&front.known["description"]), "Reviews code");
        assert_eq!(parse_tool_list(&front.known["tools"]), vec!["Read", "Grep"]);
        assert_eq!(parse_scalar(&front.known["color"]), "blue");
        assert_eq!(body.trim(), "You review code.");
    }

    #[test]
    fn the_camel_case_spelling_the_cli_writes_is_read_and_written_back() {
        // The CLI writes `permissionMode`; keys are canonicalised to lowercase,
        // so the hyphenated form alone would leave every real file unparsed.
        let raw = "---\nname: a\ndescription: d\npermissionMode: acceptEdits\neffort: high\nmemory: project\nskills: pixel-art, postgresql\n---\n\nBody\n";

        let copies = vec![Found {
            slug: "a".into(),
            path: PathBuf::from("/home/u/.claude/agents/a.md"),
            raw: raw.into(),
        }];
        let agent = fold("global", None, "", "a".into(), copies).unwrap();

        assert_eq!(agent.permission_mode, "acceptEdits");
        assert_eq!(agent.effort, "high");
        assert_eq!(agent.memory, "project");
        assert_eq!(agent.skills, vec!["pixel-art", "postgresql"]);
        // Nothing modelled may leak into the verbatim block, or it would be
        // written twice on save.
        assert!(!agent.extra_frontmatter.contains("permissionMode"));
        assert!(!agent.extra_frontmatter.contains("skills"));

        let rendered = render_definition(&input("a"), "a");
        assert!(rendered.contains("permissionMode: acceptEdits"));
        assert!(rendered.contains("effort: high"));
    }

    #[test]
    fn a_hyphenated_permission_mode_written_by_hand_is_still_read() {
        let raw = "---\nname: a\npermission-mode: plan\n---\n\nBody\n";

        let copies = vec![Found {
            slug: "a".into(),
            path: PathBuf::from("/home/u/.claude/agents/a.md"),
            raw: raw.into(),
        }];

        assert_eq!(fold("global", None, "", "a".into(), copies).unwrap().permission_mode, "plan");
    }

    #[test]
    fn the_cli_default_permission_mode_reads_as_inherit() {
        let raw = "---\nname: a\npermissionMode: default\n---\n\nBody\n";

        let copies = vec![Found {
            slug: "a".into(),
            path: PathBuf::from("/home/u/.claude/agents/a.md"),
            raw: raw.into(),
        }];

        assert!(fold("global", None, "", "a".into(), copies).unwrap().permission_mode.is_empty());
    }

    #[test]
    fn an_unknown_frontmatter_key_survives_a_round_trip() {
        let raw = "---\nname: keeper\ndescription: d\nx-vendor-flag: true\n---\n\nBody\n";

        let (front, body) = split_manifest(raw, &KNOWN_KEYS);
        let mut back = input("keeper");
        back.extra_frontmatter = front.extra;
        back.system_prompt = body;
        back.tools = Vec::new();
        let rendered = render_definition(&back, "keeper");

        assert!(rendered.contains("x-vendor-flag: true"));
    }

    /// Shaped on a definition the CLI actually loads: a folded description, the
    /// camelCase `permissionMode`, and the keys Cairn learned to model last.
    /// Nothing may be lost or duplicated across a read and a write.
    #[test]
    fn a_real_definition_round_trips_without_loss() {
        let raw = concat!(
            "---\n",
            "name: argus\n",
            "description: >\n",
            "  Runs the test suite and audits its quality. Reports exactly which\n",
            "  tests fail and why.\n",
            "model: opus\n",
            "effort: max\n",
            "permissionMode: acceptEdits\n",
            "memory: project\n",
            "skills: pixel-art-textures, postgresql\n",
            "color: cyan\n",
            "tools: Read, Grep, Glob, Bash(git diff), mcp__firefox-devtools\n",
            "x-vendor-flag: kept\n",
            "---\n",
            "\n",
            "You audit tests.\n",
        );
        let found = |raw: &str| {
            vec![Found {
                slug: "argus".into(),
                path: PathBuf::from("/home/u/.claude/agents/argus.md"),
                raw: raw.to_string(),
            }]
        };

        let agent = fold("global", None, "", "argus".into(), found(raw)).unwrap();
        assert_eq!(agent.model, "opus");
        assert_eq!(agent.effort, "max");
        assert_eq!(agent.permission_mode, "acceptEdits");
        assert_eq!(agent.memory, "project");
        assert_eq!(agent.skills, vec!["pixel-art-textures", "postgresql"]);
        assert_eq!(agent.color, "#06b6d4");
        // A tool pattern carrying its own comma is one tool, not two.
        assert_eq!(
            agent.tools,
            vec!["Read", "Grep", "Glob", "Bash(git diff)", "mcp__firefox-devtools"],
        );
        assert!(agent.description.starts_with("Runs the test suite"));

        let rendered = render_definition(
            &NativeAgentInput {
                original_paths: Vec::new(),
                targets: Vec::new(),
                scope: "global".into(),
                project_id: String::new(),
                project_path: String::new(),
                name: agent.name.clone(),
                description: agent.description.clone(),
                model: agent.model.clone(),
                effort: agent.effort.clone(),
                permission_mode: agent.permission_mode.clone(),
                memory: agent.memory.clone(),
                skills: agent.skills.clone(),
                color: agent.color.clone(),
                tools: agent.tools.clone(),
                extra_frontmatter: agent.extra_frontmatter.clone(),
                system_prompt: agent.system_prompt.clone(),
            },
            "argus",
        );
        assert!(rendered.contains("x-vendor-flag: kept"));
        assert_eq!(rendered.matches("permissionMode").count(), 1);

        let again = fold("global", None, "", "argus".into(), found(&rendered)).unwrap();
        assert_eq!(again.description, agent.description);
        assert_eq!(again.model, agent.model);
        assert_eq!(again.effort, agent.effort);
        assert_eq!(again.permission_mode, agent.permission_mode);
        assert_eq!(again.memory, agent.memory);
        assert_eq!(again.skills, agent.skills);
        assert_eq!(again.tools, agent.tools);
        assert_eq!(again.color, agent.color);
        assert_eq!(again.system_prompt.trim(), "You audit tests.");
    }

    #[test]
    fn a_colour_the_cli_cannot_name_is_left_out() {
        let mut odd = input("odd");
        odd.color = "#123456".into();

        assert!(!render_definition(&odd, "odd").contains("color:"));
    }

    #[test]
    fn only_a_md_under_an_agents_directory_can_be_written_over() {
        assert!(ensure_definition(Path::new("/repo/.claude/skills/thing.md")).is_err());
        assert!(ensure_definition(Path::new("/repo/.claude/agents/thing.txt")).is_err());
    }

    #[test]
    fn the_migration_writes_a_definition_and_leaves_an_existing_name_alone() {
        let dir = std::env::temp_dir().join(format!("cairn-migrate-{}", std::process::id()));
        let root = dir.join("agents");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("taken.md"), "---\nname: taken\n---\nMine\n").unwrap();

        let outcome = migrate_into(
            &root,
            vec![
                LegacyAgent {
                    name: "Code Reviewer".into(),
                    description: "Reviews".into(),
                    system_prompt: "You review.".into(),
                    ..Default::default()
                },
                LegacyAgent { name: "taken".into(), ..Default::default() },
            ],
            true,
        )
        .unwrap();

        assert_eq!(outcome.written, vec!["code-reviewer".to_string()]);
        assert_eq!(outcome.skipped, vec!["taken".to_string()]);
        assert!(outcome.dropped_params);
        assert!(root.join("code-reviewer.md").is_file());
        // The one already there is untouched, not overwritten.
        assert_eq!(fs::read_to_string(root.join("taken.md")).unwrap(), "---\nname: taken\n---\nMine\n");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_scope_with_no_root_is_refused_rather_than_written_nowhere() {
        assert!(write_roots("plugin", "", &["claude-code".to_string()]).is_err());
        assert!(write_roots("project", "", &["claude-code".to_string()]).is_err());
        assert!(write_roots("global", "", &[]).is_err());
        assert!(write_roots("global", "", &["codex".to_string()]).is_err());
    }
}
