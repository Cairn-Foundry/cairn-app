//! What every CLI-driven provider needs and Claude Code does not do alone.
//!
//! Claude Code is the one agent Cairn talks to through stdin (its control
//! protocol answers permission prompts that way); the others take the prompt as
//! an argument and only ever write to stdout. `run_cli` is that shape: spawn,
//! stream stdout line by line, keep stderr for the error message, and register
//! the child on the shared handle so `stop_agent` kills the whole tree.

use std::io::{BufRead, BufReader, Read};
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::Ordering;

use serde_json::Value;

use super::super::{platform, HistoryMessage, RunningChild, SendRequest};

pub fn run_cli<F>(
    binary: &Path,
    args: &[String],
    extra_env: &[(&str, String)],
    request: &SendRequest,
    handle: &RunningChild,
    mut on_line: F,
) -> Result<(), String>
where
    F: FnMut(&str),
{
    let name = binary
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("agent")
        .to_string();

    let mut cmd = platform::new_command(binary);
    cmd.args(args)
        .envs(request.env)
        .current_dir(request.working_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (key, value) in extra_env {
        cmd.env(key, value);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn {name}: {e}"))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    *handle.child.lock().map_err(|e| e.to_string())? = Some(child);

    if handle.cancelled.load(Ordering::SeqCst) {
        if let Ok(mut slot) = handle.child.lock() {
            if let Some(mut c) = slot.take() {
                platform::kill_tree(&mut c);
            }
        }
    }

    let stderr_thread = stderr.map(|mut err| {
        std::thread::spawn(move || {
            let mut buf = String::new();
            let _ = err.read_to_string(&mut buf);
            buf
        })
    });

    if let Some(out) = stdout {
        for line in BufReader::new(out).lines() {
            let Ok(line) = line else { break };
            if line.trim().is_empty() {
                continue;
            }
            on_line(&line);
        }
    }

    let status = handle
        .child
        .lock()
        .ok()
        .and_then(|mut slot| slot.take().and_then(|mut c| c.wait().ok()));
    let stderr_text = stderr_thread.and_then(|t| t.join().ok()).unwrap_or_default();

    if let Some(status) = status {
        if !status.success() && !handle.cancelled.load(Ordering::SeqCst) {
            let detail = stderr_text.trim();
            let message = if detail.is_empty() {
                format!("{name} exited with {status}")
            } else {
                detail.to_string()
            };
            return Err(message);
        }
    }

    Ok(())
}

/// A tool call as one readable line: the tool, then the one argument that says
/// what it acted on. The keys are tried in the order the agents name them.
pub fn tool_label(name: &str, input: Option<&Value>) -> String {
    let arg = input.and_then(|i| {
        i.get("file_path")
            .or_else(|| i.get("path"))
            .or_else(|| i.get("command"))
            .or_else(|| i.get("pattern"))
            .or_else(|| i.get("query"))
            .or_else(|| i.get("url"))
            .or_else(|| i.get("description"))
            .and_then(Value::as_str)
    });
    match arg {
        Some(a) => format!("{name}: {a}"),
        None => name.to_string(),
    }
}

/// The prompt handed to an agent that cannot resume its own session: the turns
/// already exchanged, then the new message. Without it every question would be
/// asked to an agent that has never heard of the conversation it is in.
pub fn with_transcript(history: &[HistoryMessage], message: &str) -> String {
    if history.is_empty() {
        return message.to_string();
    }
    let mut out = String::from(
        "Here is the conversation so far. Continue it; answer only the last message.\n\n",
    );
    for turn in history {
        let who = if turn.role == "agent" || turn.role == "assistant" {
            "Assistant"
        } else {
            "User"
        };
        out.push_str(&format!("{who}: {}\n\n", turn.content));
    }
    out.push_str(&format!("User: {message}"));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_tool_is_labelled_with_what_it_acted_on() {
        assert_eq!(
            tool_label("Bash", Some(&json!({ "command": "ls -la" }))),
            "Bash: ls -la",
        );
        assert_eq!(tool_label("Bash", None), "Bash");
        assert_eq!(tool_label("Bash", Some(&json!({ "timeout": 30 }))), "Bash");
    }

    #[test]
    fn a_first_message_travels_alone() {
        assert_eq!(with_transcript(&[], "hello"), "hello");
    }

    #[test]
    fn a_stateless_agent_is_handed_the_turns_it_missed() {
        let history = vec![
            HistoryMessage { role: "user".into(), content: "hi".into() },
            HistoryMessage { role: "agent".into(), content: "hello".into() },
        ];
        let prompt = with_transcript(&history, "and now?");

        assert!(prompt.contains("User: hi"));
        assert!(prompt.contains("Assistant: hello"));
        assert!(prompt.ends_with("User: and now?"));
    }
}
