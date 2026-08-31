// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Where each coding CLI keeps its skills and its MCP servers.
//!
//! The five agents Cairn can drive all read `SKILL.md` directories and all
//! speak MCP, but each looks in its own places - and several of them look in
//! the *same* place. `~/.agents/skills` is honoured by Codex, Copilot and Vibe;
//! a project's `.agents/skills` by Codex, Antigravity and Vibe; `.mcp.json` by
//! Claude Code and Copilot. Every root here is therefore deduplicated by path
//! before anything is written, so one file is never written twice and a skill
//! shared by three agents is one directory, not three.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::RwLock;

use serde::Serialize;

pub const CLAUDE_CODE: &str = "claude-code";
pub const CODEX: &str = "codex";
pub const GEMINI: &str = "gemini";
pub const OPENCODE: &str = "opencode";
pub const COPILOT: &str = "copilot";
pub const ANTIGRAVITY: &str = "antigravity";
pub const VIBE: &str = "vibe";
pub const CURSOR: &str = "cursor";
pub const AMP: &str = "amp";
pub const GOOSE: &str = "goose";
pub const QWEN: &str = "qwen";
pub const DROID: &str = "droid";

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
    /// Whether the binary is there to be launched. The conversation picker keys
    /// off this one: a card that cannot be launched must not be offered.
    pub installed: bool,
    /// Whether the agent has run on this machine, which is what makes writing it
    /// a skill or an MCP server worthwhile. True on a config directory an
    /// uninstall left behind, where `installed` is false.
    pub configured: bool,
    /// Where the binary was found, so the hub can show which install is used.
    pub path: Option<String>,
    /// What `<bin> --version` printed, when the binary is there.
    pub version: Option<String>,
    /// Whether a conversation with this CLI can be reopened by its own id. True
    /// for every CLI in the registry; kept so a future one that cannot is
    /// reported rather than silently offering a conversation it would lose.
    pub resumable: bool,
}

pub const CLI_PROVIDERS: [CliProviderDef; 12] = [
    CliProviderDef { id: CLAUDE_CODE, label: "Claude Code", has_local_scope: true },
    CliProviderDef { id: CODEX, label: "OpenAI Codex", has_local_scope: false },
    CliProviderDef { id: GEMINI, label: "Gemini CLI", has_local_scope: false },
    CliProviderDef { id: OPENCODE, label: "OpenCode", has_local_scope: false },
    CliProviderDef { id: COPILOT, label: "GitHub Copilot", has_local_scope: false },
    CliProviderDef { id: ANTIGRAVITY, label: "Google Antigravity", has_local_scope: false },
    CliProviderDef { id: VIBE, label: "Mistral Vibe", has_local_scope: false },
    CliProviderDef { id: CURSOR, label: "Cursor CLI", has_local_scope: false },
    CliProviderDef { id: AMP, label: "Amp", has_local_scope: false },
    CliProviderDef { id: GOOSE, label: "Goose", has_local_scope: false },
    CliProviderDef { id: QWEN, label: "Qwen Code", has_local_scope: false },
    CliProviderDef { id: DROID, label: "Factory Droid", has_local_scope: false },
];

/// Files the agent itself writes on first run. Directories Cairn may have
/// created - a `skills` folder, an MCP config it was asked to write - are
/// deliberately not markers: they would make an absent agent look installed.
///
/// A marker means "this agent has run on this machine", which is what decides
/// whether writing it a skill or an MCP server is worth doing - the file stays
/// useful even when the binary is invoked from somewhere Cairn cannot see. It
/// does *not* mean the agent can be launched: an uninstall leaves the config
/// directory behind. `launchable` answers that one.
fn install_markers(id: &str, home: &Path) -> Vec<PathBuf> {
    match id {
        CLAUDE_CODE => vec![home.join(".claude.json"), home.join(".claude").join("settings.json")],
        CODEX => vec![home.join(".codex").join("config.toml"), home.join(".codex").join("auth.json")],
        GEMINI => vec![home.join(".gemini").join("settings.json")],
        OPENCODE => vec![home.join(".config").join("opencode").join("opencode.json")],
        COPILOT => vec![home.join(".copilot").join("config.json")],
        ANTIGRAVITY => vec![home.join(".gemini").join("antigravity-cli")],
        VIBE => vec![home.join(".vibe").join("config.toml")],
        CURSOR => vec![home.join(".cursor").join("cli-config.json")],
        AMP => vec![home.join(".config").join("amp").join("settings.json")],
        GOOSE => vec![home.join(".config").join("goose").join("config.yaml")],
        QWEN => vec![home.join(".qwen").join("settings.json"), home.join(".qwen").join("oauth_creds.json")],
        DROID => vec![home.join(".factory").join("settings.json")],
        _ => Vec::new(),
    }
}

fn binary_name(id: &str) -> &'static str {
    match id {
        CLAUDE_CODE => "claude",
        CODEX => "codex",
        GEMINI => "gemini",
        OPENCODE => "opencode",
        COPILOT => "copilot",
        ANTIGRAVITY => "agy",
        VIBE => "vibe",
        // Cursor's CLI installs as `agent`, not `cursor-agent`.
        CURSOR => "agent",
        AMP => "amp",
        GOOSE => "goose",
        QWEN => "qwen",
        DROID => "droid",
        _ => "",
    }
}

/// Resolve a CLI binary: explicit override first, then PATH, then the common
/// install locations GUI apps miss (macOS apps inherit a reduced PATH).
pub fn resolve_binary(name: &str, override_path: Option<&str>) -> Option<PathBuf> {
    if let Some(p) = override_path.filter(|p| !p.trim().is_empty()) {
        let path = PathBuf::from(p);
        return path.exists().then_some(path);
    }
    if let Ok(found) = which::which(name) {
        return Some(found);
    }
    for dir in fallback_dirs() {
        for candidate in candidate_names(name) {
            let path = dir.join(&candidate);
            if path.exists() {
                return Some(path);
            }
        }
    }
    None
}

/// Install locations to search when the binary is not on the app's PATH.
fn fallback_dirs() -> Vec<PathBuf> {
    let mut dirs_list = Vec::new();
    if let Some(home) = dirs::home_dir() {
        dirs_list.push(home.join(".local").join("bin"));
        dirs_list.push(home.join(".claude").join("local"));
        #[cfg(target_os = "windows")]
        {
            dirs_list.push(home.join("AppData").join("Roaming").join("npm"));
            // Antigravity installs itself here rather than through npm.
            dirs_list.push(home.join("AppData").join("Local").join("agy").join("bin"));
        }
    }
    #[cfg(target_os = "macos")]
    {
        dirs_list.push(PathBuf::from("/opt/homebrew/bin"));
        dirs_list.push(PathBuf::from("/usr/local/bin"));
    }
    #[cfg(target_os = "linux")]
    dirs_list.push(PathBuf::from("/usr/local/bin"));
    dirs_list
}

/// File names a binary may carry: Windows npm shims are `.cmd`, not extensionless.
fn candidate_names(name: &str) -> Vec<String> {
    #[cfg(target_os = "windows")]
    {
        vec![format!("{name}.cmd"), format!("{name}.exe"), name.to_string()]
    }
    #[cfg(not(target_os = "windows"))]
    {
        vec![name.to_string()]
    }
}

/// Build a Command for a resolved binary: no console window on Windows,
/// its own process group on Unix so the whole tree can be killed.
pub fn new_command(path: &Path) -> Command {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let is_shim = path
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("cmd") || e.eq_ignore_ascii_case("bat"));
        let mut cmd = if is_shim {
            let mut c = Command::new("cmd");
            c.arg("/C").arg(path);
            c
        } else {
            Command::new(path)
        };
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd
    }
    #[cfg(not(target_os = "windows"))]
    {
        use std::os::unix::process::CommandExt;
        let mut cmd = Command::new(path);
        cmd.process_group(0);
        cmd
    }
}

/// How a conversation with this CLI is started, and started again later.
///
/// Every CLI here resumes an exact conversation by its own id - none of them is
/// reduced to "carry on with whatever ran last", which is a surprising thing to
/// do to someone who picked one conversation out of a list.
///
/// They differ only in where the id comes from. Three accept one imposed at
/// launch (`mints_session_id`), so Cairn chooses it before the process starts.
/// The rest mint their own, and the id is read back from the CLI's store once
/// the conversation exists (`discover_session_id`).
///
/// Flags verified against the installed binaries' own `--help`, not from
/// documentation: several of these are ahead of what their docs describe.
pub fn launch(id: &str, session_id: Option<&str>) -> Vec<String> {
    let bin = binary_name(id).to_string();
    let mut argv = vec![bin];
    let Some(sid) = session_id else { return argv };
    match id {
        // `claude --resume <uuid>`
        CLAUDE_CODE => argv.extend(["--resume".into(), sid.to_string()]),
        // `gemini --resume <uuid>`
        GEMINI => argv.extend(["--resume".into(), sid.to_string()]),
        // `copilot --resume=<id>`; the value form is what the help documents.
        COPILOT => argv.push(format!("--resume={sid}")),
        // `codex resume <uuid>` - a subcommand, not a flag.
        CODEX => argv.extend(["resume".into(), sid.to_string()]),
        // `opencode --session <ses_...>`
        OPENCODE => argv.extend(["--session".into(), sid.to_string()]),
        // `vibe --resume <uuid>`
        VIBE => argv.extend(["--resume".into(), sid.to_string()]),
        // `agy --conversation <uuid>`
        ANTIGRAVITY => argv.extend(["--conversation".into(), sid.to_string()]),
        // `agent --resume="<chat-id>"`; the value form is what the docs show.
        CURSOR => argv.push(format!("--resume={sid}")),
        // `amp threads continue <threadId>` - a subcommand pair, not a flag.
        AMP => argv.extend(["threads".into(), "continue".into(), sid.to_string()]),
        // `goose session -r --name <name>`: the id is the session's own name.
        GOOSE => argv.extend(["session".into(), "-r".into(), "--name".into(), sid.to_string()]),
        // `qwen --resume <uuid>`
        QWEN => argv.extend(["--resume".into(), sid.to_string()]),
        // `droid --resume <uuid>`
        DROID => argv.extend(["--resume".into(), sid.to_string()]),
        _ => {}
    }
    argv
}

/// Whether Cairn can impose the session id at launch.
///
/// True for the five that document a way to name a session before it exists,
/// so the conversation knows what to resume before its first byte of output.
/// The others mint their own: Codex refuses the feature upstream, OpenCode
/// rejects an id it has never seen, Antigravity quietly ignores one and uses
/// its own, and Cursor, Amp and Droid document no flag for it.
pub fn mints_session_id(id: &str) -> bool {
    matches!(id, CLAUDE_CODE | GEMINI | COPILOT | QWEN | GOOSE)
}

/// The argv that starts a fresh conversation with an id Cairn chose. The CLIs
/// `mints_session_id` rejects get the bare binary and are asked for their id
/// afterwards.
///
/// They spell it differently: most take `--session-id`, while Goose names a
/// session rather than numbering it - `goose session --name <name>` - which is
/// the same id it later resumes by.
pub fn launch_new(id: &str, session_id: &str) -> Vec<String> {
    let mut argv = vec![binary_name(id).to_string()];
    if !mints_session_id(id) {
        return argv;
    }
    match id {
        GOOSE => argv.extend(["session".into(), "--name".into(), session_id.to_string()]),
        _ => argv.extend(["--session-id".into(), session_id.to_string()]),
    }
    argv
}

/// The id of the conversation a CLI just started in `cwd`, once it has one.
///
/// Only for the CLIs that mint their own id: the others were handed one at
/// launch and have nothing to discover.
///
/// Each is asked the way it offers: OpenCode publishes its sessions as JSON
/// through a command, and the other three record theirs in a small index beside
/// their logs. What none of this does is read the terminal - the output belongs
/// to the user, and parsing it back is the coupling this design removes.
///
/// `started_after` is the moment the PTY was spawned, in milliseconds. A
/// session older than that belongs to some earlier conversation in the same
/// worktree, which is exactly the mix-up that made "resume the last one" a bad
/// answer; such a session is ignored rather than adopted.
///
/// `None` is not a failure: a conversation the user has not spoken to yet has
/// no session at all, and the caller simply asks again later.
pub fn discover_session_id(id: &str, cwd: &str, started_after: i64) -> Option<String> {
    match id {
        OPENCODE => opencode_session(cwd, started_after),
        ANTIGRAVITY => antigravity_conversation(cwd, started_after),
        CODEX => codex_session(cwd, started_after),
        VIBE => vibe_session(cwd, started_after),
        DROID => droid_session(cwd, started_after),
        // Cursor and Amp cannot be asked. Amp keeps its threads on its own
        // server and writes nothing local to match; Cursor's store is an
        // undocumented database keyed by a workspace hash Cairn cannot
        // reproduce. Their conversations run and resume by an id the user
        // holds, but Cairn never learns one on its own - so a conversation
        // closed before it was named starts fresh rather than opening
        // somebody else's session.
        _ => None,
    }
}

/// Droid writes a file per session under `~/.factory/sessions`. Its schema is
/// not documented, so this reads only the two fields every such store carries
/// under one of their usual spellings, and gives up quietly on anything else -
/// which costs a resume, never a wrong session.
fn droid_session(cwd: &str, started_after: i64) -> Option<String> {
    let root = home()?.join(".factory").join("sessions");
    let mut best: Option<(i64, String)> = None;
    for path in newest_files(&root, "json", 40) {
        let Ok(content) = fs::read_to_string(&path) else { continue };
        let Ok(entry) = serde_json::from_str::<serde_json::Value>(&content) else { continue };
        let field = |names: &[&str]| -> Option<&serde_json::Value> {
            names.iter().find_map(|n| entry.get(*n))
        };
        let directory = field(&["cwd", "workingDirectory", "working_dir", "directory"])
            .and_then(|d| d.as_str());
        if directory != Some(cwd) {
            continue;
        }
        let started = field(&["createdAt", "created_at", "timestamp", "startTime"])
            .and_then(|t| match t {
                serde_json::Value::String(text) => parse_rfc3339_millis(text),
                other => other.as_i64(),
            })
            .unwrap_or(0);
        if started < started_after {
            continue;
        }
        let sid = field(&["sessionId", "session_id", "id"])
            .and_then(|i| i.as_str())
            .map(str::to_string)
            .or_else(|| path.file_stem().map(|s| s.to_string_lossy().into_owned()))?;
        if best.as_ref().is_none_or(|(at, _)| started > *at) {
            best = Some((started, sid));
        }
    }
    best.map(|(_, sid)| sid)
}

/// Codex opens a rollout file per session, whose first line is a `session_meta`
/// record carrying the id, the directory and the moment it started.
fn codex_session(cwd: &str, started_after: i64) -> Option<String> {
    let root = codex_home()?.join("sessions");
    let mut best: Option<(i64, String)> = None;
    for path in newest_files(&root, "jsonl", 60) {
        let Ok(file) = fs::File::open(&path) else { continue };
        let mut first = String::new();
        if std::io::BufRead::read_line(&mut std::io::BufReader::new(file), &mut first).is_err() {
            continue;
        }
        let Ok(entry) = serde_json::from_str::<serde_json::Value>(&first) else { continue };
        let meta = entry.get("payload").unwrap_or(&entry);
        if meta.get("cwd").and_then(|c| c.as_str()) != Some(cwd) {
            continue;
        }
        let started = meta
            .get("timestamp")
            .and_then(|t| t.as_str())
            .and_then(parse_rfc3339_millis)
            .unwrap_or(0);
        if started < started_after {
            continue;
        }
        let Some(sid) = meta.get("session_id").and_then(|i| i.as_str()) else { continue };
        if best.as_ref().is_none_or(|(at, _)| started > *at) {
            best = Some((started, sid.to_string()));
        }
    }
    best.map(|(_, sid)| sid)
}

/// Vibe keeps an index of its sessions beside their logs, each entry carrying
/// the id, the directory and the start time.
fn vibe_session(cwd: &str, started_after: i64) -> Option<String> {
    let path = home()?.join(".vibe").join("logs").join("session").join(".session_index.json");
    let content = fs::read_to_string(path).ok()?;
    let index: std::collections::HashMap<String, serde_json::Value> =
        serde_json::from_str(&content).ok()?;
    index
        .into_values()
        .filter(|e| e.get("cwd").and_then(|c| c.as_str()) == Some(cwd))
        .filter_map(|e| {
            let started = e
                .get("start_time")
                .and_then(|t| t.as_str())
                .and_then(parse_rfc3339_millis)?;
            let sid = e.get("session_id").and_then(|i| i.as_str())?.to_string();
            (started >= started_after).then_some((started, sid))
        })
        .max_by_key(|(started, _)| *started)
        .map(|(_, sid)| sid)
}

/// `$CODEX_HOME`, or the default beside the other agent directories.
fn codex_home() -> Option<PathBuf> {
    match std::env::var("CODEX_HOME") {
        Ok(dir) if !dir.trim().is_empty() => Some(PathBuf::from(dir)),
        _ => home().map(|h| h.join(".codex")),
    }
}

/// The newest files under `root` with the given extension, most recent first.
/// Codex nests its rollouts under year/month/day, so the walk is recursive, and
/// capped because only a conversation started moments ago can match.
fn newest_files(root: &Path, extension: &str, limit: usize) -> Vec<PathBuf> {
    let mut found: Vec<(std::time::SystemTime, PathBuf)> = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.extension().is_some_and(|e| e == extension)
                && let Ok(meta) = entry.metadata()
                && let Ok(modified) = meta.modified()
            {
                found.push((modified, path));
            }
        }
    }
    found.sort_by(|a, b| b.0.cmp(&a.0));
    found.into_iter().take(limit).map(|(_, p)| p).collect()
}

/// An RFC 3339 stamp as milliseconds since the epoch. Hand-parsed rather than
/// pulling in a date crate for the two fields that need it; anything malformed
/// yields `None` and the session is simply not matched.
fn parse_rfc3339_millis(text: &str) -> Option<i64> {
    let bytes = text.as_bytes();
    if bytes.len() < 19 {
        return None;
    }
    let num = |from: usize, to: usize| text.get(from..to)?.parse::<i64>().ok();
    let (year, month, day) = (num(0, 4)?, num(5, 7)?, num(8, 10)?);
    let (hour, minute, second) = (num(11, 13)?, num(14, 16)?, num(17, 19)?);
    let millis = text
        .get(20..23)
        .filter(|_| bytes.get(19) == Some(&b'.'))
        .and_then(|m| m.parse::<i64>().ok())
        .unwrap_or(0);

    // Days since the epoch, by the civil-from-days algorithm (Howard Hinnant).
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;

    Some(((days * 86_400 + hour * 3_600 + minute * 60 + second) * 1_000) + millis)
}

/// OpenCode publishes its sessions as JSON, which is a supported interface
/// rather than its database - the schema of that is its own business.
fn opencode_session(cwd: &str, started_after: i64) -> Option<String> {
    let binary = resolve_binary(binary_name(OPENCODE), None)?;
    let out = Command::new(binary)
        .args(["session", "list", "--format", "json", "-n", "40"])
        .stdin(std::process::Stdio::null())
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let sessions: Vec<serde_json::Value> = serde_json::from_slice(&out.stdout).ok()?;
    sessions
        .into_iter()
        .filter(|s| s.get("directory").and_then(|d| d.as_str()) == Some(cwd))
        .filter(|s| s.get("created").and_then(serde_json::Value::as_i64).unwrap_or(0) >= started_after)
        .max_by_key(|s| s.get("created").and_then(serde_json::Value::as_i64).unwrap_or(0))
        .and_then(|s| s.get("id").and_then(|i| i.as_str()).map(str::to_string))
}

/// Antigravity records every prompt in a JSONL history, each line carrying the
/// workspace it was typed in and the conversation it belongs to. There is no
/// command that lists conversations, so this is the one place Cairn reads a
/// CLI's own file - a line-delimited log of two stable fields, which is the
/// mildest form of that coupling.
fn antigravity_conversation(cwd: &str, started_after: i64) -> Option<String> {
    let path = home()?.join(".gemini").join("antigravity-cli").join("history.jsonl");
    let content = std::fs::read_to_string(path).ok()?;
    content
        .lines()
        .rev()
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
        .filter(|entry| entry.get("workspace").and_then(|w| w.as_str()) == Some(cwd))
        .find(|entry| {
            entry.get("timestamp").and_then(serde_json::Value::as_i64).unwrap_or(0) >= started_after
        })
        .and_then(|entry| {
            entry.get("conversationId").and_then(|c| c.as_str()).map(str::to_string)
        })
}

/// Terminate a spawned CLI and every child it spawned.
///
/// The exit status is claimed first: on a process that already exited, the pid
/// is free for the kernel to reuse, and the negative-pid signal below would hit
/// whatever process group inherited it - up to the app's own.
pub fn kill_tree(child: &mut std::process::Child) {
    if !matches!(child.try_wait(), Ok(None)) {
        return;
    }
    let pid = child.id();
    if pid <= 1 {
        return;
    }
    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .output();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = Command::new("kill")
            .args(["-TERM", &format!("-{pid}")])
            .output();
    }
    let _ = child.kill();
    let _ = child.wait();
}

/// The version number in a `--version` line, or `None` when there is none.
///
/// The CLIs disagree on the shape: `2.1.251 (Claude Code)`, `vibe 2.24.1`, a
/// bare `1.18.18`. The tile already carries the name, so the first token that
/// looks like a version is what is kept.
fn version_in(line: &str) -> Option<String> {
    line.split_whitespace()
        .find(|token| {
            let core = token.trim_start_matches('v');
            // Digits and dots up to the first `-`, so `2.0.0-beta.1` counts and
            // a stray `docs.github.com` does not.
            let numeric = core.split('-').next().unwrap_or_default();
            core.starts_with(|c: char| c.is_ascii_digit())
                && numeric.contains('.')
                && numeric.chars().all(|c| c.is_ascii_digit() || c == '.')
        })
        .map(str::to_string)
}

/// What `<bin> --version` reports, and the proof the binary is the real CLI.
///
/// `None` means "this is not a usable CLI", which is why detection keys off it
/// rather than off the file existing. A launcher shim can sit on the PATH and
/// be no CLI at all: VS Code drops one for Copilot in its `globalStorage` that
/// only offers to install the real thing, answering `--version` with
/// "Install GitHub Copilot CLI? [y/N]" - and exiting 0 while it does, so the
/// status says nothing. A binary that cannot state its version is treated as
/// absent; a working CLI always can.
fn probe_version(path: &Path) -> Option<String> {
    // stdin is closed so a prompt like the one above cannot block detection
    // waiting on an answer nobody is there to give.
    let out = Command::new(path)
        .arg("--version")
        .stdin(std::process::Stdio::null())
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    text.lines().filter(|l| !l.trim().is_empty()).find_map(|l| version_in(l.trim()))
}

/// Whether this agent has run here, so writing it a skill or a server is worth
/// doing. True on a leftover config directory, deliberately.
fn is_configured(id: &str) -> bool {
    if let Some(home) = home()
        && install_markers(id, &home).iter().any(|p| p.exists()) {
            return true;
        }
    launchable(id).is_some()
}

/// The binary to exec and the version it reports, or `None` when there is no
/// usable CLI. This is the only question the conversation picker may ask.
///
/// Finding the file is not enough on two counts: a config directory left behind
/// by an uninstall would offer a card that fails on the click, and a launcher
/// shim on the PATH is a file that runs without being the CLI. Both are ruled
/// out by asking for a version and requiring an answer.
fn launchable(id: &str) -> Option<(PathBuf, String)> {
    let binary = binary_name(id);
    if binary.is_empty() {
        return None;
    }
    let path = resolve_binary(binary, None)?;
    let version = probe_version(&path)?;
    Some((path, version))
}

/// The last detection, kept so reopening the picker is instant.
///
/// Detecting means running every installed CLI to ask its version, which costs
/// a few hundred milliseconds all told - once is fine, on every visit to the
/// picker it is a wait the user did not ask for. A CLI installed or removed
/// while Cairn runs is picked up by `refresh: true`, which the Providers page
/// sends and the picker offers behind its own button.
static PROVIDERS_CACHE: RwLock<Option<Vec<CliProviderInfo>>> = RwLock::new(None);

/// The registry, detection included. Cached: pass `refresh` to probe again.
///
/// Async because it runs each CLI and walks the PATH, which a synchronous
/// command would do on the UI thread.
#[tauri::command]
pub async fn list_cli_providers(refresh: Option<bool>) -> Vec<CliProviderInfo> {
    if refresh != Some(true)
        && let Ok(cache) = PROVIDERS_CACHE.read()
        && let Some(found) = cache.as_ref()
    {
        return found.clone();
    }
    let found = detect_providers();
    if let Ok(mut cache) = PROVIDERS_CACHE.write() {
        *cache = Some(found.clone());
    }
    found
}

/// Probes every CLI at once: they are independent, and run one after another
/// their startup costs add up into a visible wait.
fn detect_providers() -> Vec<CliProviderInfo> {
    let probes: Vec<_> = CLI_PROVIDERS
        .iter()
        .map(|p| {
            let id = p.id;
            std::thread::spawn(move || (launchable(id), is_configured(id)))
        })
        .collect();

    CLI_PROVIDERS
        .iter()
        .zip(probes)
        .map(|(p, probe)| {
            let (found, configured) = probe.join().unwrap_or((None, false));
            CliProviderInfo {
                id: p.id,
                label: p.label,
                has_local_scope: p.has_local_scope,
                configured,
                installed: found.is_some(),
                version: found.as_ref().map(|(_, v)| v.clone()),
                path: found.map(|(b, _)| b.to_string_lossy().into_owned()),
                resumable: launch(p.id, Some("x")).len() > 1,
            }
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

        (GEMINI, "global") => home().map(|h| vec![h.join(".gemini").join("skills")]).unwrap_or_default(),
        (GEMINI, "project") => vec![project.join(".gemini").join("skills")],

        (OPENCODE, "global") => home()
            .map(|h| vec![h.join(".config").join("opencode").join("skills"), h.join(".agents").join("skills")])
            .unwrap_or_default(),
        (OPENCODE, "project") => vec![
            project.join(".opencode").join("skills"),
            project.join(".agents").join("skills"),
        ],

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

        (CURSOR, "global") => home()
            .map(|h| vec![h.join(".cursor").join("skills"), h.join(".agents").join("skills")])
            .unwrap_or_default(),
        (CURSOR, "project") => vec![
            project.join(".cursor").join("skills"),
            project.join(".agents").join("skills"),
        ],

        (AMP, "global") => home()
            .map(|h| vec![h.join(".config").join("amp").join("skills"), h.join(".agents").join("skills")])
            .unwrap_or_default(),
        (AMP, "project") => vec![
            project.join(".agents").join("skills"),
            project.join(".claude").join("skills"),
        ],

        (GOOSE, "global") => home()
            .map(|h| vec![h.join(".config").join("goose").join("skills"), h.join(".agents").join("skills")])
            .unwrap_or_default(),
        (GOOSE, "project") => vec![project.join(".agents").join("skills")],

        (QWEN, "global") => home().map(|h| vec![h.join(".qwen").join("skills")]).unwrap_or_default(),
        (QWEN, "project") => vec![project.join(".qwen").join("skills")],

        (DROID, "global") => home()
            .map(|h| vec![h.join(".factory").join("skills"), h.join(".agents").join("skills")])
            .unwrap_or_default(),
        (DROID, "project") => vec![
            project.join(".factory").join("skills"),
            project.join(".agents").join("skills"),
        ],

        _ => Vec::new(),
    }
}

/// Every directory a provider reads its subagent definitions from, most
/// specific first. Index 0 is where Cairn writes.
///
/// Only Claude Code has a roster. Vibe's `--agent` looks like one and is not:
/// it selects a permission profile from `~/.vibe/agents/*.toml` - how the one
/// agent asks for approval - not an agent to delegate to. The other three are
/// left out until a roster is confirmed to exist; an empty vector keeps them
/// out of the picker without any special case elsewhere.
pub fn agent_roots(provider: &str, scope: &str, project_path: &str) -> Vec<PathBuf> {
    match (provider, scope) {
        (CLAUDE_CODE, "global") => home()
            .map(|h| vec![h.join(".claude").join("agents")])
            .unwrap_or_default(),
        (CLAUDE_CODE, "project") => vec![Path::new(project_path).join(".claude").join("agents")],

        (QWEN, "global") => home().map(|h| vec![h.join(".qwen").join("agents")]).unwrap_or_default(),
        (QWEN, "project") => vec![Path::new(project_path).join(".qwen").join("agents")],

        (CURSOR, "global") => home().map(|h| vec![h.join(".cursor").join("agents")]).unwrap_or_default(),
        (CURSOR, "project") => vec![Path::new(project_path).join(".cursor").join("agents")],

        // Droid calls the members of its roster droids.
        (DROID, "global") => home().map(|h| vec![h.join(".factory").join("droids")]).unwrap_or_default(),
        (DROID, "project") => vec![Path::new(project_path).join(".factory").join("droids")],

        _ => Vec::new(),
    }
}

/// The providers that read a given directory, so a root two agents share is
/// reported as belonging to both rather than duplicated.
pub fn agent_providers_at(path: &Path, scope: &str, project_path: &str) -> Vec<String> {
    CLI_PROVIDERS
        .iter()
        .filter(|p| agent_roots(p.id, scope, project_path).iter().any(|root| root == path))
        .map(|p| p.id.to_string())
        .collect()
}

pub fn agent_reach(scope: &str, project_path: &str, targets: &[String]) -> Vec<String> {
    let written: Vec<PathBuf> = targets
        .iter()
        .filter_map(|t| agent_roots(t, scope, project_path).into_iter().next())
        .collect();
    unique_providers(
        CLI_PROVIDERS
            .iter()
            .filter(|p| {
                agent_roots(p.id, scope, project_path)
                    .iter()
                    .any(|root| written.contains(root))
            })
            .map(|p| p.id.to_string()),
    )
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

        (GEMINI, "user") => home()
            .map(|h| vec![json(h.join(".gemini").join("settings.json"), CLAUDE_CODE, &["mcpServers"])])
            .unwrap_or_default(),
        (GEMINI, "project") => vec![json(project.join(".gemini").join("settings.json"), CLAUDE_CODE, &["mcpServers"])],

        (OPENCODE, "user") => home()
            .map(|h| {
                vec![json(
                    h.join(".config").join("opencode").join("opencode.json"),
                    OPENCODE,
                    &["mcp"],
                )]
            })
            .unwrap_or_default(),
        (OPENCODE, "project") => vec![json(project.join("opencode.json"), OPENCODE, &["mcp"])],

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

        (CURSOR, "user") => home()
            .map(|h| vec![json(h.join(".cursor").join("mcp.json"), CLAUDE_CODE, &["mcpServers"])])
            .unwrap_or_default(),
        (CURSOR, "project") => vec![json(project.join(".cursor").join("mcp.json"), CLAUDE_CODE, &["mcpServers"])],

        // Amp nests its servers under its own prefix inside a shared settings file.
        (AMP, "user") => home()
            .map(|h| {
                vec![json(
                    h.join(".config").join("amp").join("settings.json"),
                    CLAUDE_CODE,
                    &["amp.mcpServers"],
                )]
            })
            .unwrap_or_default(),
        (AMP, "project") => vec![json(
            project.join(".amp").join("settings.json"),
            CLAUDE_CODE,
            &["amp.mcpServers"],
        )],

        (QWEN, "user") => home()
            .map(|h| vec![json(h.join(".qwen").join("settings.json"), CLAUDE_CODE, &["mcpServers"])])
            .unwrap_or_default(),
        (QWEN, "project") => vec![json(project.join(".qwen").join("settings.json"), CLAUDE_CODE, &["mcpServers"])],

        (DROID, "user") => home()
            .map(|h| vec![json(h.join(".factory").join("mcp.json"), CLAUDE_CODE, &["mcpServers"])])
            .unwrap_or_default(),
        (DROID, "project") => vec![json(project.join(".factory").join("mcp.json"), CLAUDE_CODE, &["mcpServers"])],

        // Goose states its servers as extensions in YAML, a shape Cairn's MCP
        // hub does not write. Its conversations run all the same; only the
        // server editor leaves it out.
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

/// Asked after a conversation has been given time to start, for the CLIs that
/// mint their own id. Async: it may run the CLI to ask it.
#[tauri::command]
pub async fn discover_cli_session(
    cli: String,
    cwd: String,
    started_after: i64,
) -> Option<String> {
    discover_session_id(&cli, &cwd, started_after)
}

#[tauri::command]
pub async fn reached_providers(
    kind: String,
    scope: String,
    project_path: String,
    targets: Vec<String>,
) -> Vec<String> {
    match kind.as_str() {
        "skill" => skill_reach(&scope, &project_path, &targets),
        "agent" => agent_reach(&scope, &project_path, &targets),
        _ => mcp_reach(&scope, &project_path, &targets),
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
        // Codex writes a project's .agents/skills, which OpenCode, Antigravity
        // and Vibe also read - so the picker must name them.
        let reach = skill_reach("project", "/repo", &[CODEX.to_string()]);

        for id in [CODEX, OPENCODE, ANTIGRAVITY, VIBE, CURSOR, AMP, GOOSE, DROID] {
            assert!(reach.contains(&id.to_string()), "{id} reads .agents/skills");
        }
        // Claude and Qwen keep places of their own and are not swept in.
        assert!(!reach.contains(&CLAUDE_CODE.to_string()));
        assert!(!reach.contains(&QWEN.to_string()));
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
        for def in CLI_PROVIDERS {
            let id = def.id;
            for marker in install_markers(id, home) {
                assert!(!marker.ends_with("skills"), "{id} keys off a Cairn-made directory");
            }
        }
    }

    #[test]
    fn only_the_agents_with_a_documented_roster_declare_one() {
        for id in [CLAUDE_CODE, QWEN, CURSOR, DROID] {
            assert!(!agent_roots(id, "project", "/repo").is_empty(), "{id} has a roster");
        }
        // Vibe's `--agent` is a permission profile, not a roster to delegate to;
        // Goose and Amp document no roster directory at all.
        for id in [CODEX, GEMINI, OPENCODE, COPILOT, ANTIGRAVITY, VIBE, AMP, GOOSE] {
            assert!(agent_roots(id, "global", "").is_empty(), "{id} claims a roster");
            assert!(agent_roots(id, "project", "/repo").is_empty(), "{id} claims a roster");
        }
    }

    #[test]
    fn an_agent_root_reaches_only_the_provider_that_reads_it() {
        assert_eq!(
            agent_reach("project", "/repo", &[CLAUDE_CODE.to_string()]),
            vec![CLAUDE_CODE.to_string()],
        );
        assert!(agent_reach("project", "/repo", &[CODEX.to_string()]).is_empty());
    }

    #[test]
    fn only_claude_offers_a_private_project_scope() {
        assert!(!mcp_locations(CLAUDE_CODE, "local", "/repo").is_empty());
        assert!(mcp_locations(CODEX, "local", "/repo").is_empty());
    }

    #[test]
    fn the_clis_that_take_an_imposed_id_are_launched_with_one() {
        // Verified against each binary's own --help, which is ahead of the
        // published docs for Gemini and Copilot.
        for id in [CLAUDE_CODE, GEMINI, COPILOT, QWEN] {
            assert!(mints_session_id(id), "{id} should accept an imposed id");
            assert_eq!(
                launch_new(id, "3f2b1a10-0c4d-4e8a-9f11-2b3c4d5e6f70"),
                vec![
                    binary_name(id),
                    "--session-id",
                    "3f2b1a10-0c4d-4e8a-9f11-2b3c4d5e6f70",
                ],
                "{id}",
            );
        }
        // Goose names a session rather than numbering it, and resumes by that
        // same name.
        assert!(mints_session_id(GOOSE));
        assert_eq!(
            launch_new(GOOSE, "cairn-42"),
            vec!["goose", "session", "--name", "cairn-42"],
        );
    }

    #[test]
    fn a_cli_that_mints_its_own_id_is_launched_bare() {
        // Codex refuses the feature upstream, OpenCode errors on an id it has
        // never seen, and Antigravity ignores one and uses its own. Handing any
        // of them an invented id would name a session that does not exist.
        for id in [CODEX, OPENCODE, ANTIGRAVITY, VIBE, CURSOR, AMP, DROID] {
            assert!(!mints_session_id(id), "{id} claims to accept an imposed id");
            assert_eq!(launch_new(id, "made-up"), vec![binary_name(id)], "{id}");
        }
    }

    #[test]
    fn a_fresh_conversation_never_carries_a_resume_flag() {
        for def in CLI_PROVIDERS {
            let argv = launch(def.id, None);
            assert_eq!(argv, vec![binary_name(def.id)], "{}", def.id);
        }
    }

    #[test]
    fn resuming_claude_passes_the_id_as_one_argument() {
        let argv = launch(CLAUDE_CODE, Some("3f2b1a10-0c4d-4e8a-9f11-2b3c4d5e6f70"));
        assert_eq!(
            argv,
            vec!["claude", "--resume", "3f2b1a10-0c4d-4e8a-9f11-2b3c4d5e6f70"],
        );
    }

    #[test]
    fn every_cli_reopens_the_exact_conversation_it_was_given() {
        // Never "carry on with the last session here": the user picked one
        // conversation out of a list, and that is the one that must come back.
        let sid = "3f2b1a10-0c4d-4e8a-9f11-2b3c4d5e6f70";
        for (id, expected) in [
            (CLAUDE_CODE, vec!["claude", "--resume", sid]),
            (GEMINI, vec!["gemini", "--resume", sid]),
            (CODEX, vec!["codex", "resume", sid]),
            (OPENCODE, vec!["opencode", "--session", sid]),
            (VIBE, vec!["vibe", "--resume", sid]),
            (ANTIGRAVITY, vec!["agy", "--conversation", sid]),
            (AMP, vec!["amp", "threads", "continue", sid]),
            (GOOSE, vec!["goose", "session", "-r", "--name", sid]),
            (QWEN, vec!["qwen", "--resume", sid]),
            (DROID, vec!["droid", "--resume", sid]),
        ] {
            assert_eq!(launch(id, Some(sid)), expected, "{id}");
        }
        // Copilot documents the `--resume=<id>` value form.
        for (id, bin) in [(COPILOT, "copilot"), (CURSOR, "agent")] {
            assert_eq!(
                launch(id, Some(sid)),
                vec![bin.to_string(), format!("--resume={sid}")],
                "{id}",
            );
        }
    }

    #[test]
    fn no_cli_is_ever_asked_to_resume_whatever_ran_last() {
        // The flags that mean "the most recent one" - `--last`, `--continue`, a
        // bare `--resume` that opens a picker - never appear: each would put the
        // user in a conversation they did not choose.
        let sid = "3f2b1a10-0c4d-4e8a-9f11-2b3c4d5e6f70";
        for def in CLI_PROVIDERS {
            let argv = launch(def.id, Some(sid));
            for token in ["--last", "--continue", "-c"] {
                assert!(!argv.iter().any(|a| a == token), "{} passes {token}", def.id);
            }
            // Whatever the spelling, the id itself is in there.
            assert!(argv.iter().any(|a| a.contains(sid)), "{} drops the id", def.id);
        }
    }

    #[test]
    fn every_registered_cli_has_a_binary_and_can_be_resumed() {
        for def in CLI_PROVIDERS {
            assert!(!binary_name(def.id).is_empty(), "{} has no binary", def.id);
            assert!(launch(def.id, Some("x")).len() > 1, "{} cannot resume", def.id);
        }
    }

    /// The CLIs that mint their own id and can be asked for it afterwards.
    const CAN_HAND_BACK_AN_ID: [&str; 5] = [CODEX, OPENCODE, ANTIGRAVITY, VIBE, DROID];

    #[test]
    fn every_cli_that_mints_its_own_id_has_a_way_to_hand_it_back() {
        // An id Cairn cannot impose has to be discoverable, or the conversation
        // could never be reopened - which is the whole point of the refonte.
        for def in CLI_PROVIDERS {
            if mints_session_id(def.id) {
                continue;
            }
            // Nothing has run in this directory, so there is nothing to find;
            // what matters is that asking is supported and answers cleanly.
            assert_eq!(
                discover_session_id(def.id, "/nonexistent/worktree", 0),
                None,
                "{}",
                def.id,
            );
            // Amp keeps its threads on its own server and Cursor's store is an
            // undocumented database keyed by a hash Cairn cannot reproduce, so
            // neither can hand an id back. They are the known exceptions; a new
            // one has to be added here deliberately rather than by accident.
            assert!(
                CAN_HAND_BACK_AN_ID.contains(&def.id) != matches!(def.id, CURSOR | AMP),
                "{} must declare whether its id is discoverable",
                def.id,
            );
        }
    }

    #[test]
    fn a_timestamp_becomes_the_millis_the_rest_of_the_app_counts_in() {
        // Both stores date their sessions in RFC 3339; the store compares them
        // with `Date.now()`, so a wrong epoch would silently match nothing.
        assert_eq!(
            parse_rfc3339_millis("2026-08-30T18:38:03.827Z"),
            Some(1_788_115_083_827),
        );
        // Seconds only, no fraction.
        assert_eq!(
            parse_rfc3339_millis("2026-08-30T18:38:03+00:00"),
            Some(1_788_115_083_000),
        );
        // A leap day, which the civil-from-days arithmetic has to get right.
        assert_eq!(parse_rfc3339_millis("2024-02-29T00:00:00Z"), Some(1_709_164_800_000));
        assert_eq!(parse_rfc3339_millis("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_rfc3339_millis("not a date"), None);
        assert_eq!(parse_rfc3339_millis(""), None);
    }

    #[test]
    fn a_config_left_by_an_uninstall_never_offers_a_conversation() {
        // `~/.copilot/config.json` outlives the binary. It still means "write
        // this agent's skills here", but launching it would fail on the click.
        let home = Path::new("/home/someone");
        assert!(!install_markers(COPILOT, home).is_empty());
        assert!(launchable("cairn-no-such-cli").is_none());
    }

    #[test]
    fn a_version_line_is_reduced_to_its_number() {
        // The CLIs each pad the number differently; the tile shows the number.
        assert_eq!(version_in("2.1.251 (Claude Code)").as_deref(), Some("2.1.251"));
        assert_eq!(version_in("vibe 2.24.1").as_deref(), Some("2.24.1"));
        assert_eq!(version_in("1.18.18").as_deref(), Some("1.18.18"));
        assert_eq!(version_in("opencode v1.2.3").as_deref(), Some("v1.2.3"));
        assert_eq!(version_in("2.0.0-beta.1").as_deref(), Some("2.0.0-beta.1"));
    }

    #[test]
    fn a_line_that_states_no_version_is_not_one() {
        // VS Code drops a launcher shim for Copilot on the PATH that answers
        // `--version` with an install prompt, and exits 0 while doing it. A
        // binary that cannot state a version is not a CLI Cairn can run.
        assert_eq!(version_in("Install GitHub Copilot CLI? ['y/N']"), None);
        assert_eq!(version_in("Cannot find GitHub Copilot CLI"), None);
        assert_eq!(version_in(""), None);
        // A bare word with a dot is not a version either.
        assert_eq!(version_in("see docs.github.com for help"), None);
    }

    #[tokio::test]
    async fn the_registry_is_served_from_cache_until_a_refresh_is_asked_for() {
        // Detecting runs every installed CLI to read its version, which is a
        // visible wait; the picker is crossed often enough that repeating it
        // would be felt. Only an explicit refresh probes again.
        let first = list_cli_providers(Some(true)).await;
        let cached = list_cli_providers(None).await;
        assert_eq!(first.len(), cached.len());
        for (a, b) in first.iter().zip(cached.iter()) {
            assert_eq!(a.id, b.id);
            assert_eq!(a.installed, b.installed);
            assert_eq!(a.version, b.version);
        }
    }

    #[test]
    fn a_provider_writes_to_the_first_root_it_reads() {
        let roots = skill_roots(VIBE, "global", "");

        assert!(roots[0].ends_with(".vibe/skills"));
        assert!(roots.iter().any(|r| r.ends_with(".agents/skills")));
    }
}
