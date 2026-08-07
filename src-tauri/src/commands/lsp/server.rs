use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::str::FromStr;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use lsp_types::{
    ClientCapabilities, CompletionClientCapabilities, CompletionItemCapability,
    DocumentSymbolClientCapabilities, GotoCapability, HoverClientCapabilities, InitializeParams,
    MarkupKind, PublishDiagnosticsClientCapabilities, RenameClientCapabilities,
    SignatureHelpClientCapabilities, TextDocumentClientCapabilities,
    TextDocumentSyncClientCapabilities, Uri, WorkspaceClientCapabilities, WorkspaceFolder,
};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::Emitter;
use super::client::{LspClient, REQUEST_TIMEOUT};
use super::registry::{resolve_binary, LanguageServerDef};

/// A cold `initialize` on a large repository takes seconds - rust-analyzer
/// indexes the whole workspace before answering.
const INITIALIZE_TIMEOUT: Duration = Duration::from_secs(60);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ServerStatus {
    Starting,
    Ready,
    Failed,
    Stopped,
}

pub struct ServerHandle {
    pub server_id:    String,
    pub root:         PathBuf,
    pub command:      String,
    pub client:       Arc<LspClient>,
    pub child:        Mutex<Child>,
    pub open_docs:    Mutex<HashMap<PathBuf, i32>>,
    pub status:       Mutex<ServerStatus>,
    pub capabilities: Mutex<Value>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StatusEvent {
    server_id: String,
    root:      String,
    status:    ServerStatus,
    message:   Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticsEvent {
    server_id:   String,
    root:        String,
    path:        String,
    diagnostics: Value,
}

pub fn emit_status(app: &tauri::AppHandle, server_id: &str, root: &Path, status: ServerStatus, message: Option<String>) {
    let _ = app.emit("lsp-status", StatusEvent {
        server_id: server_id.to_string(),
        root:      root.to_string_lossy().to_string(),
        status,
        message,
    });
}

const UNRESERVED: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~/";

pub fn path_to_uri(path: &Path) -> String {
    let mut uri = String::from("file://");
    for byte in path.to_string_lossy().as_bytes() {
        if UNRESERVED.contains(byte) {
            uri.push(*byte as char);
        } else {
            uri.push_str(&format!("%{byte:02X}"));
        }
    }
    uri
}

pub fn uri_to_path(uri: &str) -> Option<PathBuf> {
    let encoded = uri.strip_prefix("file://")?;
    let bytes = encoded.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok()?;
            match u8::from_str_radix(hex, 16) {
                Ok(byte) => {
                    out.push(byte);
                    i += 3;
                    continue;
                }
                Err(_) => return None,
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    Some(PathBuf::from(String::from_utf8(out).ok()?))
}

#[allow(deprecated)]
fn initialize_params(root: &Path) -> Result<InitializeParams, String> {
    let uri = Uri::from_str(&path_to_uri(root)).map_err(|e| e.to_string())?;
    let name = root
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "workspace".to_string());

    Ok(InitializeParams {
        process_id: Some(std::process::id()),
        root_uri: Some(uri.clone()),
        workspace_folders: Some(vec![WorkspaceFolder { uri, name }]),
        capabilities: ClientCapabilities {
            text_document: Some(TextDocumentClientCapabilities {
                synchronization: Some(TextDocumentSyncClientCapabilities {
                    dynamic_registration: Some(false),
                    will_save: Some(false),
                    will_save_wait_until: Some(false),
                    did_save: Some(true),
                }),
                completion: Some(CompletionClientCapabilities {
                    dynamic_registration: Some(false),
                    context_support: Some(true),
                    completion_item: Some(CompletionItemCapability {
                        snippet_support: Some(false),
                        documentation_format: Some(vec![MarkupKind::Markdown, MarkupKind::PlainText]),
                        ..Default::default()
                    }),
                    ..Default::default()
                }),
                hover: Some(HoverClientCapabilities {
                    dynamic_registration: Some(false),
                    content_format: Some(vec![MarkupKind::Markdown, MarkupKind::PlainText]),
                }),
                signature_help: Some(SignatureHelpClientCapabilities {
                    dynamic_registration: Some(false),
                    ..Default::default()
                }),
                definition: Some(GotoCapability { dynamic_registration: Some(false), link_support: Some(false) }),
                implementation: Some(GotoCapability { dynamic_registration: Some(false), link_support: Some(false) }),
                references: Some(Default::default()),
                document_symbol: Some(DocumentSymbolClientCapabilities {
                    dynamic_registration: Some(false),
                    hierarchical_document_symbol_support: Some(true),
                    ..Default::default()
                }),
                formatting: Some(Default::default()),
                rename: Some(RenameClientCapabilities {
                    dynamic_registration: Some(false),
                    prepare_support: Some(false),
                    ..Default::default()
                }),
                publish_diagnostics: Some(PublishDiagnosticsClientCapabilities::default()),
                ..Default::default()
            }),
            workspace: Some(WorkspaceClientCapabilities {
                apply_edit: Some(false),
                workspace_folders: Some(true),
                ..Default::default()
            }),
            ..Default::default()
        },
        client_info: Some(lsp_types::ClientInfo {
            name:    "Cairn".to_string(),
            version: Some(env!("CARGO_PKG_VERSION").to_string()),
        }),
        ..Default::default()
    })
}

/// Spawns the server process and drives `initialize` / `initialized`. A missing
/// binary returns an error the caller reports as a status, never as a crash.
pub fn start(
    app: &tauri::AppHandle,
    def: &LanguageServerDef,
    root: &Path,
    command_override: &str,
    args_override: &[String],
) -> Result<Arc<ServerHandle>, String> {
    let binary = if command_override.trim().is_empty() { def.binary.as_str() } else { command_override.trim() };
    let resolved = resolve_binary(binary, Some(root))
        .ok_or_else(|| format!("{binary} was not found"))?;

    let args: Vec<String> = if args_override.is_empty() {
        def.args.clone()
    } else {
        args_override.to_vec()
    };

    let mut child = Command::new(&resolved)
        .args(&args)
        .current_dir(root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to start {binary}: {e}"))?;

    let pipes = child.stdin.take().zip(child.stdout.take());
    let Some((stdin, stdout)) = pipes else {
        let _ = child.kill();
        let _ = child.wait();
        return Err("no stdio on language server".to_string());
    };
    if let Some(stderr) = child.stderr.take() {
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines() {
                let Ok(line) = line else { break };
                eprintln!("[lsp] {line}");
            }
        });
    }

    let app_events = app.clone();
    let server_id = def.id.clone();
    let event_root = root.to_path_buf();
    let client = LspClient::new(stdin, stdout, move |method, params| {
        if method != "textDocument/publishDiagnostics" {
            return;
        }
        let Some(uri) = params.get("uri").and_then(Value::as_str) else { return };
        let Some(path) = uri_to_path(uri) else { return };
        let _ = app_events.emit("lsp-diagnostics", DiagnosticsEvent {
            server_id:   server_id.clone(),
            root:        event_root.to_string_lossy().to_string(),
            path:        path.to_string_lossy().to_string(),
            diagnostics: params.get("diagnostics").cloned().unwrap_or(Value::Array(Vec::new())),
        });
    });

    let handle = Arc::new(ServerHandle {
        server_id:    def.id.clone(),
        root:         root.to_path_buf(),
        command:      resolved.to_string_lossy().to_string(),
        client:       Arc::clone(&client),
        child:        Mutex::new(child),
        open_docs:    Mutex::new(HashMap::new()),
        status:       Mutex::new(ServerStatus::Starting),
        capabilities: Mutex::new(Value::Null),
    });

    // `Child` does not kill on drop: an `initialize` that errors or times out
    // would otherwise leave the process running with nobody holding a handle
    // to it, and rust-analyzer indexing a repository is not a quiet orphan.
    let handshake = (|| {
        let params = serde_json::to_value(initialize_params(root)?).map_err(|e| e.to_string())?;
        let result = client.request("initialize", params, INITIALIZE_TIMEOUT)?;
        client.notify("initialized", json!({}))?;
        Ok::<Value, String>(result)
    })();
    let result = match handshake {
        Ok(result) => result,
        Err(e) => {
            if let Ok(mut child) = handle.child.lock() {
                let _ = child.kill();
                let _ = child.wait();
            }
            return Err(e);
        }
    };

    if let Ok(mut caps) = handle.capabilities.lock() {
        *caps = result.get("capabilities").cloned().unwrap_or(Value::Null);
    }
    if let Ok(mut status) = handle.status.lock() {
        *status = ServerStatus::Ready;
    }

    Ok(handle)
}

pub fn stop(handle: &ServerHandle) {
    let _ = handle.client.request("shutdown", Value::Null, SHUTDOWN_TIMEOUT);
    let _ = handle.client.notify("exit", Value::Null);
    if let Ok(mut status) = handle.status.lock() {
        *status = ServerStatus::Stopped;
    }
    if let Ok(mut child) = handle.child.lock() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

impl ServerHandle {
    pub fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        self.client.request(method, params, REQUEST_TIMEOUT)
    }

    pub fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        self.client.notify(method, params)
    }

    pub fn is_alive(&self) -> bool {
        self.child
            .lock()
            .map(|mut child| matches!(child.try_wait(), Ok(None)))
            .unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_a_plain_path() {
        assert_eq!(path_to_uri(Path::new("/src/main.rs")), "file:///src/main.rs");
    }

    #[test]
    fn encodes_spaces_and_non_ascii() {
        assert_eq!(
            path_to_uri(Path::new("/mon dossier/été (1).rs")),
            "file:///mon%20dossier/%C3%A9t%C3%A9%20%281%29.rs"
        );
    }

    #[test]
    fn round_trips_every_awkward_path() {
        for path in ["/a/b.rs", "/mon dossier/été (1).rs", "/a/#hash?q/c+d.rs"] {
            let uri = path_to_uri(Path::new(path));
            assert_eq!(uri_to_path(&uri).as_deref(), Some(Path::new(path)), "{uri}");
        }
    }

    #[test]
    fn rejects_a_uri_that_is_not_a_file() {
        assert_eq!(uri_to_path("untitled:Untitled-1"), None);
        assert_eq!(uri_to_path("https://example.com/a.rs"), None);
    }
}
