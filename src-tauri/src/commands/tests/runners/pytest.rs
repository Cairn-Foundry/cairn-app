// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

//! pytest in verbose mode. The json report needs a plugin that most projects
//! do not install, so the `-v` text output is what is parsed:
//! `path/to/test_file.py::TestClass::test_name PASSED [ 42%]`.

use super::{normalize_path, TestCase, TestEvent, TestStatus};

fn status_from(word: &str) -> Option<TestStatus> {
    match word {
        "PASSED" | "XPASS" => Some(TestStatus::Pass),
        "FAILED" | "ERROR" => Some(TestStatus::Fail),
        "SKIPPED" | "XFAIL" => Some(TestStatus::Skip),
        _ => None,
    }
}

/// A result line, or nothing for the headers, the progress bar and the summary.
pub fn parse_line(line: &str) -> Option<TestEvent> {
    let trimmed = line.trim();
    let (target, rest) = trimmed.split_once(' ')?;
    if !target.contains(".py::") {
        return None;
    }

    // The percentage counter trails the status word and is not part of it.
    let status = status_from(rest.split_whitespace().next()?)?;

    let mut parts: Vec<String> = target.split("::").map(str::to_string).collect();
    let name = parts.pop()?;
    let file = normalize_path(parts.first().map(String::as_str).unwrap_or_default());
    let ancestors = parts.into_iter().skip(1).collect();

    Some(TestEvent::Case(Box::new(TestCase::new(file, ancestors, name, status))))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_plain_test_function() {
        let TestEvent::Case(case) =
            parse_line("tests/test_auth.py::test_login PASSED [ 42%]").unwrap()
        else {
            panic!("expected a case")
        };
        assert_eq!(case.file, "tests/test_auth.py");
        assert_eq!(case.name, "test_login");
        assert!(case.ancestors.is_empty());
        assert_eq!(case.status, TestStatus::Pass);
    }

    #[test]
    fn a_class_becomes_an_ancestor() {
        let TestEvent::Case(case) =
            parse_line("tests/test_auth.py::TestTotp::test_window FAILED [100%]").unwrap()
        else {
            panic!("expected a case")
        };
        assert_eq!(case.ancestors, vec!["TestTotp"]);
        assert_eq!(case.name, "test_window");
        assert_eq!(case.status, TestStatus::Fail);
    }

    #[test]
    fn skips_and_expected_failures_are_skips() {
        for line in ["a.py::t SKIPPED [10%]", "a.py::t XFAIL [10%]"] {
            let TestEvent::Case(case) = parse_line(line).unwrap() else {
                panic!("expected a case")
            };
            assert_eq!(case.status, TestStatus::Skip);
        }
    }

    #[test]
    fn headers_and_summaries_are_ignored() {
        assert!(parse_line("=== test session starts ===").is_none());
        assert!(parse_line("collected 12 items").is_none());
        assert!(parse_line("tests/test_auth.py ..F [100%]").is_none());
        assert!(parse_line("").is_none());
    }

    #[test]
    fn normalizes_a_windows_path() {
        let TestEvent::Case(case) =
            parse_line("tests\\test_auth.py::test_login PASSED [ 42%]").unwrap()
        else {
            panic!("expected a case")
        };
        assert_eq!(case.file, "tests/test_auth.py");
    }
}
