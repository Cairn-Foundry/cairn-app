use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::SystemTime;
use serde::Serialize;

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
    /// Whether the package manager the command needs is on this machine.
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
    // The link is followed first. What npm installs globally is a link in a
    // `bin` directory pointing into `lib/node_modules`, and so is what Homebrew
    // installs into `Cellar`: the link itself sits in the same directory for
    // both and says nothing about who put it there.
    let resolved = std::fs::canonicalize(binary_path).unwrap_or_else(|_| binary_path.to_path_buf());
    let path = format!("{} {}", binary_path.to_string_lossy(), resolved.to_string_lossy());

    // Checked first: a gem's bin directory can sit inside a Homebrew prefix, and
    // the manager that put a binary there is the one that must take it away.
    if path.contains("/gems/") || path.contains("/.gem/") {
        return Some("gem");
    }
    // Before node_modules: a Homebrew formula whose payload happens to be a node
    // package lands in both, and inside its own cellar Homebrew is the owner.
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
    // dpkg's own database is the only reliable signal: `/usr/bin` also holds
    // whatever the OS image shipped with, not just what apt put there.
    if Command::new("dpkg")
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
    #[cfg(windows)]
    let mut process = Command::new("cmd");
    #[cfg(windows)]
    process.args(["/c", command]);
    #[cfg(not(windows))]
    let mut process = {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
        Command::new(shell)
    };
    #[cfg(not(windows))]
    process.args(["-lc", command]);

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
        for entry in entries.flatten() {
            // fnm buries the runtime one level deeper than nvm and asdf do.
            for bin in [entry.path().join("bin"), entry.path().join("installation").join("bin")] {
                if bin.is_dir() {
                    dirs.push(bin);
                }
            }
        }
    }
    dirs
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
            // A Node installed by a version manager lives under a per-version
            // directory that only the shell's own hook puts on the PATH, and
            // that hook never runs for a GUI process. Without this, everything
            // `npm install -g` ever put there reads as not installed - and the
            // install button that just succeeded looks like it did nothing.
            dirs.extend(version_manager_bins(&[
                home.join(".nvm").join("versions").join("node"),
                home.join("Library").join("Application Support").join("fnm").join("node-versions"),
                home.join(".local").join("share").join("fnm").join("node-versions"),
                home.join(".asdf").join("installs").join("nodejs"),
                // pip's `--user` bin, one directory per Python version.
                home.join("Library").join("Python"),
            ]));
        }
        // Where npm, winget and scoop put a per-user install on Windows. None of
        // them is on the PATH of a process started from the Start menu until the
        // session is signed out and back in.
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

/// The PATH the user's own login shell builds, read once per run. A GUI process
/// inherits almost nothing from Finder, and even one started from a terminal
/// misses whatever a shell function - nvm, mise, pyenv - resolves lazily. This
/// is the same shell `spawn_shell` installs through, so what an install command
/// puts on the PATH is what the next scan looks at.
#[cfg(not(windows))]
fn login_shell_dirs() -> &'static [PathBuf] {
    static DIRS: std::sync::OnceLock<Vec<PathBuf>> = std::sync::OnceLock::new();
    DIRS.get_or_init(|| {
        let Ok(output) = spawn_shell("printf %s \"$PATH\"").and_then(|c| c.wait_with_output())
        else {
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

    // The login shell's PATH is checked first: it is what nvm, asdf or a
    // Homebrew prefix actually build, while the process's own inherited PATH
    // is often just the OS default. On Linux that default already contains
    // `/usr/bin`, and a distro-packaged `npm` there is old enough to reject
    // the `engines` field of most modern packages - so a version manager the
    // user set up would otherwise lose to it on every resolution.
    login_shell_dirs()
        .iter()
        .cloned()
        .chain(path_dirs)
        .chain(extra_lookup_dirs(root))
        .flat_map(|dir| names.iter().map(move |name| dir.join(name)))
        .find(|candidate| is_executable(candidate))
}

/// Versions already read, keyed by the binary and the moment it was written.
/// Asking costs a process spawn, and the answer only changes when the file
/// does - an upgrade moves the timestamp and the entry misses on its own.
static VERSIONS: Mutex<Option<HashMap<(PathBuf, SystemTime), String>>> = Mutex::new(None);

fn version_stamp(path: &Path) -> Option<(PathBuf, SystemTime)> {
    let modified = path.metadata().ok()?.modified().ok()?;
    Some((path.to_path_buf(), modified))
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
    // Stamped on the target rather than the link: updating a package rewrites
    // the files, and may well leave the link it was reached through untouched.
    let stamp = version_stamp(&resolved);
    if let Some(stamp) = stamp.as_ref() {
        let cached = VERSIONS
            .lock()
            .ok()
            .and_then(|cache| cache.as_ref()?.get(stamp).cloned());
        if let Some(cached) = cached {
            return Some(cached);
        }
    }

    let version = package_version(&resolved).or_else(|| read_version(path))?;
    if let Some(stamp) = stamp {
        if let Ok(mut cache) = VERSIONS.lock() {
            cache.get_or_insert_with(HashMap::new).insert(stamp, version.clone());
        }
    }
    Some(version)
}

fn read_version(path: &Path) -> Option<String> {
    let output = Command::new(path)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    let line = text.lines().find(|l| !l.trim().is_empty())?;
    Some(line.trim().to_string())
}
