// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Secrets stored on disk, encrypted in `~/.cairn`, never in the OS keychain.
//!
//! A keychain read prompts for authorisation on every launch of an unsigned or
//! rebuilt binary, once per stored item, which made simply opening a settings
//! screen a wall of dialogs. Keys live in `ai-keys.enc`, sealed with
//! ChaCha20-Poly1305 using the secret in `ai-keys.secret`; both are `0600`. The
//! secret sits next to the ciphertext, so this guards against a key leaking
//! through a backup, a synced folder or a stray grep - not against someone who
//! already reads the home directory. Nothing stored locally could.
//!
//! The store is generic: an integration's token and anything else that must not
//! sit in plaintext share it, keyed by whatever name the caller picks.

use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::RwLock;

use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::ChaCha20Poly1305;
use serde::Serialize;

use crate::storage::{api_keys_file, api_keys_secret_file};

const NONCE_LEN: usize = 12;

// ---------------------------------------------------------------------------
// API keys: encrypted in ~/.cairn, never in the OS keychain. A keychain read
// prompts for authorisation on every launch of an unsigned or rebuilt binary,
// once per stored item, which made simply opening the Providers screen a wall
// of dialogs. The UI only ever learns whether a key exists, never the key.
// ---------------------------------------------------------------------------

/// Restrict a file to its owner. A no-op on Windows, where the user profile
/// directory is already the boundary.
fn restrict_to_owner(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
    #[cfg(not(unix))]
    let _ = path;
}

/// The secret the key file is encrypted with, created on first use.
///
/// It lives next to the ciphertext, so this is not protection against someone
/// who already reads your home directory - nothing stored locally could be.
/// What it does buy: an API key never sits in a plaintext file, so it cannot
/// leak through a backup, a synced folder, a screen share or a stray grep.
fn encryption_secret() -> Result<[u8; 32], String> {
    let path = api_keys_secret_file()?;
    if let Ok(existing) = fs::read(&path)
        && existing.len() == 32 {
            let mut secret = [0u8; 32];
            secret.copy_from_slice(&existing);
            return Ok(secret);
        }
    let mut secret = [0u8; 32];
    getrandom::fill(&mut secret).map_err(|e| e.to_string())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, secret).map_err(|e| e.to_string())?;
    restrict_to_owner(&path);
    Ok(secret)
}

/// The ChaCha20-Poly1305 cipher the key file is sealed with.
fn cipher() -> Result<ChaCha20Poly1305, String> {
    Ok(ChaCha20Poly1305::new(&encryption_secret()?.into()))
}

/// Decrypting `ai-keys.enc` costs a read plus a ChaCha20-Poly1305 pass, and
/// every prompt needs a key; `write_stored_keys` is the only writer, so the
/// plaintext map is kept here between writes.
static KEYS_CACHE: RwLock<Option<HashMap<String, String>>> = RwLock::new(None);

/// The stored keys, or an empty map when the file is missing, unreadable or
/// fails authentication - a tampered file is never half-read.
fn read_stored_keys() -> HashMap<String, String> {
    if let Ok(cache) = KEYS_CACHE.read()
        && let Some(keys) = cache.as_ref()
    {
        return keys.clone();
    }
    let keys = decrypt_stored_keys();
    if let Ok(mut cache) = KEYS_CACHE.write() {
        *cache = Some(keys.clone());
    }
    keys
}

fn decrypt_stored_keys() -> HashMap<String, String> {
    let Ok(path) = api_keys_file() else { return HashMap::new() };
    let Ok(raw) = fs::read(&path) else { return HashMap::new() };
    if raw.len() < NONCE_LEN {
        return HashMap::new();
    }
    let (nonce, ciphertext) = raw.split_at(NONCE_LEN);
    let Ok(nonce) = <&[u8; NONCE_LEN]>::try_from(nonce) else { return HashMap::new() };
    let Ok(cipher) = cipher() else { return HashMap::new() };
    cipher
        .decrypt(nonce.into(), ciphertext)
        .ok()
        .and_then(|plain| serde_json::from_slice(&plain).ok())
        .unwrap_or_default()
}

/// Seals the keys under a fresh nonce, prefixed to the ciphertext. An empty
/// map removes the file instead of writing an encrypted nothing.
fn write_stored_keys(keys: &HashMap<String, String>) -> Result<(), String> {
    if let Ok(mut cache) = KEYS_CACHE.write() {
        *cache = Some(keys.clone());
    }
    let path = api_keys_file()?;
    if keys.is_empty() {
        let _ = fs::remove_file(&path);
        return Ok(());
    }
    let plain = serde_json::to_vec(keys).map_err(|e| e.to_string())?;
    let mut nonce = [0u8; NONCE_LEN];
    getrandom::fill(&mut nonce).map_err(|e| e.to_string())?;
    let ciphertext = cipher()?
        .encrypt(&nonce.into(), plain.as_slice())
        .map_err(|e| e.to_string())?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut blob = nonce.to_vec();
    blob.extend_from_slice(&ciphertext);
    fs::write(&path, blob).map_err(|e| e.to_string())?;
    restrict_to_owner(&path);
    Ok(())
}

/// All the frontend is ever told about a key: whether there is one.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ApiKeyStatus {
    pub set: bool,
}

/// Stores a provider's key, replacing any previous one.
#[tauri::command]
pub async fn set_provider_api_key(provider_id: String, key: String) -> Result<ApiKeyStatus, String> {
    let mut keys = read_stored_keys();
    keys.insert(provider_id, key);
    write_stored_keys(&keys)?;
    Ok(ApiKeyStatus { set: true })
}

/// Every provider's key state in one call: the UI asks about all of them at
/// once, and asking one command per provider is what made this expensive.
#[tauri::command]
pub async fn get_api_key_statuses() -> Result<HashMap<String, bool>, String> {
    Ok(read_stored_keys()
        .into_iter()
        .map(|(provider, key)| (provider, !key.is_empty()))
        .collect())
}

/// Forgets a provider's key; unknown ids are not an error.
#[tauri::command]
pub async fn delete_provider_api_key(provider_id: String) -> Result<(), String> {
    let mut keys = read_stored_keys();
    if keys.remove(&provider_id).is_some() {
        write_stored_keys(&keys)?;
    }
    Ok(())
}

/// A provider's key for a run. Rust-side only - it never crosses to the
/// frontend.
pub fn get_api_key(provider_id: &str) -> Option<String> {
    read_stored_keys().remove(provider_id).filter(|k| !k.is_empty())
}

