// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Shared plumbing for the package managers Cairn installs tools through:
//! locating a binary, working out which manager owns it, and comparing versions.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;
use std::time::{Duration, SystemTime};
use serde::Serialize;
use crate::child_env;

/// One command per package manager. The same shape serves installing and
/// removing, so the two can never drift apart in the catalogue.
#[derive(Clone, Default)]
pub struct ManagerCommands {
    pub npm:   Option<&'static str>,
    pub brew:  Option<&'static str>,
    pub apt:   Option<&'static str>,
    pub cargo: Option<&'static str>,
    pub pip:   Option<&'static str>,
    pub go:    Option<&'static str>,
    pub gem:   Option<&'static str>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ManagerOption {
    pub manager:   &'static str,
    pub command:   &'static str,
    pub available: bool,
}

/// The commands a card can offer, in the order they are shown, without touching
/// the filesystem. Everything that only needs to know *which* commands exist
/// reads this rather than probing for the tools behind them.
pub fn manager_commands(commands: &ManagerCommands) -> Vec<(&'static str, &'static str)> {
    [
        ("npm", commands.npm),
        ("brew", commands.brew),
        ("apt", commands.apt),
        ("cargo", commands.cargo),
        ("pip", commands.pip),
        ("go", commands.go),
        ("gem", commands.gem),
    ]
    .into_iter()
    .filter_map(|(manager, command)| command.map(|command| (manager, command)))
    .collect()
}

/// Whether a manager could exist on this platform at all. Being installed is a
/// separate question, answered by probing; this one keeps a command nobody here
/// could ever run off the card. `brew install clangd` shown to a Windows user is
/// not a missing tool, it is an instruction that leads nowhere.
fn runs_here(manager: &str) -> bool {
    match manager {
        "brew" => cfg!(any(target_os = "macos", target_os = "linux")),
        "apt" => cfg!(target_os = "linux"),
        _ => true,
    }
}

/// The commands worth showing here: the platform filter, then whether the tool
/// each one starts with is on this machine. The manager is probed from the
/// command's own first word, so a command and its tool can never drift apart.
pub fn manager_options(commands: &ManagerCommands, cache: &mut BinaryCache) -> Vec<ManagerOption> {
    manager_commands(commands)
        .into_iter()
        .filter(|(manager, _)| runs_here(manager))
        .map(|(manager, command)| ManagerOption {
            manager,
            command,
            available: command
                .split_whitespace()
                .next()
                .is_some_and(|tool| cache.resolve(tool, None).is_some()),
        })
        .collect()
}

pub fn resolve_command(commands: &ManagerCommands, manager: &str) -> Option<&'static str> {
    manager_commands(commands)
        .into_iter()
        .filter(|(name, _)| runs_here(name))
        .find(|(name, _)| *name == manager)
        .map(|(_, command)| command)
}

/// The manager a binary looks like it came from, so removing it reaches for the
/// same one that put it there rather than the first that happens to be around.
pub fn owning_manager(binary_path: &Path) -> Option<&'static str> {
    let resolved = std::fs::canonicalize(binary_path).unwrap_or_else(|_| binary_path.to_path_buf());
    let path = format!("{} {}", binary_path.to_string_lossy(), resolved.to_string_lossy());

    if path.contains("/gems/") || path.contains("/.gem/") {
        return Some("gem");
    }
    if path.contains("/Cellar/") {
        return Some("brew");
    }
    if path.contains("/node_modules/") {
        return Some("npm");
    }
    if path.contains("/.cargo/") || path.contains("/.rustup/") {
        return Some("cargo");
    }
    if path.contains("/go/bin/") {
        return Some("go");
    }
    if path.contains("/homebrew/") {
        return Some("brew");
    }
    if child_env::command("dpkg")
        .args(["-S", &resolved.to_string_lossy()])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
    {
        return Some("apt");
    }
    None
}

/// Spawns a shell running `command`, with its output piped back to the caller.
/// The user's own login shell (`$SHELL`), so the profile files that build their
/// PATH - and with it nvm, asdf or a Homebrew prefix - are the ones that run.
/// A login shell still does not read the interactive rc file (`~/.zshrc`), so a
/// PATH set only there stays invisible; `extra_lookup_dirs` covers the usual
/// places that leaves out.
pub fn spawn_shell(command: &str) -> std::io::Result<std::process::Child> {
    spawn_shell_in(command, None)
}

/// `spawn_shell`, run from `cwd` when one is given and is a real directory.
/// The directory goes through `current_dir` rather than a `cd &&` prefix: the
/// quoting a path would need differs between `cmd` and a POSIX shell, and a
/// path holding a space or a `&` would break the concatenated form.
pub fn spawn_shell_in(
    command: &str,
    cwd: Option<&Path>,
) -> std::io::Result<std::process::Child> {
    spawn_shell_full(command, cwd, false)
}

/// The directory of the tool a command starts with, when resolution finds it
/// somewhere the login shell's own PATH does not reach.
///
/// A login shell does not read `~/.zshrc`, which is where nvm, fnm and asdf
/// install their hook, so `npm` inside one resolves to whatever the OS ships -
/// typically a node old enough that a modern package refuses to install on it
/// ("unsupported engine"). `resolve_binary` already looks through the version
/// managers' own directories; putting what it finds at the front of PATH is
/// what makes the command actually run under it, and it carries the sibling
/// `node` along, which is the one the engine check reads.
fn resolved_tool_dir(command: &str) -> Option<PathBuf> {
    let tool = command.split_whitespace().next()?;
    if tool.is_empty() || Path::new(tool).is_absolute() {
        return None;
    }
    if BUILDING_LOGIN_DIRS.with(std::cell::Cell::get) {
        return None;
    }
    let resolved = resolve_binary(tool, None)?;
    let dir = resolved.parent()?.to_path_buf();
    if login_shell_dirs().first() == Some(&dir) {
        return None;
    }
    Some(dir)
}

/// `spawn_shell_in`, with `group` putting the child in its own process group so
/// the caller can signal the whole tree at once.
pub fn spawn_shell_full(
    command: &str,
    cwd: Option<&Path>,
    group: bool,
) -> std::io::Result<std::process::Child> {
    #[cfg(windows)]
    let mut process = child_env::command("cmd");
    #[cfg(windows)]
    process.args(["/c", command]);
    #[cfg(not(windows))]
    let mut process = {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
        child_env::command(shell)
    };
    #[cfg(not(windows))]
    process.args(["-lc", command]);

    if let Some(dir) = cwd
        && dir.is_dir()
    {
        process.current_dir(dir);
    }

    if let Some(dir) = resolved_tool_dir(command) {
        let existing = std::env::var_os("PATH").unwrap_or_default();
        let dirs = std::iter::once(dir).chain(std::env::split_paths(&existing));
        if let Ok(path) = std::env::join_paths(dirs) {
            process.env("PATH", path);
        }
    }

    #[cfg(unix)]
    if group {
        use std::os::unix::process::CommandExt;
        process.process_group(0);
    }

    process
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
}

fn is_executable(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        path.metadata()
            .map(|m| m.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        true
    }
}

/// Every `bin` directory under a version manager's roots. nvm, fnm and asdf all
/// keep one directory per installed runtime, and which one is current is decided
/// by a shell function the app never runs - so every version is a candidate.
#[cfg(not(windows))]
fn version_manager_bins(roots: &[PathBuf]) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    for root in roots {
        let Ok(entries) = std::fs::read_dir(root) else { continue };
        let mut versions: Vec<(Vec<u32>, PathBuf)> = entries
            .flatten()
            .map(|entry| (version_key(&entry.file_name().to_string_lossy()), entry.path()))
            .collect();
        versions.sort_by(|a, b| b.0.cmp(&a.0));
        for (_, path) in versions {
            // fnm buries the runtime one level deeper than nvm and asdf do.
            for bin in [path.join("bin"), path.join("installation").join("bin")] {
                if bin.is_dir() {
                    dirs.push(bin);
                }
            }
        }
    }
    dirs
}

/// The numbers in a version directory name, for ordering. `v22.11.0` and
/// `22.11.0` are the same version under different managers; anything that does
/// not parse sorts last rather than winning by accident.
fn version_key(name: &str) -> Vec<u32> {
    name.trim_start_matches('v')
        .split(['.', '-', '+'])
        .map(|part| part.parse::<u32>().unwrap_or(0))
        .collect()
}

fn extra_lookup_dirs(root: Option<&Path>) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(root) = root {
        dirs.push(root.join("node_modules").join(".bin"));
    }
    if let Some(home) = dirs::home_dir() {
        dirs.push(home.join(".cargo").join("bin"));
        dirs.push(home.join("go").join("bin"));
        #[cfg(not(windows))]
        {
            dirs.push(home.join(".local").join("bin"));
            dirs.push(home.join(".bun").join("bin"));
            dirs.push(home.join(".volta").join("bin"));
            dirs.extend(version_manager_bins(&[
                home.join(".nvm").join("versions").join("node"),
                home.join("Library").join("Application Support").join("fnm").join("node-versions"),
                home.join(".local").join("share").join("fnm").join("node-versions"),
                home.join(".asdf").join("installs").join("nodejs"),
                home.join("Library").join("Python"),
            ]));
        }
        #[cfg(windows)]
        {
            dirs.push(home.join("AppData").join("Roaming").join("npm"));
            dirs.push(home.join("AppData").join("Local").join("Microsoft").join("WinGet").join("Links"));
            dirs.push(home.join("scoop").join("shims"));
        }
    }
    #[cfg(not(windows))]
    {
        dirs.push(PathBuf::from("/opt/homebrew/bin"));
        dirs.push(PathBuf::from("/usr/local/bin"));
        dirs.push(PathBuf::from("/home/linuxbrew/.linuxbrew/bin"));
    }
    dirs
}

/// The names a bare command can wear here. On Windows the suffix is neither
/// typed nor part of what a package manager installs - `npm` on disk is
/// `npm.cmd`, `typescript-language-server` is `typescript-language-server.cmd` -
/// so joining the bare name to a directory finds nothing, and every server
/// installed through npm reads as missing. Each PATHEXT suffix is tried in turn.
fn candidate_names(binary: &str) -> Vec<String> {
    #[cfg(not(windows))]
    {
        vec![binary.to_string()]
    }
    #[cfg(windows)]
    {
        let mut names = vec![binary.to_string()];
        if Path::new(binary).extension().is_some() {
            return names;
        }
        let pathext =
            std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string());
        for suffix in pathext.split(';').filter(|s| !s.is_empty()) {
            names.push(format!("{binary}{}", suffix.to_lowercase()));
        }
        names
    }
}

/// Memo for one listing pass. Resolving a binary walks every PATH entry and
/// every fallback directory, and a single listing asks for the same handful of
/// tools dozens of times over - once per command of every catalogue entry.
/// Deliberately short-lived: a binary installed mid-session must show up on the
/// next scan, not after a restart.
#[derive(Default)]
pub struct BinaryCache {
    entries: std::collections::HashMap<(String, Option<PathBuf>), Option<PathBuf>>,
}

impl BinaryCache {
    pub fn resolve(&mut self, binary: &str, root: Option<&Path>) -> Option<PathBuf> {
        let key = (binary.to_string(), root.map(Path::to_path_buf));
        if let Some(hit) = self.entries.get(&key) {
            return hit.clone();
        }
        let resolved = resolve_binary(binary, root);
        self.entries.insert(key, resolved.clone());
        resolved
    }
}

thread_local! {
    static BUILDING_LOGIN_DIRS: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// The PATH the user's own login shell builds, read once per run. A GUI process
/// inherits almost nothing from Finder, and even one started from a terminal
/// misses whatever a shell function - nvm, mise, pyenv - resolves lazily. This
/// is the same shell `spawn_shell` installs through, so what an install command
/// puts on the PATH is what the next scan looks at.
#[cfg(not(windows))]
fn login_shell_dirs() -> &'static [PathBuf] {
    static DIRS: std::sync::OnceLock<Vec<PathBuf>> = std::sync::OnceLock::new();
    DIRS.get_or_init(|| {
        BUILDING_LOGIN_DIRS.with(|f| f.set(true));
        let read = spawn_shell("printf %s \"$PATH\"").and_then(|c| c.wait_with_output());
        BUILDING_LOGIN_DIRS.with(|f| f.set(false));
        let Ok(output) = read else {
            return Vec::new();
        };
        let path = String::from_utf8_lossy(&output.stdout);
        std::env::split_paths(path.trim()).collect()
    })
}

#[cfg(windows)]
fn login_shell_dirs() -> &'static [PathBuf] {
    &[]
}

/// Where a binary actually lives, or None when nothing was found. A missing
/// binary is a normal state: it must never be reported as an error.
pub fn resolve_binary(binary: &str, root: Option<&Path>) -> Option<PathBuf> {
    let names = candidate_names(binary);

    if Path::new(binary).is_absolute() {
        return names
            .into_iter()
            .map(PathBuf::from)
            .find(|candidate| is_executable(candidate));
    }

    let path_dirs = std::env::var("PATH")
        .map(|path| std::env::split_paths(&path).collect::<Vec<PathBuf>>())
        .unwrap_or_default();

    login_shell_dirs()
        .iter()
        .cloned()
        .chain(path_dirs)
        .chain(extra_lookup_dirs(root))
        .flat_map(|dir| names.iter().map(move |name| dir.join(name)))
        .find(|candidate| is_executable(candidate))
}

/// Versions already read, one entry per binary, holding the moment the file was
/// written. Asking costs a process spawn, and the answer only changes when the
/// file does - an upgrade moves the timestamp and the entry misses. Keying on
/// the path alone rather than on the pair is what bounds the map: every `npm
/// install` moves a timestamp, and a pair key would leave the superseded entry
/// behind forever.
static VERSIONS: Mutex<Option<HashMap<PathBuf, (SystemTime, String)>>> = Mutex::new(None);

fn version_stamp(path: &Path) -> Option<(PathBuf, SystemTime)> {
    let modified = path.metadata().ok()?.modified().ok()?;
    Some((path.to_path_buf(), modified))
}

type VersionCache = HashMap<PathBuf, (SystemTime, String)>;

/// The version held for that binary, unless the file has been written since.
fn cached_version(cache: &VersionCache, binary: &Path, modified: SystemTime) -> Option<String> {
    let (cached_at, version) = cache.get(binary)?;
    (*cached_at == modified).then(|| version.clone())
}

/// Records the version, replacing whatever that binary held. Replacing rather
/// than adding is the whole point: an upgrade must not leave the version it
/// superseded behind.
fn remember_version(cache: &mut VersionCache, binary: PathBuf, modified: SystemTime, version: String) {
    cache.insert(binary, (modified, version));
}

/// The version buried in whatever a tool printed: the first run of digits and
/// dots holding at least one dot. Servers pad their answer with their own name,
/// a commit hash and a date, and a registry with the package name.
pub fn parse_version(text: &str) -> Option<Vec<u64>> {
    let bytes: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < bytes.len() {
        if !bytes[i].is_ascii_digit() {
            i += 1;
            continue;
        }
        let start = i;
        while i < bytes.len() && (bytes[i].is_ascii_digit() || bytes[i] == '.') {
            i += 1;
        }
        let run: String = bytes[start..i].iter().collect();
        let run = run.trim_end_matches('.');
        if run.contains('.') {
            let parts: Option<Vec<u64>> = run.split('.').map(|p| p.parse().ok()).collect();
            if let Some(parts) = parts {
                return Some(parts);
            }
        }
    }
    None
}

/// Whether `latest` is newer than `installed`. Only the numeric core is
/// compared: a pre-release suffix says nothing that can be ordered here, and
/// calling an update available on the strength of one would be a guess.
pub fn is_newer(installed: &str, latest: &str) -> Option<bool> {
    let (installed, latest) = (parse_version(installed)?, parse_version(latest)?);
    let len = installed.len().max(latest.len());
    for i in 0..len {
        let (a, b) = (installed.get(i).copied().unwrap_or(0), latest.get(i).copied().unwrap_or(0));
        if a != b {
            return Some(b > a);
        }
    }
    Some(false)
}

/// Homebrew answers whether a formula is outdated rather than with a version:
/// `brew outdated --quiet <formula>` prints the name when there is something to
/// upgrade, and nothing when there is not.
pub fn answers_with_a_flag(manager: &str) -> bool {
    manager == "brew"
}

/// The version of the npm package a binary belongs to, read from the
/// `package.json` next to it. Several servers cannot be asked directly -
/// `pyright-langserver --version` refuses to start without a transport, the
/// `vscode-*` ones crash - and their package knows the answer anyway, without
/// spawning anything.
pub(crate) fn package_version(resolved: &Path) -> Option<String> {
    if !resolved.to_string_lossy().contains("/node_modules/") {
        return None;
    }
    for dir in resolved.ancestors().skip(1) {
        if !dir.to_string_lossy().contains("/node_modules/") {
            break;
        }
        let Ok(text) = std::fs::read_to_string(dir.join("package.json")) else { continue };
        let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) else { continue };
        if let Some(version) = json.get("version").and_then(|v| v.as_str()) {
            return Some(version.to_string());
        }
    }
    None
}

/// What version a binary is: its package's, when it belongs to one, otherwise
/// the first line of `<binary> --version`.
pub fn detect_version(path: &Path) -> Option<String> {
    let resolved = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let stamp = version_stamp(&resolved);
    if let Some((binary, modified)) = stamp.as_ref() {
        let cached = VERSIONS
            .lock()
            .ok()
            .and_then(|cache| cached_version(cache.as_ref()?, binary, *modified));
        if let Some(cached) = cached {
            return Some(cached);
        }
    }

    let version = package_version(&resolved).or_else(|| read_version(path))?;
    if let Some((binary, modified)) = stamp
        && let Ok(mut cache) = VERSIONS.lock() {
            remember_version(cache.get_or_insert_with(HashMap::new), binary, modified, version.clone());
        }
    Some(version)
}

/// A few servers answer `--version` by starting up instead of printing, and
/// never exit: waiting on `output()` would hang the whole scan, so the child is
/// killed once it has had its chance.
fn read_version(path: &Path) -> Option<String> {
    let mut child = child_env::command(path)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if std::time::Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(25));
            }
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            Err(_) => return None,
        }
    }

    let output = child.wait_with_output().ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    let line = text.lines().find(|l| !l.trim().is_empty())?;
    Some(line.trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;


    #[test]
    fn a_version_is_read_out_of_whatever_the_tool_prints() {
        assert_eq!(parse_version("1.2.3"), Some(vec![1, 2, 3]));
        assert_eq!(parse_version("v1.2.3"), Some(vec![1, 2, 3]));
        assert_eq!(parse_version("node v20.11.0"), Some(vec![20, 11, 0]));
        assert_eq!(
            parse_version("rustc 1.75.0 (82e1608df 2023-12-21)"),
            Some(vec![1, 75, 0])
        );
    }

    #[test]
    fn a_rewritten_binary_replaces_its_entry_instead_of_adding_one() {
        let mut cache = VersionCache::new();
        let npm = PathBuf::from("/usr/local/bin/npm");
        let before = SystemTime::UNIX_EPOCH;
        let after = before + Duration::from_secs(3600);

        remember_version(&mut cache, npm.clone(), before, "10.2.0".into());
        assert_eq!(cached_version(&cache, &npm, before).as_deref(), Some("10.2.0"));
        // The install moved the timestamp: the entry misses rather than
        // answering with the version that is no longer installed.
        assert_eq!(cached_version(&cache, &npm, after), None);

        remember_version(&mut cache, npm.clone(), after, "10.9.2".into());
        assert_eq!(cached_version(&cache, &npm, after).as_deref(), Some("10.9.2"));
        assert_eq!(cache.len(), 1, "the superseded version is gone, not merely shadowed");
    }

    #[test]
    fn a_two_part_version_is_read_as_it_is() {
        assert_eq!(parse_version("1.2"), Some(vec![1, 2]));
    }

    #[test]
    fn a_trailing_dot_is_not_taken_for_a_component() {
        assert_eq!(parse_version("1.2."), Some(vec![1, 2]));
    }

    #[test]
    fn a_number_with_no_dot_is_not_a_version() {
        assert_eq!(parse_version("42"), None);
        assert_eq!(parse_version("tool 7"), None);
    }

    #[test]
    fn text_carrying_no_version_answers_nothing() {
        assert_eq!(parse_version(""), None);
        assert_eq!(parse_version("command not found"), None);
    }

    #[test]
    fn the_first_version_shaped_run_wins() {
        assert_eq!(parse_version("tool 1.2.3 built with 4.5.6"), Some(vec![1, 2, 3]));
    }

    #[test]
    fn a_version_with_many_components_keeps_them_all() {
        assert_eq!(parse_version("1.2.3.4"), Some(vec![1, 2, 3, 4]));
    }

    #[test]
    fn an_update_is_reported_when_the_latest_is_ahead() {
        assert_eq!(is_newer("1.2.3", "1.2.4"), Some(true));
        assert_eq!(is_newer("1.2.3", "1.3.0"), Some(true));
        assert_eq!(is_newer("1.2.3", "2.0.0"), Some(true));
    }

    #[test]
    fn no_update_is_reported_when_the_versions_match() {
        assert_eq!(is_newer("1.2.3", "1.2.3"), Some(false));
    }

    #[test]
    fn no_update_is_reported_when_the_installed_one_is_ahead() {
        assert_eq!(is_newer("2.0.0", "1.9.9"), Some(false));
    }

    /// A version with fewer components is padded with zeroes rather than
    /// compared by length, so 1.2 and 1.2.0 are the same release.
    #[test]
    fn a_shorter_version_is_padded_rather_than_ranked_by_length() {
        assert_eq!(is_newer("1.2", "1.2.0"), Some(false));
        assert_eq!(is_newer("1.2.0", "1.2"), Some(false));
        assert_eq!(is_newer("1.2", "1.2.1"), Some(true));
    }

    #[test]
    fn a_double_digit_component_is_compared_as_a_number() {
        assert_eq!(is_newer("1.9.0", "1.10.0"), Some(true));
        assert_eq!(is_newer("1.10.0", "1.9.0"), Some(false));
    }

    /// A pre-release suffix says nothing that can be ordered, so only the
    /// numeric core is compared rather than guessing.
    #[test]
    fn a_pre_release_suffix_is_left_out_of_the_comparison() {
        assert_eq!(is_newer("1.2.3", "1.2.3-beta.1"), Some(false));
        assert_eq!(is_newer("1.2.3-alpha", "1.2.4"), Some(true));
    }

    #[test]
    fn nothing_is_reported_when_a_version_cannot_be_read() {
        assert_eq!(is_newer("not a version", "1.2.3"), None);
        assert_eq!(is_newer("1.2.3", "unknown"), None);
        assert_eq!(is_newer("", ""), None);
    }

    #[test]
    fn homebrew_is_the_one_manager_that_answers_with_a_flag() {
        assert!(answers_with_a_flag("brew"));
        for manager in ["npm", "cargo", "gem", "go", "apt"] {
            assert!(!answers_with_a_flag(manager), "{manager} should report a version");
        }
    }

    /// The order matters: a gem's bin directory can sit inside a Homebrew
    /// prefix, and a formula whose payload is a node package lands in both
    /// Cellar and node_modules. Whoever put the binary there owns it.
    #[test]
    fn a_gem_wins_over_the_prefix_it_sits_in() {
        assert_eq!(
            owning_manager(Path::new("/opt/homebrew/lib/ruby/gems/3.2.0/bin/rubocop")),
            Some("gem")
        );
    }

    #[test]
    fn homebrew_owns_what_lives_in_its_cellar() {
        assert_eq!(
            owning_manager(Path::new("/opt/homebrew/Cellar/node/20.0.0/bin/node")),
            Some("brew")
        );
    }

    #[test]
    fn a_formula_whose_payload_is_a_node_package_still_belongs_to_homebrew() {
        assert_eq!(
            owning_manager(Path::new("/opt/homebrew/Cellar/x/1.0/lib/node_modules/x/bin/x")),
            Some("brew")
        );
    }

    #[test]
    fn npm_owns_what_it_installed_globally() {
        assert_eq!(
            owning_manager(Path::new("/usr/local/lib/node_modules/typescript/bin/tsc")),
            Some("npm")
        );
    }

    #[test]
    fn cargo_owns_what_it_installed() {
        assert_eq!(
            owning_manager(Path::new("/home/ada/.cargo/bin/ripgrep")),
            Some("cargo")
        );
        assert_eq!(
            owning_manager(Path::new("/home/ada/.rustup/toolchains/stable/bin/rustc")),
            Some("cargo")
        );
    }

    #[test]
    fn go_owns_what_it_installed() {
        assert_eq!(
            owning_manager(Path::new("/home/ada/go/bin/gopls")),
            Some("go")
        );
    }

    #[test]
    fn a_homebrew_prefix_outside_the_cellar_still_reads_as_homebrew() {
        assert_eq!(
            owning_manager(Path::new("/home/linuxbrew/.linuxbrew/homebrew/bin/tool")),
            Some("brew")
        );
    }

    #[test]
    fn a_binary_no_manager_claims_answers_nothing() {
        assert_eq!(owning_manager(Path::new("/opt/hand-built/bin/tool")), None);
    }

    #[test]
    fn manager_commands_are_listed_with_their_manager() {
        let commands = ManagerCommands::default();
        for (manager, _) in manager_commands(&commands) {
            assert!(!manager.is_empty());
        }
    }
}

#[cfg(test)]
mod version_order_tests {
    use super::*;

    #[test]
    fn newest_node_wins_over_the_system_one() {
        let dir = std::env::temp_dir().join(format!("cairn-nvm-{}", std::process::id()));
        let root = dir.join("versions").join("node");
        for v in ["v18.19.1", "v22.22.2", "v20.9.0"] {
            std::fs::create_dir_all(root.join(v).join("bin")).unwrap();
        }
        let dirs = version_manager_bins(&[root.clone()]);
        let first = dirs.first().unwrap().to_string_lossy().to_string();
        std::fs::remove_dir_all(&dir).ok();
        assert!(first.contains("v22.22.2"), "resolved {first} instead of v22.22.2");
    }

    #[test]
    fn version_key_orders_numerically_not_lexically() {
        assert!(version_key("v22.11.0") > version_key("v9.11.0"));
        assert!(version_key("22.11.0") > version_key("v18.19.1"));
        assert_eq!(version_key("not-a-version"), vec![0, 0, 0]);
    }
}
