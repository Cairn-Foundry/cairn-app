//! Running a project's test suite in a worktree and streaming what comes back.
//!
//! The command is composed by the frontend, which alone knows the package
//! manager and the detected script; Rust receives it plus the `runner_id` that
//! says which adapter parses its output. Every run is keyed by a `run_id` minted
//! by the frontend, so two instances can test at once and `stop_tests` kills
//! exactly one of them.

pub mod runners;
#[cfg(test)]
pub mod sample;
pub mod state;

use std::collections::HashMap;
use std::io::Read;
use std::path::Path;
use std::process::{Child, ChildStderr, ChildStdout};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{Emitter, Manager};

use self::runners::{TestCase, TestEvent};
use crate::commands::lsp::strip_ansi;
use crate::commands::toolchain::{resolve_binary, spawn_shell_full};

/// Keeps the whole output for the final parse, bounded so a runner that prints
/// a progress bar for an hour cannot grow it without end.
const OUTPUT_MAX_BYTES: usize = 4 * 1024 * 1024;

/// stdout and stderr read the same way but are different types.
enum Either {
    Out(ChildStdout),
    Err(ChildStderr),
}

struct RunningTest {
    child:     Mutex<Option<Child>>,
    cancelled: AtomicBool,
}

/// Every test run in flight, keyed by the frontend's run id.
#[derive(Default)]
pub struct TestState {
    running: Mutex<HashMap<String, Arc<RunningTest>>>,
}

impl TestState {
    pub fn new() -> Self {
        Self::default()
    }
}

/// One `test-output` event. `run_id` is what routes it to the right instance,
/// never "whatever is on screen".
#[derive(Clone, Serialize)]
struct TestOutputEvent {
    #[serde(rename = "runId")]
    run_id:    String,
    kind:      String,
    #[serde(skip_serializing_if = "Option::is_none")]
    case:      Option<TestCase>,
    #[serde(skip_serializing_if = "Option::is_none")]
    file:      Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message:   Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    line:      Option<String>,
    #[serde(rename = "exitCode", skip_serializing_if = "Option::is_none")]
    exit_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cancelled: Option<bool>,
}

impl TestOutputEvent {
    fn new(run_id: &str, kind: &str) -> Self {
        Self {
            run_id:    run_id.to_string(),
            kind:      kind.to_string(),
            case:      None,
            file:      None,
            message:   None,
            line:      None,
            exit_code: None,
            cancelled: None,
        }
    }
}

/// Reads a pipe and hands back one line at a time. Splits on carriage returns
/// as well as newlines, so a reporter rewriting its progress line still reports,
/// and CRLF output from Windows parses the same as LF.
fn pump_lines(stream: impl Read, mut on_line: impl FnMut(String)) {
    let mut reader = std::io::BufReader::new(stream);
    let mut pending: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 4096];
    let flush = |pending: &mut Vec<u8>, on_line: &mut dyn FnMut(String)| {
        // Runners colour their output, and a mark wrapped in an escape sequence
        // matches nothing. Stripping is what makes the streamed lines parseable.
        let line = strip_ansi(String::from_utf8_lossy(pending).trim_end());
        pending.clear();
        if !line.trim().is_empty() {
            on_line(line);
        }
    };
    loop {
        match reader.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(read) => {
                for byte in &chunk[..read] {
                    match byte {
                        b'\n' | b'\r' => flush(&mut pending, &mut on_line),
                        _ => pending.push(*byte),
                    }
                }
            }
        }
    }
    flush(&mut pending, &mut on_line);
}

/// Applies the adapter that matches `runner_id` to one line, for the runners
/// that stream. The others answer at the end, from `parse_final`.
fn parse_streaming_line(
    runner_id: &str,
    line: &str,
    go: &mut runners::go::GoParser,
) -> Option<TestEvent> {
    match runner_id {
        "vitest" => runners::vitest::parse_line(line),
        "nextest" => runners::cargo::parse_nextest_line(line),
        "cargo" => runners::cargo::parse_text_line(line),
        "pytest" => runners::pytest::parse_line(line),
        "go" => go.parse_line(line),
        _ => None,
    }
}

/// The end-of-run parse, for the runners that only speak once they are done.
/// Its cases overwrite whatever the streaming pass guessed.
fn parse_final(runner_id: &str, output: &str) -> Vec<TestEvent> {
    match runner_id {
        "vitest" | "jest" => runners::jest::parse_report(output),
        _ => Vec::new(),
    }
}

/// Emits one event, with every path made relative to the run's directory.
///
/// Both reporters have to agree on how a file is spelled: the streaming one
/// names it relative to the worktree, the final JSON report names it
/// absolutely. Left alone, the same test arrives under two ids and the tree
/// shows it twice once the run finishes.
fn emit_event(app: &tauri::AppHandle, run_id: &str, root: &str, event: TestEvent) {
    let payload = match event {
        TestEvent::Case(mut case) => {
            case.file = runners::relative_to(&case.file, root);
            case.id = runners::TestCase::build_id(&case.file, &case.ancestors, &case.name);
            if let Some(failure) = case.failure.as_mut() {
                if let Some(location) = failure.location.as_mut() {
                    location.file = runners::relative_to(&location.file, root);
                }
                for frame in failure.stack.iter_mut() {
                    frame.file = runners::relative_to(&frame.file, root);
                }
            }
            let mut payload = TestOutputEvent::new(run_id, "case");
            payload.case = Some(*case);
            payload
        }
        TestEvent::SuiteError { file, message } => {
            let mut payload = TestOutputEvent::new(run_id, "suite_error");
            payload.file = Some(runners::relative_to(&file, root));
            payload.message = Some(message);
            payload
        }
    };
    let _ = app.emit("test-output", payload);
}

/// True when `cargo nextest` can be run, which decides whether the frontend
/// offers nextest or plain `cargo test`.
#[tauri::command]
pub async fn has_cargo_nextest(worktree_path: String) -> bool {
    let root = Path::new(&worktree_path);
    resolve_binary("cargo-nextest", Some(root)).is_some()
}

/// Runs `command` in `worktree_path` and streams the result.
///
/// The whole body goes through `spawn_blocking`: reading a child's pipes to the
/// end is blocking work, and leaving it on an async worker holds that worker for
/// the entire run. That starves everything else the runtime has to do - the
/// `test-output` events never reach the frontend until the process exits, and
/// `stop_tests` cannot even start, so the run looks unstoppable and unstreamed.
#[tauri::command]
pub async fn run_tests(
    app: tauri::AppHandle,
    run_id: String,
    worktree_path: String,
    command: String,
    runner_id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_tests_blocking(app, run_id, worktree_path, command, runner_id)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn run_tests_blocking(
    app: tauri::AppHandle,
    run_id: String,
    worktree_path: String,
    command: String,
    runner_id: String,
) -> Result<(), String> {
    let cwd = Path::new(&worktree_path).to_path_buf();
    let mut child = spawn_shell_full(&command, Some(&cwd), true)
        .map_err(|e| format!("failed to start the tests: {e}"))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let running = Arc::new(RunningTest {
        child:     Mutex::new(Some(child)),
        cancelled: AtomicBool::new(false),
    });
    app.state::<TestState>()
        .running
        .lock()
        .map_err(|e| e.to_string())?
        .insert(run_id.clone(), Arc::clone(&running));

    let _ = app.emit("test-output", {
        let mut start = TestOutputEvent::new(&run_id, "run_start");
        start.message = Some(command.clone());
        start
    });

    let collected = Arc::new(Mutex::new(String::new()));
    let go = Arc::new(Mutex::new(runners::go::GoParser::new()));

    let readers: Vec<_> = [stdout.map(Either::Out), stderr.map(Either::Err)]
        .into_iter()
        .flatten()
        .map(|stream| {
            let app = app.clone();
            let run_id = run_id.clone();
            let runner_id = runner_id.clone();
            let collected = Arc::clone(&collected);
            let go = Arc::clone(&go);
            let root = worktree_path.clone();
            std::thread::spawn(move || {
                let on_line = |line: String| {
                    if let Ok(mut buffer) = collected.lock()
                        && buffer.len() + line.len() < OUTPUT_MAX_BYTES
                    {
                        buffer.push_str(&line);
                        buffer.push('\n');
                    }

                    let parsed = go
                        .lock()
                        .ok()
                        .and_then(|mut go| parse_streaming_line(&runner_id, &line, &mut go));
                    if let Some(event) = parsed {
                        emit_event(&app, &run_id, &root, event);
                    }

                    let mut raw = TestOutputEvent::new(&run_id, "raw");
                    raw.line = Some(line);
                    let _ = app.emit("test-output", raw);
                };
                match stream {
                    Either::Out(out) => pump_lines(out, on_line),
                    Either::Err(err) => pump_lines(err, on_line),
                }
            })
        })
        .collect();

    for reader in readers {
        let _ = reader.join();
    }

    let status = running
        .child
        .lock()
        .map_err(|e| e.to_string())?
        .take()
        .map(|mut child| child.wait());
    app.state::<TestState>()
        .running
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&run_id);

    let was_cancelled = running.cancelled.load(Ordering::SeqCst);
    if !was_cancelled {
        let output = collected.lock().map(|buffer| buffer.clone()).unwrap_or_default();
        for event in parse_final(&runner_id, &output) {
            emit_event(&app, &run_id, &worktree_path, event);
        }
    }

    let exit_code = match status {
        Some(Ok(status)) => status.code(),
        Some(Err(e)) => {
            let mut error = TestOutputEvent::new(&run_id, "error");
            error.message = Some(e.to_string());
            let _ = app.emit("test-output", error);
            None
        }
        None => None,
    };

    let mut end = TestOutputEvent::new(&run_id, "run_end");
    end.exit_code = exit_code;
    end.cancelled = Some(was_cancelled);
    let _ = app.emit("test-output", end);
    Ok(())
}

/// Stops one run. A suite that turned out to be the wrong one has to be
/// abandonable without waiting it out. Killing the child is the only thing that
/// ends `run_tests`: its reader threads sit on the pipes until they close.
#[tauri::command]
pub async fn stop_tests(app: tauri::AppHandle, run_id: String) -> Result<(), String> {
    let running = app
        .state::<TestState>()
        .running
        .lock()
        .map_err(|e| e.to_string())?
        .get(&run_id)
        .map(Arc::clone);

    if let Some(running) = running {
        running.cancelled.store(true, Ordering::SeqCst);
        if let Ok(mut slot) = running.child.lock()
            && let Some(child) = slot.as_mut()
        {
            // The shell is only the parent: the runner it launched is what has
            // to die, or the pipes stay open and the run never ends.
            crate::commands::agent::platform::kill_tree(child);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crlf_and_lf_split_the_same_way() {
        let mut lines = Vec::new();
        pump_lines("a\r\nb\nc".as_bytes(), |line| lines.push(line));
        assert_eq!(lines, vec!["a", "b", "c"]);
    }

    #[test]
    fn blank_lines_are_dropped() {
        let mut lines = Vec::new();
        pump_lines("a\n\n\n   \nb".as_bytes(), |line| lines.push(line));
        assert_eq!(lines, vec!["a", "b"]);
    }

    #[test]
    fn a_line_without_a_trailing_newline_is_still_emitted() {
        let mut lines = Vec::new();
        pump_lines("only".as_bytes(), |line| lines.push(line));
        assert_eq!(lines, vec!["only"]);
    }

    #[test]
    fn an_unknown_runner_parses_nothing_rather_than_guessing() {
        let mut go = runners::go::GoParser::new();
        assert!(parse_streaming_line("unknown", "test a ... ok", &mut go).is_none());
        assert!(parse_final("unknown", "{}").is_empty());
    }
}

#[cfg(all(test, unix))]
mod kill_tests {
    use super::*;

    /// The whole point of the process group: a shell running a long child must
    /// take that child down with it, or `Stop` leaves the runner alive.
    #[test]
    fn killing_the_group_stops_the_grandchild() {
        let mut child = spawn_shell_full("sleep 30", None, true).expect("spawn");
        let pid = child.id();
        assert!(pid > 0);

        crate::commands::agent::platform::kill_tree(&mut child);
        let status = child.wait().expect("the child must be reapable");
        assert!(!status.success(), "a killed run does not exit cleanly");
    }

    /// Without the group flag the call must still work, so existing callers of
    /// the plain spawn keep their behaviour.
    #[test]
    fn a_plain_spawn_still_runs_and_exits() {
        let child = spawn_shell_full("exit 0", None, false).expect("spawn");
        let out = child.wait_with_output().expect("output");
        assert!(out.status.success());
    }
}

#[cfg(all(test, unix))]
mod streaming_tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    /// The transport, without Tauri: a shell that prints, pauses, then prints
    /// again must hand the first lines over well before it exits. If this ever
    /// buffers to the end, the Tests step stops streaming.
    #[test]
    fn lines_arrive_while_the_process_is_still_running() {
        let mut child = spawn_shell_full(
            "echo first; echo second; sleep 2; echo third",
            None,
            true,
        )
        .expect("spawn");
        let stdout = child.stdout.take().expect("stdout");

        let started = Instant::now();
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            pump_lines(stdout, |line| {
                let _ = tx.send((line, started.elapsed()));
            });
        });

        let (first, at_first) = rx.recv_timeout(Duration::from_secs(5)).expect("first line");
        assert_eq!(first, "first");
        assert!(
            at_first < Duration::from_secs(1),
            "the first line waited {at_first:?}, so output is buffered to the end"
        );

        let (_, _) = rx.recv_timeout(Duration::from_secs(5)).expect("second line");
        let (third, at_third) = rx.recv_timeout(Duration::from_secs(5)).expect("third line");
        assert_eq!(third, "third");
        assert!(at_third >= Duration::from_secs(2), "the pause must be observed");

        let _ = child.wait();
    }
}

#[cfg(test)]
mod ansi_tests {
    use super::*;

    /// Runners colour their output. Every unit test here used to feed the parser
    /// clean strings, so an escape sequence sitting between the mark and the
    /// path went unnoticed and nothing streamed at all.
    #[test]
    fn a_coloured_result_line_still_parses() {
        let coloured = "\u{1b}[32m\u{2713}\u{1b}[39m src/cart.test.js > subtotal > sums the lines \u{1b}[2m1ms\u{1b}[22m";
        let cleaned = strip_ansi(coloured);
        let mut go = runners::go::GoParser::new();
        let event = parse_streaming_line("vitest", &cleaned, &mut go);

        match event {
            Some(TestEvent::Case(case)) => {
                assert_eq!(case.file, "src/cart.test.js");
                assert_eq!(case.name, "sums the lines");
                assert_eq!(case.duration_ms, Some(1));
            }
            _ => panic!("a coloured line must still be read as a case"),
        }
    }

    #[test]
    fn pump_lines_strips_colour_before_handing_a_line_over() {
        let mut seen = Vec::new();
        pump_lines("\u{1b}[32mgreen\u{1b}[0m\n".as_bytes(), |line| seen.push(line));
        assert_eq!(seen, vec!["green"]);
    }
}

#[cfg(test)]
mod streaming_shape {
    use super::*;

    /// The coloured `verbose` lines must all be read. This is the guard that
    /// caught the ANSI bug: an escape sequence between the mark and the path
    /// used to make every line unparseable, so nothing streamed.
    #[test]
    fn every_streamed_line_is_read() {
        let mut go = runners::go::GoParser::new();
        let cases: Vec<_> = sample::stream()
            .lines()
            .map(strip_ansi)
            .filter_map(|line| parse_streaming_line("vitest", &line, &mut go))
            .filter_map(|event| match event {
                TestEvent::Case(case) => Some(case),
                _ => None,
            })
            .collect();

        assert_eq!(cases.len(), sample::TOTAL_CASES);
        assert!(cases.iter().any(|case| case.duration_ms == Some(20001)));
        assert!(cases.iter().all(|case| case.file.ends_with(".test.js")));
    }
}

#[cfg(test)]
mod dedup_tests {
    use super::*;
    use runners::{relative_to, TestCase};

    /// The bug this guards: the streaming reporter spells a file relative to the
    /// worktree, the final JSON report spells it absolutely. Two spellings mean
    /// two ids, and the finished run shows every test twice.
    #[test]
    fn both_reporters_agree_on_one_id() {
        let root = "/Users/me/demo";
        let ancestors = vec!["subtotal".to_string()];
        let name = "sums the lines";

        let streamed = relative_to("src/cart.test.js", root);
        let reported = relative_to("/Users/me/demo/src/cart.test.js", root);
        assert_eq!(streamed, reported, "the two spellings must collapse");

        assert_eq!(
            TestCase::build_id(&streamed, &ancestors, name),
            TestCase::build_id(&reported, &ancestors, name),
        );
    }

    #[test]
    fn a_run_from_a_subdirectory_still_agrees() {
        let root = "/Users/me/demo/packages/api";
        assert_eq!(
            relative_to("/Users/me/demo/packages/api/test/a.test.js", root),
            relative_to("test/a.test.js", root),
        );
    }
}

#[cfg(test)]
mod no_duplicates {
    use super::*;
    use std::collections::HashSet;

    /// Streaming names a file relative to the worktree, the final report names
    /// it absolutely. Without normalising, the same test lands under two ids and
    /// every row is doubled once the run finishes.
    #[test]
    fn the_final_report_lands_on_the_ids_the_stream_created() {
        let run = sample::whole_run();
        let cleaned: Vec<String> = run.lines().map(strip_ansi).collect();

        let mut ids: HashSet<String> = HashSet::new();
        let mut go = runners::go::GoParser::new();
        for line in &cleaned {
            if let Some(TestEvent::Case(mut case)) = parse_streaming_line("vitest", line, &mut go) {
                case.file = runners::relative_to(&case.file, sample::ROOT);
                ids.insert(runners::TestCase::build_id(&case.file, &case.ancestors, &case.name));
            }
        }
        let streamed = ids.len();
        assert_eq!(streamed, sample::TOTAL_CASES);

        for event in parse_final("vitest", &cleaned.join("\n")) {
            if let TestEvent::Case(mut case) = event {
                case.file = runners::relative_to(&case.file, sample::ROOT);
                ids.insert(runners::TestCase::build_id(&case.file, &case.ancestors, &case.name));
            }
        }
        assert_eq!(ids.len(), streamed, "the report must not create new ids");
    }
}
