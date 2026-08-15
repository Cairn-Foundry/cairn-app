//! JSON-RPC transport for one language server process: framed reads on a
//! background thread, and request/response correlation by id.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{ChildStdin, ChildStdout};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use serde_json::{json, Value};

pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

type Pending = Arc<Mutex<HashMap<i64, Sender<Result<Value, String>>>>>;

/// A connected language server. Requests block the caller until the reader
/// thread matches the response, or the timeout expires.
pub struct LspClient {
    stdin:   Mutex<ChildStdin>,
    next_id: AtomicI64,
    pending: Pending,
}

/// Frames one message with its `Content-Length` header, as LSP requires.
fn write_message(stdin: &mut ChildStdin, payload: &Value) -> Result<(), String> {
    let body = serde_json::to_string(payload).map_err(|e| e.to_string())?;
    write!(stdin, "Content-Length: {}\r\n\r\n{}", body.len(), body).map_err(|e| e.to_string())?;
    stdin.flush().map_err(|e| e.to_string())
}

/// Reads one `Content-Length` framed message, or None once the stream ends.
fn read_message(reader: &mut BufReader<ChildStdout>) -> Option<Value> {
    let mut length: Option<usize> = None;
    loop {
        let mut header = String::new();
        if reader.read_line(&mut header).ok()? == 0 {
            return None;
        }
        let trimmed = header.trim_end();
        if trimmed.is_empty() {
            break;
        }
        if let Some(value) = trimmed.strip_prefix("Content-Length:") {
            length = value.trim().parse::<usize>().ok();
        }
    }
    let mut buf = vec![0u8; length?];
    reader.read_exact(&mut buf).ok()?;
    serde_json::from_slice(&buf).ok()
}

impl LspClient {
    /// Spawns the reader thread and returns the connected client. Server-initiated
    /// requests are answered with null rather than ignored, because a server that
    /// never gets a reply will stall waiting for one.
    pub fn new(
        stdin: ChildStdin,
        stdout: ChildStdout,
        on_notification: impl Fn(&str, Value) + Send + 'static,
    ) -> Arc<Self> {
        let client = Arc::new(Self {
            stdin:   Mutex::new(stdin),
            next_id: AtomicI64::new(1),
            pending: Arc::new(Mutex::new(HashMap::new())),
        });

        let reader_client = Arc::clone(&client);
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            while let Some(message) = read_message(&mut reader) {
                let id = message.get("id").and_then(Value::as_i64);
                let method = message.get("method").and_then(Value::as_str);

                match (method, id) {
                    (Some(method), None) => {
                        on_notification(method, message.get("params").cloned().unwrap_or(Value::Null));
                    }
                    (Some(_), Some(id)) => {
                        let _ = reader_client.respond(id, Value::Null);
                    }
                    (None, Some(id)) => {
                        let sender = reader_client.pending.lock().ok().and_then(|mut p| p.remove(&id));
                        if let Some(sender) = sender {
                            let outcome = match message.get("error") {
                                Some(error) => Err(error
                                    .get("message")
                                    .and_then(Value::as_str)
                                    .unwrap_or("LSP error")
                                    .to_string()),
                                None => Ok(message.get("result").cloned().unwrap_or(Value::Null)),
                            };
                            let _ = sender.send(outcome);
                        }
                    }
                    (None, None) => {}
                }
            }
            // The server is gone: release every caller still waiting.
            if let Ok(mut pending) = reader_client.pending.lock() {
                for (_, sender) in pending.drain() {
                    let _ = sender.send(Err("language server stopped".to_string()));
                }
            }
        });

        client
    }

    /// Fire and forget: notifications have no id and get no response.
    pub fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        let payload = json!({ "jsonrpc": "2.0", "method": method, "params": params });
        let mut stdin = self.stdin.lock().map_err(|e| e.to_string())?;
        write_message(&mut stdin, &payload)
    }

    /// Replies to a request the server sent us.
    fn respond(&self, id: i64, result: Value) -> Result<(), String> {
        let payload = json!({ "jsonrpc": "2.0", "id": id, "result": result });
        let mut stdin = self.stdin.lock().map_err(|e| e.to_string())?;
        write_message(&mut stdin, &payload)
    }

    /// Registers the pending id before writing, and unregisters it again if the
    /// write fails, so a failed send never leaks a waiting slot.
    fn send_request(&self, method: &str, params: Value) -> Result<(i64, Receiver<Result<Value, String>>), String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (sender, receiver) = channel();
        self.pending.lock().map_err(|e| e.to_string())?.insert(id, sender);

        let payload = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        let mut stdin = self.stdin.lock().map_err(|e| e.to_string())?;
        if let Err(e) = write_message(&mut stdin, &payload) {
            drop(stdin);
            self.pending.lock().ok().and_then(|mut p| p.remove(&id));
            return Err(e);
        }
        Ok((id, receiver))
    }

    /// Blocks until the server answers. On timeout the pending entry is dropped,
    /// so a late response is discarded instead of matching a later request.
    pub fn request(&self, method: &str, params: Value, timeout: Duration) -> Result<Value, String> {
        let (id, receiver) = self.send_request(method, params)?;
        match receiver.recv_timeout(timeout) {
            Ok(outcome) => outcome,
            Err(_) => {
                self.pending.lock().ok().and_then(|mut p| p.remove(&id));
                Err(format!("{method} timed out"))
            }
        }
    }
}
