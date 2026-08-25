//! One filesystem watcher per worktree the frontend asked for. Events are
//! debounced and classified: a change under `.git` that moves the status
//! (index, HEAD, refs) is reported as git-only, anything else as a tree change.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{Emitter, Manager};

const DEBOUNCE: Duration = Duration::from_millis(300);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FsChanged {
    worktree: String,
    git_only: bool,
}

#[derive(Default)]
pub struct WatchState {
    watchers: Mutex<HashMap<String, RecommendedWatcher>>,
    sender:   Mutex<Option<Sender<(String, bool)>>>,
}

fn sender(app: &tauri::AppHandle) -> Sender<(String, bool)> {
    let state = app.state::<WatchState>();
    let mut slot = state.sender.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(tx) = slot.as_ref() {
        return tx.clone();
    }
    let (tx, rx) = channel::<(String, bool)>();
    let app = app.clone();
    std::thread::spawn(move || {
        while let Ok(first) = rx.recv() {
            let mut pending: HashMap<String, bool> = HashMap::from([first]);
            let deadline = Instant::now() + DEBOUNCE;
            loop {
                match rx.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
                    Ok((root, tree)) => *pending.entry(root).or_insert(false) |= tree,
                    Err(RecvTimeoutError::Timeout) => break,
                    Err(RecvTimeoutError::Disconnected) => return,
                }
            }
            for (worktree, tree) in pending {
                let _ = app.emit("fs-changed", FsChanged { worktree, git_only: !tree });
            }
        }
    });
    *slot = Some(tx.clone());
    tx
}

const GIT_STATUS_FILES: &[&str] = &["index", "HEAD", "ORIG_HEAD", "MERGE_HEAD", "REBASE_HEAD", "FETCH_HEAD"];

/// `Some(true)` for a change to the tree, `Some(false)` for one that only
/// moves the git status, `None` for noise (objects, lock files, node_modules).
fn classify(path: &Path, root: &Path, gitdir: &Path) -> Option<bool> {
    if let Ok(rel) = path.strip_prefix(gitdir) {
        return git_meta(rel).then_some(false);
    }
    let rel = path.strip_prefix(root).ok()?;
    if let Ok(inner) = rel.strip_prefix(".git") {
        return git_meta(inner).then_some(false);
    }
    if rel.components().any(|c| c.as_os_str() == "node_modules") {
        return None;
    }
    Some(true)
}

fn git_meta(rel: &Path) -> bool {
    let text = rel.to_string_lossy();
    let name = text.trim_start_matches('/');
    GIT_STATUS_FILES.contains(&name)
        || name.starts_with("refs/")
        || name.starts_with("rebase-merge")
        || name.starts_with("rebase-apply")
}

/// The directory holding this worktree's git metadata: `.git` itself, or the
/// `worktrees/<name>` entry of the main repository for a linked worktree.
fn gitdir_of(root: &Path) -> PathBuf {
    let dot_git = root.join(".git");
    if dot_git.is_file()
        && let Ok(text) = std::fs::read_to_string(&dot_git)
        && let Some(target) = text.trim().strip_prefix("gitdir:")
    {
        let target = target.trim();
        let path = PathBuf::from(target);
        return if path.is_absolute() { path } else { root.join(path) };
    }
    dot_git
}

#[tauri::command]
pub async fn watch_worktree(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let root = PathBuf::from(shellexpand::tilde(&path).into_owned());
    let state = app.state::<WatchState>();
    if state.watchers.lock().map_err(|e| e.to_string())?.contains_key(&path) {
        return Ok(());
    }
    let tx = sender(&app);
    let gitdir = gitdir_of(&root);
    let (cb_root, cb_gitdir, key) = (root.clone(), gitdir.clone(), path.clone());
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(event) = res else { return };
        let mut verdict: Option<bool> = None;
        for p in &event.paths {
            if let Some(tree) = classify(p, &cb_root, &cb_gitdir) {
                verdict = Some(verdict.unwrap_or(false) | tree);
            }
        }
        if let Some(tree) = verdict {
            let _ = tx.send((key.clone(), tree));
        }
    })
    .map_err(|e| e.to_string())?;
    watcher.watch(&root, RecursiveMode::Recursive).map_err(|e| e.to_string())?;
    if !gitdir.starts_with(&root) && gitdir.is_dir() {
        let _ = watcher.watch(&gitdir, RecursiveMode::Recursive);
    }
    state.watchers.lock().map_err(|e| e.to_string())?.insert(path, watcher);
    Ok(())
}

#[tauri::command]
pub async fn unwatch_worktree(app: tauri::AppHandle, path: String) -> Result<(), String> {
    app.state::<WatchState>().watchers.lock().map_err(|e| e.to_string())?.remove(&path);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_tree_git_and_noise() {
        let root = Path::new("/w");
        let gitdir = Path::new("/w/.git");
        assert_eq!(classify(Path::new("/w/src/a.ts"), root, gitdir), Some(true));
        assert_eq!(classify(Path::new("/w/.git/index"), root, gitdir), Some(false));
        assert_eq!(classify(Path::new("/w/.git/refs/heads/main"), root, gitdir), Some(false));
        assert_eq!(classify(Path::new("/w/.git/objects/ab/cd"), root, gitdir), None);
        assert_eq!(classify(Path::new("/w/.git/index.lock"), root, gitdir), None);
        assert_eq!(classify(Path::new("/w/node_modules/x/y.js"), root, gitdir), None);
        assert_eq!(classify(Path::new("/elsewhere/f"), root, gitdir), None);
        assert_eq!(classify(Path::new("/w/.git"), root, gitdir), None);
    }

    #[test]
    fn classifies_a_linked_worktree_gitdir() {
        let root = Path::new("/w");
        let gitdir = Path::new("/repo/.git/worktrees/w");
        assert_eq!(classify(Path::new("/repo/.git/worktrees/w/HEAD"), root, gitdir), Some(false));
        assert_eq!(classify(Path::new("/repo/.git/worktrees/w/logs/HEAD"), root, gitdir), None);
    }
}
