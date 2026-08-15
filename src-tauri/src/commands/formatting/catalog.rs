use crate::commands::toolchain::ManagerCommands;

/// A set of style options. Flat and sparse on purpose: a missing key means
/// "inherit", which is what makes the global / language / project chain work.
pub type StyleSet = serde_json::Map<String, serde_json::Value>;

const EMPTY: ManagerCommands = ManagerCommands {
    npm: None, brew: None, apt: None, cargo: None, pip: None, go: None, gem: None,
};

/// A style option in Cairn's own vocabulary, not in any one tool's. The UI
/// builds its form from this list, and an adapter maps it to whatever the
/// formatter underneath calls the same idea.
pub struct StyleOptionDef {
    pub id:        &'static str,
    pub kind:      &'static str,
    pub choices:   &'static [&'static str],
    pub min:       Option<f64>,
    pub max:       Option<f64>,
    pub default:   Value,
    /// Languages where the option means something. Empty is universal.
    pub languages: &'static [&'static str],
}

/// The value of one style option. Kept deliberately narrow: a style is a flat
/// map of scalars, so it can be serialized, diffed and inherited without care.
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Value {
    Bool(bool),
    Num(f64),
    Str(&'static str),
}

impl Value {
    pub fn to_json(self) -> serde_json::Value {
        match self {
            Value::Bool(b) => serde_json::Value::Bool(b),
            Value::Num(n) => serde_json::json!(n),
            Value::Str(s) => serde_json::Value::String(s.to_string()),
        }
    }
}

const BRACES: &[&str] = &[
    "javascript", "javascriptreact", "typescript", "typescriptreact", "svelte", "vue",
    "css", "scss", "less", "html", "json", "jsonc", "yaml", "markdown", "graphql",
];

pub const STYLE_OPTIONS: &[StyleOptionDef] = &[
    StyleOptionDef {
        id: "indentStyle", kind: "enum", choices: &["space", "tab"],
        min: None, max: None, default: Value::Str("space"), languages: &[],
    },
    StyleOptionDef {
        id: "indentSize", kind: "number", choices: &[],
        min: Some(1.0), max: Some(16.0), default: Value::Num(2.0), languages: &[],
    },
    StyleOptionDef {
        id: "lineWidth", kind: "number", choices: &[],
        min: Some(40.0), max: Some(400.0), default: Value::Num(80.0), languages: &[],
    },
    StyleOptionDef {
        id: "lineEnding", kind: "enum", choices: &["lf", "crlf", "auto"],
        min: None, max: None, default: Value::Str("lf"), languages: &[],
    },
    StyleOptionDef {
        id: "finalNewline", kind: "boolean", choices: &[],
        min: None, max: None, default: Value::Bool(true), languages: &[],
    },
    StyleOptionDef {
        id: "trimTrailingWhitespace", kind: "boolean", choices: &[],
        min: None, max: None, default: Value::Bool(true), languages: &[],
    },
    StyleOptionDef {
        id: "quoteStyle", kind: "enum", choices: &["single", "double", "preserve"],
        min: None, max: None, default: Value::Str("double"), languages: BRACES,
    },
    StyleOptionDef {
        id: "jsxQuoteStyle", kind: "enum", choices: &["single", "double"],
        min: None, max: None, default: Value::Str("double"), languages: BRACES,
    },
    StyleOptionDef {
        id: "semicolons", kind: "enum", choices: &["always", "asNeeded"],
        min: None, max: None, default: Value::Str("always"), languages: BRACES,
    },
    StyleOptionDef {
        id: "trailingComma", kind: "enum", choices: &["none", "es5", "all"],
        min: None, max: None, default: Value::Str("all"), languages: BRACES,
    },
    StyleOptionDef {
        id: "bracketSpacing", kind: "boolean", choices: &[],
        min: None, max: None, default: Value::Bool(true), languages: BRACES,
    },
    StyleOptionDef {
        id: "bracketSameLine", kind: "boolean", choices: &[],
        min: None, max: None, default: Value::Bool(false), languages: BRACES,
    },
    StyleOptionDef {
        id: "arrowParens", kind: "enum", choices: &["always", "avoid"],
        min: None, max: None, default: Value::Str("always"), languages: BRACES,
    },
    StyleOptionDef {
        id: "quoteProps", kind: "enum", choices: &["asNeeded", "consistent", "preserve"],
        min: None, max: None, default: Value::Str("asNeeded"), languages: BRACES,
    },
    StyleOptionDef {
        id: "singleAttributePerLine", kind: "boolean", choices: &[],
        min: None, max: None, default: Value::Bool(false), languages: BRACES,
    },
    StyleOptionDef {
        id: "reorderImports", kind: "boolean", choices: &[],
        min: None, max: None, default: Value::Bool(false), languages: &["rust"],
    },
    StyleOptionDef {
        id: "matchBlockTrailingComma", kind: "boolean", choices: &[],
        min: None, max: None, default: Value::Bool(false), languages: &["rust"],
    },
    StyleOptionDef {
        id: "skipStringNormalization", kind: "boolean", choices: &[],
        min: None, max: None, default: Value::Bool(false), languages: &["python"],
    },
];

pub fn style_option(id: &str) -> Option<&'static StyleOptionDef> {
    STYLE_OPTIONS.iter().find(|o| o.id == id)
}

/// One formatter Cairn knows how to drive. `supported` names the style options
/// it can honour; anything else is shown as unsupported rather than silently
/// dropped, so the UI never promises a setting the tool ignores.
pub struct FormatterDef {
    pub id:           &'static str,
    pub name:         &'static str,
    pub binary:       &'static str,
    /// Arguments before the file path. `{config}` is replaced by the generated
    /// config file, and the whole argument is dropped when none is generated.
    pub args:         &'static [&'static str],
    pub language_ids: &'static [&'static str],
    pub extensions:   &'static [&'static str],
    pub supported:    &'static [&'static str],
    /// Config files of the tool itself. Their presence at the worktree root is
    /// what `respectRepoConfig` defers to.
    pub config_files: &'static [&'static str],
    pub install:      ManagerCommands,
    pub uninstall:    ManagerCommands,
    pub update:       ManagerCommands,
    pub check:        ManagerCommands,
    /// A formatter that ships with its language toolchain. Cairn never installs
    /// it: the row points at the toolchain instead of offering a command that
    /// would half-work.
    pub toolchain:    bool,
    pub doc_url:      &'static str,
}

const PRETTIER_OPTS: &[&str] = &[
    "indentStyle", "indentSize", "lineWidth", "lineEnding", "finalNewline",
    "trimTrailingWhitespace", "quoteStyle", "jsxQuoteStyle", "semicolons",
    "trailingComma", "bracketSpacing", "bracketSameLine", "arrowParens",
    "quoteProps", "singleAttributePerLine",
];

pub const FORMATTERS: &[FormatterDef] = &[
    FormatterDef {
        id: "prettier",
        name: "Prettier",
        binary: "prettier",
        args: &["--config", "{config}", "--stdin-filepath", "{path}"],
        language_ids: BRACES,
        extensions: &[
            "js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts", "svelte", "vue",
            "css", "scss", "less", "html", "json", "jsonc", "json5", "yaml", "yml",
            "md", "markdown", "graphql", "gql",
        ],
        supported: PRETTIER_OPTS,
        config_files: &[
            ".prettierrc", ".prettierrc.json", ".prettierrc.yaml", ".prettierrc.yml",
            ".prettierrc.js", "prettier.config.js", ".prettierrc.mjs", "prettier.config.mjs",
        ],
        install:   ManagerCommands { npm: Some("npm install -g prettier"), ..EMPTY },
        uninstall: ManagerCommands { npm: Some("npm uninstall -g prettier"), ..EMPTY },
        update:    ManagerCommands { npm: Some("npm install -g prettier@latest"), ..EMPTY },
        check:     ManagerCommands { npm: Some("npm view prettier version"), ..EMPTY },
        toolchain: false,
        doc_url: "https://prettier.io/docs/en/options",
    },
    FormatterDef {
        id: "biome",
        name: "Biome",
        binary: "biome",
        args: &["format", "--config-path", "{config}", "--stdin-file-path", "{path}"],
        language_ids: &[
            "javascript", "javascriptreact", "typescript", "typescriptreact",
            "json", "jsonc", "css", "graphql",
        ],
        extensions: &["js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts", "json", "jsonc", "css", "graphql"],
        supported: &[
            "indentStyle", "indentSize", "lineWidth", "lineEnding", "quoteStyle",
            "jsxQuoteStyle", "semicolons", "trailingComma", "bracketSpacing",
            "bracketSameLine", "arrowParens",
        ],
        config_files: &["biome.json", "biome.jsonc"],
        install:   ManagerCommands { npm: Some("npm install -g @biomejs/biome"), ..EMPTY },
        uninstall: ManagerCommands { npm: Some("npm uninstall -g @biomejs/biome"), ..EMPTY },
        update:    ManagerCommands { npm: Some("npm install -g @biomejs/biome@latest"), ..EMPTY },
        check:     ManagerCommands { npm: Some("npm view @biomejs/biome version"), ..EMPTY },
        toolchain: false,
        doc_url: "https://biomejs.dev/formatter/",
    },
    FormatterDef {
        id: "rustfmt",
        name: "rustfmt",
        binary: "rustfmt",
        args: &["--config-path", "{config}", "--emit", "stdout"],
        language_ids: &["rust"],
        extensions: &["rs"],
        supported: &[
            "indentStyle", "indentSize", "lineWidth", "lineEnding", "reorderImports",
            "matchBlockTrailingComma",
        ],
        config_files: &["rustfmt.toml", ".rustfmt.toml"],
        install: EMPTY, uninstall: EMPTY, update: EMPTY, check: EMPTY,
        toolchain: true,
        doc_url: "https://rust-lang.github.io/rustfmt/",
    },
    FormatterDef {
        id: "gofmt",
        name: "gofmt",
        binary: "gofmt",
        args: &[],
        language_ids: &["go"],
        extensions: &["go"],
        // gofmt takes no options at all: that is the point of it.
        supported: &[],
        config_files: &[],
        install: EMPTY, uninstall: EMPTY, update: EMPTY, check: EMPTY,
        toolchain: true,
        doc_url: "https://pkg.go.dev/cmd/gofmt",
    },
    FormatterDef {
        id: "ruff",
        name: "Ruff",
        binary: "ruff",
        args: &["format", "--config", "{config}", "--stdin-filename", "{path}", "-"],
        language_ids: &["python"],
        extensions: &["py", "pyi"],
        supported: &["indentStyle", "indentSize", "lineWidth", "quoteStyle", "skipStringNormalization"],
        config_files: &["ruff.toml", ".ruff.toml"],
        install:   ManagerCommands { pip: Some("pip install ruff"), brew: Some("brew install ruff"), ..EMPTY },
        uninstall: ManagerCommands { pip: Some("pip uninstall -y ruff"), brew: Some("brew uninstall ruff"), ..EMPTY },
        update:    ManagerCommands { pip: Some("pip install --upgrade ruff"), brew: Some("brew upgrade ruff"), ..EMPTY },
        check:     ManagerCommands { pip: Some("pip index versions ruff"), brew: Some("brew outdated --quiet ruff"), ..EMPTY },
        toolchain: false,
        doc_url: "https://docs.astral.sh/ruff/formatter/",
    },
    FormatterDef {
        id: "black",
        name: "Black",
        binary: "black",
        args: &["--config", "{config}", "--stdin-filename", "{path}", "-", "--quiet"],
        language_ids: &["python"],
        extensions: &["py", "pyi"],
        supported: &["lineWidth", "skipStringNormalization"],
        config_files: &[],
        install:   ManagerCommands { pip: Some("pip install black"), brew: Some("brew install black"), ..EMPTY },
        uninstall: ManagerCommands { pip: Some("pip uninstall -y black"), brew: Some("brew uninstall black"), ..EMPTY },
        update:    ManagerCommands { pip: Some("pip install --upgrade black"), brew: Some("brew upgrade black"), ..EMPTY },
        check:     ManagerCommands { pip: Some("pip index versions black"), brew: Some("brew outdated --quiet black"), ..EMPTY },
        toolchain: false,
        doc_url: "https://black.readthedocs.io/",
    },
    FormatterDef {
        id: "clang-format",
        name: "clang-format",
        binary: "clang-format",
        args: &["--style=file:{config}", "--assume-filename={path}"],
        language_ids: &["c", "cpp", "objective-c", "objective-cpp", "java", "csharp"],
        extensions: &["c", "h", "cc", "cpp", "cxx", "hpp", "hh", "hxx", "m", "mm", "java", "cs"],
        supported: &["indentStyle", "indentSize", "lineWidth", "bracketSameLine"],
        config_files: &[".clang-format", "_clang-format"],
        install:   ManagerCommands { brew: Some("brew install clang-format"), npm: Some("npm install -g clang-format"), ..EMPTY },
        uninstall: ManagerCommands { brew: Some("brew uninstall clang-format"), npm: Some("npm uninstall -g clang-format"), ..EMPTY },
        update:    ManagerCommands { brew: Some("brew upgrade clang-format"), npm: Some("npm install -g clang-format@latest"), ..EMPTY },
        check:     ManagerCommands { brew: Some("brew outdated --quiet clang-format"), npm: Some("npm view clang-format version"), ..EMPTY },
        toolchain: false,
        doc_url: "https://clang.llvm.org/docs/ClangFormatStyleOptions.html",
    },
    FormatterDef {
        id: "php-cs-fixer",
        name: "PHP CS Fixer",
        binary: "php-cs-fixer",
        args: &["fix", "--config", "{config}", "--quiet", "{path}"],
        language_ids: &["php"],
        extensions: &["php"],
        supported: &["indentStyle", "indentSize", "lineEnding"],
        config_files: &[".php-cs-fixer.php", ".php-cs-fixer.dist.php"],
        install:   ManagerCommands { brew: Some("brew install php-cs-fixer"), apt: Some("sudo apt install -y php-cs-fixer"), ..EMPTY },
        uninstall: ManagerCommands { brew: Some("brew uninstall php-cs-fixer"), apt: Some("sudo apt remove -y php-cs-fixer"), ..EMPTY },
        update:    ManagerCommands { brew: Some("brew upgrade php-cs-fixer"), apt: Some("sudo apt install --only-upgrade -y php-cs-fixer"), ..EMPTY },
        check:     ManagerCommands { brew: Some("brew outdated --quiet php-cs-fixer"), ..EMPTY },
        toolchain: false,
        doc_url: "https://cs.symfony.com/",
    },
    FormatterDef {
        id: "ktlint",
        name: "ktlint",
        binary: "ktlint",
        args: &["--format", "--stdin", "--log-level=none"],
        language_ids: &["kotlin"],
        extensions: &["kt", "kts"],
        supported: &["indentStyle", "indentSize", "lineWidth"],
        config_files: &[".editorconfig"],
        install:   ManagerCommands { brew: Some("brew install ktlint"), ..EMPTY },
        uninstall: ManagerCommands { brew: Some("brew uninstall ktlint"), ..EMPTY },
        update:    ManagerCommands { brew: Some("brew upgrade ktlint"), ..EMPTY },
        check:     ManagerCommands { brew: Some("brew outdated --quiet ktlint"), ..EMPTY },
        toolchain: false,
        doc_url: "https://pinterest.github.io/ktlint/",
    },
    FormatterDef {
        id: "shfmt",
        name: "shfmt",
        binary: "shfmt",
        args: &[],
        language_ids: &["shellscript", "bash"],
        extensions: &["sh", "bash", "zsh", "ksh"],
        supported: &["indentStyle", "indentSize"],
        config_files: &[],
        install:   ManagerCommands { brew: Some("brew install shfmt"), go: Some("go install mvdan.cc/sh/v3/cmd/shfmt@latest"), ..EMPTY },
        uninstall: ManagerCommands { brew: Some("brew uninstall shfmt"), ..EMPTY },
        update:    ManagerCommands { brew: Some("brew upgrade shfmt"), go: Some("go install mvdan.cc/sh/v3/cmd/shfmt@latest"), ..EMPTY },
        check:     ManagerCommands { brew: Some("brew outdated --quiet shfmt"), ..EMPTY },
        toolchain: false,
        doc_url: "https://github.com/mvdan/sh",
    },
    FormatterDef {
        id: "taplo",
        name: "Taplo",
        binary: "taplo",
        args: &["format", "-"],
        language_ids: &["toml"],
        extensions: &["toml"],
        supported: &["indentStyle", "indentSize", "lineWidth"],
        config_files: &["taplo.toml", ".taplo.toml"],
        install:   ManagerCommands { brew: Some("brew install taplo"), cargo: Some("cargo install taplo-cli --locked"), ..EMPTY },
        uninstall: ManagerCommands { brew: Some("brew uninstall taplo"), cargo: Some("cargo uninstall taplo-cli"), ..EMPTY },
        update:    ManagerCommands { brew: Some("brew upgrade taplo"), cargo: Some("cargo install taplo-cli --locked --force"), ..EMPTY },
        check:     ManagerCommands { brew: Some("brew outdated --quiet taplo"), ..EMPTY },
        toolchain: false,
        doc_url: "https://taplo.tamasfe.dev/",
    },
];

/// The formatter that is not one: choosing it hands the document to the
/// language server. It needs an id of its own - an empty one already means
/// "whatever the catalogue picks for this language", so the two cannot share it.
pub const LSP_FORMATTER_ID: &str = "lsp";

pub fn find_formatter(id: &str) -> Option<&'static FormatterDef> {
    FORMATTERS.iter().find(|f| f.id == id)
}

/// The formatters that can handle a file, best first. Order follows the
/// catalogue, so the first entry is the one a language defaults to.
pub fn formatters_for_extension(ext: &str) -> Vec<&'static FormatterDef> {
    let ext = ext.trim_start_matches('.').to_lowercase();
    FORMATTERS.iter().filter(|f| f.extensions.contains(&ext.as_str())).collect()
}

/// The language a file belongs to, read from its extension. `None` when nothing
/// in the catalogue claims it - a normal answer, not an error.
pub fn language_for_extension(ext: &str) -> Option<&'static str> {
    let ext = ext.trim_start_matches('.').to_lowercase();
    let by_pair: &[(&str, &str)] = &[
        ("js", "javascript"), ("mjs", "javascript"), ("cjs", "javascript"),
        ("jsx", "javascriptreact"),
        ("ts", "typescript"), ("mts", "typescript"), ("cts", "typescript"),
        ("tsx", "typescriptreact"),
        ("svelte", "svelte"), ("vue", "vue"),
        ("css", "css"), ("scss", "scss"), ("less", "less"),
        ("html", "html"), ("htm", "html"),
        ("json", "json"), ("json5", "json"), ("jsonc", "jsonc"),
        ("yaml", "yaml"), ("yml", "yaml"),
        ("md", "markdown"), ("markdown", "markdown"),
        ("graphql", "graphql"), ("gql", "graphql"),
        ("rs", "rust"), ("go", "go"),
        ("py", "python"), ("pyi", "python"),
        ("c", "c"), ("h", "c"),
        ("cc", "cpp"), ("cpp", "cpp"), ("cxx", "cpp"), ("hpp", "cpp"), ("hh", "cpp"), ("hxx", "cpp"),
        ("m", "objective-c"), ("mm", "objective-cpp"),
        ("java", "java"), ("cs", "csharp"),
        ("php", "php"), ("kt", "kotlin"), ("kts", "kotlin"),
        ("sh", "shellscript"), ("bash", "shellscript"), ("zsh", "shellscript"), ("ksh", "shellscript"),
        ("toml", "toml"),
    ];
    by_pair.iter().find(|(e, _)| *e == ext).map(|(_, lang)| *lang)
}

/// Every language the catalogue can format, in a stable order, so the settings
/// list never reshuffles between two openings.
pub fn known_languages() -> Vec<&'static str> {
    let mut seen: Vec<&'static str> = Vec::new();
    for def in FORMATTERS {
        for lang in def.language_ids {
            if !seen.contains(lang) {
                seen.push(lang);
            }
        }
    }
    seen
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The options that must apply whatever the language. Spelled out here so a
    /// new entry cannot quietly narrow one of them to a single language.
    const UNIVERSAL: &[&str] = &[
        "indentStyle", "indentSize", "lineWidth", "lineEnding", "finalNewline",
        "trimTrailingWhitespace",
    ];

    #[test]
    fn every_supported_option_exists_in_the_style_catalogue() {
        for def in FORMATTERS {
            for id in def.supported {
                assert!(style_option(id).is_some(), "{} claims unknown option {id}", def.id);
            }
        }
    }

    #[test]
    fn a_toolchain_formatter_offers_no_install_command() {
        for def in FORMATTERS.iter().filter(|d| d.toolchain) {
            assert!(
                crate::commands::toolchain::manager_commands(&def.install).is_empty(),
                "{} ships with its toolchain and must offer no install",
                def.id
            );
        }
    }

    #[test]
    fn ambiguous_extensions_land_on_one_language() {
        assert_eq!(language_for_extension("h"), Some("c"));
        assert_eq!(language_for_extension("ts"), Some("typescript"));
        assert_eq!(language_for_extension("tsx"), Some("typescriptreact"));
        assert_eq!(language_for_extension(".TS"), Some("typescript"));
        assert_eq!(language_for_extension("unknown"), None);
    }

    #[test]
    fn prettier_leads_for_a_typescript_file() {
        let found = formatters_for_extension("ts");
        assert_eq!(found.first().map(|f| f.id), Some("prettier"));
    }

    #[test]
    fn universal_options_apply_to_every_language() {
        for id in UNIVERSAL {
            assert!(style_option(id).unwrap().languages.is_empty(), "{id} must be universal");
        }
    }
}
