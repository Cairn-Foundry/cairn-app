//! Jest, and vitest's `--reporter=json` which uses the same shape. Both print
//! one JSON document at the very end, so the parse happens on the whole
//! buffered output rather than line by line; the default reporter running
//! alongside is what keeps the UI alive meanwhile.

use serde_json::Value;

use super::{
    normalize_path, parse_stack_line, FailureLocation, TestCase, TestEvent, TestFailure, TestStatus,
};

/// Jest's per-assertion `status` field.
fn status_from(raw: &str) -> TestStatus {
    match raw {
        "passed" => TestStatus::Pass,
        "failed" => TestStatus::Fail,
        "todo" => TestStatus::Todo,
        _ => TestStatus::Skip,
    }
}

/// The `Expected: x / Received: y` pair jest and vitest print inside a failure.
fn extract_expectation(message: &str) -> (Option<String>, Option<String>) {
    let mut expected = None;
    let mut received = None;
    for line in message.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("Expected: ") {
            expected.get_or_insert_with(|| rest.trim().to_string());
        } else if let Some(rest) = trimmed.strip_prefix("Received: ") {
            received.get_or_insert_with(|| rest.trim().to_string());
        }
    }
    (expected, received)
}

/// The first in-project frame is where the user wants to land, not the first
/// frame overall - that one is usually inside the assertion library.
fn build_failure(messages: &[String]) -> Option<TestFailure> {
    if messages.is_empty() {
        return None;
    }
    let message = messages.join("\n");
    let stack: Vec<_> = message.lines().filter_map(parse_stack_line).collect();
    let location = stack
        .iter()
        .find(|frame| frame.in_project)
        .or_else(|| stack.first())
        .map(|frame| FailureLocation {
            file:   frame.file.clone(),
            line:   frame.line,
            column: frame.column,
        });
    let (expected, received) = extract_expectation(&message);
    Some(TestFailure { message, expected, received, stack, location })
}

fn strings(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items.iter().filter_map(|item| item.as_str().map(str::to_string)).collect()
        })
        .unwrap_or_default()
}

/// Parses the whole JSON report. An unparseable document yields nothing rather
/// than failing the run: the exit code still tells the user what happened.
pub fn parse_report(output: &str) -> Vec<TestEvent> {
    let Some(root) = find_json_object(output).and_then(|text| {
        serde_json::from_str::<Value>(&text).ok()
    }) else {
        return Vec::new();
    };

    let Some(suites) = root.get("testResults").and_then(Value::as_array) else {
        return Vec::new();
    };

    let mut events = Vec::new();
    for suite in suites {
        let file = suite
            .get("name")
            .or_else(|| suite.get("testFilePath"))
            .and_then(Value::as_str)
            .map(normalize_path)
            .unwrap_or_default();

        let assertions = suite.get("assertionResults").and_then(Value::as_array);
        // A suite that failed to load has a message but no assertion at all.
        if assertions.map(|list| list.is_empty()).unwrap_or(true) {
            if let Some(message) = suite.get("message").and_then(Value::as_str)
                && !message.trim().is_empty()
            {
                events.push(TestEvent::SuiteError {
                    file:    file.clone(),
                    message: message.to_string(),
                });
            }
            continue;
        }

        for assertion in assertions.unwrap_or(&Vec::new()) {
            let name = assertion.get("title").and_then(Value::as_str).unwrap_or_default();
            let ancestors = strings(assertion.get("ancestorTitles"));
            let status = status_from(
                assertion.get("status").and_then(Value::as_str).unwrap_or("pending"),
            );

            let mut case = TestCase::new(file.clone(), ancestors, name.to_string(), status);
            // vitest reports a float (0.6259ms), jest an integer; `as_u64` alone
            // would drop every fractional duration on the floor.
            case.duration_ms = assertion
                .get("duration")
                .and_then(Value::as_f64)
                .filter(|value| value.is_finite() && *value >= 0.0)
                .map(|value| value.round() as u64);
            case.line = assertion
                .get("location")
                .and_then(|loc| loc.get("line"))
                .and_then(Value::as_u64)
                .map(|line| line as u32);
            case.failure = build_failure(&strings(assertion.get("failureMessages")));
            events.push(TestEvent::Case(Box::new(case)));
        }
    }
    events
}

/// The report is preceded by whatever the default reporter wrote, so the JSON
/// has to be cut out: from the first `{` that opens an object holding
/// `testResults`, to its matching brace, ignoring braces inside strings.
fn find_json_object(output: &str) -> Option<String> {
    let bytes = output.as_bytes();
    for (start, _) in output.match_indices('{') {
        let mut depth = 0usize;
        let mut in_string = false;
        let mut escaped = false;
        for index in start..bytes.len() {
            let byte = bytes[index];
            if in_string {
                match byte {
                    _ if escaped => escaped = false,
                    b'\\' => escaped = true,
                    b'"' => in_string = false,
                    _ => {}
                }
                continue;
            }
            match byte {
                b'"' => in_string = true,
                b'{' => depth += 1,
                b'}' => {
                    depth -= 1;
                    if depth == 0 {
                        let candidate = &output[start..=index];
                        if candidate.contains("\"testResults\"") {
                            return Some(candidate.to_string());
                        }
                        break;
                    }
                }
                _ => {}
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    const REPORT: &str = r#"
 RUN  v1.0.0
{"numTotalTests":3,"testResults":[
 {"name":"/repo/src/auth/totp.test.ts","assertionResults":[
   {"title":"generates a token","ancestorTitles":["totp"],"status":"passed","duration":12,"location":{"line":10,"column":3},"failureMessages":[]},
   {"title":"rejects old tokens","ancestorTitles":["totp"],"status":"failed","duration":14,"location":{"line":47,"column":3},
    "failureMessages":["Error: expect(received).toBe(expected)\n\nExpected: false\nReceived: true\n    at /repo/node_modules/expect/build/index.js:1:1\n    at /repo/src/auth/totp.test.ts:51:19"]},
   {"title":"rate limits","ancestorTitles":[],"status":"pending","failureMessages":[]}
 ]}]}
"#;

    #[test]
    fn parses_cases_with_status_duration_and_line() {
        let events = parse_report(REPORT);
        assert_eq!(events.len(), 3);

        let TestEvent::Case(first) = &events[0] else { panic!("expected a case") };
        assert_eq!(first.name, "generates a token");
        assert_eq!(first.file, "/repo/src/auth/totp.test.ts");
        assert_eq!(first.status, TestStatus::Pass);
        assert_eq!(first.duration_ms, Some(12));
        assert_eq!(first.line, Some(10));
        assert_eq!(first.id, "/repo/src/auth/totp.test.ts::totp::generates a token");
    }

    #[test]
    fn a_failure_keeps_the_expectation_and_lands_on_project_code() {
        let events = parse_report(REPORT);
        let TestEvent::Case(failing) = &events[1] else { panic!("expected a case") };
        let failure = failing.failure.as_ref().expect("a failed case carries a failure");

        assert_eq!(failure.expected.as_deref(), Some("false"));
        assert_eq!(failure.received.as_deref(), Some("true"));
        assert_eq!(failure.stack.len(), 2);
        // The node_modules frame is skipped in favour of the test file.
        let location = failure.location.as_ref().unwrap();
        assert_eq!(location.file, "/repo/src/auth/totp.test.ts");
        assert_eq!(location.line, 51);
    }

    #[test]
    fn a_fractional_duration_is_kept() {
        // vitest writes durations as floats; they must not be dropped.
        let report = r#"{"testResults":[{"name":"a.test.js","assertionResults":[
            {"title":"quick","ancestorTitles":[],"status":"passed","duration":0.6259580000000042,"failureMessages":[]},
            {"title":"slow","ancestorTitles":[],"status":"passed","duration":901.729417,"failureMessages":[]},
            {"title":"todo","ancestorTitles":[],"status":"todo","failureMessages":[]}]}]}"#;
        let events = parse_report(report);
        let durations: Vec<_> = events
            .iter()
            .filter_map(|event| match event {
                TestEvent::Case(case) => Some(case.duration_ms),
                _ => None,
            })
            .collect();
        assert_eq!(durations, vec![Some(1), Some(902), None]);
    }

    #[test]
    fn a_pending_case_is_a_skip_without_failure() {
        let events = parse_report(REPORT);
        let TestEvent::Case(skipped) = &events[2] else { panic!("expected a case") };
        assert_eq!(skipped.status, TestStatus::Skip);
        assert!(skipped.failure.is_none());
    }

    #[test]
    fn a_suite_that_never_loaded_reports_its_error() {
        let report = r#"{"testResults":[{"name":"/repo/broken.test.ts","assertionResults":[],"message":"Cannot find module 'nope'"}]}"#;
        let events = parse_report(report);
        assert_eq!(events.len(), 1);
        let TestEvent::SuiteError { file, message } = &events[0] else {
            panic!("expected a suite error")
        };
        assert_eq!(file, "/repo/broken.test.ts");
        assert!(message.contains("Cannot find module"));
    }

    #[test]
    fn garbage_yields_nothing_rather_than_panicking() {
        assert!(parse_report("").is_empty());
        assert!(parse_report("not json at all").is_empty());
        assert!(parse_report("{\"testResults\": truncated").is_empty());
    }

    #[test]
    fn a_brace_inside_a_string_does_not_end_the_document() {
        let report = r#"prefix {"testResults":[{"name":"a{b}.ts","assertionResults":[{"title":"t","ancestorTitles":[],"status":"passed","failureMessages":[]}]}]}"#;
        let events = parse_report(report);
        assert_eq!(events.len(), 1);
    }
}

#[cfg(test)]
mod real_output {
    use super::*;
    use crate::commands::tests::sample;

    /// The JSON report is what corrects the streamed guesses, so it has to be
    /// read whole: every case plus the file that never loaded.
    #[test]
    fn parses_a_whole_report() {
        let events = parse_report(&sample::report());
        // Every test, plus one suite that failed to load.
        assert_eq!(events.len(), sample::TOTAL_CASES + 1);

        let errors = events
            .iter()
            .filter(|event| matches!(event, TestEvent::SuiteError { .. }))
            .count();
        assert_eq!(errors, 1);

        let cases: Vec<_> = events
            .iter()
            .filter_map(|event| match event {
                TestEvent::Case(case) => Some(case),
                _ => None,
            })
            .collect();
        // Fractional durations must survive, and a todo keeps none.
        assert!(cases.iter().any(|case| case.duration_ms == Some(1)));
        assert!(cases.iter().any(|case| case.duration_ms == Some(20002)));
        assert!(cases.iter().any(|case| case.duration_ms.is_none()));
    }
}
