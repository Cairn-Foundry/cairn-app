use std::process::{Command, Stdio};
use serde::Deserialize;
use super::super::{AgentProvider, AgentResponse};

#[derive(Deserialize)]
struct StructuredReply {
    content: String,
    summary: String,
}

const FORMAT_INSTRUCTION: &str = "\
Respond with a JSON object only — no markdown code block, no text outside the JSON. \
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

        let output = Command::new("claude")
            .args(&args)
            .current_dir(working_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output()
            .map_err(|e| format!("Failed to spawn claude: {e}"))?;

        let raw = String::from_utf8_lossy(&output.stdout).to_string();

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
