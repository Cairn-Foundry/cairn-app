//! Filesystem access for the editor: directory trees honouring `.gitignore`,
//! fuzzy path search, content search, and the read/write/rename primitives.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use grep_matcher::Matcher;
use grep_regex::RegexMatcherBuilder;
use grep_searcher::{BinaryDetection, SearcherBuilder, Sink, SinkMatch};
use ignore::WalkBuilder;
use ignore::overrides::OverrideBuilder;
use nucleo_matcher::pattern::{CaseMatching, Normalization, Pattern};
use nucleo_matcher::{Config, Matcher as NucleoMatcher};
use serde::{Deserialize, Serialize};

const SEARCH_RESULT_CAP: usize = 2000;

/// One node of the file tree, with `path` relative to the tree root.
#[derive(Serialize)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    #[serde(rename = "isDir")]
    pub is_dir: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<FileNode>>,
}

/// Intermediate tree keyed by name, so walked paths can be assembled in any order.
#[derive(Default)]
struct TreeBuilder {
    is_dir: bool,
    rel: String,
    children: std::collections::BTreeMap<String, TreeBuilder>,
}

/// Walks the tree honouring ignore rules unless `show_ignored`; `.git` is always skipped.
fn build_gitignore_tree(root: &PathBuf, show_ignored: bool) -> Vec<FileNode> {
    let mut builder = WalkBuilder::new(root);
    builder
        .hidden(false)
        .git_ignore(!show_ignored)
        .git_global(!show_ignored)
        .git_exclude(!show_ignored)
        .ignore(!show_ignored)
        .parents(!show_ignored)
        .filter_entry(|e| e.file_name() != ".git");

    // Walking in parallel and assembling afterwards: with `show_ignored` the walk
    // descends into dependency directories and is what the whole call costs, while
    // the assembly below is a single pass over the paths it found.
    let collected = Mutex::new(Vec::new());
    builder.build_parallel().run(|| {
        Box::new(|entry| {
            if let Ok(entry) = entry {
                let is_dir = entry.file_type().is_some_and(|ft| ft.is_dir());
                if let Ok(mut out) = collected.lock() {
                    out.push((entry.into_path(), is_dir));
                }
            }
            ignore::WalkState::Continue
        })
    });

    let mut entries = collected.into_inner().unwrap_or_default();
    entries.sort_by(|a, b| a.0.cmp(&b.0));

    let mut tree = TreeBuilder::default();
    for (path, is_dir) in &entries {
        let rel = match path.strip_prefix(root) {
            Ok(r) if !r.as_os_str().is_empty() => r,
            _ => continue,
        };
        let is_dir = *is_dir;

        let components: Vec<_> = rel.components().collect();
        let last = components.len().saturating_sub(1);
        let mut partial = PathBuf::new();
        let mut cursor = &mut tree;
        for (i, comp) in components.iter().enumerate() {
            partial.push(comp);
            let name = comp.as_os_str().to_string_lossy().to_string();
            cursor = cursor.children.entry(name).or_default();
            cursor.rel = partial.to_string_lossy().to_string();
            cursor.is_dir = if i == last { is_dir } else { true };
        }
    }

    to_file_nodes(tree.children)
}

/// Turns the builder map into the serialized tree, directories first then case-insensitive by name.
fn to_file_nodes(children: std::collections::BTreeMap<String, TreeBuilder>) -> Vec<FileNode> {
    let mut nodes: Vec<FileNode> = children
        .into_iter()
        .map(|(name, node)| {
            let child_nodes = if node.is_dir { Some(to_file_nodes(node.children)) } else { None };
            FileNode { name, path: node.rel, is_dir: node.is_dir, children: child_nodes }
        })
        .collect();

    nodes.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    nodes
}

/// Flat list of every file and directory under `root`, used as the quick-search index.
fn collect_entries(root: &PathBuf, include_ignored: bool) -> Vec<QuickSearchHit> {
    let mut builder = WalkBuilder::new(root);
    builder
        .hidden(false)
        .git_ignore(!include_ignored)
        .git_global(!include_ignored)
        .git_exclude(!include_ignored)
        .ignore(!include_ignored)
        .parents(!include_ignored)
        .filter_entry(|e| e.file_name() != ".git");

    let mut entries = Vec::new();
    for entry in builder.build().flatten() {
        let Some(ft) = entry.file_type() else { continue };
        if !ft.is_file() && !ft.is_dir() {
            continue;
        }
        if let Ok(rel) = entry.path().strip_prefix(root) {
            let path = rel.to_string_lossy().to_string();
            if path.is_empty() {
                continue;
            }
            entries.push(QuickSearchHit { path, is_dir: ft.is_dir() });
        }
    }
    entries
}

/// Path separators become atom separators, so "src/foo" matches the same as "src foo".
fn parse_query(query: &str) -> Pattern {
    let atoms = query.replace(['/', '\\'], " ");
    Pattern::parse(&atoms, CaseMatching::Ignore, Normalization::Smart)
}

/// A quick-search entry, matched on its root-relative path.
#[derive(Clone, Serialize)]
pub struct QuickSearchHit {
    pub path: String,
    #[serde(rename = "isDir")]
    pub is_dir: bool,
}

impl AsRef<str> for QuickSearchHit {
    fn as_ref(&self) -> &str {
        &self.path
    }
}

/// Cached entry list; `key` pairs the root with the ignore setting it was built for.
pub struct QuickSearchIndex {
    key: String,
    entries: Arc<Vec<QuickSearchHit>>,
}

/// Managed state holding the last quick-search index, rebuilt when the key changes.
#[derive(Default)]
pub struct QuickSearchCache(Mutex<Option<QuickSearchIndex>>);

#[tauri::command]
/// Fuzzy path search over a cached index, rebuilt when the root, the ignore flag or `refresh` demand it.
pub async fn quick_search(
    state: tauri::State<'_, QuickSearchCache>,
    path: String,
    query: String,
    include_ignored: bool,
    refresh: bool,
    limit: usize,
) -> Result<Vec<QuickSearchHit>, String> {
    let expanded = shellexpand::tilde(&path).into_owned();
    let key = format!("{}::{}", expanded, include_ignored);

    // The index is cloned out and the lock released before matching: a fuzzy match
    // over the whole entry list would otherwise serialise concurrent keystrokes.
    let entries = {
        let mut guard = state.0.lock().map_err(|e| e.to_string())?;
        let stale = refresh || guard.as_ref().map(|c| c.key != key).unwrap_or(true);
        if stale {
            let root = PathBuf::from(&expanded);
            if !root.exists() { return Err(format!("Path does not exist: {}", path)); }
            let entries = Arc::new(collect_entries(&root, include_ignored));
            *guard = Some(QuickSearchIndex { key, entries });
        }
        match guard.as_ref() {
            Some(index) => Arc::clone(&index.entries),
            None => return Ok(Vec::new()),
        }
    };

    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(entries.iter().take(limit).cloned().collect());
    }

    let mut matcher = NucleoMatcher::new(Config::DEFAULT.match_paths());
    let pattern = parse_query(trimmed);
    let mut matches = pattern.match_list(entries.iter(), &mut matcher);
    matches.truncate(limit);
    Ok(matches.into_iter().map(|(hit, _)| hit.clone()).collect())
}

/// The tree as one string plus one parent index per entry, in display order:
/// a fraction of the nested JSON, and the webview rebuilds the hierarchy in a
/// single pass. Directories carry a trailing separator in `names`.
#[derive(Serialize, Deserialize, Clone)]
pub struct FlatTree {
    pub names:   String,
    pub parents: Vec<i32>,
    pub sep:     String,
}

fn flatten_tree(nodes: &[FileNode]) -> FlatTree {
    fn walk(nodes: &[FileNode], parent: i32, names: &mut String, parents: &mut Vec<i32>) {
        for node in nodes {
            if !names.is_empty() {
                names.push('\n');
            }
            names.push_str(&node.name);
            if node.is_dir {
                names.push('/');
            }
            parents.push(parent);
            let index = parents.len() as i32 - 1;
            if let Some(children) = &node.children {
                walk(children, index, names, parents);
            }
        }
    }
    let mut names = String::new();
    let mut parents = Vec::new();
    walk(nodes, -1, &mut names, &mut parents);
    FlatTree { names, parents, sep: std::path::MAIN_SEPARATOR.to_string() }
}

fn tree_cache_path(root: &Path, show_ignored: bool) -> Result<PathBuf, String> {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    root.hash(&mut hasher);
    Ok(crate::storage::cairn_dir()?
        .join("tree-cache")
        .join(format!("{:016x}-{}.json", hasher.finish(), u8::from(show_ignored))))
}

#[tauri::command]
/// Full recursive tree of the directory. The result is also written to the
/// tree cache, so the next launch paints it before any walk.
pub async fn read_dir_tree(path: String, show_ignored: bool) -> Result<FlatTree, String> {
    let expanded = shellexpand::tilde(&path).into_owned();
    let root = PathBuf::from(&expanded);
    if !root.exists() { return Err(format!("Path does not exist: {}", path)); }
    let flat = flatten_tree(&build_gitignore_tree(&root, show_ignored));
    if let Ok(cache) = tree_cache_path(&root, show_ignored) {
        let snapshot = flat.clone();
        std::thread::spawn(move || {
            let _ = crate::storage::write_json_atomic(&cache, &snapshot);
        });
    }
    Ok(flat)
}

#[tauri::command]
/// The last tree walked for this directory, from disk; `None` when never walked.
pub async fn read_dir_tree_cached(path: String, show_ignored: bool) -> Result<Option<FlatTree>, String> {
    let expanded = shellexpand::tilde(&path).into_owned();
    let cache = tree_cache_path(&PathBuf::from(&expanded), show_ignored)?;
    let Ok(text) = fs::read_to_string(&cache) else { return Ok(None) };
    Ok(serde_json::from_str(&text).ok())
}

#[tauri::command]
/// Non-recursive entry names; a missing path yields an empty list rather than an error.
pub async fn list_dir_names(path: String) -> Result<Vec<String>, String> {
    let expanded = shellexpand::tilde(&path).into_owned();
    let p = PathBuf::from(&expanded);
    if !p.exists() {
        return Ok(Vec::new());
    }
    let mut names = Vec::new();
    for entry in fs::read_dir(&p).map_err(|e| e.to_string())?.flatten() {
        if let Some(n) = entry.file_name().to_str() {
            names.push(n.to_string());
        }
    }
    Ok(names)
}

/// Past this, a file is not something the editor can usefully hold: the bytes cross
/// the IPC boundary as JSON and land in the webview heap whole. A stray build artifact
/// left untracked in a worktree would otherwise freeze the window on its own.
pub const MAX_TEXT_FILE_BYTES: u64 = 10 * 1024 * 1024;

#[tauri::command]
/// Last-modified time in milliseconds for each path; a path that cannot be
/// read simply has no entry, which the caller treats as unchanged.
pub async fn file_mtimes(paths: Vec<String>) -> Result<std::collections::HashMap<String, u64>, String> {
    let mut out = std::collections::HashMap::new();
    for path in paths {
        let expanded = shellexpand::tilde(&path).into_owned();
        let Ok(meta) = fs::metadata(&expanded) else { continue };
        let Ok(modified) = meta.modified() else { continue };
        let Ok(dur) = modified.duration_since(std::time::UNIX_EPOCH) else { continue };
        out.insert(path, dur.as_millis() as u64);
    }
    Ok(out)
}

const PREVIEW_HEAD_BYTES: usize = 1024;

/// Size plus the first bytes as hex, enough for the frontend to sniff the type.
#[derive(Serialize)]
pub struct FilePreview {
    pub size: u64,
    #[serde(rename = "headHex")]
    pub head_hex: String,
}

#[tauri::command]
/// Size and the first kilobyte hex-encoded, for detecting a binary file's kind.
pub async fn read_file_preview(path: String) -> Result<FilePreview, String> {
    use std::io::Read;
    let expanded = shellexpand::tilde(&path).into_owned();
    let p = PathBuf::from(&expanded);
    let meta = fs::metadata(&p).map_err(|e| e.to_string())?;
    let mut head = vec![0u8; PREVIEW_HEAD_BYTES];
    let mut file = fs::File::open(&p).map_err(|e| e.to_string())?;
    let mut read = 0usize;
    while read < head.len() {
        match file.read(&mut head[read..]).map_err(|e| e.to_string())? {
            0 => break,
            n => read += n,
        }
    }
    let head_hex = head[..read].iter().map(|b| format!("{:02x}", b)).collect();
    Ok(FilePreview { size: meta.len(), head_hex })
}

const MAX_INLINE_PREVIEW_BYTES: u64 = 64 * 1024 * 1024;

#[tauri::command]
/// Whole file base64-encoded for inline display; refuses anything over 64 MB.
pub async fn read_file_base64(path: String) -> Result<String, String> {
    use base64::Engine;
    let expanded = shellexpand::tilde(&path).into_owned();
    let p = PathBuf::from(&expanded);
    let meta = fs::metadata(&p).map_err(|e| e.to_string())?;
    if meta.len() > MAX_INLINE_PREVIEW_BYTES {
        return Err(format!("File too large to inline: {} bytes", meta.len()));
    }
    let bytes = fs::read(&p).map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
/// Writes the file, creating missing parent directories.
pub async fn write_file(path: String, content: String) -> Result<(), String> {
    let expanded = shellexpand::tilde(&path).into_owned();
    let p = PathBuf::from(&expanded);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&p, content).map_err(|e| e.to_string())
}

#[tauri::command]
/// Deletes a file, or a directory and its contents.
pub async fn delete_path(path: String) -> Result<(), String> {
    let expanded = shellexpand::tilde(&path).into_owned();
    let p = PathBuf::from(&expanded);
    if !p.exists() { return Err(format!("Path does not exist: {}", path)); }
    if p.is_dir() {
        fs::remove_dir_all(&p).map_err(|e| e.to_string())
    } else {
        fs::remove_file(&p).map_err(|e| e.to_string())
    }
}

#[tauri::command]
/// Renames, refusing to overwrite an existing destination.
pub async fn rename_path(from: String, to: String) -> Result<(), String> {
    let from_expanded = shellexpand::tilde(&from).into_owned();
    let to_expanded = shellexpand::tilde(&to).into_owned();
    let from_p = PathBuf::from(&from_expanded);
    let to_p = PathBuf::from(&to_expanded);
    if !from_p.exists() { return Err(format!("Path does not exist: {}", from)); }
    if to_p.exists() { return Err(format!("Destination already exists: {}", to)); }
    fs::rename(&from_p, &to_p).map_err(|e| e.to_string())
}

#[tauri::command]
/// Creates an empty file or a directory; errors if the path is taken.
pub async fn create_file_or_dir(path: String, is_dir: bool) -> Result<(), String> {
    let expanded = shellexpand::tilde(&path).into_owned();
    let p = PathBuf::from(&expanded);
    if p.exists() { return Err(format!("Already exists: {}", path)); }
    if is_dir {
        fs::create_dir_all(&p).map_err(|e| e.to_string())
    } else {
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::File::create(&p).map(|_| ()).map_err(|e| e.to_string())
    }
}

/// One match, with byte offsets of the match inside `text`.
#[derive(Serialize)]
pub struct SearchMatch {
    pub path: String,
    pub line: u32,
    pub col: u32,
    pub text: String,
    #[serde(rename = "matchStart")]
    pub match_start: u32,
    #[serde(rename = "matchEnd")]
    pub match_end: u32,
}

/// Collects every match on a line, sharing the global result cap across walker threads.
struct MatchSink<'a, M: Matcher> {
    matcher: &'a M,
    rel: &'a str,
    results: &'a mut Vec<SearchMatch>,
    count: &'a AtomicUsize,
}

/// Merges a walker thread's buffer into the shared list when the thread ends,
/// whichever way it ends - the walk running out of entries, or the cap quitting it.
struct ThreadResults {
    local: Vec<SearchMatch>,
    collected: Arc<Mutex<Vec<Vec<SearchMatch>>>>,
}

impl Drop for ThreadResults {
    fn drop(&mut self) {
        if self.local.is_empty() {
            return;
        }
        if let Ok(mut all) = self.collected.lock() {
            all.push(std::mem::take(&mut self.local));
        }
    }
}

impl<'a, M: Matcher> Sink for MatchSink<'a, M> {
    type Error = std::io::Error;

    fn matched(&mut self, _searcher: &grep_searcher::Searcher, mat: &SinkMatch) -> Result<bool, std::io::Error> {
        let line_num = mat.line_number().unwrap_or(0) as u32;
        let bytes = mat.bytes();
        let end = bytes.iter().rposition(|&b| b != b'\n' && b != b'\r').map_or(0, |i| i + 1);
        let line_bytes = &bytes[..end];
        let line_text = String::from_utf8_lossy(line_bytes).into_owned();

        let mut start = 0usize;
        while start <= line_bytes.len() {
            match self.matcher.find_at(line_bytes, start) {
                Ok(Some(m)) => {
                    if self.count.fetch_add(1, Ordering::Relaxed) >= SEARCH_RESULT_CAP {
                        return Ok(false);
                    }
                    self.results.push(SearchMatch {
                        path: self.rel.to_string(),
                        line: line_num,
                        col: (m.start() + 1) as u32,
                        text: line_text.clone(),
                        match_start: m.start() as u32,
                        match_end: m.end() as u32,
                    });
                    start = if m.end() > m.start() { m.end() } else { m.end() + 1 };
                }
                _ => break,
            }
        }
        Ok(self.count.load(Ordering::Relaxed) < SEARCH_RESULT_CAP)
    }
}

#[tauri::command]
/// Content search across the tree, run on a blocking thread. `include_glob` and
/// `exclude_glob` are comma-separated; results are capped at 2000 and sorted by path and position.
pub async fn search_in_files(
    root: String,
    query: String,
    case_sensitive: bool,
    is_regex: bool,
    include_glob: String,
    exclude_glob: String,
) -> Result<Vec<SearchMatch>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if query.trim().is_empty() { return Ok(vec![]); }
        let expanded = shellexpand::tilde(&root).into_owned();
        let root_path = PathBuf::from(&expanded);

        let pattern = if is_regex { query.clone() } else { regex::escape(&query) };
        let matcher = Arc::new(
            RegexMatcherBuilder::new()
                .case_insensitive(!case_sensitive)
                .build(&pattern)
                .map_err(|e| format!("Invalid regex: {}", e))?,
        );

        let mut override_builder = OverrideBuilder::new(&root_path);
        for inc in include_glob.split(',') {
            let inc = inc.trim();
            if !inc.is_empty() {
                override_builder.add(inc).map_err(|e| e.to_string())?;
            }
        }
        for exc in exclude_glob.split(',') {
            let exc = exc.trim();
            if !exc.is_empty() {
                override_builder.add(&format!("!{}", exc)).map_err(|e| e.to_string())?;
                override_builder.add(&format!("!**/{}/**", exc)).map_err(|e| e.to_string())?;
            }
        }
        let overrides = override_builder.build().map_err(|e| e.to_string())?;

        // Each walker thread fills its own buffer and merges once at the end: a
        // shared Mutex locked per match had every thread contending on a hot
        // search, which cost more than the walk itself.
        let collected: Arc<Mutex<Vec<Vec<SearchMatch>>>> = Arc::new(Mutex::new(Vec::new()));
        let count = Arc::new(AtomicUsize::new(0));

        WalkBuilder::new(&root_path)
            .overrides(overrides)
            .build_parallel()
            .run(|| {
                let matcher = Arc::clone(&matcher);
                let collected = Arc::clone(&collected);
                let count = Arc::clone(&count);
                let root_path = root_path.clone();
                let mut buffer = ThreadResults { local: Vec::new(), collected };
                // Built once per thread rather than once per file.
                let mut searcher = SearcherBuilder::new()
                    .binary_detection(BinaryDetection::quit(0))
                    .line_number(true)
                    .build();
                Box::new(move |entry| {
                    use ignore::WalkState;
                    if count.load(Ordering::Relaxed) >= SEARCH_RESULT_CAP {
                        return WalkState::Quit;
                    }
                    let entry = match entry { Ok(e) => e, Err(_) => return WalkState::Continue };
                    if !entry.file_type().is_some_and(|ft| ft.is_file()) {
                        return WalkState::Continue;
                    }
                    let path = entry.path();
                    let rel = path.strip_prefix(&root_path).unwrap_or(path).to_string_lossy().into_owned();
                    let sink = MatchSink { matcher: matcher.as_ref(), rel: &rel, results: &mut buffer.local, count: &count };
                    let _ = searcher.search_path(matcher.as_ref(), path, sink);
                    if count.load(Ordering::Relaxed) >= SEARCH_RESULT_CAP {
                        WalkState::Quit
                    } else {
                        WalkState::Continue
                    }
                })
            });

        let mut results: Vec<SearchMatch> = Arc::try_unwrap(collected)
            .map(|m| m.into_inner().unwrap())
            .unwrap_or_default()
            .into_iter()
            .flatten()
            .collect();
        results.sort_by(|a, b| a.path.cmp(&b.path).then(a.line.cmp(&b.line)).then(a.col.cmp(&b.col)));
        results.truncate(SEARCH_RESULT_CAP);
        Ok(results)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicU32;

    /// A throwaway directory tree, torn down with the guard.
    struct TempTree {
        path: PathBuf,
    }

    impl TempTree {
        fn new() -> Self {
            static COUNTER: AtomicU32 = AtomicU32::new(0);
            let n = COUNTER.fetch_add(1, Ordering::SeqCst);
            let path = std::env::temp_dir()
                .join(format!("cairn-files-test-{}-{}", std::process::id(), n));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).unwrap();
            TempTree { path }
        }

        fn write(&self, rel: &str, content: &str) {
            let full = self.path.join(rel);
            fs::create_dir_all(full.parent().unwrap()).unwrap();
            fs::write(full, content).unwrap();
        }

        fn mkdir(&self, rel: &str) {
            fs::create_dir_all(self.path.join(rel)).unwrap();
        }
    }

    impl Drop for TempTree {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn names(nodes: &[FileNode]) -> Vec<&str> {
        nodes.iter().map(|n| n.name.as_str()).collect()
    }

    #[test]
    fn tree_sorts_directories_first_then_case_insensitively() {
        let tree = TempTree::new();
        tree.write("Zeta.txt", "z");
        tree.write("alpha.txt", "a");
        tree.mkdir("src");
        tree.write("src/main.rs", "fn main() {}");
        tree.mkdir("Docs");

        let nodes = build_gitignore_tree(&tree.path, true);
        assert_eq!(names(&nodes), vec!["Docs", "src", "alpha.txt", "Zeta.txt"]);
    }

    #[test]
    fn tree_nests_children_under_their_directory_with_relative_paths() {
        let tree = TempTree::new();
        tree.write("src/lib/deep.rs", "x");

        let nodes = build_gitignore_tree(&tree.path, true);
        let src = &nodes[0];
        assert_eq!(src.name, "src");
        assert!(src.is_dir);

        let lib = &src.children.as_ref().unwrap()[0];
        assert_eq!(lib.path, "src/lib");

        let deep = &lib.children.as_ref().unwrap()[0];
        assert_eq!(deep.path, "src/lib/deep.rs");
        assert!(!deep.is_dir);
        assert!(deep.children.is_none());
    }

    #[test]
    fn tree_honours_gitignore_unless_show_ignored() {
        let tree = TempTree::new();
        // `ignore` only applies a .gitignore inside a repository.
        tree.mkdir(".git");
        tree.write(".gitignore", "ignored/\n");
        tree.write("ignored/secret.txt", "s");
        tree.write("kept.txt", "k");

        let hidden = build_gitignore_tree(&tree.path, false);
        assert!(!names(&hidden).contains(&"ignored"));
        assert!(names(&hidden).contains(&"kept.txt"));

        let shown = build_gitignore_tree(&tree.path, true);
        assert!(names(&shown).contains(&"ignored"));
    }

    #[test]
    fn tree_always_skips_the_git_directory() {
        let tree = TempTree::new();
        tree.write(".git/config", "[core]");
        tree.write("a.txt", "a");

        for show_ignored in [false, true] {
            let nodes = build_gitignore_tree(&tree.path, show_ignored);
            assert!(!names(&nodes).contains(&".git"));
        }
    }

    #[test]
    fn tree_of_an_empty_directory_is_empty() {
        let tree = TempTree::new();
        assert!(build_gitignore_tree(&tree.path, true).is_empty());
    }
}
