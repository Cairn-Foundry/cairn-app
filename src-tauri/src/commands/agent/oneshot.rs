//! Headless one-shot runs: one prompt in, one JSON object out, no conversation.
//!
//! The review guide and the comment drafts need the model without any of the
//! agent step's machinery - no session to resume, no permissions to answer, no
//! transcript. This asks the CLI a single question and parses its answer
//! against a schema. Runs register in the same `running` map as an ordinary
//! send, so `stop_agent(runId)` cancels a generation the same way.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::Deserialize;
use serde_json::Value;
use tauri::Manager;

use super::{emit_agent_data, platform, AgentState, RunningAgent, RunningChild};

/// The first balanced JSON object in the text, honouring strings and escapes so
/// a brace inside a string literal does not end the scan. The CLI is asked for
/// bare JSON but a model will wrap it in prose or a ```json fence often enough
/// that trusting the whole output would break the feature at random.
pub fn extract_json(text: &str) -> Option<Value> {
    let bytes = text.as_bytes();
    let start = text.find('{')?;
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;
    for index in start..bytes.len() {
        let byte = bytes[index];
        if in_string {
            if escaped {
                escaped = false;
            } else if byte == b'\\' {
                escaped = true;
            } else if byte == b'"' {
                in_string = false;
            }
            continue;
        }
        match byte {
            b'"' => in_string = true,
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return serde_json::from_str(&text[start..=index]).ok();
                }
            }
            _ => {}
        }
    }
    None
}

/// The CLI's own envelope when it is asked for `--output-format json`: the
/// answer sits in `result`. Anything else is treated as the answer itself, so
/// a plain JSON reply works too.
fn unwrap_cli_envelope(value: Value) -> Value {
    match value.get("result").and_then(Value::as_str) {
        Some(result) => extract_json(result).unwrap_or(value),
        None => value,
    }
}

/// The prompt handed to the CLI: the question, then the shape the answer has to
/// take. The schema travels in the prompt rather than as a flag because the
/// installed CLI version may not accept one, and a prompt-carried schema costs
/// nothing when it does.
fn prompt_with_schema(prompt: &str, schema: &Value) -> String {
    format!(
        "{prompt}\n\nAnswer with a single JSON object and nothing else - no prose, no code fence. \
It must validate against this JSON schema:\n\n{schema}"
    )
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
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub binary_path: Option<String>,
    #[serde(default)]
    pub env: Option<HashMap<String, String>>,
}

/// Runs `claude -p` once in the working directory and returns the JSON object it
/// answered with. Blocks for as long as the model takes, so the command is
/// `async` and Tauri keeps it off the UI thread.
#[tauri::command]
pub async fn run_oneshot(
    app: tauri::AppHandle,
    request: OneshotRequest,
) -> Result<Value, String> {
    let OneshotRequest { working_dir, prompt, schema, run_id, model, binary_path, env } = request;
    let binary = platform::resolve_binary("claude", binary_path.as_deref())
        .ok_or("Claude Code CLI not found. Install it or set its path in the provider settings.")?;

    let handle: RunningChild = Arc::new(RunningAgent {
        child: Mutex::new(None),
        stdin: Mutex::new(None),
        cancelled: AtomicBool::new(false),
    });
    app.state::<AgentState>()
        .running
        .lock()
        .map_err(|e| e.to_string())?
        .insert(run_id.clone(), handle.clone());

    let result = run_blocking(&app, &binary, &working_dir, &prompt, &schema, &run_id, model, env.unwrap_or_default(), &handle);

    if let Ok(mut running) = app.state::<AgentState>().running.lock() {
        running.remove(&run_id);
    }
    if handle.cancelled.load(Ordering::SeqCst) {
        return Err("cancelled".to_string());
    }
    result
}

#[allow(clippy::too_many_arguments)]
fn run_blocking(
    app: &tauri::AppHandle,
    binary: &std::path::Path,
    working_dir: &str,
    prompt: &str,
    schema: &Value,
    run_id: &str,
    model: Option<String>,
    env: HashMap<String, String>,
    handle: &RunningChild,
) -> Result<Value, String> {
    let mut args: Vec<String> = vec![
        "-p".into(),
        prompt_with_schema(prompt, schema),
        "--output-format".into(),
        "json".into(),
    ];
    if let Some(model) = model.filter(|m| !m.is_empty()) {
        args.push("--model".into());
        args.push(model);
    }

    let mut cmd = platform::new_command(binary);
    cmd.args(&args)
        .envs(&env)
        .current_dir(working_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn claude: {e}"))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    *handle.child.lock().map_err(|e| e.to_string())? = Some(child);

    // The run may have been cancelled between registering and spawning.
    if handle.cancelled.load(Ordering::SeqCst)
        && let Ok(mut slot) = handle.child.lock()
        && let Some(mut c) = slot.take()
    {
        platform::kill_tree(&mut c);
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
            // Nothing useful streams out of a one-shot, but the view still has
            // to show that something is happening rather than a frozen spinner.
            emit_agent_data(
                app,
                "oneshot-progress",
                serde_json::json!({ "bytes": output.len() }),
                Some(working_dir.to_string()),
                Some(run_id.to_string()),
            );
        }
    }

    let status = handle
        .child
        .lock()
        .ok()
        .and_then(|mut slot| slot.take().and_then(|mut c| c.wait().ok()));
    let stderr_text = stderr_thread.and_then(|t| t.join().ok()).unwrap_or_default();

    if handle.cancelled.load(Ordering::SeqCst) {
        return Err("cancelled".to_string());
    }
    if let Some(status) = status
        && !status.success()
    {
        let detail = stderr_text.trim();
        return Err(if detail.is_empty() {
            format!("claude exited with {status}")
        } else {
            detail.to_string()
        });
    }

    extract_json(&output)
        .map(unwrap_cli_envelope)
        .ok_or_else(|| "The model did not answer with JSON.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_bare_object_is_read_as_is() {
        assert_eq!(extract_json(r#"{"a": 1}"#), Some(json!({ "a": 1 })));
    }

    #[test]
    fn an_object_wrapped_in_prose_is_still_found() {
        let text = "Here you go:\n```json\n{\"a\": 1}\n```\nHope that helps.";
        assert_eq!(extract_json(text), Some(json!({ "a": 1 })));
    }

    #[test]
    fn a_brace_inside_a_string_does_not_end_the_object() {
        let text = r#"{"a": "} not the end", "b": 2}"#;
        assert_eq!(extract_json(text), Some(json!({ "a": "} not the end", "b": 2 })));
    }

    #[test]
    fn an_escaped_quote_does_not_end_the_string() {
        let text = r#"{"a": "say \"hi\" }", "b": 2}"#;
        assert_eq!(extract_json(text), Some(json!({ "a": "say \"hi\" }", "b": 2 })));
    }

    #[test]
    fn a_nested_object_is_returned_whole() {
        let text = "prefix {\"a\": {\"b\": [1, 2]}} suffix";
        assert_eq!(extract_json(text), Some(json!({ "a": { "b": [1, 2] } })));
    }

    #[test]
    fn output_that_is_not_json_yields_nothing() {
        assert_eq!(extract_json("I cannot do that."), None);
        assert_eq!(extract_json("{ not json at all"), None);
    }

    #[test]
    fn the_cli_envelope_is_unwrapped_to_the_answer() {
        let envelope = json!({ "type": "result", "result": "{\"overview\": \"ok\"}" });
        assert_eq!(unwrap_cli_envelope(envelope), json!({ "overview": "ok" }));
    }

    #[test]
    fn an_answer_that_is_already_bare_survives_unwrapping() {
        let bare = json!({ "overview": "ok", "chapters": [] });
        assert_eq!(unwrap_cli_envelope(bare.clone()), bare);
    }

    #[test]
    fn the_schema_travels_with_the_prompt() {
        let prompt = prompt_with_schema("Describe the diff.", &json!({ "type": "object" }));
        assert!(prompt.starts_with("Describe the diff."));
        assert!(prompt.contains("\"type\":\"object\""));
    }
}
