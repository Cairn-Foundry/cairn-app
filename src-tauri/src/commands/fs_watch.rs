// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

//! One filesystem watcher per worktree the frontend asked for. Events are
//! debounced and classified: a change under `.git` that moves the status
//! (index, HEAD, refs) is reported as git-only, anything else as a tree change.
//! A path the worktree's `.gitignore` excludes is noise: `storage/` or a log
//! directory written to continuously would otherwise walk the whole tree, read
//! the status and re-blame the open file every few seconds, with nothing on
//! screen ever changing.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use ignore::gitignore::{Gitignore, GitignoreBuilder};
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
/// moves the git status, `None` for noise (objects, lock files, node_modules,
/// anything `.gitignore` excludes).
fn classify(path: &Path, root: &Path, gitdir: &Path, ignored: &[(PathBuf, Gitignore)]) -> Option<bool> {
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
    if is_ignored(ignored, path) {
        return None;
    }
    Some(true)
}

/// Depth of the descent looking for nested `.gitignore` files. Deeper ones are
/// rare and the scan reruns whenever one of them is written, so it stays bounded.
const IGNORE_SCAN_DEPTH: u32 = 4;

/// Directories the ignore scan never descends into, and whose `.gitignore` files
/// therefore never affect the matcher.
const IGNORE_SCAN_SKIP: &[&str] = &["node_modules", "target", "vendor", "dist", "build"];

/// The worktree's ignore rules: one matcher per directory holding a `.gitignore`,
/// each anchored at that directory, plus the root one and `.git/info/exclude`.
///
/// They cannot be merged into a single builder. `GitignoreBuilder` compiles every
/// pattern relative to the root it was constructed with, so an anchored rule in
/// `app/.gitignore` - `/build/` - would come out matching `<root>/build` and miss
/// `<root>/app/build`: the loud directory stays loud, and an unrelated top-level
/// one is silenced instead.
fn build_ignore(root: &Path, gitdir: &Path) -> Vec<(PathBuf, Gitignore)> {
    let mut out = Vec::new();
    let mut root_builder = GitignoreBuilder::new(root);
    root_builder.add(gitdir.join("info").join("exclude"));
    root_builder.add(root.join(".gitignore"));
    if let Ok(matcher) = root_builder.build() {
        out.push((root.to_path_buf(), matcher));
    }
    for dir in gitignore_dirs(root, IGNORE_SCAN_DEPTH) {
        let mut builder = GitignoreBuilder::new(&dir);
        builder.add(dir.join(".gitignore"));
        if let Ok(matcher) = builder.build() {
            out.push((dir, matcher));
        }
    }
    out
}

/// True when any matcher covering this path excludes it, as a file and as a
/// directory: an event carries no file type, and stat'ing on the watcher thread
/// for every event would be worse than testing both.
///
/// Each matcher is only asked about paths under its own directory - `ignore`
/// panics on anything else - which is also what makes a nested `.gitignore` apply
/// exactly where git applies it.
fn is_ignored(matchers: &[(PathBuf, Gitignore)], path: &Path) -> bool {
    matchers.iter().any(|(dir, m)| {
        path.starts_with(dir)
            && (m.matched_path_or_any_parents(path, false).is_ignore()
                || m.matched_path_or_any_parents(path, true).is_ignore())
    })
}

/// Whether a changed path is a `.gitignore` the matcher actually reads: inside the
/// worktree, within the scan depth, and not under a directory the scan skips.
fn affects_ignore_rules(path: &Path, root: &Path) -> bool {
    if path.file_name().is_none_or(|n| n != ".gitignore") {
        return false;
    }
    let Ok(rel) = path.strip_prefix(root) else { return false };
    let dirs: Vec<_> = rel.components().collect();
    // The last component is the file name itself.
    let depth = dirs.len().saturating_sub(1);
    if depth > IGNORE_SCAN_DEPTH as usize {
        return false;
    }
    !dirs[..depth].iter().any(|c| {
        let name = c.as_os_str().to_string_lossy();
        name.starts_with('.') || IGNORE_SCAN_SKIP.contains(&name.as_ref())
    })
}

/// Directories below `root` holding a `.gitignore`, down to `depth`, skipping
/// hidden and dependency directories so the scan never walks into a `node_modules`
/// or a `target`. The root itself is handled separately and never returned.
fn gitignore_dirs(root: &Path, depth: u32) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut frontier = vec![root.to_path_buf()];
    for _ in 0..=depth {
        let mut next = Vec::new();
        for dir in frontier {
            if dir != root && dir.join(".gitignore").is_file() {
                out.push(dir.clone());
            }
            let Ok(entries) = std::fs::read_dir(&dir) else { continue };
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                if name.starts_with('.') || IGNORE_SCAN_SKIP.contains(&name.as_ref()) {
                    continue;
                }
                if entry.file_type().is_ok_and(|t| t.is_dir()) {
                    next.push(entry.path());
                }
            }
        }
        frontier = next;
    }
    out
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
    let ignored = Arc::new(Mutex::new(build_ignore(&root, &gitdir)));
    let (cb_root, cb_gitdir, key) = (root.clone(), gitdir.clone(), path.clone());
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(event) = res else { return };
        // An edited `.gitignore` changes what counts as noise from here on, so the
        // matcher is rebuilt before the event that carried it is classified.
        // Only a `.gitignore` that the scan would actually have picked up is worth a
        // rebuild - `build_ignore` walks the tree synchronously on this thread, and a
        // checkout touching a dozen ignored-away ones would otherwise run that walk a
        // dozen times while every other event queues up behind it.
        if event.paths.iter().any(|p| affects_ignore_rules(p, &cb_root))
            && let Ok(mut slot) = ignored.lock()
        {
            *slot = build_ignore(&cb_root, &cb_gitdir);
        }
        let Ok(ignored) = ignored.lock() else { return };
        let mut verdict: Option<bool> = None;
        for p in &event.paths {
            if let Some(tree) = classify(p, &cb_root, &cb_gitdir, &ignored) {
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

    fn no_ignore() -> Vec<(PathBuf, Gitignore)> {
        Vec::new()
    }

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
        let ig = no_ignore();
        assert_eq!(classify(Path::new("/w/src/a.ts"), root, gitdir, &ig), Some(true));
        assert_eq!(classify(Path::new("/w/.git/index"), root, gitdir, &ig), Some(false));
        assert_eq!(classify(Path::new("/w/.git/refs/heads/main"), root, gitdir, &ig), Some(false));
        assert_eq!(classify(Path::new("/w/.git/objects/ab/cd"), root, gitdir, &ig), None);
        assert_eq!(classify(Path::new("/w/.git/index.lock"), root, gitdir, &ig), None);
        assert_eq!(classify(Path::new("/w/node_modules/x/y.js"), root, gitdir, &ig), None);
        assert_eq!(classify(Path::new("/elsewhere/f"), root, gitdir, &ig), None);
        assert_eq!(classify(Path::new("/w/.git"), root, gitdir, &ig), None);
    }

    #[test]
    fn classifies_a_linked_worktree_gitdir() {
        let root = Path::new("/w");
        let gitdir = Path::new("/repo/.git/worktrees/w");
        let ig = no_ignore();
        assert_eq!(classify(Path::new("/repo/.git/worktrees/w/HEAD"), root, gitdir, &ig), Some(false));
        assert_eq!(classify(Path::new("/repo/.git/worktrees/w/logs/HEAD"), root, gitdir, &ig), None);
    }

    #[test]
    fn drops_ignored_paths() {
        let root = Path::new("/w");
        let gitdir = Path::new("/w/.git");
        let mut builder = GitignoreBuilder::new(root);
        builder.add_line(None, "storage/").unwrap();
        builder.add_line(None, "*.log").unwrap();
        let ig = vec![(root.to_path_buf(), builder.build().unwrap())];
        assert_eq!(classify(Path::new("/w/storage/logs/laravel.log"), root, gitdir, &ig), None);
        assert_eq!(classify(Path::new("/w/storage"), root, gitdir, &ig), None);
        assert_eq!(classify(Path::new("/w/debug.log"), root, gitdir, &ig), None);
        assert_eq!(classify(Path::new("/w/src/a.ts"), root, gitdir, &ig), Some(true));
        assert_eq!(classify(Path::new("/w/.git/index"), root, gitdir, &ig), Some(false));
    }

    /// The real `notify` watcher, so the filter is exercised where it runs rather
    /// than only through `classify`: a write inside an ignored directory must not
    /// reach the channel, a write next to it must.
    #[test]
    fn a_live_watcher_stays_silent_on_an_ignored_write() {
        let root = temp_root("live");
        std::fs::write(root.join(".gitignore"), "storage/\n").unwrap();
        std::fs::create_dir_all(root.join("storage")).unwrap();
        std::fs::create_dir_all(root.join("src")).unwrap();

        let ignored = build_ignore(&root, &root.join(".git"));
        let (tx, rx) = channel::<(String, bool)>();
        let (cb_root, cb_gitdir) = (root.clone(), root.join(".git"));
        let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            let Ok(event) = res else { return };
            for p in &event.paths {
                if let Some(tree) = classify(p, &cb_root, &cb_gitdir, &ignored) {
                    let _ = tx.send((p.to_string_lossy().into_owned(), tree));
                }
            }
        })
        .unwrap();
        watcher.watch(&root, RecursiveMode::Recursive).unwrap();

        std::fs::write(root.join("storage/laravel.log"), "noise").unwrap();
        assert!(rx.recv_timeout(Duration::from_millis(1500)).is_err(), "an ignored write woke the watcher");

        std::fs::write(root.join("src/a.ts"), "export {}").unwrap();
        let (path, tree) = rx.recv_timeout(Duration::from_secs(5)).expect("a tracked write was swallowed");
        assert!(path.ends_with("a.ts"));
        assert!(tree);

        let _ = std::fs::remove_dir_all(&root);
    }

    /// A plain directory the user opened as a project has no `.git` at all. The
    /// matcher must still build - an empty one, excluding nothing - or the watcher
    /// would fail to install and the frontend would fall back to polling.
    #[test]
    fn a_directory_without_a_repository_still_builds_a_matcher() {
        let root = temp_root("nogit");
        std::fs::write(root.join("test.md"), "# hello").unwrap();

        let ignored = build_ignore(&root, &root.join(".git"));
        let gitdir = root.join(".git");
        assert_eq!(classify(&root.join("test.md"), &root, &gitdir, &ignored), Some(true));

        let _ = std::fs::remove_dir_all(&root);
    }

    /// Does a nested `.gitignore` anchor its rules at its own directory?
    #[test]
    fn a_nested_gitignore_anchors_its_rules_at_its_own_directory() {
        let root = temp_root("anchor");
        std::fs::create_dir_all(root.join("app")).unwrap();
        std::fs::write(root.join("app/.gitignore"), "/build/\n").unwrap();

        let ig = build_ignore(&root, &root.join(".git"));
        assert!(
            is_ignored(&ig, &root.join("app/build/x")),
            "app/.gitignore '/build/' must cover app/build"
        );
        assert!(
            !is_ignored(&ig, &root.join("build/x")),
            "it must not cover the unrelated top-level build/"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn only_a_gitignore_the_scan_reads_triggers_a_rebuild() {
        let root = Path::new("/w");
        assert!(affects_ignore_rules(Path::new("/w/.gitignore"), root));
        assert!(affects_ignore_rules(Path::new("/w/app/.gitignore"), root));

        assert!(!affects_ignore_rules(Path::new("/w/src/main.rs"), root));
        assert!(!affects_ignore_rules(Path::new("/elsewhere/.gitignore"), root));
        assert!(
            !affects_ignore_rules(Path::new("/w/node_modules/pkg/.gitignore"), root),
            "the scan never descends there, so it changes nothing"
        );
        assert!(
            !affects_ignore_rules(Path::new("/w/a/b/c/d/e/.gitignore"), root),
            "past the scan depth"
        );
    }

    #[test]
    fn collects_nested_gitignore_files_without_walking_dependencies() {
        let root = &temp_root("nested");
        std::fs::write(root.join(".gitignore"), "storage/\n").unwrap();
        std::fs::create_dir_all(root.join("app")).unwrap();
        std::fs::write(root.join("app/.gitignore"), "*.tmp\n").unwrap();
        std::fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        std::fs::write(root.join("node_modules/pkg/.gitignore"), "*\n").unwrap();

        let found = gitignore_dirs(root, IGNORE_SCAN_DEPTH);
        assert!(found.contains(&root.join("app")));
        assert!(!found.contains(&root.to_path_buf()), "the root is handled separately");
        assert!(!found.iter().any(|p| p.to_string_lossy().contains("node_modules")));

        let ig = build_ignore(root, &root.join(".git"));
        assert!(is_ignored(&ig, &root.join("storage/logs/a.log")));
        assert!(is_ignored(&ig, &root.join("app/x.tmp")));

        let _ = std::fs::remove_dir_all(root);
    }
}
