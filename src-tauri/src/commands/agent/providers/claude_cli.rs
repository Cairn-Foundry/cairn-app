use std::process::{Command, Stdio};
use super::super::AgentProvider;

pub struct ClaudeCliProvider;

impl AgentProvider for ClaudeCliProvider {
    fn send(
        &self,
        message: &str,
        working_dir: &str,
        session_id: Option<&str>,
    ) -> Result<(String, Option<String>), String> {
        let mut args: Vec<String> = vec![
            "-p".into(),
            message.to_string(),
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

        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&raw) {
            let new_session_id = val.get("session_id")
                .and_then(|s| s.as_str())
                .map(str::to_string);
            let text = val.get("result")
                .and_then(|r| r.as_str())
                .unwrap_or("")
                .to_string();
            Ok((text, new_session_id))
        } else {
            Ok((String::new(), None))
        }
    }
}
