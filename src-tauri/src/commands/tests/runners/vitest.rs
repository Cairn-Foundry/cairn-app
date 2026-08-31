// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Vitest. Its `--reporter=json` document has the same shape as jest's, so the
//! final parse is shared; what belongs here is the live reading of the
//! `verbose` reporter, which is what arrives while the run is going.
//!
//! `verbose` is used rather than the default reporter for one reason: it prints
//! each test the moment it finishes, where the default one withholds a file
//! until every test in it is done. On a suite holding one slow test, the default
//! reporter shows nothing for as long as that test runs, which reads as "the run
//! does not stream at all".
//!
//! Its lines carry the whole path, so the parser needs no state:
//!
//! ```text
//!  v src/cart.test.js > subtotal > sums the lines 1ms
//!  x src/cart.test.js > roundMoney > rounds half up 2ms
//!    -> expected 1 to be 1.01
//! ```

use super::{normalize_path, TestCase, TestEvent, TestStatus};

pub use super::jest::parse_report;

/// The marks vitest puts in front of a result, written as escapes because they
/// are data to match, not text to display.
const MARK_PASS: [&str; 2] = ["\u{2713}", "\u{221A}"];
const MARK_FAIL: [&str; 3] = ["\u{00D7}", "\u{2717}", "x"];
const MARK_SKIP: [&str; 2] = ["\u{2193}", "\u{25CB}"];
/// A `todo` test, which the reporter marks with an empty square.
const MARK_TODO: [&str; 2] = ["\u{25A1}", "\u{2610}"];

/// The separator between the file, the describe blocks and the test name.
const PATH_SEP: &str = " > ";

/// Reads one line of the `verbose` reporter. A decorative, summary or detail
/// line yields nothing.
pub fn parse_line(line: &str) -> Option<TestEvent> {
    let trimmed = line.trim();
    let (mark, rest) = trimmed.split_once(' ')?;
    let rest = rest.trim();

    let status = if MARK_PASS.contains(&mark) {
        TestStatus::Pass
    } else if MARK_FAIL.contains(&mark) {
        TestStatus::Fail
    } else if MARK_SKIP.contains(&mark) {
        TestStatus::Skip
    } else if MARK_TODO.contains(&mark) {
        TestStatus::Todo
    } else {
        return None;
    };

    // Every result line names its file first; anything else is not one.
    let (file, path) = rest.split_once(PATH_SEP)?;
    if !is_test_file(file) {
        return None;
    }

    let (path, duration) = split_trailing_duration(path);
    let mut parts: Vec<String> =
        path.split(PATH_SEP).map(|part| part.trim().to_string()).collect();
    let name = parts.pop().filter(|name| !name.is_empty())?;

    let mut case = TestCase::new(normalize_path(file), parts, name, status);
    case.duration_ms = duration;
    Some(TestEvent::Case(Box::new(case)))
}

/// A path with a test-ish extension; guards against reading prose as a file.
fn is_test_file(candidate: &str) -> bool {
    candidate.contains('.')
        && !candidate.contains(' ')
        && candidate.split('.').next_back().is_some_and(|ext| {
            matches!(
                ext,
                "ts" | "tsx" | "js" | "jsx" | "mts" | "cts" | "mjs" | "cjs" | "svelte" | "vue"
            )
        })
}

/// Splits `some test name 42ms` into its name and its duration. A fast test is
/// printed without one, so the duration is optional.
fn split_trailing_duration(rest: &str) -> (&str, Option<u64>) {
    let token = rest.split_whitespace().next_back().unwrap_or_default();
    match parse_duration(token) {
        Some(ms) => (rest[..rest.len() - token.len()].trim_end(), Some(ms)),
        None => (rest, None),
    }
}

/// `123ms` or `1.2s`, as the reporter writes them.
fn parse_duration(token: &str) -> Option<u64> {
    if let Some(value) = token.strip_suffix("ms") {
        return value.parse().ok();
    }
    token
        .strip_suffix('s')
        .filter(|value| !value.is_empty())
        .and_then(|value| value.parse::<f64>().ok())
        .map(|seconds| (seconds * 1000.0) as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PASS: &str = "\u{2713}";
    const FAIL: &str = "\u{00D7}";
    const SKIP: &str = "\u{2193}";
    const TODO: &str = "\u{25A1}";

    fn case_of(event: Option<TestEvent>) -> Box<TestCase> {
        match event.expect("expected an event") {
            TestEvent::Case(case) => case,
            _ => panic!("expected a case"),
        }
    }

    #[test]
    fn reads_a_test_with_its_file_describes_and_duration() {
        let line = format!(" {PASS} src/cart.test.js > subtotal > sums the lines 1ms");
        let case = case_of(parse_line(&line));
        assert_eq!(case.file, "src/cart.test.js");
        assert_eq!(case.ancestors, vec!["subtotal"]);
        assert_eq!(case.name, "sums the lines");
        assert_eq!(case.status, TestStatus::Pass);
        assert_eq!(case.duration_ms, Some(1));
    }

    #[test]
    fn keeps_every_level_of_nesting() {
        let line = format!("{PASS} a.test.js > outer > inner > works 2ms");
        let case = case_of(parse_line(&line));
        assert_eq!(case.ancestors, vec!["outer", "inner"]);
        assert_eq!(case.name, "works");
    }

    #[test]
    fn reads_a_test_sitting_at_the_top_level() {
        let line = format!("{PASS} a.test.js > works 1ms");
        let case = case_of(parse_line(&line));
        assert!(case.ancestors.is_empty());
        assert_eq!(case.name, "works");
    }

    #[test]
    fn reads_every_status_mark() {
        assert_eq!(
            case_of(parse_line(&format!("{FAIL} a.test.js > breaks 2ms"))).status,
            TestStatus::Fail
        );
        assert_eq!(
            case_of(parse_line(&format!("{SKIP} a.test.js > skipped"))).status,
            TestStatus::Skip
        );
        assert_eq!(
            case_of(parse_line(&format!("{TODO} a.test.js > todo"))).status,
            TestStatus::Todo
        );
    }

    #[test]
    fn a_long_duration_is_read_in_full() {
        let line = format!("{PASS} a.test.js > slow 20001ms");
        assert_eq!(case_of(parse_line(&line)).duration_ms, Some(20001));
    }

    #[test]
    fn a_test_without_a_duration_keeps_its_whole_name() {
        let line = format!("{PASS} a.test.js > no duration here");
        let case = case_of(parse_line(&line));
        assert_eq!(case.name, "no duration here");
        assert_eq!(case.duration_ms, None);
    }

    #[test]
    fn ignores_headers_summaries_and_failure_details() {
        assert!(parse_line("").is_none());
        assert!(parse_line(" RUN  v4.1.10").is_none());
        assert!(parse_line("Test Files  1 passed (1)").is_none());
        assert!(parse_line("   \u{2192} expected 1 to be 1.01").is_none());
        // A file header with no test path is not a result.
        assert!(parse_line(&format!("{PASS} src/cart.test.js")).is_none());
    }

    #[test]
    fn normalizes_a_windows_path() {
        let line = format!("{PASS} src\\cart.test.js > works 3ms");
        assert_eq!(case_of(parse_line(&line)).file, "src/cart.test.js");
    }
}

#[cfg(test)]
mod real_output {
    use super::*;
    use crate::commands::lsp::strip_ansi;
    use crate::commands::tests::sample;

    /// Guards the streaming path against the reporter changing shape, on a
    /// sample that reproduces the coloured lines vitest really writes.
    #[test]
    fn streams_every_test_of_a_run() {
        let cases: Vec<_> = sample::stream()
            .lines()
            .map(strip_ansi)
            .filter_map(|line| parse_line(&line))
            .filter_map(|event| match event {
                TestEvent::Case(case) => Some(case),
                _ => None,
            })
            .collect();

        assert_eq!(cases.len(), sample::TOTAL_CASES);
        assert_eq!(
            cases.iter().filter(|c| c.status == TestStatus::Fail).count(),
            sample::FAILING_CASES
        );
        assert_eq!(
            cases.iter().filter(|c| c.status == TestStatus::Todo).count(),
            sample::TODO_CASES
        );
        assert!(cases.iter().all(|case| !case.ancestors.is_empty()));
    }
}
