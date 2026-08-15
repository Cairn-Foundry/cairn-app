//! The catalogue of known language servers, plus the user's own entries, and
//! how a server's workspace root is resolved for a given file.

use std::path::{Path, PathBuf};

pub use crate::commands::toolchain::{
    answers_with_a_flag, detect_version, is_newer, manager_commands, manager_options,
    owning_manager, parse_version, resolve_binary, resolve_command, spawn_shell, BinaryCache,
    ManagerCommands, ManagerOption,
};

/// One entry of the built-in catalogue. Keep it in sync with LANGUAGE_SERVERS in
/// src/lib/utils/languages/servers.ts (same ids, names and extensions).
pub struct BuiltinDef {
    pub id:           &'static str,
    pub name:         &'static str,
    pub binary:       &'static str,
    pub args:         &'static [&'static str],
    pub language_ids: &'static [&'static str],
    pub extensions:   &'static [&'static str],
    pub root_markers: &'static [&'static str],
    pub install:      ManagerCommands,
    pub uninstall:    ManagerCommands,
    /// What brings an already installed server up to date. Separate from
    /// installing because most managers refuse to install over themselves:
    /// `brew install` on an outdated formula reports it is already there.
    pub update:       ManagerCommands,
    /// What answers whether a newer version exists, without installing it.
    /// Empty for a manager that publishes no version to ask for - rustup hands
    /// out whatever the toolchain carries, and there is nothing to compare to.
    pub check:        ManagerCommands,
    pub doc_url:      &'static str,
}

/// A server the rest of the code works with, whether it came from the built-in
/// catalogue or from what the user declared in their settings. Owned rather than
/// borrowed for exactly that reason: a user server exists only at runtime.
#[derive(Clone)]
pub struct LanguageServerDef {
    pub id:           String,
    pub name:         String,
    pub binary:       String,
    pub args:         Vec<String>,
    pub language_ids: Vec<String>,
    pub extensions:   Vec<String>,
    pub root_markers: Vec<String>,
    pub install:      ManagerCommands,
    pub uninstall:    ManagerCommands,
    pub update:       ManagerCommands,
    pub check:        ManagerCommands,
    pub doc_url:      String,
    /// A server Cairn neither installs nor removes: the user brought it.
    pub custom:       bool,
}

pub const BUILTIN: &[BuiltinDef] = &[
    BuiltinDef {
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
        update: ManagerCommands {
            npm: Some("npm install -g typescript@latest typescript-language-server@latest"),
            ..EMPTY
        },
        check: ManagerCommands {
            npm: Some("npm view typescript-language-server version"),
            ..EMPTY
        },
        doc_url: "https://github.com/typescript-language-server/typescript-language-server",
    },
    BuiltinDef {
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
        update: ManagerCommands {
            npm: Some("npm install -g pyright@latest"),
            pip: Some("pip install --upgrade pyright"),
            ..EMPTY
        },
        check: ManagerCommands {
            npm: Some("npm view pyright version"),
            pip: Some("pip index versions pyright"),
            ..EMPTY
        },
        doc_url: "https://github.com/microsoft/pyright",
    },
    BuiltinDef {
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
        update: ManagerCommands {
            brew:  Some("brew upgrade rust-analyzer"),
            cargo: Some("rustup component add rust-analyzer"),
            ..EMPTY
        },
        check:     ManagerCommands { brew: Some("brew outdated --quiet rust-analyzer"), ..EMPTY },
        doc_url: "https://rust-analyzer.github.io",
    },
    BuiltinDef {
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
        update: ManagerCommands {
            brew: Some("brew upgrade gopls"),
            go:   Some("go install golang.org/x/tools/gopls@latest"),
            ..EMPTY
        },
        check: ManagerCommands {
            brew: Some("brew outdated --quiet gopls"),
            go:   Some("go list -m -f {{.Version}} golang.org/x/tools/gopls@latest"),
            ..EMPTY
        },
        doc_url: "https://pkg.go.dev/golang.org/x/tools/gopls",
    },
    BuiltinDef {
        id:           "svelte",
        name:         "Svelte",
        binary:       "svelteserver",
        args:         &["--stdio"],
        language_ids: &["svelte"],
        extensions:   &[".svelte"],
        root_markers: &["svelte.config.js", "svelte.config.ts", "package.json"],
        install:   ManagerCommands { npm: Some("npm install -g svelte-language-server"), ..EMPTY },
        uninstall: ManagerCommands { npm: Some("npm uninstall -g svelte-language-server"), ..EMPTY },
        update: ManagerCommands {
            npm: Some("npm install -g svelte-language-server@latest"),
            ..EMPTY
        },
        check: ManagerCommands {
            npm: Some("npm view svelte-language-server version"),
            ..EMPTY
        },
        doc_url: "https://github.com/sveltejs/language-tools",
    },
    BuiltinDef {
        id:           "json",
        name:         "JSON",
        binary:       "vscode-json-language-server",
        args:         &["--stdio"],
        language_ids: &["json", "jsonc"],
        extensions:   &[".json", ".jsonc"],
        root_markers: &["package.json"],
        install:   ManagerCommands { npm: Some("npm install -g vscode-langservers-extracted"), ..EMPTY },
        uninstall: ManagerCommands { npm: Some("npm uninstall -g vscode-langservers-extracted"), ..EMPTY },
        update: ManagerCommands {
            npm: Some("npm install -g vscode-langservers-extracted@latest"),
            ..EMPTY
        },
        check: ManagerCommands {
            npm: Some("npm view vscode-langservers-extracted version"),
            ..EMPTY
        },
        doc_url: "https://github.com/hrsh7th/vscode-langservers-extracted",
    },
    BuiltinDef {
        id:           "css",
        name:         "CSS / SCSS / Less",
        binary:       "vscode-css-language-server",
        args:         &["--stdio"],
        language_ids: &["css", "scss", "less"],
        extensions:   &[".css", ".scss", ".less"],
        root_markers: &["package.json"],
        install:   ManagerCommands { npm: Some("npm install -g vscode-langservers-extracted"), ..EMPTY },
        uninstall: ManagerCommands { npm: Some("npm uninstall -g vscode-langservers-extracted"), ..EMPTY },
        update: ManagerCommands {
            npm: Some("npm install -g vscode-langservers-extracted@latest"),
            ..EMPTY
        },
        check: ManagerCommands {
            npm: Some("npm view vscode-langservers-extracted version"),
            ..EMPTY
        },
        doc_url: "https://github.com/hrsh7th/vscode-langservers-extracted",
    },
    BuiltinDef {
        id:           "html",
        name:         "HTML",
        binary:       "vscode-html-language-server",
        args:         &["--stdio"],
        language_ids: &["html"],
        extensions:   &[".html", ".htm"],
        root_markers: &["package.json"],
        install:   ManagerCommands { npm: Some("npm install -g vscode-langservers-extracted"), ..EMPTY },
        uninstall: ManagerCommands { npm: Some("npm uninstall -g vscode-langservers-extracted"), ..EMPTY },
        update: ManagerCommands {
            npm: Some("npm install -g vscode-langservers-extracted@latest"),
            ..EMPTY
        },
        check: ManagerCommands {
            npm: Some("npm view vscode-langservers-extracted version"),
            ..EMPTY
        },
        doc_url: "https://github.com/hrsh7th/vscode-langservers-extracted",
    },
    BuiltinDef {
        id:           "yaml",
        name:         "YAML",
        binary:       "yaml-language-server",
        args:         &["--stdio"],
        language_ids: &["yaml"],
        extensions:   &[".yaml", ".yml"],
        root_markers: &[],
        install:   ManagerCommands { npm: Some("npm install -g yaml-language-server"), ..EMPTY },
        uninstall: ManagerCommands { npm: Some("npm uninstall -g yaml-language-server"), ..EMPTY },
        update: ManagerCommands {
            npm: Some("npm install -g yaml-language-server@latest"),
            ..EMPTY
        },
        check:     ManagerCommands { npm: Some("npm view yaml-language-server version"), ..EMPTY },
        doc_url: "https://github.com/redhat-developer/yaml-language-server",
    },
    BuiltinDef {
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
        update: ManagerCommands {
            npm:  Some("npm install -g bash-language-server@latest"),
            brew: Some("brew upgrade bash-language-server"),
            ..EMPTY
        },
        check: ManagerCommands {
            npm:  Some("npm view bash-language-server version"),
            brew: Some("brew outdated --quiet bash-language-server"),
            ..EMPTY
        },
        doc_url: "https://github.com/bash-lsp/bash-language-server",
    },
    BuiltinDef {
        id:           "cpp",
        name:         "C / C++ (clangd)",
        binary:       "clangd",
        args:         &[],
        language_ids: &["c", "cpp", "objective-c", "objective-cpp"],
        extensions:   &[".c", ".h", ".cc", ".cpp", ".cxx", ".hh", ".hpp", ".hxx", ".m", ".mm"],
        root_markers: &["compile_commands.json", "compile_flags.txt", "CMakeLists.txt", "Makefile"],
        install: ManagerCommands {
            brew: Some("brew install llvm"),
            apt:  Some("sudo apt install -y clangd"),
            ..EMPTY
        },
        uninstall: ManagerCommands {
            brew: Some("brew uninstall llvm"),
            apt:  Some("sudo apt remove -y clangd"),
            ..EMPTY
        },
        update: ManagerCommands {
            brew: Some("brew upgrade llvm"),
            apt:  Some("sudo apt install --only-upgrade -y clangd"),
            ..EMPTY
        },
        check:     ManagerCommands { brew: Some("brew outdated --quiet llvm"), ..EMPTY },
        doc_url: "https://clangd.llvm.org",
    },
    BuiltinDef {
        id:           "vue",
        name:         "Vue (Volar)",
        binary:       "vue-language-server",
        args:         &["--stdio"],
        language_ids: &["vue"],
        extensions:   &[".vue"],
        root_markers: &["vite.config.ts", "nuxt.config.ts", "package.json"],
        install:   ManagerCommands { npm: Some("npm install -g @vue/language-server"), ..EMPTY },
        uninstall: ManagerCommands { npm: Some("npm uninstall -g @vue/language-server"), ..EMPTY },
        update: ManagerCommands {
            npm: Some("npm install -g @vue/language-server@latest"),
            ..EMPTY
        },
        check:     ManagerCommands { npm: Some("npm view @vue/language-server version"), ..EMPTY },
        doc_url: "https://github.com/vuejs/language-tools",
    },
    BuiltinDef {
        id:           "php",
        name:         "PHP (Intelephense)",
        binary:       "intelephense",
        args:         &["--stdio"],
        language_ids: &["php"],
        extensions:   &[".php", ".phtml"],
        root_markers: &["composer.json"],
        install:   ManagerCommands { npm: Some("npm install -g intelephense"), ..EMPTY },
        uninstall: ManagerCommands { npm: Some("npm uninstall -g intelephense"), ..EMPTY },
        update:    ManagerCommands { npm: Some("npm install -g intelephense@latest"), ..EMPTY },
        check:     ManagerCommands { npm: Some("npm view intelephense version"), ..EMPTY },
        doc_url: "https://intelephense.com",
    },
    BuiltinDef {
        id:           "ruby",
        name:         "Ruby (Solargraph)",
        binary:       "solargraph",
        args:         &["stdio"],
        language_ids: &["ruby"],
        extensions:   &[".rb", ".rake", ".gemspec"],
        root_markers: &["Gemfile", ".solargraph.yml"],
        install:   ManagerCommands { gem: Some("gem install solargraph"), ..EMPTY },
        uninstall: ManagerCommands { gem: Some("gem uninstall -x solargraph"), ..EMPTY },
        update:    ManagerCommands { gem: Some("gem update solargraph"), ..EMPTY },
        check:     ManagerCommands { gem: Some("gem list -r -e solargraph"), ..EMPTY },
        doc_url: "https://solargraph.org",
    },
    BuiltinDef {
        id:           "java",
        name:         "Java (Eclipse JDT)",
        binary:       "jdtls",
        args:         &[],
        language_ids: &["java"],
        extensions:   &[".java"],
        root_markers: &["pom.xml", "build.gradle", "build.gradle.kts", ".project"],
        // no apt package: jdtls has no stable Debian/Ubuntu package name to
        // install by, so this stays Homebrew-only rather than guessing one.
        install:   ManagerCommands { brew: Some("brew install jdtls"), ..EMPTY },
        uninstall: ManagerCommands { brew: Some("brew uninstall jdtls"), ..EMPTY },
        update:    ManagerCommands { brew: Some("brew upgrade jdtls"), ..EMPTY },
        check:     ManagerCommands { brew: Some("brew outdated --quiet jdtls"), ..EMPTY },
        doc_url: "https://github.com/eclipse-jdtls/eclipse.jdt.ls",
    },
    BuiltinDef {
        id:           "lua",
        name:         "Lua",
        binary:       "lua-language-server",
        args:         &[],
        language_ids: &["lua"],
        extensions:   &[".lua"],
        root_markers: &[".luarc.json", ".luarc.jsonc"],
        // no apt package: lua-language-server is not in the Debian/Ubuntu
        // repositories, so this stays Homebrew-only rather than guessing one.
        install:   ManagerCommands { brew: Some("brew install lua-language-server"), ..EMPTY },
        uninstall: ManagerCommands { brew: Some("brew uninstall lua-language-server"), ..EMPTY },
        update:    ManagerCommands { brew: Some("brew upgrade lua-language-server"), ..EMPTY },
        check: ManagerCommands {
            brew: Some("brew outdated --quiet lua-language-server"),
            ..EMPTY
        },
        doc_url: "https://luals.github.io",
    },
    BuiltinDef {
        id:           "zig",
        name:         "Zig (zls)",
        binary:       "zls",
        args:         &[],
        language_ids: &["zig"],
        extensions:   &[".zig", ".zon"],
        root_markers: &["build.zig"],
        // no apt package: zls is not in the Debian/Ubuntu repositories, so
        // this stays Homebrew-only rather than guessing one.
        install:   ManagerCommands { brew: Some("brew install zls"), ..EMPTY },
        uninstall: ManagerCommands { brew: Some("brew uninstall zls"), ..EMPTY },
        update:    ManagerCommands { brew: Some("brew upgrade zls"), ..EMPTY },
        check:     ManagerCommands { brew: Some("brew outdated --quiet zls"), ..EMPTY },
        doc_url: "https://github.com/zigtools/zls",
    },
    BuiltinDef {
        id:           "toml",
        name:         "TOML (Taplo)",
        binary:       "taplo",
        args:         &["lsp", "stdio"],
        language_ids: &["toml"],
        extensions:   &[".toml"],
        root_markers: &[],
        install: ManagerCommands {
            brew:  Some("brew install taplo"),
            cargo: Some("cargo install taplo-cli --locked --features lsp"),
            ..EMPTY
        },
        uninstall: ManagerCommands {
            brew:  Some("brew uninstall taplo"),
            cargo: Some("cargo uninstall taplo-cli"),
            ..EMPTY
        },
        update: ManagerCommands {
            brew:  Some("brew upgrade taplo"),
            cargo: Some("cargo install taplo-cli --locked --features lsp --force"),
            ..EMPTY
        },
        check: ManagerCommands {
            brew:  Some("brew outdated --quiet taplo"),
            cargo: Some("cargo search taplo-cli --limit 1"),
            ..EMPTY
        },
        doc_url: "https://taplo.tamasfe.dev",
    },
    BuiltinDef {
        id:           "terraform",
        name:         "Terraform",
        binary:       "terraform-ls",
        args:         &["serve"],
        language_ids: &["terraform"],
        extensions:   &[".tf", ".tfvars"],
        root_markers: &[".terraform", "main.tf"],
        // no apt package: terraform-ls ships as a direct binary download, not
        // through Debian/Ubuntu, npm, cargo or go, so this stays Homebrew-only.
        install:   ManagerCommands { brew: Some("brew install terraform-ls"), ..EMPTY },
        uninstall: ManagerCommands { brew: Some("brew uninstall terraform-ls"), ..EMPTY },
        update:    ManagerCommands { brew: Some("brew upgrade terraform-ls"), ..EMPTY },
        check:     ManagerCommands { brew: Some("brew outdated --quiet terraform-ls"), ..EMPTY },
        doc_url: "https://github.com/hashicorp/terraform-ls",
    },
    BuiltinDef {
        id:           "markdown",
        name:         "Markdown (Marksman)",
        binary:       "marksman",
        args:         &["server"],
        language_ids: &["markdown"],
        extensions:   &[".md", ".markdown"],
        root_markers: &[],
        // no apt package: marksman is not in the Debian/Ubuntu repositories,
        // so this stays Homebrew-only rather than guessing one.
        install:   ManagerCommands { brew: Some("brew install marksman"), ..EMPTY },
        uninstall: ManagerCommands { brew: Some("brew uninstall marksman"), ..EMPTY },
        update:    ManagerCommands { brew: Some("brew upgrade marksman"), ..EMPTY },
        check:     ManagerCommands { brew: Some("brew outdated --quiet marksman"), ..EMPTY },
        doc_url: "https://github.com/artempyanykh/marksman",
    },
    BuiltinDef {
        id:           "graphql",
        name:         "GraphQL",
        binary:       "graphql-lsp",
        args:         &["server", "--method", "stream"],
        language_ids: &["graphql"],
        extensions:   &[".graphql", ".gql"],
        root_markers: &["graphql.config.yml", "graphql.config.js", ".graphqlrc"],
        install:   ManagerCommands { npm: Some("npm install -g graphql-language-service-cli"), ..EMPTY },
        uninstall: ManagerCommands { npm: Some("npm uninstall -g graphql-language-service-cli"), ..EMPTY },
        update: ManagerCommands {
            npm: Some("npm install -g graphql-language-service-cli@latest"),
            ..EMPTY
        },
        check: ManagerCommands {
            npm: Some("npm view graphql-language-service-cli version"),
            ..EMPTY
        },
        doc_url: "https://github.com/graphql/graphiql/tree/main/packages/graphql-language-service-cli",
    },
];

const EMPTY: ManagerCommands = ManagerCommands {
    npm: None, brew: None, apt: None, cargo: None, pip: None, go: None, gem: None,
};

impl From<&BuiltinDef> for LanguageServerDef {
    fn from(def: &BuiltinDef) -> Self {
        let owned = |list: &[&'static str]| list.iter().map(|s| s.to_string()).collect();
        LanguageServerDef {
            id:           def.id.to_string(),
            name:         def.name.to_string(),
            binary:       def.binary.to_string(),
            args:         owned(def.args),
            language_ids: owned(def.language_ids),
            extensions:   owned(def.extensions),
            root_markers: owned(def.root_markers),
            install:      def.install.clone(),
            uninstall:    def.uninstall.clone(),
            update:       def.update.clone(),
            check:        def.check.clone(),
            doc_url:      def.doc_url.to_string(),
            custom:       false,
        }
    }
}

impl From<crate::commands::settings::CustomLanguageServer> for LanguageServerDef {
    fn from(server: crate::commands::settings::CustomLanguageServer) -> Self {
        LanguageServerDef {
            id:           server.id,
            name:         server.name,
            binary:       server.binary,
            args:         server.args,
            language_ids: server.language_ids,
            extensions:   server.extensions,
            root_markers: server.root_markers,
            install:      EMPTY,
            uninstall:    EMPTY,
            update:       EMPTY,
            check:        EMPTY,
            doc_url:      server.doc_url,
            custom:       true,
        }
    }
}

/// Whatever the user declared, minus what it could not describe: a server
/// without an id, a binary or an extension answers for no file, and an id the
/// built-in catalogue already uses would silently shadow a real server.
pub fn custom_defs() -> Vec<LanguageServerDef> {
    let servers = crate::commands::settings::read_settings()
        .map(|settings| settings.custom_language_servers)
        .unwrap_or_default();

    let mut seen: Vec<String> = BUILTIN.iter().map(|d| d.id.to_string()).collect();
    let mut out = Vec::new();
    for server in servers {
        let usable = !server.id.trim().is_empty()
            && !server.binary.trim().is_empty()
            && !server.extensions.is_empty()
            && !seen.contains(&server.id);
        if !usable {
            continue;
        }
        seen.push(server.id.clone());
        out.push(LanguageServerDef::from(server));
    }
    out
}

/// Every server this machine knows about: the catalogue shipped with the app,
/// then the ones the user brought. Read fresh each time - a server added in the
/// settings has to answer on the next scan, not after a restart.
pub fn catalog() -> Vec<LanguageServerDef> {
    let mut all: Vec<LanguageServerDef> = BUILTIN.iter().map(LanguageServerDef::from).collect();
    all.extend(custom_defs());
    all
}

pub fn find_def(id: &str) -> Option<LanguageServerDef> {
    catalog().into_iter().find(|d| d.id == id)
}


/// Several servers ship in one package - the JSON, CSS and HTML ones all come
/// from `vscode-langservers-extracted`. Removing one removes the others, and
/// the user has to be told before, not after.
pub fn shares_removal_with(def: &LanguageServerDef, catalog: &[LanguageServerDef]) -> Vec<String> {
    let own = manager_commands(&def.uninstall);
    catalog
        .iter()
        .filter(|other| other.id != def.id)
        .filter(|other| {
            manager_commands(&other.uninstall)
                .iter()
                .any(|(_, command)| own.iter().any(|(_, mine)| mine == command))
        })
        .map(|other| other.name.clone())
        .collect()
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
    use crate::commands::toolchain::package_version;

    fn def_with(markers: &[&str]) -> LanguageServerDef {
        LanguageServerDef {
            id: "test".into(),
            name: "Test".into(),
            binary: "test-ls".into(),
            args: Vec::new(),
            language_ids: Vec::new(),
            extensions: Vec::new(),
            root_markers: markers.iter().map(|m| m.to_string()).collect(),
            install: EMPTY,
            uninstall: EMPTY,
            update: EMPTY,
            check: EMPTY,
            doc_url: String::new(),
            custom: false,
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
        let def = builtin("rust");
        assert_eq!(resolve_command(&def.install, "npm"), None);
        assert_eq!(resolve_command(&def.install, "brew"), Some("brew install rust-analyzer"));
        assert_eq!(resolve_command(&def.uninstall, "brew"), Some("brew uninstall rust-analyzer"));
    }

    fn builtins() -> Vec<LanguageServerDef> {
        BUILTIN.iter().map(LanguageServerDef::from).collect()
    }

    fn builtin(id: &str) -> LanguageServerDef {
        builtins().into_iter().find(|d| d.id == id).unwrap()
    }

    #[test]
    fn warns_that_one_package_carries_several_servers() {
        let shared = shares_removal_with(&builtin("json"), &builtins());
        assert!(shared.iter().any(|n| n == "CSS / SCSS / Less"), "{shared:?}");
        assert!(shared.iter().any(|n| n == "HTML"), "{shared:?}");
    }

    #[test]
    fn a_server_with_its_own_package_shares_nothing() {
        assert!(shares_removal_with(&builtin("rust"), &builtins()).is_empty());
        assert!(shares_removal_with(&builtin("yaml"), &builtins()).is_empty());
    }

    #[test]
    fn a_user_server_is_neither_installed_nor_removed() {
        let mine = LanguageServerDef::from(crate::commands::settings::CustomLanguageServer {
            id:           "mine".into(),
            name:         "Mine".into(),
            binary:       "my-ls".into(),
            args:         vec!["--stdio".into()],
            language_ids: vec!["mine".into()],
            extensions:   vec![".mine".into()],
            root_markers: Vec::new(),
            doc_url:      String::new(),
        });
        assert!(mine.custom);
        assert!(manager_commands(&mine.install).is_empty());
        assert!(manager_commands(&mine.uninstall).is_empty());
        assert!(shares_removal_with(&mine, &builtins()).is_empty());
    }

    #[test]
    fn reads_the_version_off_the_package_a_binary_belongs_to() {
        // pyright-langserver refuses to answer `--version`, and the vscode ones
        // crash: the package they ship in is the only thing that knows.
        let root = temp_dir("package-version");
        let package = root.join("lib/node_modules/pyright");
        std::fs::create_dir_all(&package).unwrap();
        std::fs::write(package.join("package.json"), r#"{"name":"pyright","version":"1.1.411"}"#)
            .unwrap();
        let binary = package.join("langserver.index.js");
        std::fs::write(&binary, "").unwrap();

        assert_eq!(detect_version(&binary).as_deref(), Some("1.1.411"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn takes_the_package_a_binary_sits_in_not_one_of_its_dependencies() {
        let root = temp_dir("package-nested");
        let outer = root.join("lib/node_modules/vscode-langservers-extracted");
        let inner = outer.join("node_modules/vscode-languageserver");
        std::fs::create_dir_all(inner.join("lib")).unwrap();
        std::fs::create_dir_all(outer.join("bin")).unwrap();
        std::fs::write(outer.join("package.json"), r#"{"version":"4.10.0"}"#).unwrap();
        std::fs::write(inner.join("package.json"), r#"{"version":"9.0.1"}"#).unwrap();
        let binary = outer.join("bin/vscode-json-language-server");
        std::fs::write(&binary, "").unwrap();

        assert_eq!(detect_version(&binary).as_deref(), Some("4.10.0"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_binary_outside_a_package_is_left_to_answer_for_itself() {
        let root = temp_dir("no-package");
        std::fs::create_dir_all(&root).unwrap();
        let binary = root.join("thing");
        std::fs::write(&binary, "").unwrap();
        assert_eq!(package_version(&binary), None);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    #[test]
    fn follows_the_link_to_find_who_installed_a_binary() {
        // What npm installs globally is a link in a `bin` directory pointing
        // into `lib/node_modules` - the link alone names no manager, which read
        // as "nobody owns this" and had the wrong manager asked about it.
        let root = temp_dir("owner-link");
        let package = root.join("lib/node_modules/pyright");
        std::fs::create_dir_all(&package).unwrap();
        std::fs::create_dir_all(root.join("bin")).unwrap();
        let target = package.join("langserver.index.js");
        std::fs::write(&target, "").unwrap();
        let link = root.join("bin/pyright-langserver");
        std::os::unix::fs::symlink(&target, &link).unwrap();

        assert_eq!(owning_manager(&link), Some("npm"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn reads_the_owning_manager_off_the_binary_path() {
        assert_eq!(owning_manager(Path::new("/opt/homebrew/bin/gopls")), Some("brew"));
        assert_eq!(owning_manager(Path::new("/usr/local/Cellar/x/1/bin/x")), Some("brew"));
        assert_eq!(owning_manager(Path::new("/Users/me/.cargo/bin/rust-analyzer")), Some("cargo"));
        assert_eq!(owning_manager(Path::new("/Users/me/go/bin/gopls")), Some("go"));
        assert_eq!(owning_manager(Path::new("/x/node_modules/.bin/tsserver")), Some("npm"));
        // A Homebrew formula whose payload is a node package is Homebrew's.
        assert_eq!(
            owning_manager(Path::new("/opt/homebrew/Cellar/x/1/libexec/lib/node_modules/x/bin/x")),
            Some("brew"),
        );
        assert_eq!(owning_manager(Path::new("/usr/local/bin/whatever")), None);
    }

    #[test]
    fn catalogue_never_claims_an_extension_twice() {
        let mut seen = std::collections::HashSet::new();
        for def in BUILTIN {
            for extension in def.extensions {
                assert!(seen.insert(*extension), "{extension} claimed twice");
            }
        }
    }

    #[test]
    fn every_builtin_server_declares_what_it_needs() {
        for def in BUILTIN {
            assert!(!def.binary.is_empty(), "{} has no binary", def.id);
            assert!(!def.extensions.is_empty(), "{} covers no file", def.id);
            assert!(!def.language_ids.is_empty(), "{} has no language id", def.id);
            assert!(def.doc_url.starts_with("https://"), "{} has no documentation", def.id);
        }
    }

    #[test]
    fn every_installable_server_can_also_be_removed_and_updated() {
        for def in BUILTIN {
            assert!(!manager_commands(&def.install).is_empty(), "{} cannot be installed", def.id);
            assert!(!manager_commands(&def.uninstall).is_empty(), "{} cannot be removed", def.id);
            assert!(!manager_commands(&def.update).is_empty(), "{} cannot be updated", def.id);
        }
    }

    /// A manager that installs a server has to be able to update it too, or the
    /// card offers an update through a tool the user does not have.
    #[test]
    fn a_server_is_updated_by_the_managers_that_installed_it() {
        for def in BUILTIN {
            let installers: Vec<&str> =
                manager_commands(&def.install).into_iter().map(|(m, _)| m).collect();
            let updaters: Vec<&str> =
                manager_commands(&def.update).into_iter().map(|(m, _)| m).collect();
            assert_eq!(installers, updaters, "{} installs and updates differently", def.id);
        }
    }

    /// Installing over an existing Homebrew formula reports it is already there
    /// and changes nothing, so an update must ask for an upgrade.
    #[test]
    fn homebrew_upgrades_rather_than_reinstalls() {
        for def in BUILTIN {
            let Some(command) = def.update.brew else { continue };
            assert!(command.starts_with("brew upgrade "), "{}: {command}", def.id);
        }
    }

    #[test]
    fn finds_the_version_inside_what_a_tool_prints() {
        assert_eq!(parse_version("rust-analyzer 1.78.0 (a1b2c3 2026-01-01)"), Some(vec![1, 78, 0]));
        assert_eq!(parse_version("solargraph (0.53.4)"), Some(vec![0, 53, 4]));
        assert_eq!(parse_version("v0.16.2\n"), Some(vec![0, 16, 2]));
        assert_eq!(parse_version("1.1.444"), Some(vec![1, 1, 444]));
        assert_eq!(parse_version("clangd version 17.0.6"), Some(vec![17, 0, 6]));
        assert_eq!(parse_version("no version here"), None);
        assert_eq!(parse_version("2026"), None, "a bare number is a year as easily as a version");
    }

    #[test]
    fn compares_versions_number_by_number() {
        assert_eq!(is_newer("1.1.403", "1.1.444"), Some(true));
        assert_eq!(is_newer("4.3.3", "4.3.3"), Some(false));
        assert_eq!(is_newer("1.10.0", "1.9.0"), Some(false), "10 is above 9, not below it");
        assert_eq!(is_newer("1.2", "1.2.1"), Some(true));
        assert_eq!(is_newer("1.2.0", "1.2"), Some(false));
        assert_eq!(is_newer("unknown", "1.2.0"), None);
    }

    #[test]
    fn every_checkable_server_is_checked_by_a_manager_that_installs_it() {
        for def in BUILTIN {
            let installers: Vec<&str> =
                manager_commands(&def.install).into_iter().map(|(m, _)| m).collect();
            for (manager, _) in manager_commands(&def.check) {
                assert!(installers.contains(&manager), "{} is checked by {manager}", def.id);
            }
        }
    }

    #[test]
    fn a_manager_that_cannot_exist_here_is_never_offered() {
        let commands = ManagerCommands { brew: Some("brew install thing"), ..EMPTY };
        let offered = manager_options(&commands, &mut BinaryCache::default());
        if cfg!(target_os = "windows") {
            assert!(offered.is_empty(), "Homebrew has no Windows to run on");
            assert_eq!(resolve_command(&commands, "brew"), None);
        } else {
            assert_eq!(offered.len(), 1);
            assert_eq!(resolve_command(&commands, "brew"), Some("brew install thing"));
        }
    }

    #[test]
    fn resolves_a_command_whatever_suffix_the_platform_gives_it() {
        // /bin/sh on Unix, cmd.exe reached as `cmd` on Windows: both are the
        // case that matters - a name typed without the suffix it has on disk.
        #[cfg(unix)]
        assert_eq!(resolve_binary("sh", None), Some(PathBuf::from("/bin/sh")));
        #[cfg(windows)]
        assert!(resolve_binary("cmd", None).is_some(), "cmd.exe must resolve from `cmd`");
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
        let css = shares_removal_with(&builtin("css"), &builtins());
        assert!(css.iter().any(|n| n == "JSON"), "{css:?}");
        assert!(css.iter().any(|n| n == "HTML"), "{css:?}");
    }
}
