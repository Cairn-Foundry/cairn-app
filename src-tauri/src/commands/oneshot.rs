//! Headless one-shot runs: one prompt in, one JSON object out, no conversation.
//!
//! Drafting a commit message, a merge request description or a review guide
//! needs the model for a single question - no session to resume, no permissions
//! to answer, nothing to show. It is deliberately not part of the Agent step,
//! which runs a CLI interactively in a PTY and reads none of its output.
//!
//! Every CLI here is one whose answer can be **forced** into a shape: it takes
//! the JSON schema as a flag and answers an object that validates against it.
//! A CLI that can only be asked nicely in its prompt is not in the table, since
//! a shape that is merely requested comes back as prose often enough to show up
//! as a silently empty commit message.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::Deserialize;
use serde_json::Value;
use tauri::Manager;

use crate::commands::cli_providers::{kill_tree, new_command, resolve_binary};

/// Where a CLI puts the object it was asked for.
#[derive(Clone, Copy, PartialEq)]
enum AnswerSource {
    /// A single JSON envelope on stdout, the object under `structured_output`.
    StructuredOutput,
    /// The file named by the output flag holds the final message, alone.
    LastMessageFile,
}

/// One CLI Cairn can ask a schema-constrained question of.
struct HeadlessCli {
    /// Matches `CliProviderId` on the TS side.
    id: &'static str,
    /// Looked up on PATH, then in the usual install locations.
    binary: &'static str,
    /// Arguments before the prompt, which is always pushed last.
    args: &'static [&'static str],
    /// How the schema is handed over; the value is the flag name.
    schema_flag: &'static str,
    /// Whether the schema flag takes the JSON inline or a path to a file.
    schema_is_file: bool,
    model_flag: &'static str,
    answer: AnswerSource,
    /// Whether the prompt goes on stdin rather than as the last argument.
    /// Linux caps one argument at 128 KB (`MAX_ARG_STRLEN`), and a branch diff
    /// goes past it - macOS, with a single 1 MB budget for the whole vector,
    /// never showed it.
    prompt_on_stdin: bool,
}

/// The CLIs whose answer can be forced into a shape.
///
/// Deliberately short. `gemini` has a documented headless mode and a clean JSON
/// envelope but no schema flag at all; `copilot`, `opencode` and `vibe` answer
/// in JSONL, where which event carries the final turn is a guess. Adding one is
/// an entry here plus its `AnswerSource`, once a real run has been seen.
const HEADLESS_CLIS: &[HeadlessCli] = &[
    HeadlessCli {
        id: "claude-code",
        binary: "claude",
        args: &["--output-format", "json", "-p"],
        schema_flag: "--json-schema",
        schema_is_file: false,
        model_flag: "--model",
        answer: AnswerSource::StructuredOutput,
        prompt_on_stdin: true,
    },
    // `--skip-git-repo-check` because an assist may run in a worktree Cairn
    // created before its first commit, where codex otherwise refuses to start.
    HeadlessCli {
        id: "codex",
        binary: "codex",
        args: &[
            "exec",
            "-s",
            "read-only",
            "--skip-git-repo-check",
            "--color",
            "never",
        ],
        schema_flag: "--output-schema",
        schema_is_file: true,
        model_flag: "--model",
        answer: AnswerSource::LastMessageFile,
        prompt_on_stdin: false,
    },
];

fn headless_cli(id: &str) -> Option<&'static HeadlessCli> {
    HEADLESS_CLIS.iter().find(|c| c.id == id)
}

/// The ids the frontend may offer, so the picker and the table never drift.
#[tauri::command]
pub fn list_oneshot_providers() -> Vec<String> {
    HEADLESS_CLIS.iter().map(|c| c.id.to_string()).collect()
}

/// One run in flight, so another call can cancel it.
pub struct RunningOneshot {
    child: Mutex<Option<std::process::Child>>,
    cancelled: AtomicBool,
}

type RunningChild = Arc<RunningOneshot>;

/// Every run in flight, keyed by the id the frontend minted for it.
#[derive(Default)]
pub struct OneshotState {
    running: Mutex<HashMap<String, RunningChild>>,
}

impl OneshotState {
    pub fn new() -> Self {
        Self::default()
    }
}

/// The answer the CLI produced, pulled out of whatever it wrapped it in.
///
/// Both sources hand back an object that already validated against the schema,
/// so nothing is scanned for a brace and no prose is stripped: a CLI that
/// answers something else answers nothing, which is reported rather than
/// guessed at.
fn read_answer(
    source: AnswerSource,
    stdout: &str,
    message_file: &Option<PathBuf>,
) -> Result<Value, String> {
    match source {
        AnswerSource::StructuredOutput => {
            let envelope: Value = serde_json::from_str(stdout.trim())
                .map_err(|_| "The CLI did not answer with JSON.".to_string())?;
            envelope
                .get("structured_output")
                .cloned()
                .filter(|v| !v.is_null())
                .ok_or_else(|| {
                    // `result` carries the CLI's own error text when it failed
                    // before the model ever answered.
                    let detail = envelope.get("result").and_then(Value::as_str).unwrap_or("");
                    if detail.is_empty() {
                        "The CLI answered without the requested structure.".to_string()
                    } else {
                        detail.to_string()
                    }
                })
        }
        AnswerSource::LastMessageFile => {
            let path = message_file
                .as_ref()
                .ok_or_else(|| "No output file for this run.".to_string())?;
            let text = std::fs::read_to_string(path)
                .map_err(|_| "The CLI wrote no answer.".to_string())?;
            serde_json::from_str(text.trim())
                .map_err(|_| "The CLI did not answer with JSON.".to_string())
        }
    }
}

/// Everything one headless run needs. It travels as one object so the command
/// signature stays readable as the options grow.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OneshotRequest {
    pub working_dir: String,
    pub prompt: String,
    pub schema: Value,
    pub run_id: String,
    /// Which CLI answers; empty falls back to Claude Code.
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub binary_path: Option<String>,
    #[serde(default)]
    pub env: Option<HashMap<String, String>>,
}

/// Runs the assigned CLI once in the working directory and returns the object
/// it answered with. Blocks for as long as the model takes, so the command is
/// `async` and Tauri keeps it off the UI thread.
#[tauri::command]
pub async fn run_oneshot(app: tauri::AppHandle, request: OneshotRequest) -> Result<Value, String> {
    let OneshotRequest {
        working_dir,
        prompt,
        schema,
        run_id,
        provider,
        model,
        binary_path,
        env,
    } = request;

    let requested = provider.unwrap_or_default();
    let id = if requested.is_empty() {
        "claude-code"
    } else {
        &requested
    };
    let cli = headless_cli(id).ok_or_else(|| {
        format!(
            "{id} cannot answer a structured question. Pick another provider in the Features page."
        )
    })?;
    let binary = resolve_binary(cli.binary, binary_path.as_deref()).ok_or_else(|| {
        format!(
            "{} not found. Install it or set its path in the provider settings.",
            cli.binary
        )
    })?;

    let handle: RunningChild = Arc::new(RunningOneshot {
        child: Mutex::new(None),
        cancelled: AtomicBool::new(false),
    });
    app.state::<OneshotState>()
        .running
        .lock()
        .map_err(|e| e.to_string())?
        .insert(run_id.clone(), handle.clone());

    let result = run_blocking(
        cli,
        &binary,
        &working_dir,
        &prompt,
        &schema,
        &run_id,
        model,
        env.unwrap_or_default(),
        &handle,
    );

    if let Ok(mut running) = app.state::<OneshotState>().running.lock() {
        running.remove(&run_id);
    }
    if handle.cancelled.load(Ordering::SeqCst) {
        return Err("cancelled".to_string());
    }
    result
}

/// A scratch file for one run, removed when the run ends whatever happened.
struct ScratchFile(PathBuf);

impl Drop for ScratchFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

fn write_scratch(run_id: &str, suffix: &str, contents: &str) -> Result<ScratchFile, String> {
    let path = std::env::temp_dir().join(format!("cairn-oneshot-{run_id}-{suffix}"));
    let mut file = std::fs::File::create(&path).map_err(|e| e.to_string())?;
    file.write_all(contents.as_bytes())
        .map_err(|e| e.to_string())?;
    Ok(ScratchFile(path))
}

#[allow(clippy::too_many_arguments)]
fn run_blocking(
    cli: &HeadlessCli,
    binary: &std::path::Path,
    working_dir: &str,
    prompt: &str,
    schema: &Value,
    run_id: &str,
    model: Option<String>,
    env: HashMap<String, String>,
    handle: &RunningChild,
) -> Result<Value, String> {
    let mut args: Vec<String> = cli.args.iter().map(|a| a.to_string()).collect();

    // Held for the whole run: dropping either file early would pull it from
    // under the CLI still reading or writing it.
    let schema_file = if cli.schema_is_file {
        Some(write_scratch(run_id, "schema.json", &schema.to_string())?)
    } else {
        None
    };
    args.push(cli.schema_flag.to_string());
    args.push(match &schema_file {
        Some(file) => file.0.to_string_lossy().into_owned(),
        None => schema.to_string(),
    });

    let message_file = if cli.answer == AnswerSource::LastMessageFile {
        let path = std::env::temp_dir().join(format!("cairn-oneshot-{run_id}-answer.json"));
        args.push("-o".to_string());
        args.push(path.to_string_lossy().into_owned());
        Some(ScratchFile(path))
    } else {
        None
    };

    if let Some(model) = model.filter(|m| !m.is_empty()) {
        args.push(cli.model_flag.to_string());
        args.push(model);
    }
    if !cli.prompt_on_stdin {
        args.push(prompt.to_string());
    }

    let mut cmd = new_command(binary);
    cmd.args(&args)
        .envs(&env)
        .current_dir(working_dir)
        // Closed unless the CLI is fed there: codex reads the prompt from stdin
        // when it believes none was passed, and would hang waiting on it.
        .stdin(if cli.prompt_on_stdin {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn {}: {e}", cli.binary))?;
    if cli.prompt_on_stdin && let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(prompt.as_bytes())
            .map_err(|e| format!("Failed to send the prompt to {}: {e}", cli.binary))?;
    }
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    *handle.child.lock().map_err(|e| e.to_string())? = Some(child);

    // The run may have been cancelled between registering and spawning.
    if handle.cancelled.load(Ordering::SeqCst)
        && let Ok(mut slot) = handle.child.lock()
        && let Some(mut c) = slot.take()
    {
        kill_tree(&mut c);
    }

    let stderr_thread = stderr.map(|mut err| {
        std::thread::spawn(move || {
            let mut buf = String::new();
            let _ = err.read_to_string(&mut buf);
            buf
        })
    });

    let mut output = String::new();
    if let Some(out) = stdout {
        for line in BufReader::new(out).lines() {
            let Ok(line) = line else { break };
            output.push_str(&line);
            output.push('\n');
        }
    }

    let status = handle
        .child
        .lock()
        .ok()
        .and_then(|mut slot| slot.take().and_then(|mut c| c.wait().ok()));
    let stderr_text = stderr_thread
        .and_then(|t| t.join().ok())
        .unwrap_or_default();

    if handle.cancelled.load(Ordering::SeqCst) {
        return Err("cancelled".to_string());
    }
    if let Some(status) = status
        && !status.success()
    {
        let detail = stderr_text.trim();
        return Err(if detail.is_empty() {
            format!("{} exited with {status}", cli.binary)
        } else {
            detail.to_string()
        });
    }

    read_answer(
        cli.answer,
        &output,
        &message_file.as_ref().map(|f| f.0.clone()),
    )
}

/// Cancels a run in flight. An unknown id is not an error: the run may have
/// finished on its own between the click and this call.
#[tauri::command]
pub async fn stop_oneshot(app: tauri::AppHandle, run_id: String) -> Result<(), String> {
    let handle = app
        .state::<OneshotState>()
        .running
        .lock()
        .map_err(|e| e.to_string())?
        .get(&run_id)
        .cloned();
    let Some(handle) = handle else { return Ok(()) };
    handle.cancelled.store(true, Ordering::SeqCst);
    if let Ok(mut slot) = handle.child.lock()
        && let Some(mut child) = slot.take()
    {
        kill_tree(&mut child);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn the_structured_field_is_the_answer() {
        let envelope = json!({
            "type": "result",
            "result": "{\"answer\":\"ignored\"}",
            "structured_output": { "subject": "feat: a", "body": "why" }
        })
        .to_string();
        assert_eq!(
            read_answer(AnswerSource::StructuredOutput, &envelope, &None),
            Ok(json!({ "subject": "feat: a", "body": "why" }))
        );
    }

    #[test]
    fn an_envelope_without_structure_reports_what_the_cli_said() {
        let envelope = json!({ "result": "Credit balance is too low" }).to_string();
        assert_eq!(
            read_answer(AnswerSource::StructuredOutput, &envelope, &None),
            Err("Credit balance is too low".to_string())
        );
    }

    #[test]
    fn a_null_structured_field_is_not_an_answer() {
        let envelope = json!({ "structured_output": null }).to_string();
        assert!(read_answer(AnswerSource::StructuredOutput, &envelope, &None).is_err());
    }

    #[test]
    fn output_that_is_not_json_yields_an_error() {
        assert!(read_answer(AnswerSource::StructuredOutput, "I cannot do that.", &None).is_err());
    }

    #[test]
    fn the_message_file_holds_the_answer() {
        let path = std::env::temp_dir().join("cairn-oneshot-test-answer.json");
        std::fs::write(&path, "{\"title\":\"t\",\"description\":\"d\"}\n").unwrap();
        let answer = read_answer(AnswerSource::LastMessageFile, "", &Some(path.clone()));
        let _ = std::fs::remove_file(&path);
        assert_eq!(answer, Ok(json!({ "title": "t", "description": "d" })));
    }

    #[test]
    fn a_missing_message_file_is_reported() {
        let path = std::env::temp_dir().join("cairn-oneshot-absent.json");
        let _ = std::fs::remove_file(&path);
        assert!(read_answer(AnswerSource::LastMessageFile, "", &Some(path)).is_err());
    }

    #[test]
    fn only_the_forceable_clis_are_offered() {
        assert!(headless_cli("claude-code").is_some());
        assert!(headless_cli("codex").is_some());
        // Documented headless mode, no schema flag: not offered.
        assert!(headless_cli("gemini").is_none());
        // JSONL, final turn unidentified: not offered.
        assert!(headless_cli("opencode").is_none());
    }

    #[test]
    fn the_scratch_file_is_removed_with_its_guard() {
        let path = {
            let file = write_scratch("test-run", "schema.json", "{}").unwrap();
            assert!(file.0.exists());
            file.0.clone()
        };
        assert!(!path.exists());
    }
}
