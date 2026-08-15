use std::collections::BTreeMap;

use serde::Serialize;
use serde_json::{json, Map, Value};

use super::catalog::{style_option, StyleSet};

/// What an import made of a file. Reported rather than applied silently: an
/// import that quietly drops half of what it read is worse than none at all.
#[derive(Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    /// The tool the file belongs to, as a formatter id when one owns it.
    pub source:      String,
    pub style:       StyleSet,
    /// Options read and mapped, as `native -> cairn`.
    pub mapped:      Vec<[String; 2]>,
    /// Options understood but with no equivalent in Cairn's model.
    pub unsupported: Vec<String>,
    /// Keys the file carried that mean nothing here.
    pub unknown:     Vec<String>,
}

fn num(value: &Value) -> Option<f64> {
    value.as_f64()
}

fn set(style: &mut StyleSet, mapped: &mut Vec<[String; 2]>, native: &str, id: &str, value: Value) {
    style.insert(id.to_string(), value);
    mapped.push([native.to_string(), id.to_string()]);
}

/// Prettier's own vocabulary, read into Cairn's. Covers `.prettierrc` in its
/// JSON form and the `prettier` key of a `package.json` - the YAML form is
/// normalized to the same map before it gets here.
pub fn import_prettier(map: &Map<String, Value>) -> ImportReport {
    let mut report = ImportReport { source: "prettier".into(), ..Default::default() };
    let (style, mapped) = (&mut report.style, &mut report.mapped);

    for (key, value) in map {
        match key.as_str() {
            "useTabs" => {
                let tabs = value.as_bool().unwrap_or(false);
                set(style, mapped, key, "indentStyle", json!(if tabs { "tab" } else { "space" }));
            }
            "tabWidth" => if let Some(n) = num(value) {
                set(style, mapped, key, "indentSize", json!(n));
            },
            "printWidth" => if let Some(n) = num(value) {
                set(style, mapped, key, "lineWidth", json!(n));
            },
            "endOfLine" => {
                let ending = match value.as_str().unwrap_or("lf") {
                    "crlf" => "crlf",
                    "auto" => "auto",
                    _ => "lf",
                };
                set(style, mapped, key, "lineEnding", json!(ending));
            }
            "singleQuote" => {
                let single = value.as_bool().unwrap_or(false);
                set(style, mapped, key, "quoteStyle", json!(if single { "single" } else { "double" }));
            }
            "jsxSingleQuote" => {
                let single = value.as_bool().unwrap_or(false);
                set(style, mapped, key, "jsxQuoteStyle", json!(if single { "single" } else { "double" }));
            }
            "semi" => {
                let semi = value.as_bool().unwrap_or(true);
                set(style, mapped, key, "semicolons", json!(if semi { "always" } else { "asNeeded" }));
            }
            "trailingComma" => if let Some(s) = value.as_str() {
                set(style, mapped, key, "trailingComma", json!(s));
            },
            "bracketSpacing" => if let Some(b) = value.as_bool() {
                set(style, mapped, key, "bracketSpacing", json!(b));
            },
            "bracketSameLine" => if let Some(b) = value.as_bool() {
                set(style, mapped, key, "bracketSameLine", json!(b));
            },
            "arrowParens" => if let Some(s) = value.as_str() {
                set(style, mapped, key, "arrowParens", json!(s));
            },
            "quoteProps" => if let Some(s) = value.as_str() {
                let id = match s {
                    "consistent" => "consistent",
                    "preserve" => "preserve",
                    _ => "asNeeded",
                };
                set(style, mapped, key, "quoteProps", json!(id));
            },
            "singleAttributePerLine" => if let Some(b) = value.as_bool() {
                set(style, mapped, key, "singleAttributePerLine", json!(b));
            },
            // Understood, but Cairn's model has no place for them: they select
            // plugins or scope rules rather than describe a style. `overrides`
            // applies a whole style set to a glob, which the flat StyleSet model
            // cannot represent - same reasoning as editorconfig's per-glob sections.
            "plugins" | "overrides" | "parser" | "filepath" | "rangeStart" | "rangeEnd"
            | "requirePragma" | "insertPragma" | "proseWrap" | "htmlWhitespaceSensitivity"
            | "vueIndentScriptAndStyle" | "embeddedLanguageFormatting"
            | "experimentalTernaries" => report.unsupported.push(key.clone()),
            _ => report.unknown.push(key.clone()),
        }
    }
    report
}

/// Biome keeps its formatter settings in nested sections, with the JS-only ones
/// under `javascript.formatter`.
pub fn import_biome(root: &Map<String, Value>) -> ImportReport {
    let mut report = ImportReport { source: "biome".into(), ..Default::default() };
    let (style, mapped) = (&mut report.style, &mut report.mapped);

    if let Some(f) = root.get("formatter").and_then(Value::as_object) {
        for (key, value) in f {
            match key.as_str() {
                "indentStyle" => if let Some(s) = value.as_str() {
                    set(style, mapped, "formatter.indentStyle", "indentStyle", json!(s));
                },
                "indentWidth" => if let Some(n) = num(value) {
                    set(style, mapped, "formatter.indentWidth", "indentSize", json!(n));
                },
                "lineWidth" => if let Some(n) = num(value) {
                    set(style, mapped, "formatter.lineWidth", "lineWidth", json!(n));
                },
                "lineEnding" => if let Some(s) = value.as_str() {
                    set(style, mapped, "formatter.lineEnding", "lineEnding", json!(s));
                },
                "enabled" | "formatWithErrors" | "ignore" | "include" => {
                    report.unsupported.push(format!("formatter.{key}"))
                }
                _ => report.unknown.push(format!("formatter.{key}")),
            }
        }
    }

    let js = root
        .get("javascript")
        .and_then(Value::as_object)
        .and_then(|j| j.get("formatter"))
        .and_then(Value::as_object);
    if let Some(js) = js {
        for (key, value) in js {
            let native = format!("javascript.formatter.{key}");
            match key.as_str() {
                "quoteStyle" => if let Some(s) = value.as_str() {
                    set(style, mapped, &native, "quoteStyle", json!(s));
                },
                "jsxQuoteStyle" => if let Some(s) = value.as_str() {
                    set(style, mapped, &native, "jsxQuoteStyle", json!(s));
                },
                "semicolons" => {
                    let value = if value.as_str() == Some("asNeeded") { "asNeeded" } else { "always" };
                    set(style, mapped, &native, "semicolons", json!(value));
                }
                "trailingCommas" | "trailingComma" => if let Some(s) = value.as_str() {
                    set(style, mapped, &native, "trailingComma", json!(s));
                },
                "bracketSpacing" => if let Some(b) = value.as_bool() {
                    set(style, mapped, &native, "bracketSpacing", json!(b));
                },
                "bracketSameLine" => if let Some(b) = value.as_bool() {
                    set(style, mapped, &native, "bracketSameLine", json!(b));
                },
                "arrowParentheses" => {
                    let value = if value.as_str() == Some("asNeeded") { "avoid" } else { "always" };
                    set(style, mapped, &native, "arrowParens", json!(value));
                }
                _ => report.unknown.push(native),
            }
        }
    }
    report
}

fn toml_to_json(value: &toml::Value) -> Value {
    match value {
        toml::Value::String(s) => json!(s),
        toml::Value::Integer(i) => json!(i),
        toml::Value::Float(f) => json!(f),
        toml::Value::Boolean(b) => json!(b),
        toml::Value::Datetime(d) => json!(d.to_string()),
        toml::Value::Array(a) => Value::Array(a.iter().map(toml_to_json).collect()),
        toml::Value::Table(t) => {
            Value::Object(t.iter().map(|(k, v)| (k.clone(), toml_to_json(v))).collect())
        }
    }
}

pub fn import_rustfmt(table: &toml::value::Table) -> ImportReport {
    let mut report = ImportReport { source: "rustfmt".into(), ..Default::default() };
    let (style, mapped) = (&mut report.style, &mut report.mapped);

    for (key, value) in table {
        let value = toml_to_json(value);
        match key.as_str() {
            "max_width" => if let Some(n) = num(&value) {
                set(style, mapped, key, "lineWidth", json!(n));
            },
            "tab_spaces" => if let Some(n) = num(&value) {
                set(style, mapped, key, "indentSize", json!(n));
            },
            "hard_tabs" => {
                let tabs = value.as_bool().unwrap_or(false);
                set(style, mapped, key, "indentStyle", json!(if tabs { "tab" } else { "space" }));
            }
            "newline_style" => {
                let ending = match value.as_str().unwrap_or("Auto") {
                    "Windows" => "crlf",
                    "Unix" | "Native" => "lf",
                    _ => "auto",
                };
                set(style, mapped, key, "lineEnding", json!(ending));
            }
            "reorder_imports" => if let Some(b) = value.as_bool() {
                set(style, mapped, key, "reorderImports", json!(b));
            },
            "match_block_trailing_comma" => if let Some(b) = value.as_bool() {
                set(style, mapped, key, "matchBlockTrailingComma", json!(b));
            },
            "edition" | "unstable_features" | "ignore" | "required_version" => {
                report.unsupported.push(key.clone())
            }
            _ => report.unknown.push(key.clone()),
        }
    }
    report
}

/// `[tool.black]` and `[tool.ruff]` of a `pyproject.toml`. A file carrying
/// neither is not an error: it simply yields an empty report.
pub fn import_pyproject(doc: &toml::value::Table) -> ImportReport {
    let mut report = ImportReport { source: "python".into(), ..Default::default() };
    let (style, mapped) = (&mut report.style, &mut report.mapped);

    let tool = doc.get("tool").and_then(|t| t.as_table());
    for name in ["black", "ruff"] {
        let Some(section) = tool.and_then(|t| t.get(name)).and_then(|s| s.as_table()) else {
            continue;
        };
        for (key, value) in section {
            let native = format!("tool.{name}.{key}");
            let value = toml_to_json(value);
            match key.as_str() {
                "line-length" | "line_length" => if let Some(n) = num(&value) {
                    set(style, mapped, &native, "lineWidth", json!(n));
                },
                "indent-width" | "indent_width" => if let Some(n) = num(&value) {
                    set(style, mapped, &native, "indentSize", json!(n));
                },
                "skip-string-normalization" | "skip_string_normalization" => {
                    if let Some(b) = value.as_bool() {
                        set(style, mapped, &native, "skipStringNormalization", json!(b));
                    }
                }
                "target-version" | "target_version" | "exclude" | "extend-exclude"
                | "include" | "select" | "lint" => report.unsupported.push(native),
                _ => report.unknown.push(native),
            }
        }
    }
    report
}

/// `.clang-format`, which is YAML but in practice a flat `Key: value` list for
/// everything Cairn maps. Only those scalars are read.
pub fn import_clang_format(pairs: &BTreeMap<String, String>) -> ImportReport {
    let mut report = ImportReport { source: "clang-format".into(), ..Default::default() };
    let (style, mapped) = (&mut report.style, &mut report.mapped);

    for (key, raw) in pairs {
        match key.as_str() {
            "IndentWidth" => if let Ok(n) = raw.parse::<f64>() {
                set(style, mapped, key, "indentSize", json!(n));
            },
            "ColumnLimit" => if let Ok(n) = raw.parse::<f64>() {
                set(style, mapped, key, "lineWidth", json!(n));
            },
            "UseTab" => {
                let tabs = !matches!(raw.as_str(), "Never" | "false");
                set(style, mapped, key, "indentStyle", json!(if tabs { "tab" } else { "space" }));
            }
            "BasedOnStyle" | "Language" => report.unsupported.push(key.clone()),
            _ => report.unknown.push(key.clone()),
        }
    }
    report
}

/// The `[*]` section of an `.editorconfig`. Per-glob sections are reported as
/// unsupported rather than flattened: collapsing them would silently apply one
/// language's rule to every other.
pub fn import_editorconfig(text: &str) -> ImportReport {
    let mut report = ImportReport { source: "editorconfig".into(), ..Default::default() };
    let (style, mapped) = (&mut report.style, &mut report.mapped);
    let mut section = String::new();

    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
            continue;
        }
        if line.starts_with('[') && line.ends_with(']') {
            section = line[1..line.len() - 1].to_string();
            continue;
        }
        let Some((key, value)) = line.split_once('=') else { continue };
        let (key, value) = (key.trim().to_lowercase(), value.trim());
        if section != "*" && !section.is_empty() {
            report.unsupported.push(format!("[{section}] {key}"));
            continue;
        }
        match key.as_str() {
            "indent_style" => {
                let tabs = value == "tab";
                set(style, mapped, &key, "indentStyle", json!(if tabs { "tab" } else { "space" }));
            }
            "indent_size" | "tab_width" => if let Ok(n) = value.parse::<f64>() {
                set(style, mapped, &key, "indentSize", json!(n));
            },
            "max_line_length" => if let Ok(n) = value.parse::<f64>() {
                set(style, mapped, &key, "lineWidth", json!(n));
            },
            "end_of_line" => {
                let ending = if value == "crlf" { "crlf" } else { "lf" };
                set(style, mapped, &key, "lineEnding", json!(ending));
            }
            "insert_final_newline" => {
                set(style, mapped, &key, "finalNewline", json!(value == "true"));
            }
            "trim_trailing_whitespace" => {
                set(style, mapped, &key, "trimTrailingWhitespace", json!(value == "true"));
            }
            "root" | "charset" => report.unsupported.push(key),
            _ => report.unknown.push(key),
        }
    }
    report
}

/// A flat `key: value` YAML reader, enough for `.prettierrc.yaml` and
/// `.clang-format`. Nested structures are left to the caller to reject: the
/// files this serves are flat in every real case.
pub fn parse_flat_yaml(text: &str) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with("---") {
            continue;
        }
        // An indented line belongs to a nested block, which this does not read.
        if line.starts_with(' ') || line.starts_with('\t') {
            continue;
        }
        let Some((key, value)) = trimmed.split_once(':') else { continue };
        let value = value.trim().trim_matches(['"', '\'']).to_string();
        if value.is_empty() {
            continue;
        }
        out.insert(key.trim().to_string(), value);
    }
    out
}

/// A flat YAML map read as JSON scalars, so a `.prettierrc.yaml` reaches the
/// same importer as its JSON twin.
pub fn flat_yaml_as_json(text: &str) -> Map<String, Value> {
    parse_flat_yaml(text)
        .into_iter()
        .map(|(key, raw)| {
            let value = match raw.as_str() {
                "true" => json!(true),
                "false" => json!(false),
                other => other.parse::<f64>().map(|n| json!(n)).unwrap_or_else(|_| json!(other)),
            };
            (key, value)
        })
        .collect()
}

// --- Export: Cairn's model out to a tool's own config ------------------------

fn s(style: &StyleSet, id: &str) -> Option<String> {
    style.get(id)?.as_str().map(str::to_string)
}
fn n(style: &StyleSet, id: &str) -> Option<f64> {
    style.get(id)?.as_f64()
}
fn b(style: &StyleSet, id: &str) -> Option<bool> {
    style.get(id)?.as_bool()
}

/// What a target format could not express. Returned alongside the text so the
/// UI can say which settings will not survive the round trip.
pub struct Exported {
    pub text: String,
    pub dropped: Vec<String>,
}

fn dropped_for(style: &StyleSet, kept: &[&str]) -> Vec<String> {
    let mut out: Vec<String> = style
        .keys()
        .filter(|k| !kept.contains(&k.as_str()))
        .filter(|k| style_option(k).is_some())
        .cloned()
        .collect();
    out.sort();
    out
}

pub fn export_prettier(style: &StyleSet) -> Exported {
    let mut map = Map::new();
    if let Some(v) = s(style, "indentStyle") { map.insert("useTabs".into(), json!(v == "tab")); }
    if let Some(v) = n(style, "indentSize") { map.insert("tabWidth".into(), json!(v)); }
    if let Some(v) = n(style, "lineWidth") { map.insert("printWidth".into(), json!(v)); }
    if let Some(v) = s(style, "lineEnding") { map.insert("endOfLine".into(), json!(v)); }
    if let Some(v) = s(style, "quoteStyle")
        && v != "preserve" { map.insert("singleQuote".into(), json!(v == "single")); }
    if let Some(v) = s(style, "jsxQuoteStyle") { map.insert("jsxSingleQuote".into(), json!(v == "single")); }
    if let Some(v) = s(style, "semicolons") { map.insert("semi".into(), json!(v == "always")); }
    if let Some(v) = s(style, "trailingComma") { map.insert("trailingComma".into(), json!(v)); }
    if let Some(v) = b(style, "bracketSpacing") { map.insert("bracketSpacing".into(), json!(v)); }
    if let Some(v) = b(style, "bracketSameLine") { map.insert("bracketSameLine".into(), json!(v)); }
    if let Some(v) = s(style, "arrowParens") { map.insert("arrowParens".into(), json!(v)); }
    if let Some(v) = s(style, "quoteProps") {
        let native = if v == "asNeeded" { "as-needed" } else { v.as_str() };
        map.insert("quoteProps".into(), json!(native));
    }
    if let Some(v) = b(style, "singleAttributePerLine") {
        map.insert("singleAttributePerLine".into(), json!(v));
    }

    Exported {
        text: serde_json::to_string_pretty(&Value::Object(map)).unwrap_or_default(),
        dropped: dropped_for(style, &[
            "indentStyle", "indentSize", "lineWidth", "lineEnding", "quoteStyle",
            "jsxQuoteStyle", "semicolons", "trailingComma", "bracketSpacing",
            "bracketSameLine", "arrowParens", "quoteProps", "singleAttributePerLine",
            // Prettier always does these; nothing is lost by not writing them.
            "finalNewline", "trimTrailingWhitespace",
        ]),
    }
}

pub fn export_biome(style: &StyleSet) -> Exported {
    let mut formatter = Map::new();
    if let Some(v) = s(style, "indentStyle") { formatter.insert("indentStyle".into(), json!(v)); }
    if let Some(v) = n(style, "indentSize") { formatter.insert("indentWidth".into(), json!(v)); }
    if let Some(v) = n(style, "lineWidth") { formatter.insert("lineWidth".into(), json!(v)); }
    if let Some(v) = s(style, "lineEnding")
        && v != "auto" { formatter.insert("lineEnding".into(), json!(v)); }

    let mut js = Map::new();
    if let Some(v) = s(style, "quoteStyle")
        && v != "preserve" { js.insert("quoteStyle".into(), json!(v)); }
    if let Some(v) = s(style, "jsxQuoteStyle") { js.insert("jsxQuoteStyle".into(), json!(v)); }
    if let Some(v) = s(style, "semicolons") { js.insert("semicolons".into(), json!(v)); }
    if let Some(v) = s(style, "trailingComma") { js.insert("trailingCommas".into(), json!(v)); }
    if let Some(v) = b(style, "bracketSpacing") { js.insert("bracketSpacing".into(), json!(v)); }
    if let Some(v) = b(style, "bracketSameLine") { js.insert("bracketSameLine".into(), json!(v)); }
    if let Some(v) = s(style, "arrowParens") {
        js.insert("arrowParentheses".into(), json!(if v == "avoid" { "asNeeded" } else { "always" }));
    }

    let mut root = Map::new();
    root.insert("formatter".into(), Value::Object(formatter));
    if !js.is_empty() {
        root.insert("javascript".into(), json!({ "formatter": Value::Object(js) }));
    }

    Exported {
        text: serde_json::to_string_pretty(&Value::Object(root)).unwrap_or_default(),
        dropped: dropped_for(style, &[
            "indentStyle", "indentSize", "lineWidth", "lineEnding", "quoteStyle",
            "jsxQuoteStyle", "semicolons", "trailingComma", "bracketSpacing",
            "bracketSameLine", "arrowParens",
        ]),
    }
}

fn toml_lines(pairs: Vec<(String, String)>) -> String {
    let mut text = pairs.into_iter().map(|(k, v)| format!("{k} = {v}\n")).collect::<String>();
    if !text.is_empty() && !text.ends_with('\n') {
        text.push('\n');
    }
    text
}

pub fn export_rustfmt(style: &StyleSet) -> Exported {
    let mut pairs = Vec::new();
    if let Some(v) = n(style, "lineWidth") { pairs.push(("max_width".into(), format!("{v}"))); }
    if let Some(v) = n(style, "indentSize") { pairs.push(("tab_spaces".into(), format!("{v}"))); }
    if let Some(v) = s(style, "indentStyle") {
        pairs.push(("hard_tabs".into(), format!("{}", v == "tab")));
    }
    if let Some(v) = s(style, "lineEnding") {
        let native = match v.as_str() { "crlf" => "Windows", "lf" => "Unix", _ => "Auto" };
        pairs.push(("newline_style".into(), format!("\"{native}\"")));
    }
    if let Some(v) = b(style, "reorderImports") { pairs.push(("reorder_imports".into(), format!("{v}"))); }
    if let Some(v) = b(style, "matchBlockTrailingComma") {
        pairs.push(("match_block_trailing_comma".into(), format!("{v}")));
    }

    Exported {
        text: toml_lines(pairs),
        dropped: dropped_for(style, &[
            "lineWidth", "indentSize", "indentStyle", "lineEnding", "reorderImports",
            "matchBlockTrailingComma",
        ]),
    }
}

pub fn export_ruff(style: &StyleSet) -> Exported {
    let mut pairs = Vec::new();
    if let Some(v) = n(style, "lineWidth") { pairs.push(("line-length".into(), format!("{v}"))); }
    if let Some(v) = n(style, "indentSize") { pairs.push(("indent-width".into(), format!("{v}"))); }

    let mut text = toml_lines(pairs);
    let quote = s(style, "quoteStyle").filter(|v| v != "preserve");
    let tabs = s(style, "indentStyle").map(|v| v == "tab");
    if quote.is_some() || tabs.is_some() {
        text.push_str("\n[format]\n");
        if let Some(v) = quote {
            text.push_str(&format!("quote-style = \"{v}\"\n"));
        }
        if let Some(tabs) = tabs {
            text.push_str(&format!("indent-style = \"{}\"\n", if tabs { "tab" } else { "space" }));
        }
    }

    Exported {
        text,
        dropped: dropped_for(style, &["lineWidth", "indentSize", "quoteStyle", "indentStyle"]),
    }
}

pub fn export_black(style: &StyleSet) -> Exported {
    let mut text = String::from("[tool.black]\n");
    if let Some(v) = n(style, "lineWidth") {
        text.push_str(&format!("line-length = {v}\n"));
    }
    if let Some(v) = b(style, "skipStringNormalization") {
        text.push_str(&format!("skip-string-normalization = {v}\n"));
    }
    Exported { text, dropped: dropped_for(style, &["lineWidth", "skipStringNormalization"]) }
}

pub fn export_clang_format(style: &StyleSet) -> Exported {
    let mut text = String::new();
    if let Some(v) = n(style, "indentSize") { text.push_str(&format!("IndentWidth: {v}\n")); }
    if let Some(v) = n(style, "lineWidth") { text.push_str(&format!("ColumnLimit: {v}\n")); }
    if let Some(v) = s(style, "indentStyle") {
        text.push_str(&format!("UseTab: {}\n", if v == "tab" { "Always" } else { "Never" }));
    }
    Exported { text, dropped: dropped_for(style, &["indentSize", "lineWidth", "indentStyle"]) }
}

pub fn export_editorconfig(style: &StyleSet) -> Exported {
    let mut text = String::from("root = true\n\n[*]\n");
    if let Some(v) = s(style, "indentStyle") { text.push_str(&format!("indent_style = {v}\n")); }
    if let Some(v) = n(style, "indentSize") { text.push_str(&format!("indent_size = {v}\n")); }
    if let Some(v) = n(style, "lineWidth") { text.push_str(&format!("max_line_length = {v}\n")); }
    if let Some(v) = s(style, "lineEnding")
        && v != "auto" { text.push_str(&format!("end_of_line = {v}\n")); }
    if let Some(v) = b(style, "finalNewline") { text.push_str(&format!("insert_final_newline = {v}\n")); }
    if let Some(v) = b(style, "trimTrailingWhitespace") {
        text.push_str(&format!("trim_trailing_whitespace = {v}\n"));
    }
    Exported {
        text,
        dropped: dropped_for(style, &[
            "indentStyle", "indentSize", "lineWidth", "lineEnding", "finalNewline",
            "trimTrailingWhitespace",
        ]),
    }
}

/// The config a formatter is handed for one run, in its own format. `None` for
/// a tool that takes no config at all - gofmt, and shfmt which is driven by
/// flags instead.
pub fn generate_config(formatter_id: &str, style: &StyleSet) -> Option<(String, String)> {
    match formatter_id {
        "prettier" => Some((".prettierrc".into(), export_prettier(style).text)),
        "biome" => Some(("biome.json".into(), export_biome(style).text)),
        "rustfmt" => Some(("rustfmt.toml".into(), export_rustfmt(style).text)),
        "ruff" => Some(("ruff.toml".into(), export_ruff(style).text)),
        "black" => Some(("pyproject.toml".into(), export_black(style).text)),
        "clang-format" => Some((".clang-format".into(), export_clang_format(style).text)),
        "ktlint" => Some((".editorconfig".into(), export_editorconfig(style).text)),
        _ => None,
    }
}

/// Extra command-line arguments for tools configured by flags rather than by a
/// file. shfmt is the only one in the v1 catalogue.
pub fn extra_args(formatter_id: &str, style: &StyleSet) -> Vec<String> {
    let mut args = Vec::new();
    if formatter_id == "shfmt" {
        let tabs = s(style, "indentStyle").map(|v| v == "tab").unwrap_or(false);
        // shfmt reads an indent of 0 as tabs, which is exactly what is wanted.
        let width = if tabs { 0.0 } else { n(style, "indentSize").unwrap_or(2.0) };
        args.push("-i".into());
        args.push(format!("{width}"));
    }
    args
}

#[cfg(test)]
mod tests {
    use super::*;

    fn style(pairs: &[(&str, Value)]) -> StyleSet {
        pairs.iter().map(|(k, v)| (k.to_string(), v.clone())).collect()
    }

    #[test]
    fn a_prettierrc_maps_onto_the_model() {
        let map: Map<String, Value> = serde_json::from_str(
            r#"{"semi":false,"singleQuote":true,"tabWidth":4,"printWidth":100,"useTabs":true}"#,
        )
        .unwrap();
        let report = import_prettier(&map);
        assert_eq!(report.style["semicolons"], json!("asNeeded"));
        assert_eq!(report.style["quoteStyle"], json!("single"));
        assert_eq!(report.style["indentSize"], json!(4.0));
        assert_eq!(report.style["lineWidth"], json!(100.0));
        assert_eq!(report.style["indentStyle"], json!("tab"));
        assert!(report.unknown.is_empty());
    }

    #[test]
    fn a_prettierrc_reports_what_it_could_not_place() {
        let map: Map<String, Value> =
            serde_json::from_str(r#"{"plugins":["a"],"wildKey":1}"#).unwrap();
        let report = import_prettier(&map);
        assert_eq!(report.unsupported, vec!["plugins".to_string()]);
        assert_eq!(report.unknown, vec!["wildKey".to_string()]);
    }

    #[test]
    fn prettier_survives_a_round_trip() {
        let original = style(&[
            ("indentStyle", json!("tab")), ("indentSize", json!(4.0)),
            ("lineWidth", json!(100.0)), ("quoteStyle", json!("single")),
            ("semicolons", json!("asNeeded")), ("trailingComma", json!("all")),
            ("arrowParens", json!("avoid")), ("bracketSpacing", json!(false)),
        ]);
        let exported = export_prettier(&original);
        let map: Map<String, Value> = serde_json::from_str(&exported.text).unwrap();
        let back = import_prettier(&map).style;
        for (key, value) in &original {
            assert_eq!(back.get(key), Some(value), "{key} did not survive");
        }
    }

    #[test]
    fn rustfmt_survives_a_round_trip() {
        let original = style(&[
            ("lineWidth", json!(120.0)), ("indentSize", json!(4.0)),
            ("indentStyle", json!("space")), ("reorderImports", json!(true)),
        ]);
        let exported = export_rustfmt(&original);
        let table: toml::value::Table = toml::from_str(&exported.text).unwrap();
        let back = import_rustfmt(&table).style;
        for (key, value) in &original {
            assert_eq!(back.get(key), Some(value), "{key} did not survive");
        }
    }

    #[test]
    fn biome_survives_a_round_trip() {
        let original = style(&[
            ("indentStyle", json!("space")), ("indentSize", json!(2.0)),
            ("lineWidth", json!(90.0)), ("quoteStyle", json!("single")),
            ("semicolons", json!("asNeeded")), ("arrowParens", json!("avoid")),
        ]);
        let exported = export_biome(&original);
        let map: Map<String, Value> = serde_json::from_str(&exported.text).unwrap();
        let back = import_biome(&map).style;
        for (key, value) in &original {
            assert_eq!(back.get(key), Some(value), "{key} did not survive");
        }
    }

    #[test]
    fn an_export_names_what_the_target_cannot_express() {
        let original = style(&[("lineWidth", json!(100.0)), ("reorderImports", json!(true))]);
        let exported = export_prettier(&original);
        assert_eq!(exported.dropped, vec!["reorderImports".to_string()]);
    }

    #[test]
    fn editorconfig_reads_the_star_section_and_flags_the_rest() {
        let text = "root = true\n\n[*]\nindent_style = tab\nindent_size = 4\n\n[*.md]\nindent_size = 2\n";
        let report = import_editorconfig(text);
        assert_eq!(report.style["indentStyle"], json!("tab"));
        assert_eq!(report.style["indentSize"], json!(4.0));
        assert!(report.unsupported.iter().any(|u| u.starts_with("[*.md]")));
    }

    #[test]
    fn a_pyproject_without_a_tool_section_is_empty_not_an_error() {
        let doc: toml::value::Table = toml::from_str("[project]\nname = \"x\"\n").unwrap();
        let report = import_pyproject(&doc);
        assert!(report.style.is_empty());
        assert!(report.mapped.is_empty());
    }

    #[test]
    fn a_pyproject_reads_black_and_ruff() {
        let doc: toml::value::Table = toml::from_str(
            "[tool.black]\nline-length = 100\nskip-string-normalization = true\n\n[tool.ruff]\nindent-width = 4\n",
        )
        .unwrap();
        let report = import_pyproject(&doc);
        // Numbers are normalized to f64 on the way in, whatever the source
        // format called them, so a style never depends on how it was written.
        assert_eq!(report.style["lineWidth"], json!(100.0));
        assert_eq!(report.style["skipStringNormalization"], json!(true));
        assert_eq!(report.style["indentSize"], json!(4.0));
    }

    #[test]
    fn flat_yaml_reads_scalars_and_skips_nesting() {
        let map = flat_yaml_as_json("semi: false\ntabWidth: 4\nnested:\n  inner: 1\nname: \"x\"\n");
        assert_eq!(map["semi"], json!(false));
        assert_eq!(map["tabWidth"], json!(4.0));
        assert_eq!(map["name"], json!("x"));
        assert!(!map.contains_key("inner"));
    }

    #[test]
    fn shfmt_is_driven_by_flags_and_reads_tabs_as_zero() {
        assert_eq!(extra_args("shfmt", &style(&[("indentStyle", json!("tab"))])), vec!["-i", "0"]);
        assert_eq!(
            extra_args("shfmt", &style(&[("indentStyle", json!("space")), ("indentSize", json!(4.0))])),
            vec!["-i", "4"]
        );
        assert!(extra_args("prettier", &style(&[])).is_empty());
    }

    #[test]
    fn gofmt_takes_no_generated_config() {
        assert!(generate_config("gofmt", &style(&[("lineWidth", json!(100.0))])).is_none());
    }
}
