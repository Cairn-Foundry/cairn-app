// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

//! `go test -json`. One JSON object per line, streamed as the run goes, so
//! this is the only adapter that needs no final pass.

use std::collections::HashMap;

use serde_json::Value;

use super::{TestCase, TestEvent, TestFailure, TestStatus};

/// Accumulates the output lines of each test, since the failure text arrives in
/// `output` actions before the `fail` action that closes the test.
#[derive(Default)]
pub struct GoParser {
    output: HashMap<String, String>,
}

impl GoParser {
    pub fn new() -> Self {
        Self::default()
    }

    /// A line that is not JSON, or a subtest event with no name, yields nothing.
    pub fn parse_line(&mut self, line: &str) -> Option<TestEvent> {
        let value: Value = serde_json::from_str(line.trim()).ok()?;
        let test = value.get("Test").and_then(Value::as_str)?;
        let package = value.get("Package").and_then(Value::as_str).unwrap_or_default();
        let key = format!("{package}/{test}");

        match value.get("Action").and_then(Value::as_str)? {
            "output" => {
                if let Some(text) = value.get("Output").and_then(Value::as_str) {
                    self.output.entry(key).or_default().push_str(text);
                }
                None
            }
            action => {
                let status = match action {
                    "pass" => TestStatus::Pass,
                    "fail" => TestStatus::Fail,
                    "skip" => TestStatus::Skip,
                    _ => return None,
                };
                let collected = self.output.remove(&key).unwrap_or_default();

                // Subtests come as `Parent/child`: the parents are the ancestors.
                let mut parts: Vec<String> = test.split('/').map(str::to_string).collect();
                let name = parts.pop()?;
                let mut ancestors = vec![package.to_string()];
                ancestors.append(&mut parts);

                let mut case = TestCase::new(package.to_string(), ancestors, name, status);
                case.duration_ms = value
                    .get("Elapsed")
                    .and_then(Value::as_f64)
                    .map(|seconds| (seconds * 1000.0) as u64);
                if status == TestStatus::Fail && !collected.trim().is_empty() {
                    case.failure = Some(TestFailure {
                        message: collected.trim_end().to_string(),
                        ..TestFailure::default()
                    });
                }
                Some(TestEvent::Case(Box::new(case)))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_passing_test_carries_its_package_and_duration() {
        let mut parser = GoParser::new();
        let line = r#"{"Action":"pass","Package":"app/auth","Test":"TestTotp","Elapsed":0.012}"#;
        let TestEvent::Case(case) = parser.parse_line(line).unwrap() else {
            panic!("expected a case")
        };
        assert_eq!(case.name, "TestTotp");
        assert_eq!(case.ancestors, vec!["app/auth"]);
        assert_eq!(case.status, TestStatus::Pass);
        assert_eq!(case.duration_ms, Some(12));
    }

    #[test]
    fn output_lines_are_folded_into_the_failure() {
        let mut parser = GoParser::new();
        assert!(parser
            .parse_line(r#"{"Action":"output","Package":"p","Test":"T","Output":"want false\n"}"#)
            .is_none());
        assert!(parser
            .parse_line(r#"{"Action":"output","Package":"p","Test":"T","Output":"got true\n"}"#)
            .is_none());

        let TestEvent::Case(case) = parser
            .parse_line(r#"{"Action":"fail","Package":"p","Test":"T","Elapsed":0.5}"#)
            .unwrap()
        else {
            panic!("expected a case")
        };
        let failure = case.failure.expect("a failed test keeps its output");
        assert_eq!(failure.message, "want false\ngot true");
    }

    #[test]
    fn a_subtest_nests_under_its_parent() {
        let mut parser = GoParser::new();
        let line = r#"{"Action":"pass","Package":"p","Test":"TestParent/sub_case"}"#;
        let TestEvent::Case(case) = parser.parse_line(line).unwrap() else {
            panic!("expected a case")
        };
        assert_eq!(case.name, "sub_case");
        assert_eq!(case.ancestors, vec!["p", "TestParent"]);
    }

    #[test]
    fn package_level_and_malformed_lines_are_ignored() {
        let mut parser = GoParser::new();
        assert!(parser.parse_line(r#"{"Action":"pass","Package":"p"}"#).is_none());
        assert!(parser.parse_line("ok  	app/auth	0.012s").is_none());
        assert!(parser.parse_line("").is_none());
    }

    #[test]
    fn a_passing_test_keeps_no_failure_even_after_output() {
        let mut parser = GoParser::new();
        parser.parse_line(r#"{"Action":"output","Package":"p","Test":"T","Output":"noise"}"#);
        let TestEvent::Case(case) =
            parser.parse_line(r#"{"Action":"pass","Package":"p","Test":"T"}"#).unwrap()
        else {
            panic!("expected a case")
        };
        assert!(case.failure.is_none());
    }
}
