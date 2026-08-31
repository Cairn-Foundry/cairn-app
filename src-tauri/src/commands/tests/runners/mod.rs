// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Turning a runner's output into test events. Every adapter is a pure
//! line-to-events function so it can be tested on captured output without
//! spawning anything.

pub mod cargo;
pub mod go;
pub mod jest;
pub mod pytest;
pub mod vitest;

use serde::{Deserialize, Serialize};

/// How one case ended. `Running` is only ever produced by a streaming runner.
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum TestStatus {
    Pass,
    Fail,
    Skip,
    Todo,
    Running,
}

/// A frame of a failure stack; `in_project` decides whether the UI folds it.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct StackFrame {
    pub file:       String,
    pub line:       u32,
    pub column:     u32,
    #[serde(rename = "inProject")]
    pub in_project: bool,
}

/// Where a failure happened, when the runner says so.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct FailureLocation {
    pub file:   String,
    pub line:   u32,
    pub column: u32,
}

/// Why a case failed, as far as the runner was willing to say.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct TestFailure {
    pub message:  String,
    pub expected: Option<String>,
    pub received: Option<String>,
    pub stack:    Vec<StackFrame>,
    pub location: Option<FailureLocation>,
}

/// One case. `id` is `file::ancestors>name` and must stay stable across runs,
/// since it is what keeps the selection and the tree's folding when a run is
/// replayed.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TestCase {
    pub id:         String,
    pub name:       String,
    pub ancestors:  Vec<String>,
    pub file:       String,
    pub line:       Option<u32>,
    pub status:     TestStatus,
    #[serde(rename = "durationMs")]
    pub duration_ms: Option<u64>,
    pub failure:    Option<TestFailure>,
}

impl TestCase {
    /// Builds the stable id from the parts that identify a case everywhere.
    pub fn build_id(file: &str, ancestors: &[String], name: &str) -> String {
        format!("{}::{}::{}", file, ancestors.join(">"), name)
    }

    pub fn new(file: String, ancestors: Vec<String>, name: String, status: TestStatus) -> Self {
        let id = Self::build_id(&file, &ancestors, &name);
        Self { id, name, ancestors, file, line: None, status, duration_ms: None, failure: None }
    }
}

/// What an adapter produces from a line. A line that means nothing yields none.
#[derive(Clone, Debug)]
pub enum TestEvent {
    Case(Box<TestCase>),
    SuiteError { file: String, message: String },
}

/// Windows separators are normalized away so a path compares and displays the
/// same wherever the runner ran.
pub fn normalize_path(path: &str) -> String {
    path.replace('\\', "/")
}

/// Cuts `root` off the front of `path`.
///
/// This is what keeps a test's identity stable: the streaming reporter names a
/// file relative to the worktree while the final JSON report names it
/// absolutely, and an id built from two different spellings of the same file
/// produces two rows for one test.
pub fn relative_to(path: &str, root: &str) -> String {
    let path = normalize_path(path);
    let root = normalize_path(root);
    let root = root.strip_suffix('/').unwrap_or(&root);
    if root.is_empty() {
        return path;
    }
    match path.strip_prefix(root).and_then(|rest| rest.strip_prefix('/')) {
        Some(rest) if !rest.is_empty() => rest.to_string(),
        _ => path,
    }
}

/// A frame is "in project" unless it comes from a dependency or the stdlib -
/// those are the ones the UI folds by default.
pub fn is_in_project(file: &str) -> bool {
    let file = normalize_path(file);
    !file.contains("/node_modules/")
        && !file.contains("/.cargo/registry/")
        && !file.contains("/site-packages/")
        && !file.starts_with("/rustc/")
        && !file.contains("/go/pkg/mod/")
}

/// The `at file:line:column` tail every JS runner writes in a stack.
pub fn parse_stack_line(line: &str) -> Option<StackFrame> {
    let trimmed = line.trim().strip_prefix("at ").unwrap_or(line.trim());
    let inside = trimmed.rfind('(').map(|start| {
        let end = trimmed.rfind(')').unwrap_or(trimmed.len());
        &trimmed[start + 1..end]
    });
    let target = inside.unwrap_or(trimmed);

    let mut parts = target.rsplitn(3, ':');
    let column = parts.next()?.parse().ok()?;
    let line_no = parts.next()?.parse().ok()?;
    let file = parts.next()?.to_string();
    if file.is_empty() {
        return None;
    }
    let in_project = is_in_project(&file);
    Some(StackFrame { file: normalize_path(&file), line: line_no, column, in_project })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_stable_and_unique() {
        let a = TestCase::build_id("a.ts", &["outer".into(), "inner".into()], "works");
        assert_eq!(a, "a.ts::outer>inner::works");
        let b = TestCase::build_id("a.ts", &["outer".into()], "works");
        assert_ne!(a, b, "different ancestors must not collide");
    }

    #[test]
    fn a_path_is_made_relative_to_the_worktree() {
        // The two spellings the two reporters produce must collapse into one.
        assert_eq!(
            relative_to("/repo/src/cart.test.js", "/repo"),
            "src/cart.test.js"
        );
        assert_eq!(relative_to("src/cart.test.js", "/repo"), "src/cart.test.js");
        // A trailing slash on the root must not matter.
        assert_eq!(relative_to("/repo/a.js", "/repo/"), "a.js");
        // Windows separators on either side.
        assert_eq!(relative_to("C:\\repo\\src\\a.js", "C:\\repo"), "src/a.js");
        // A path outside the root is left alone rather than mangled.
        assert_eq!(relative_to("/other/a.js", "/repo"), "/other/a.js");
        // A root that is a string prefix but not a path prefix.
        assert_eq!(relative_to("/repository/a.js", "/repo"), "/repository/a.js");
        assert_eq!(relative_to("/repo/a.js", ""), "/repo/a.js");
    }

    #[test]
    fn windows_paths_are_normalized() {
        assert_eq!(normalize_path("src\\auth\\totp.test.ts"), "src/auth/totp.test.ts");
    }

    #[test]
    fn dependency_frames_are_not_in_project() {
        assert!(is_in_project("src/auth/totp.ts"));
        assert!(!is_in_project("/repo/node_modules/vitest/dist/index.js"));
        assert!(!is_in_project("C:\\repo\\node_modules\\jest\\build\\run.js"));
        assert!(!is_in_project("/home/u/.cargo/registry/src/core.rs"));
    }

    #[test]
    fn stack_lines_parse_both_shapes() {
        let bare = parse_stack_line("    at src/auth/totp.test.ts:51:19").unwrap();
        assert_eq!(bare.file, "src/auth/totp.test.ts");
        assert_eq!((bare.line, bare.column), (51, 19));
        assert!(bare.in_project);

        let wrapped = parse_stack_line("at Object.<anonymous> (/repo/src/a.test.ts:12:3)").unwrap();
        assert_eq!(wrapped.file, "/repo/src/a.test.ts");
        assert_eq!((wrapped.line, wrapped.column), (12, 3));
    }

    #[test]
    fn a_line_without_a_position_is_not_a_frame() {
        assert!(parse_stack_line("some prose").is_none());
        assert!(parse_stack_line("at :1:2").is_none());
    }
}

/// Strips colour from a whole captured run, so a fixture can be fed to a parser
/// the way `pump_lines` would hand it over line by line.
#[cfg(test)]
pub fn strip_all_ansi(text: &str) -> String {
    text.lines()
        .map(crate::commands::lsp::strip_ansi)
        .collect::<Vec<_>>()
        .join("\n")
}
