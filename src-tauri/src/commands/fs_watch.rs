// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

//! One filesystem watcher per worktree the frontend asked for. Events are
//! debounced and classified: a change under `.git` that moves the status
//! (index, HEAD, refs) is reported as git-only, anything else as a tree change.
//! Watches are placed per directory, on what the view actually shows - the
//! expanded directories and the parents of the open tabs - never on the whole
//! repository. A directory nobody looks at has no watch, so a `storage/` or a
//! `node_modules` being written to continuously is silent for free.
//!
//! Nothing is filtered on `.gitignore`. Every watched directory is one the user
//! opened, so its events are wanted whatever git thinks of them - the tree can
//! show ignored files, and they have to stay up to date like the rest. The noise
//! the recursive watcher used to generate came from watching directories nobody
//! had opened, which no longer happens.

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
    watchers: Mutex<HashMap<String, Watched>>,
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

/// `Some(true)` for a change to the tree, `Some(false)` for one that only moves
/// the git status, `None` for noise under `.git` (objects, lock files).
///
/// Nothing is filtered on `.gitignore` here any more. Silence now comes from not
/// watching a directory at all, which is both cheaper and more honest: a filter
/// also swallowed the events of an ignored directory the user had *expanded* -
/// the tree has a `showIgnored` mode - so a file created in an open `node_modules`
/// or `storage` never appeared. A collapsed directory has no watch and is silent
/// for free; an expanded one is watched and must report.
fn classify(path: &Path, root: &Path, gitdir: &Path) -> Option<bool> {
    if let Ok(rel) = path.strip_prefix(gitdir) {
        return git_meta(rel).then_some(false);
    }
    let rel = path.strip_prefix(root).ok()?;
    if let Ok(inner) = rel.strip_prefix(".git") {
        return git_meta(inner).then_some(false);
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

/// The path as the filesystem sees it, so two spellings of one directory - a
/// symlinked prefix, a `..` inside a relative `gitdir:` pointer - compare equal.
/// Falls back to the path itself when it cannot be resolved, which is what a
/// directory that does not exist yet needs.
fn resolve(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
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

/// What `watch_dirs` answers: how many directories are covered, and which of the
/// requested ones could not be, so the frontend can say the view may be stale
/// rather than pretend everything is seen.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchReport {
    /// Directories this watcher was asked to cover. Not the number of OS watches:
    /// `.git` is watched recursively, which on Linux expands to one inotify watch
    /// per directory under it. The count is what the frontend requested, useful to
    /// see the set move; it is deliberately not presented as a quota figure.
    pub watched: usize,
    pub failed: Vec<String>,
}

/// A directory created inside a watched one is not covered by that watch: inotify
/// is flat, so the new directory needs a watch of its own. The frontend gets the
/// creation as a tree change, reloads the tree and sends the set again, which is
/// what installs it - but only if the directory is expanded. A newly created
/// directory the user has not opened is deliberately left uncovered, exactly like
/// every other collapsed one.
/// One worktree's watcher plus the set of directories it currently covers.
struct Watched {
    watcher: RecommendedWatcher,
    dirs: std::collections::HashSet<PathBuf>,
    failed: Vec<PathBuf>,
}

impl Watched {
    fn add(&mut self, dir: &Path, mode: RecursiveMode) -> bool {
        if self.dirs.contains(dir) {
            return true;
        }
        match self.watcher.watch(dir, mode) {
            Ok(()) => {
                self.dirs.insert(dir.to_path_buf());
                true
            }
            // One directory refused - a race with a deletion, or the inotify quota -
            // must not sink the rest: what can be watched still is, and the caller
            // is told what is missing.
            Err(_) => {
                self.failed.push(dir.to_path_buf());
                false
            }
        }
    }

    fn remove(&mut self, dir: &Path) {
        if self.dirs.remove(dir) {
            let _ = self.watcher.unwatch(dir);
        }
    }
}

#[tauri::command]
/// Declares the exact set of directories to watch for a worktree, on top of the
/// root and the git metadata which are always covered.
///
/// The set is what the user is actually looking at - the directories expanded in
/// the tree and the parents of the open tabs - not the whole repository. On Linux
/// inotify has no recursive watch: `notify` emulates one by walking the tree and
/// placing a watch on every directory, `node_modules` included, which is how a
/// single project reaches five figures against a per-user quota shared with every
/// other program. Watching what is on screen costs a few dozen instead.
///
/// Idempotent: the backend diffs against what it already holds and only moves the
/// difference, so the frontend can send the whole set on every change.
pub async fn watch_dirs(
    app: tauri::AppHandle,
    path: String,
    dirs: Vec<String>,
) -> Result<WatchReport, String> {
    // Canonicalised on both sides before anything is compared. `notify` reports
    // resolved paths, and a worktree under a symlinked home or /tmp would
    // otherwise fail every `starts_with` below: `wanted` would collapse to the
    // root alone and the diff would unwatch everything, silently, with an empty
    // `failed` so nothing would say the view had stopped updating.
    let root = resolve(&PathBuf::from(shellexpand::tilde(&path).into_owned()));
    let gitdir = resolve(&gitdir_of(&root));
    let state = app.state::<WatchState>();
    let mut watchers = state.watchers.lock().map_err(|e| e.to_string())?;

    if !watchers.contains_key(&path) {
        let tx = sender(&app);
        let (cb_root, cb_gitdir, key) = (root.clone(), gitdir.clone(), path.clone());
        let watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
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
        // The root and the gitdir are not installed here: they are part of `wanted`
        // below, so the same diff loop places them and records a refusal the same
        // way it does for any other directory.
        watchers.insert(path.clone(), Watched { watcher, dirs: Default::default(), failed: Vec::new() });
    }

    let w = watchers.get_mut(&path).ok_or("watcher vanished")?;
    // Cleared so the report describes this call rather than accumulating every
    // refusal of the session; the loop below re-records anything still failing.
    w.failed.clear();

    let mut wanted: std::collections::HashSet<PathBuf> = dirs
        .iter()
        .map(|d| resolve(&PathBuf::from(shellexpand::tilde(d).into_owned())))
        // A path outside the worktree is not this watcher's business.
        .filter(|d| d.starts_with(&root))
        .collect();
    // The fixed watches are part of the set and are never dropped by a diff.
    wanted.insert(root.clone());
    if gitdir.is_dir() {
        wanted.insert(gitdir.clone());
    }

    for stale in w.dirs.difference(&wanted).cloned().collect::<Vec<_>>() {
        w.remove(&stale);
    }
    for dir in &wanted {
        if !w.dirs.contains(dir) && dir.is_dir() {
            let mode = if dir == &gitdir { RecursiveMode::Recursive } else { RecursiveMode::NonRecursive };
            w.add(dir, mode);
        }
    }

    Ok(WatchReport {
        watched: w.dirs.len(),
        failed: w.failed.iter().map(|p| p.to_string_lossy().into_owned()).collect(),
    })
}

#[tauri::command]
pub async fn unwatch_worktree(app: tauri::AppHandle, path: String) -> Result<(), String> {
    app.state::<WatchState>().watchers.lock().map_err(|e| e.to_string())?.remove(&path);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(label: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("cairn-fswatch-{}-{}", std::process::id(), label));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        // macOS resolves the temp dir through a symlink; `notify` reports the real
        // path, so strip_prefix in classify would fail against the symlinked one.
        path.canonicalize().unwrap()
    }

    #[test]
    fn classifies_tree_git_and_noise() {
        let root = Path::new("/w");
        let gitdir = Path::new("/w/.git");
        assert_eq!(classify(Path::new("/w/src/a.ts"), root, gitdir), Some(true));
        assert_eq!(classify(Path::new("/w/.git/index"), root, gitdir), Some(false));
        assert_eq!(classify(Path::new("/w/.git/refs/heads/main"), root, gitdir), Some(false));
        assert_eq!(classify(Path::new("/w/.git/objects/ab/cd"), root, gitdir), None);
        assert_eq!(classify(Path::new("/w/.git/index.lock"), root, gitdir), None);
        assert_eq!(classify(Path::new("/elsewhere/f"), root, gitdir), None);
        assert_eq!(classify(Path::new("/w/.git"), root, gitdir), None);
    }

    /// No `.gitignore` filtering anywhere, root included. A watched directory is
    /// one the user opened, and the tree can display ignored files, so an ignored
    /// file appearing in it has to show up like any other. The noise the original
    /// report described came from watching directories nobody had opened, which
    /// the per-directory model already prevents.
    #[test]
    fn an_ignored_file_is_reported_like_any_other() {
        let root = Path::new("/w");
        let gitdir = Path::new("/w/.git");
        assert_eq!(classify(Path::new("/w/debug.log"), root, gitdir), Some(true));
        assert_eq!(classify(Path::new("/w/node_modules/pkg/index.js"), root, gitdir), Some(true));
        assert_eq!(classify(Path::new("/w/storage/logs/laravel.log"), root, gitdir), Some(true));
    }

    #[test]
    fn classifies_a_linked_worktree_gitdir() {
        let root = Path::new("/w");
        let gitdir = Path::new("/repo/.git/worktrees/w");
        assert_eq!(classify(Path::new("/repo/.git/worktrees/w/HEAD"), root, gitdir), Some(false));
        assert_eq!(classify(Path::new("/repo/.git/worktrees/w/logs/HEAD"), root, gitdir), None);
    }

    /// The whole point of the design: a watch covers one directory, so the number
    /// of watches follows what is on screen and not the size of the repository.
    #[test]
    fn a_watch_covers_one_directory_and_not_its_children() {
        let root = temp_root("scope");
        std::fs::create_dir_all(root.join("src/deep")).unwrap();

        let (tx, rx) = channel::<PathBuf>();
        let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            let Ok(event) = res else { return };
            for p in &event.paths {
                let _ = tx.send(p.clone());
            }
        })
        .unwrap();
        watcher.watch(&root.join("src"), RecursiveMode::NonRecursive).unwrap();

        std::fs::write(root.join("src/deep/buried.ts"), "x").unwrap();
        assert!(
            rx.recv_timeout(Duration::from_millis(1200)).is_err(),
            "a non-recursive watch must not report a nested directory"
        );

        std::fs::write(root.join("src/direct.ts"), "x").unwrap();
        let seen = rx.recv_timeout(Duration::from_secs(5)).expect("its own entries must be reported");
        assert!(seen.ends_with("direct.ts"));

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_directory_created_later_is_covered_by_its_parent_watch() {
        let root = temp_root("created");

        let (tx, rx) = channel::<PathBuf>();
        let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            let Ok(event) = res else { return };
            for p in &event.paths {
                let _ = tx.send(p.clone());
            }
        })
        .unwrap();
        watcher.watch(&root, RecursiveMode::NonRecursive).unwrap();

        std::fs::create_dir(root.join("fresh")).unwrap();
        let seen = rx.recv_timeout(Duration::from_secs(5)).expect("a new directory must be announced");
        assert!(seen.ends_with("fresh"), "so the frontend can send the set again");

        let _ = std::fs::remove_dir_all(&root);
    }
}
