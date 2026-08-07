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
    pub cargo: Option<&'static str>,
    pub pip:   Option<&'static str>,
    pub go:    Option<&'static str>,
}

/// Keep this catalogue in sync with LANGUAGE_SERVERS in
/// src/lib/utils/languages/servers.ts (same ids, names and extensions).
pub struct LanguageServerDef {
    pub id:           &'static str,
    pub name:         &'static str,
    pub binary:       &'static str,
    pub args:         &'static [&'static str],
    pub language_ids: &'static [&'static str],
    pub extensions:   &'static [&'static str],
    pub root_markers: &'static [&'static str],
    pub install:      ManagerCommands,
    pub uninstall:    ManagerCommands,
    pub doc_url:      &'static str,
}

pub const CATALOG: &[LanguageServerDef] = &[
    LanguageServerDef {
        id:           "typescript",
        name:         "TypeScript / JavaScript",
        binary:       "typescript-language-server",
        args:         &["--stdio"],
        language_ids: &["typescript", "typescriptreact", "javascript", "javascriptreact"],
        extensions:   &[".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"],
        root_markers: &["tsconfig.json", "jsconfig.json", "package.json"],
        install: ManagerCommands {
            npm: Some("npm install -g typescript typescript-language-server"),
            ..EMPTY
        },
        uninstall: ManagerCommands {
            npm: Some("npm uninstall -g typescript typescript-language-server"),
            ..EMPTY
        },
        doc_url: "https://github.com/typescript-language-server/typescript-language-server",
    },
    LanguageServerDef {
        id:           "python",
        name:         "Python (Pyright)",
        binary:       "pyright-langserver",
        args:         &["--stdio"],
        language_ids: &["python"],
        extensions:   &[".py", ".pyi"],
        root_markers: &["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt"],
        install: ManagerCommands {
            npm: Some("npm install -g pyright"),
            pip: Some("pip install pyright"),
            ..EMPTY
        },
        uninstall: ManagerCommands {
            npm: Some("npm uninstall -g pyright"),
            pip: Some("pip uninstall -y pyright"),
            ..EMPTY
        },
        doc_url: "https://github.com/microsoft/pyright",
    },
    LanguageServerDef {
        id:           "rust",
        name:         "Rust (rust-analyzer)",
        binary:       "rust-analyzer",
        args:         &[],
        language_ids: &["rust"],
        extensions:   &[".rs"],
        root_markers: &["Cargo.toml"],
        install: ManagerCommands {
            brew:  Some("brew install rust-analyzer"),
            cargo: Some("rustup component add rust-analyzer"),
            ..EMPTY
        },
        uninstall: ManagerCommands {
            brew:  Some("brew uninstall rust-analyzer"),
            cargo: Some("rustup component remove rust-analyzer"),
            ..EMPTY
        },
        doc_url: "https://rust-analyzer.github.io",
    },
    LanguageServerDef {
        id:           "go",
        name:         "Go (gopls)",
        binary:       "gopls",
        args:         &[],
        language_ids: &["go"],
        extensions:   &[".go"],
        root_markers: &["go.work", "go.mod"],
        install: ManagerCommands {
            brew: Some("brew install gopls"),
            go:   Some("go install golang.org/x/tools/gopls@latest"),
            ..EMPTY
        },
        // `go install` has no counterpart: it only drops a binary in GOBIN.
        uninstall: ManagerCommands { brew: Some("brew uninstall gopls"), ..EMPTY },
        doc_url: "https://pkg.go.dev/golang.org/x/tools/gopls",
    },
    LanguageServerDef {
        id:           "svelte",
        name:         "Svelte",
        binary:       "svelteserver",
        args:         &["--stdio"],
        language_ids: &["svelte"],
        extensions:   &[".svelte"],
        root_markers: &["svelte.config.js", "svelte.config.ts", "package.json"],
        install:   ManagerCommands { npm: Some("npm install -g svelte-language-server"), ..EMPTY },
        uninstall: ManagerCommands { npm: Some("npm uninstall -g svelte-language-server"), ..EMPTY },
        doc_url: "https://github.com/sveltejs/language-tools",
    },
    LanguageServerDef {
        id:           "json",
        name:         "JSON",
        binary:       "vscode-json-language-server",
        args:         &["--stdio"],
        language_ids: &["json", "jsonc"],
        extensions:   &[".json", ".jsonc"],
        root_markers: &["package.json"],
        install:   ManagerCommands { npm: Some("npm install -g vscode-langservers-extracted"), ..EMPTY },
        uninstall: ManagerCommands { npm: Some("npm uninstall -g vscode-langservers-extracted"), ..EMPTY },
        doc_url: "https://github.com/hrsh7th/vscode-langservers-extracted",
    },
    LanguageServerDef {
        id:           "css",
        name:         "CSS / SCSS / Less",
        binary:       "vscode-css-language-server",
        args:         &["--stdio"],
        language_ids: &["css", "scss", "less"],
        extensions:   &[".css", ".scss", ".less"],
        root_markers: &["package.json"],
        install:   ManagerCommands { npm: Some("npm install -g vscode-langservers-extracted"), ..EMPTY },
        uninstall: ManagerCommands { npm: Some("npm uninstall -g vscode-langservers-extracted"), ..EMPTY },
        doc_url: "https://github.com/hrsh7th/vscode-langservers-extracted",
    },
    LanguageServerDef {
        id:           "html",
        name:         "HTML",
        binary:       "vscode-html-language-server",
        args:         &["--stdio"],
        language_ids: &["html"],
        extensions:   &[".html", ".htm"],
        root_markers: &["package.json"],
        install:   ManagerCommands { npm: Some("npm install -g vscode-langservers-extracted"), ..EMPTY },
        uninstall: ManagerCommands { npm: Some("npm uninstall -g vscode-langservers-extracted"), ..EMPTY },
        doc_url: "https://github.com/hrsh7th/vscode-langservers-extracted",
    },
    LanguageServerDef {
        id:           "yaml",
        name:         "YAML",
        binary:       "yaml-language-server",
        args:         &["--stdio"],
        language_ids: &["yaml"],
        extensions:   &[".yaml", ".yml"],
        root_markers: &[],
        install:   ManagerCommands { npm: Some("npm install -g yaml-language-server"), ..EMPTY },
        uninstall: ManagerCommands { npm: Some("npm uninstall -g yaml-language-server"), ..EMPTY },
        doc_url: "https://github.com/redhat-developer/yaml-language-server",
    },
    LanguageServerDef {
        id:           "bash",
        name:         "Bash",
        binary:       "bash-language-server",
        args:         &["start"],
        language_ids: &["shellscript"],
        extensions:   &[".sh", ".bash", ".zsh"],
        root_markers: &[],
        install: ManagerCommands {
            npm:  Some("npm install -g bash-language-server"),
            brew: Some("brew install bash-language-server"),
            ..EMPTY
        },
        uninstall: ManagerCommands {
            npm:  Some("npm uninstall -g bash-language-server"),
            brew: Some("brew uninstall bash-language-server"),
            ..EMPTY
        },
        doc_url: "https://github.com/bash-lsp/bash-language-server",
    },
];

const EMPTY: ManagerCommands = ManagerCommands {
    npm: None, brew: None, cargo: None, pip: None, go: None,
};

pub fn find_def(id: &str) -> Option<&'static LanguageServerDef> {
    CATALOG.iter().find(|d| d.id == id)
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
        ("cargo", commands.cargo),
        ("pip", commands.pip),
        ("go", commands.go),
    ]
    .into_iter()
    .filter_map(|(manager, command)| command.map(|command| (manager, command)))
    .collect()
}

/// The same list, plus whether the tool each command starts with is on this
/// machine. The manager is probed from the command's own first word, so a
/// command and its tool can never drift apart.
pub fn manager_options(commands: &ManagerCommands, cache: &mut BinaryCache) -> Vec<ManagerOption> {
    manager_commands(commands)
        .into_iter()
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
        .find(|(name, _)| *name == manager)
        .map(|(_, command)| command)
}

/// Several servers ship in one package - the JSON, CSS and HTML ones all come
/// from `vscode-langservers-extracted`. Removing one removes the others, and
/// the user has to be told before, not after.
pub fn shares_removal_with(def: &LanguageServerDef) -> Vec<&'static str> {
    let own = manager_commands(&def.uninstall);
    CATALOG
        .iter()
        .filter(|other| other.id != def.id)
        .filter(|other| {
            manager_commands(&other.uninstall)
                .iter()
                .any(|(_, command)| own.iter().any(|(_, mine)| mine == command))
        })
        .map(|other| other.name)
        .collect()
}

/// The manager a binary looks like it came from, so removing it reaches for the
/// same one that put it there rather than the first that happens to be around.
pub fn owning_manager(binary_path: &Path) -> Option<&'static str> {
    let path = binary_path.to_string_lossy();
    if path.contains("/Cellar/") || path.contains("/homebrew/") {
        return Some("brew");
    }
    if path.contains("/.cargo/") || path.contains("/.rustup/") {
        return Some("cargo");
    }
    if path.contains("/go/bin/") {
        return Some("go");
    }
    if path.contains("/node_modules/") {
        return Some("npm");
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

fn extra_lookup_dirs(root: Option<&Path>) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(root) = root {
        dirs.push(root.join("node_modules").join(".bin"));
    }
    if let Some(home) = dirs::home_dir() {
        dirs.push(home.join(".cargo").join("bin"));
        dirs.push(home.join(".local").join("bin"));
        dirs.push(home.join("go").join("bin"));
        dirs.push(home.join(".bun").join("bin"));
        dirs.push(home.join(".volta").join("bin"));
    }
    dirs.push(PathBuf::from("/opt/homebrew/bin"));
    dirs.push(PathBuf::from("/usr/local/bin"));
    dirs
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

/// Where a binary actually lives, or None when nothing was found. A missing
/// binary is a normal state: it must never be reported as an error.
pub fn resolve_binary(binary: &str, root: Option<&Path>) -> Option<PathBuf> {
    let direct = Path::new(binary);
    if direct.is_absolute() {
        return is_executable(direct).then(|| direct.to_path_buf());
    }

    if let Ok(path) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path) {
            let candidate = dir.join(binary);
            if is_executable(&candidate) {
                return Some(candidate);
            }
        }
    }

    extra_lookup_dirs(root)
        .into_iter()
        .map(|dir| dir.join(binary))
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

/// First line of `<binary> --version`, when the binary answers at all.
pub fn detect_version(path: &Path) -> Option<String> {
    let stamp = version_stamp(path);
    if let Some(stamp) = stamp.as_ref() {
        let cached = VERSIONS
            .lock()
            .ok()
            .and_then(|cache| cache.as_ref()?.get(stamp).cloned());
        if let Some(cached) = cached {
            return Some(cached);
        }
    }

    let version = read_version(path)?;
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

/// The highest ancestor of `file` inside the worktree holding one of the
/// server's root markers, falling back to the worktree itself. Taking the
/// highest rather than the closest keeps a monorepo on a single server instead
/// of one per package.
pub fn resolve_root(def: &LanguageServerDef, worktree: &Path, file: &Path) -> PathBuf {
    if def.root_markers.is_empty() || !file.starts_with(worktree) {
        return worktree.to_path_buf();
    }
    let mut current = file.parent();
    let mut best: Option<PathBuf> = None;
    while let Some(dir) = current {
        if !dir.starts_with(worktree) {
            break;
        }
        if def.root_markers.iter().any(|m| dir.join(m).exists()) {
            best = Some(dir.to_path_buf());
        }
        if dir == worktree {
            break;
        }
        current = dir.parent();
    }
    best.unwrap_or_else(|| worktree.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn def_with(markers: &'static [&'static str]) -> LanguageServerDef {
        LanguageServerDef {
            id: "test",
            name: "Test",
            binary: "test-ls",
            args: &[],
            language_ids: &[],
            extensions: &[],
            root_markers: markers,
            install: EMPTY,
            uninstall: EMPTY,
            doc_url: "",
        }
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("cairn-lsp-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn falls_back_to_the_worktree_without_markers() {
        let root = temp_dir("no-markers");
        let file = root.join("src/main.rs");
        assert_eq!(resolve_root(&def_with(&[]), &root, &file), root);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn takes_the_highest_marker_inside_the_worktree() {
        let root = temp_dir("monorepo");
        let package = root.join("packages/app");
        std::fs::create_dir_all(&package).unwrap();
        std::fs::write(root.join("package.json"), "{}").unwrap();
        std::fs::write(package.join("package.json"), "{}").unwrap();

        let file = package.join("src/index.ts");
        assert_eq!(resolve_root(&def_with(&["package.json"]), &root, &file), root);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn never_climbs_above_the_worktree() {
        let outer = temp_dir("outer");
        let worktree = outer.join("inner");
        std::fs::create_dir_all(worktree.join("src")).unwrap();
        std::fs::write(outer.join("Cargo.toml"), "").unwrap();

        let file = worktree.join("src/main.rs");
        assert_eq!(resolve_root(&def_with(&["Cargo.toml"]), &worktree, &file), worktree);
        let _ = std::fs::remove_dir_all(&outer);
    }

    #[test]
    fn falls_back_for_a_file_outside_the_worktree() {
        let root = temp_dir("outside");
        let file = PathBuf::from("/elsewhere/main.rs");
        assert_eq!(resolve_root(&def_with(&["Cargo.toml"]), &root, &file), root);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn resolves_an_absolute_binary_only_when_executable() {
        assert!(resolve_binary("/definitely/not/here", None).is_none());
        assert_eq!(resolve_binary("/bin/sh", None), Some(PathBuf::from("/bin/sh")));
    }

    #[test]
    fn manager_options_probe_the_command_s_own_tool() {
        let commands = ManagerCommands {
            npm:   Some("sh -c true"),
            cargo: Some("cairn-no-such-tool install thing"),
            ..EMPTY
        };
        let options = manager_options(&commands, &mut BinaryCache::default());
        assert_eq!(options.len(), 2);
        assert_eq!(options[0].manager, "npm");
        assert!(options[0].available, "sh should always resolve");
        assert_eq!(options[1].manager, "cargo");
        assert!(!options[1].available);
    }

    #[test]
    fn resolve_command_refuses_a_manager_the_catalogue_does_not_offer() {
        let def = find_def("rust").unwrap();
        assert_eq!(resolve_command(&def.install, "npm"), None);
        assert_eq!(resolve_command(&def.install, "brew"), Some("brew install rust-analyzer"));
        assert_eq!(resolve_command(&def.uninstall, "brew"), Some("brew uninstall rust-analyzer"));
    }

    #[test]
    fn warns_that_one_package_carries_several_servers() {
        let json = find_def("json").unwrap();
        let shared = shares_removal_with(json);
        assert!(shared.contains(&"CSS / SCSS / Less"), "{shared:?}");
        assert!(shared.contains(&"HTML"), "{shared:?}");
    }

    #[test]
    fn a_server_with_its_own_package_shares_nothing() {
        assert!(shares_removal_with(find_def("rust").unwrap()).is_empty());
        assert!(shares_removal_with(find_def("yaml").unwrap()).is_empty());
    }

    #[test]
    fn reads_the_owning_manager_off_the_binary_path() {
        assert_eq!(owning_manager(Path::new("/opt/homebrew/bin/gopls")), Some("brew"));
        assert_eq!(owning_manager(Path::new("/usr/local/Cellar/x/1/bin/x")), Some("brew"));
        assert_eq!(owning_manager(Path::new("/Users/me/.cargo/bin/rust-analyzer")), Some("cargo"));
        assert_eq!(owning_manager(Path::new("/Users/me/go/bin/gopls")), Some("go"));
        assert_eq!(owning_manager(Path::new("/x/node_modules/.bin/tsserver")), Some("npm"));
        assert_eq!(owning_manager(Path::new("/usr/local/bin/whatever")), None);
    }

    #[test]
    fn catalogue_never_claims_an_extension_twice() {
        let mut seen = std::collections::HashSet::new();
        for def in CATALOG {
            for extension in def.extensions {
                assert!(seen.insert(*extension), "{extension} claimed twice");
            }
        }
    }

    #[test]
    fn every_installable_server_can_also_be_removed() {
        for def in CATALOG {
            assert!(!manager_commands(&def.install).is_empty(), "{} cannot be installed", def.id);
            assert!(!manager_commands(&def.uninstall).is_empty(), "{} cannot be removed", def.id);
        }
    }

    #[test]
    fn the_binary_cache_answers_the_same_as_a_fresh_lookup() {
        let mut cache = BinaryCache::default();
        assert_eq!(cache.resolve("/bin/sh", None), resolve_binary("/bin/sh", None));
        assert_eq!(cache.resolve("/bin/sh", None), Some(PathBuf::from("/bin/sh")));
        assert_eq!(cache.resolve("cairn-no-such-tool", None), None);
        assert_eq!(cache.resolve("cairn-no-such-tool", None), None);
    }

    #[test]
    fn a_shared_package_is_found_without_touching_the_filesystem() {
        // shares_removal_with compares commands, so it must hold whether or not
        // any package manager is installed on the machine running the tests.
        let css = shares_removal_with(find_def("css").unwrap());
        assert!(css.contains(&"JSON"), "{css:?}");
        assert!(css.contains(&"HTML"), "{css:?}");
    }
}
