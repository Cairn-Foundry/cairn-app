use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::atomic::Ordering;
use serde::Deserialize;
use super::super::{AgentProvider, AgentResponse, RunningChild};

#[derive(Deserialize)]
struct StructuredReply {
    content: String,
    summary: String,
}

const FORMAT_INSTRUCTION: &str = "\
Respond with a JSON object only - no markdown code block, no text outside the JSON. \
The object must have exactly two fields:\n\
- \"content\": your full response in markdown\n\
- \"summary\": one sentence (max 12 words) summarising what you did or answered\n\n\
User message:\n";

pub struct ClaudeCliProvider;

impl AgentProvider for ClaudeCliProvider {
    fn send(
        &self,
        message: &str,
        working_dir: &str,
        session_id: Option<&str>,
        handle: &RunningChild,
    ) -> Result<AgentResponse, String> {
        let prompt = format!("{FORMAT_INSTRUCTION}{message}");

        let mut args: Vec<String> = vec![
            "-p".into(),
            prompt,
            "--output-format".into(),
            "json".into(),
        ];
        if let Some(id) = session_id {
            args.push("--resume".into());
            args.push(id.to_string());
        }

        let mut child = Command::new("claude")
            .args(&args)
            .current_dir(working_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed to spawn claude: {e}"))?;

        // Hand the pipe over before registering the child so stop_agent can kill
        // it while we block on reading its output.
        let stdout = child.stdout.take();
        *handle.child.lock().map_err(|e| e.to_string())? = Some(child);

        // A stop that arrived before the process was registered: kill it now.
        if handle.cancelled.load(Ordering::SeqCst) {
            if let Ok(mut slot) = handle.child.lock() {
                if let Some(mut c) = slot.take() { let _ = c.kill(); }
            }
        }

        let mut raw = String::new();
        if let Some(mut out) = stdout {
            out.read_to_string(&mut raw).map_err(|e| e.to_string())?;
        }

        // Reap the child so it doesn't linger as a zombie.
        if let Ok(mut slot) = handle.child.lock() {
            if let Some(mut c) = slot.take() { let _ = c.wait(); }
        }

        let cli_json = serde_json::from_str::<serde_json::Value>(&raw)
            .map_err(|e| format!("Invalid CLI JSON: {e}"))?;

        let session_id = cli_json.get("session_id")
            .and_then(|s| s.as_str())
            .map(str::to_string);

        let result = cli_json.get("result")
            .and_then(|r| r.as_str())
            .unwrap_or("");

        let (content, summary) = serde_json::from_str::<StructuredReply>(result)
            .map(|r| (r.content, r.summary))
            .unwrap_or_else(|_| (result.to_owned(), String::new()));

        Ok(AgentResponse { content, summary, session_id })
    }
}
