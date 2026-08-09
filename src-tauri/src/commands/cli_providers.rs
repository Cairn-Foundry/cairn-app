//! Where each coding CLI keeps its skills and its MCP servers.
//!
//! The five agents Cairn can drive all read `SKILL.md` directories and all
//! speak MCP, but each looks in its own places - and several of them look in
//! the *same* place. `~/.agents/skills` is honoured by Codex, Copilot and Vibe;
//! a project's `.agents/skills` by Codex, Antigravity and Vibe; `.mcp.json` by
//! Claude Code and Copilot. Every root here is therefore deduplicated by path
//! before anything is written, so one file is never written twice and a skill
//! shared by three agents is one directory, not three.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::commands::agent::platform::resolve_binary;

pub const CLAUDE_CODE: &str = "claude-code";
pub const CODEX: &str = "codex";
pub const COPILOT: &str = "copilot";
pub const ANTIGRAVITY: &str = "antigravity";
pub const VIBE: &str = "vibe";

#[derive(Clone, Copy)]
pub struct CliProviderDef {
    pub id: &'static str,
    pub label: &'static str,
    /// Whether the agent keeps a per-project private MCP scope, on top of the
    /// user-wide and the committed ones. Only Claude Code does.
    pub has_local_scope: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CliProviderInfo {
    pub id: &'static str,
    pub label: &'static str,
    pub has_local_scope: bool,
    /// Whether this machine actually has the agent. Writing a skill or a server
    /// for an agent that is not there only leaves files nothing reads.
    pub installed: bool,
}

pub const CLI_PROVIDERS: [CliProviderDef; 5] = [
    CliProviderDef { id: CLAUDE_CODE, label: "Claude Code", has_local_scope: true },
    CliProviderDef { id: CODEX, label: "OpenAI Codex", has_local_scope: false },
    CliProviderDef { id: COPILOT, label: "GitHub Copilot", has_local_scope: false },
    CliProviderDef { id: ANTIGRAVITY, label: "Google Antigravity", has_local_scope: false },
    CliProviderDef { id: VIBE, label: "Mistral Vibe", has_local_scope: false },
];

/// Files the agent itself writes on first run. Directories Cairn may have
/// created - a `skills` folder, an MCP config it was asked to write - are
/// deliberately not markers: they would make an absent agent look installed.
fn install_markers(id: &str, home: &Path) -> Vec<PathBuf> {
    match id {
        CLAUDE_CODE => vec![home.join(".claude.json"), home.join(".claude").join("settings.json")],
        CODEX => vec![home.join(".codex").join("config.toml"), home.join(".codex").join("auth.json")],
        COPILOT => vec![home.join(".copilot").join("config.json")],
        ANTIGRAVITY => vec![home.join(".gemini").join("antigravity-cli")],
        VIBE => vec![home.join(".vibe").join("config.toml")],
        _ => Vec::new(),
    }
}

fn binary_name(id: &str) -> &'static str {
    match id {
        CLAUDE_CODE => "claude",
        CODEX => "codex",
        COPILOT => "copilot",
        ANTIGRAVITY => "antigravity",
        VIBE => "vibe",
        _ => "",
    }
}

fn is_installed(id: &str) -> bool {
    if let Some(home) = home() {
        if install_markers(id, &home).iter().any(|p| p.exists()) {
            return true;
        }
    }
    let binary = binary_name(id);
    !binary.is_empty() && resolve_binary(binary, None).is_some()
}

/// Async because it probes the filesystem and the PATH, which a synchronous
/// command would do on the UI thread.
#[tauri::command]
pub async fn list_cli_providers() -> Vec<CliProviderInfo> {
    CLI_PROVIDERS
        .iter()
        .map(|p| CliProviderInfo {
            id: p.id,
            label: p.label,
            has_local_scope: p.has_local_scope,
            installed: is_installed(p.id),
        })
        .collect()
}

fn home() -> Option<PathBuf> {
    dirs::home_dir()
}

/// Every skills directory a provider reads, most specific first. Index 0 is
/// where Cairn writes; the rest are read so a skill dropped there by hand, or
/// by another agent, is still found.
pub fn skill_roots(provider: &str, scope: &str, project_path: &str) -> Vec<PathBuf> {
    let project = Path::new(project_path);
    match (provider, scope) {
        (CLAUDE_CODE, "global") => home().map(|h| vec![h.join(".claude").join("skills")]).unwrap_or_default(),
        (CLAUDE_CODE, "project") => vec![project.join(".claude").join("skills")],

        (CODEX, "global") => home().map(|h| vec![h.join(".agents").join("skills")]).unwrap_or_default(),
        (CODEX, "project") => vec![project.join(".agents").join("skills")],

        (COPILOT, "global") => home()
            .map(|h| vec![h.join(".copilot").join("skills"), h.join(".agents").join("skills")])
            .unwrap_or_default(),
        (COPILOT, "project") => vec![project.join(".github").join("skills")],

        (ANTIGRAVITY, "global") => home()
            .map(|h| vec![h.join(".gemini").join("config").join("skills")])
            .unwrap_or_default(),
        // Antigravity accepts four spellings of its workspace root.
        (ANTIGRAVITY, "project") => vec![
            project.join(".agents").join("skills"),
            project.join(".agent").join("skills"),
            project.join("_agents").join("skills"),
            project.join("_agent").join("skills"),
        ],

        (VIBE, "global") => home()
            .map(|h| vec![h.join(".vibe").join("skills"), h.join(".agents").join("skills")])
            .unwrap_or_default(),
        (VIBE, "project") => vec![
            project.join(".vibe").join("skills"),
            project.join(".agents").join("skills"),
        ],

        _ => Vec::new(),
    }
}

/// How a config file holds its servers. The shape decides how an entry is read
/// and written back; the dialect decides what its keys are called.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum McpStore {
    /// A JSON object keyed by server name.
    JsonMap,
    /// A TOML table keyed by server name: `[mcp_servers.<name>]`.
    TomlTable,
    /// A TOML array of tables, each carrying its own `name`.
    TomlArray,
}

#[derive(Clone)]
pub struct McpLocation {
    pub path: PathBuf,
    pub store: McpStore,
    /// Which provider's key names this file uses.
    pub dialect: &'static str,
    /// Path to the collection inside the document, one segment per level. A
    /// list rather than a joined string because a segment can be a project
    /// path, which carries separators of its own.
    pub pointer: Vec<String>,
}

/// Every file a provider reads its MCP servers from, in the given scope. As
/// with skills, index 0 is the one Cairn writes.
pub fn mcp_locations(provider: &str, scope: &str, project_path: &str) -> Vec<McpLocation> {
    let project = Path::new(project_path);
    let json = |path: PathBuf, dialect: &'static str, pointer: &[&str]| McpLocation {
        path,
        store: McpStore::JsonMap,
        dialect,
        pointer: pointer.iter().map(|s| s.to_string()).collect(),
    };

    match (provider, scope) {
        (CLAUDE_CODE, "user") => home()
            .map(|h| vec![json(h.join(".claude.json"), CLAUDE_CODE, &["mcpServers"])])
            .unwrap_or_default(),
        // Claude alone keeps a private per-project list, inside its own state file.
        (CLAUDE_CODE, "local") => home()
            .map(|h| {
                vec![json(
                    h.join(".claude.json"),
                    CLAUDE_CODE,
                    &["projects", project_path, "mcpServers"],
                )]
            })
            .unwrap_or_default(),
        (CLAUDE_CODE, "project") => vec![json(project.join(".mcp.json"), CLAUDE_CODE, &["mcpServers"])],

        (CODEX, "user") => home()
            .map(|h| {
                vec![McpLocation {
                    path: h.join(".codex").join("config.toml"),
                    store: McpStore::TomlTable,
                    dialect: CODEX,
                    pointer: vec!["mcp_servers".into()],
                }]
            })
            .unwrap_or_default(),
        (CODEX, "project") => vec![McpLocation {
            path: project.join(".codex").join("config.toml"),
            store: McpStore::TomlTable,
            dialect: CODEX,
            pointer: vec!["mcp_servers".into()],
        }],

        (COPILOT, "user") => home()
            .map(|h| vec![json(h.join(".copilot").join("mcp-config.json"), CLAUDE_CODE, &["mcpServers"])])
            .unwrap_or_default(),
        // Copilot prefers its own file but also honours the one Claude commits.
        (COPILOT, "project") => vec![
            json(project.join(".github").join("mcp.json"), CLAUDE_CODE, &["mcpServers"]),
            json(project.join(".mcp.json"), CLAUDE_CODE, &["mcpServers"]),
        ],

        (ANTIGRAVITY, "user") => home()
            .map(|h| {
                vec![json(
                    h.join(".gemini").join("config").join("mcp_config.json"),
                    ANTIGRAVITY,
                    &["mcpServers"],
                )]
            })
            .unwrap_or_default(),
        (ANTIGRAVITY, "project") => vec![json(
            project.join(".agents").join("mcp_config.json"),
            ANTIGRAVITY,
            &["mcpServers"],
        )],

        (VIBE, "user") => home()
            .map(|h| {
                vec![McpLocation {
                    path: h.join(".vibe").join("config.toml"),
                    store: McpStore::TomlArray,
                    dialect: VIBE,
                    pointer: vec!["mcp_servers".into()],
                }]
            })
            .unwrap_or_default(),
        (VIBE, "project") => vec![McpLocation {
            path: project.join(".vibe").join("config.toml"),
            store: McpStore::TomlArray,
            dialect: VIBE,
            pointer: vec!["mcp_servers".into()],
        }],

        _ => Vec::new(),
    }
}

/// Collapses a provider list to one entry each, in registry order. `Vec::dedup`
/// would only drop neighbours, and a duplicate id reaches the UI as a repeated
/// key - which is a hard error in a keyed list, not a cosmetic one.
pub fn unique_providers(providers: impl IntoIterator<Item = String>) -> Vec<String> {
    let seen: Vec<String> = providers.into_iter().collect();
    CLI_PROVIDERS
        .iter()
        .filter(|p| seen.iter().any(|s| s == p.id))
        .map(|p| p.id.to_string())
        .collect()
}

/// The agents that would end up reading an entry written for `targets`. Not the
/// same list as `targets`: a write root is often read by agents that were never
/// asked for, which the picker has to say before the save rather than after.
pub fn skill_reach(scope: &str, project_path: &str, targets: &[String]) -> Vec<String> {
    let written: Vec<PathBuf> = targets
        .iter()
        .filter_map(|t| skill_roots(t, scope, project_path).into_iter().next())
        .collect();
    unique_providers(
        CLI_PROVIDERS
            .iter()
            .filter(|p| {
                skill_roots(p.id, scope, project_path)
                    .iter()
                    .any(|root| written.contains(root))
            })
            .map(|p| p.id.to_string()),
    )
}

pub fn mcp_reach(scope: &str, project_path: &str, targets: &[String]) -> Vec<String> {
    let written: Vec<(PathBuf, Vec<String>)> = targets
        .iter()
        .filter_map(|t| mcp_locations(t, scope, project_path).into_iter().next())
        .map(|loc| (loc.path, loc.pointer))
        .collect();
    unique_providers(
        CLI_PROVIDERS
            .iter()
            .filter(|p| {
                mcp_locations(p.id, scope, project_path)
                    .iter()
                    .any(|loc| written.iter().any(|(path, pointer)| *path == loc.path && *pointer == loc.pointer))
            })
            .map(|p| p.id.to_string()),
    )
}

#[tauri::command]
pub async fn reached_providers(
    kind: String,
    scope: String,
    project_path: String,
    targets: Vec<String>,
) -> Vec<String> {
    if kind == "skill" {
        skill_reach(&scope, &project_path, &targets)
    } else {
        mcp_reach(&scope, &project_path, &targets)
    }
}

/// The providers that read a given path, so a directory or a file two agents
/// share is reported as belonging to both rather than duplicated.
pub fn skill_providers_at(path: &Path, scope: &str, project_path: &str) -> Vec<String> {
    CLI_PROVIDERS
        .iter()
        .filter(|p| skill_roots(p.id, scope, project_path).iter().any(|root| root == path))
        .map(|p| p.id.to_string())
        .collect()
}

pub fn mcp_providers_at(path: &Path, pointer: &[String], scope: &str, project_path: &str) -> Vec<String> {
    CLI_PROVIDERS
        .iter()
        .filter(|p| {
            mcp_locations(p.id, scope, project_path)
                .iter()
                .any(|loc| loc.path == path && loc.pointer == pointer)
        })
        .map(|p| p.id.to_string())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_agents_directory_is_reported_for_every_agent_that_reads_it() {
        let shared = Path::new("/repo/.agents/skills");

        let providers = skill_providers_at(shared, "project", "/repo");

        assert!(providers.contains(&CODEX.to_string()));
        assert!(providers.contains(&ANTIGRAVITY.to_string()));
        assert!(providers.contains(&VIBE.to_string()));
        assert!(!providers.contains(&CLAUDE_CODE.to_string()));
    }

    #[test]
    fn a_committed_mcp_file_is_reported_for_claude_and_copilot() {
        let shared = Path::new("/repo/.mcp.json");

        let providers = mcp_providers_at(shared, &["mcpServers".to_string()], "project", "/repo");

        assert_eq!(providers, vec![CLAUDE_CODE.to_string(), COPILOT.to_string()]);
    }

    #[test]
    fn picking_one_agent_can_hand_the_entry_to_others() {
        // Codex writes a project's .agents/skills, which Antigravity and Vibe
        // also read - so the picker must name them.
        let reach = skill_reach("project", "/repo", &[CODEX.to_string()]);

        assert_eq!(
            reach,
            vec![CODEX.to_string(), ANTIGRAVITY.to_string(), VIBE.to_string()],
        );
    }

    #[test]
    fn a_committed_server_written_for_claude_is_read_by_copilot_too() {
        let reach = mcp_reach("project", "/repo", &[CLAUDE_CODE.to_string()]);

        assert_eq!(reach, vec![CLAUDE_CODE.to_string(), COPILOT.to_string()]);
    }

    #[test]
    fn an_agent_with_a_place_of_its_own_reaches_only_itself() {
        assert_eq!(mcp_reach("user", "", &[VIBE.to_string()]), vec![VIBE.to_string()]);
    }

    #[test]
    fn a_provider_reached_through_two_paths_is_listed_once() {
        let repeated = vec![
            "vibe".to_string(),
            "copilot".to_string(),
            "vibe".to_string(),
            "claude-code".to_string(),
            "copilot".to_string(),
        ];

        assert_eq!(
            unique_providers(repeated),
            vec!["claude-code".to_string(), "copilot".to_string(), "vibe".to_string()],
        );
    }

    #[test]
    fn a_directory_cairn_creates_is_never_taken_for_an_installed_agent() {
        let home = Path::new("/home/someone");

        // The skills folder Cairn writes into must not be a marker.
        for id in [CLAUDE_CODE, CODEX, COPILOT, ANTIGRAVITY, VIBE] {
            for marker in install_markers(id, home) {
                assert!(!marker.ends_with("skills"), "{id} keys off a Cairn-made directory");
            }
        }
    }

    #[test]
    fn only_claude_offers_a_private_project_scope() {
        assert!(!mcp_locations(CLAUDE_CODE, "local", "/repo").is_empty());
        assert!(mcp_locations(CODEX, "local", "/repo").is_empty());
    }

    #[test]
    fn a_provider_writes_to_the_first_root_it_reads() {
        let roots = skill_roots(VIBE, "global", "");

        assert!(roots[0].ends_with(".vibe/skills"));
        assert!(roots.iter().any(|r| r.ends_with(".agents/skills")));
    }
}
