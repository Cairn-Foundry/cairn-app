use std::io::{BufRead, BufReader};
use std::sync::atomic::Ordering;
use std::time::Duration;
use serde_json::{json, Value};
use super::super::{
    emit_agent, emit_agent_data, AgentProvider, AgentResponse, RunningChild, SendRequest,
};

#[derive(Clone, Copy)]
pub enum ApiFlavor {
    OpenAiCompatible,
    Anthropic,
    Gemini,
}

/// Direct chat-completion provider: no tools, no agentic loop. The frontend
/// sends the conversation history; nothing is kept server-side.
pub struct ApiChatProvider {
    pub flavor: ApiFlavor,
    pub default_base_url: &'static str,
    pub requires_key: bool,
}

struct StreamOutcome {
    usage: Option<Value>,
}

impl AgentProvider for ApiChatProvider {
    fn send(
        &self,
        app: &tauri::AppHandle,
        request: &SendRequest,
        handle: &RunningChild,
    ) -> Result<AgentResponse, String> {
        let opts = request.options;
        let key = opts.api_key.clone();
        if self.requires_key && key.is_none() {
            return Err("API key missing. Add it in the provider settings.".into());
        }
        if opts.model.is_empty() {
            return Err("No model selected. Pick one in the provider settings.".into());
        }

        let base = if opts.base_url.trim().is_empty() {
            self.default_base_url.to_string()
        } else {
            opts.base_url.trim().trim_end_matches('/').to_string()
        };

        let client = reqwest::blocking::Client::builder()
            .connect_timeout(Duration::from_secs(u64::from(opts.timeout.max(5))))
            .build()
            .map_err(|e| e.to_string())?;

        let wd = Some(request.working_dir.to_string());
        let rid = Some(request.run_id.to_string());

        let outcome = match self.flavor {
            ApiFlavor::OpenAiCompatible => {
                self.stream_openai(app, &client, &base, key.as_deref(), request, handle, &wd, &rid)?
            }
            ApiFlavor::Anthropic => {
                self.stream_anthropic(app, &client, &base, key.as_deref(), request, handle, &wd, &rid)?
            }
            ApiFlavor::Gemini => {
                self.stream_gemini(app, &client, key.as_deref(), request, handle, &wd, &rid)?
            }
        };

        if let Some(usage) = outcome.usage {
            emit_agent_data(app, "usage", usage, wd, rid);
        }

        Ok(AgentResponse { session_id: None })
    }
}

fn history_messages(request: &SendRequest) -> Vec<(String, String)> {
    let mut messages: Vec<(String, String)> = request
        .options
        .history
        .iter()
        .filter(|m| !m.content.is_empty())
        .map(|m| {
            let role = if m.role == "agent" { "assistant" } else { "user" };
            (role.to_string(), m.content.clone())
        })
        .collect();
    messages.push(("user".to_string(), request.message.to_string()));
    messages
}

fn sse_data_lines<R: std::io::Read>(
    reader: R,
    handle: &RunningChild,
    mut on_data: impl FnMut(&str),
) {
    for line in BufReader::new(reader).lines() {
        if handle.cancelled.load(Ordering::SeqCst) {
            break;
        }
        let Ok(line) = line else { break };
        if let Some(data) = line.strip_prefix("data: ") {
            if data == "[DONE]" {
                break;
            }
            on_data(data);
        }
    }
}

fn ensure_success(resp: reqwest::blocking::Response) -> Result<reqwest::blocking::Response, String> {
    if resp.status().is_success() {
        return Ok(resp);
    }
    let status = resp.status();
    let body = resp.text().unwrap_or_default();
    let detail = serde_json::from_str::<Value>(&body)
        .ok()
        .and_then(|v| {
            v.pointer("/error/message")
                .or_else(|| v.pointer("/0/error/message"))
                .and_then(Value::as_str)
                .map(String::from)
        })
        .unwrap_or(body);
    Err(format!("HTTP {status}: {}", detail.trim()))
}

impl ApiChatProvider {
    #[allow(clippy::too_many_arguments)]
    fn stream_openai(
        &self,
        app: &tauri::AppHandle,
        client: &reqwest::blocking::Client,
        base: &str,
        key: Option<&str>,
        request: &SendRequest,
        handle: &RunningChild,
        wd: &Option<String>,
        rid: &Option<String>,
    ) -> Result<StreamOutcome, String> {
        let opts = request.options;
        let mut messages: Vec<Value> = Vec::new();
        if !opts.system_prompt.is_empty() {
            messages.push(json!({ "role": "system", "content": opts.system_prompt }));
        }
        for (role, content) in history_messages(request) {
            messages.push(json!({ "role": role, "content": content }));
        }

        let mut req = client
            .post(format!("{base}/chat/completions"))
            .json(&json!({
                "model": opts.model,
                "messages": messages,
                "temperature": opts.temperature,
                "max_tokens": opts.max_tokens,
                "stream": true,
                "stream_options": { "include_usage": true },
            }));
        if let Some(key) = key {
            req = req.bearer_auth(key);
        }

        let resp = ensure_success(req.send().map_err(|e| e.to_string())?)?;
        let mut usage: Option<Value> = None;
        sse_data_lines(resp, handle, |data| {
            let Ok(event) = serde_json::from_str::<Value>(data) else { return };
            if let Some(delta) = event
                .pointer("/choices/0/delta/content")
                .and_then(Value::as_str)
                && !delta.is_empty() {
                    emit_agent(app, delta.to_string(), "assistant", wd.clone(), rid.clone());
                }
            if let Some(u) = event.get("usage").filter(|u| !u.is_null()) {
                usage = Some(json!({
                    "model": opts.model,
                    "usage": {
                        "input_tokens": u.get("prompt_tokens"),
                        "output_tokens": u.get("completion_tokens"),
                    },
                }));
            }
        });
        Ok(StreamOutcome { usage })
    }

    #[allow(clippy::too_many_arguments)]
    fn stream_anthropic(
        &self,
        app: &tauri::AppHandle,
        client: &reqwest::blocking::Client,
        base: &str,
        key: Option<&str>,
        request: &SendRequest,
        handle: &RunningChild,
        wd: &Option<String>,
        rid: &Option<String>,
    ) -> Result<StreamOutcome, String> {
        let opts = request.options;
        let messages: Vec<Value> = history_messages(request)
            .into_iter()
            .map(|(role, content)| json!({ "role": role, "content": content }))
            .collect();

        let mut body = json!({
            "model": opts.model,
            "messages": messages,
            "max_tokens": opts.max_tokens,
            "temperature": opts.temperature.min(1.0),
            "stream": true,
        });
        if !opts.system_prompt.is_empty() {
            body["system"] = Value::String(opts.system_prompt.clone());
        }

        let resp = ensure_success(
            client
                .post(format!("{base}/v1/messages"))
                .header("x-api-key", key.unwrap_or_default())
                .header("anthropic-version", "2023-06-01")
                .json(&body)
                .send()
                .map_err(|e| e.to_string())?,
        )?;

        let mut input_tokens: Option<i64> = None;
        let mut output_tokens: Option<i64> = None;
        sse_data_lines(resp, handle, |data| {
            let Ok(event) = serde_json::from_str::<Value>(data) else { return };
            match event.get("type").and_then(Value::as_str) {
                Some("content_block_delta") => {
                    if let Some(text) = event.pointer("/delta/text").and_then(Value::as_str)
                        && !text.is_empty() {
                            emit_agent(app, text.to_string(), "assistant", wd.clone(), rid.clone());
                        }
                }
                Some("message_start") => {
                    input_tokens = event
                        .pointer("/message/usage/input_tokens")
                        .and_then(Value::as_i64);
                }
                Some("message_delta") => {
                    output_tokens = event
                        .pointer("/usage/output_tokens")
                        .and_then(Value::as_i64);
                }
                _ => {}
            }
        });

        let usage = (input_tokens.is_some() || output_tokens.is_some()).then(|| {
            json!({
                "model": opts.model,
                "usage": { "input_tokens": input_tokens, "output_tokens": output_tokens },
            })
        });
        Ok(StreamOutcome { usage })
    }

    #[allow(clippy::too_many_arguments)]
    fn stream_gemini(
        &self,
        app: &tauri::AppHandle,
        client: &reqwest::blocking::Client,
        key: Option<&str>,
        request: &SendRequest,
        handle: &RunningChild,
        wd: &Option<String>,
        rid: &Option<String>,
    ) -> Result<StreamOutcome, String> {
        let opts = request.options;
        let contents: Vec<Value> = history_messages(request)
            .into_iter()
            .map(|(role, content)| {
                let role = if role == "assistant" { "model" } else { "user" };
                json!({ "role": role, "parts": [{ "text": content }] })
            })
            .collect();

        let mut body = json!({
            "contents": contents,
            "generationConfig": {
                "temperature": opts.temperature,
                "maxOutputTokens": opts.max_tokens,
            },
        });
        if !opts.system_prompt.is_empty() {
            body["systemInstruction"] = json!({ "parts": [{ "text": opts.system_prompt }] });
        }

        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:streamGenerateContent?alt=sse",
            opts.model
        );
        let resp = ensure_success(
            client
                .post(url)
                .header("x-goog-api-key", key.unwrap_or_default())
                .json(&body)
                .send()
                .map_err(|e| e.to_string())?,
        )?;

        let mut usage: Option<Value> = None;
        sse_data_lines(resp, handle, |data| {
            let Ok(event) = serde_json::from_str::<Value>(data) else { return };
            if let Some(text) = event
                .pointer("/candidates/0/content/parts/0/text")
                .and_then(Value::as_str)
                && !text.is_empty() {
                    emit_agent(app, text.to_string(), "assistant", wd.clone(), rid.clone());
                }
            if let Some(meta) = event.get("usageMetadata") {
                usage = Some(json!({
                    "model": opts.model,
                    "usage": {
                        "input_tokens": meta.get("promptTokenCount"),
                        "output_tokens": meta.get("candidatesTokenCount"),
                    },
                }));
            }
        });
        Ok(StreamOutcome { usage })
    }
}
