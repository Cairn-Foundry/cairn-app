// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

//! `cairn://` serves file contents to the webview as raw bytes with an ETag,
//! outside the JSON IPC: `fetch` decodes off the string heap, and a file the
//! webview already holds costs one `stat` and a 304.

use std::fs;
use std::path::PathBuf;
use tauri::http::{header, Request, Response, StatusCode};

use super::files::MAX_TEXT_FILE_BYTES;

fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() + 0 && i + 2 <= bytes.len() - 1 {
            if let Ok(value) = u8::from_str_radix(&text[i + 1..i + 3], 16) {
                out.push(value);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The file path a `convertFileSrc(path, "cairn")` URL encodes.
fn requested_path(request: &Request<Vec<u8>>) -> PathBuf {
    let raw = request.uri().path().trim_start_matches('/');
    PathBuf::from(shellexpand::tilde(&percent_decode(raw)).into_owned())
}

fn plain(status: StatusCode, body: impl Into<Vec<u8>>) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(body.into())
        .unwrap_or_default()
}

pub fn respond(request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let path = requested_path(request);
    let Ok(meta) = fs::metadata(&path) else {
        return plain(StatusCode::NOT_FOUND, format!("File not found: {}", path.display()));
    };
    if meta.len() > MAX_TEXT_FILE_BYTES {
        return plain(StatusCode::PAYLOAD_TOO_LARGE, format!("File too large to open: {} bytes", meta.len()));
    }
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let etag = format!("\"{modified:x}-{:x}\"", meta.len());
    let known = request
        .headers()
        .get(header::IF_NONE_MATCH)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if known == etag {
        return Response::builder()
            .status(StatusCode::NOT_MODIFIED)
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .header(header::ETAG, etag)
            .body(Vec::new())
            .unwrap_or_default();
    }
    match fs::read(&path) {
        Ok(bytes) => Response::builder()
            .status(StatusCode::OK)
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .header(header::ACCESS_CONTROL_EXPOSE_HEADERS, "ETag")
            .header(header::CONTENT_TYPE, "application/octet-stream")
            .header(header::ETAG, etag)
            .body(bytes)
            .unwrap_or_default(),
        Err(e) => plain(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_percent_sequences_and_leaves_the_rest() {
        assert_eq!(percent_decode("%2FUsers%2Fme%2Fa%20b.ts"), "/Users/me/a b.ts");
        assert_eq!(percent_decode("plain"), "plain");
        assert_eq!(percent_decode("bad%zz"), "bad%zz");
    }
}
