// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Cargo, two ways. `cargo nextest run --message-format libtest-json` streams
//! one JSON object per line and is preferred whenever nextest is installed;
//! plain `cargo test` has no stable machine format outside nightly, so its text
//! output is parsed line by line instead.

use serde_json::Value;

use super::{TestCase, TestEvent, TestFailure, TestStatus};

/// Splits `module::path::test_name` into its ancestors and its name.
fn split_path(full: &str) -> (Vec<String>, String) {
    let mut parts: Vec<String> = full.split("::").map(str::to_string).collect();
    let name = parts.pop().unwrap_or_else(|| full.to_string());
    (parts, name)
}

/// One line of nextest's libtest-json stream.
pub fn parse_nextest_line(line: &str) -> Option<TestEvent> {
    let value: Value = serde_json::from_str(line.trim()).ok()?;
    if value.get("type").and_then(Value::as_str)? != "test" {
        return None;
    }

    let event = value.get("event").and_then(Value::as_str)?;
    let status = match event {
        "ok" => TestStatus::Pass,
        "failed" => TestStatus::Fail,
        "ignored" => TestStatus::Skip,
        // `started` carries no result yet; the run's progress comes from the
        // events that close a test.
        _ => return None,
    };

    let full = value.get("name").and_then(Value::as_str)?;
    let (ancestors, name) = split_path(full);
    let file = ancestors.first().cloned().unwrap_or_default();

    let mut case = TestCase::new(file, ancestors, name, status);
    case.duration_ms = value
        .get("exec_time")
        .and_then(Value::as_f64)
        .map(|seconds| (seconds * 1000.0) as u64);
    if status == TestStatus::Fail {
        let message = value
            .get("stdout")
            .or_else(|| value.get("message"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_string();
        case.failure = Some(TestFailure { message, ..TestFailure::default() });
    }
    Some(TestEvent::Case(Box::new(case)))
}

/// A `test some::path ... ok` line of plain `cargo test`. The trailing word is
/// the result, which is why the parse works from the end.
pub fn parse_text_line(line: &str) -> Option<TestEvent> {
    let trimmed = line.trim();
    let rest = trimmed.strip_prefix("test ")?;
    let (full, result) = rest.rsplit_once(" ... ")?;
    let full = full.trim();
    if full.is_empty() {
        return None;
    }

    let status = match result.trim() {
        "ok" => TestStatus::Pass,
        "FAILED" => TestStatus::Fail,
        result if result.starts_with("ignored") => TestStatus::Skip,
        _ => return None,
    };

    let (ancestors, name) = split_path(full);
    let file = ancestors.first().cloned().unwrap_or_default();
    Some(TestEvent::Case(Box::new(TestCase::new(file, ancestors, name, status))))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nextest_reports_a_passing_test_with_its_module_path() {
        let line = r#"{"type":"test","event":"ok","name":"commands::tests::runners::works","exec_time":0.004}"#;
        let TestEvent::Case(case) = parse_nextest_line(line).unwrap() else {
            panic!("expected a case")
        };
        assert_eq!(case.name, "works");
        assert_eq!(case.ancestors, vec!["commands", "tests", "runners"]);
        assert_eq!(case.status, TestStatus::Pass);
        assert_eq!(case.duration_ms, Some(4));
    }

    #[test]
    fn nextest_keeps_the_failure_output() {
        let line = r#"{"type":"test","event":"failed","name":"auth::totp","stdout":"assertion failed: left == right"}"#;
        let TestEvent::Case(case) = parse_nextest_line(line).unwrap() else {
            panic!("expected a case")
        };
        assert_eq!(case.status, TestStatus::Fail);
        assert!(case.failure.unwrap().message.contains("assertion failed"));
    }

    #[test]
    fn nextest_ignores_suite_and_started_events() {
        assert!(parse_nextest_line(r#"{"type":"suite","event":"started"}"#).is_none());
        assert!(parse_nextest_line(r#"{"type":"test","event":"started","name":"a::b"}"#).is_none());
        assert!(parse_nextest_line("Compiling cairn v0.16.0").is_none());
    }

    #[test]
    fn text_output_reads_the_three_results() {
        let TestEvent::Case(passing) = parse_text_line("test auth::totp::works ... ok").unwrap()
        else {
            panic!("expected a case")
        };
        assert_eq!(passing.status, TestStatus::Pass);
        assert_eq!(passing.name, "works");
        assert_eq!(passing.ancestors, vec!["auth", "totp"]);

        let TestEvent::Case(failing) = parse_text_line("test auth::totp::breaks ... FAILED").unwrap()
        else {
            panic!("expected a case")
        };
        assert_eq!(failing.status, TestStatus::Fail);

        let TestEvent::Case(skipped) = parse_text_line("test slow ... ignored, needs network").unwrap()
        else {
            panic!("expected a case")
        };
        assert_eq!(skipped.status, TestStatus::Skip);
    }

    #[test]
    fn text_summary_and_noise_lines_are_ignored() {
        assert!(parse_text_line("running 12 tests").is_none());
        assert!(parse_text_line("test result: ok. 12 passed; 0 failed").is_none());
        assert!(parse_text_line("").is_none());
        assert!(parse_text_line("test  ... ok").is_none());
    }
}
