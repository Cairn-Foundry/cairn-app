use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use grep_matcher::Matcher;
use grep_regex::RegexMatcherBuilder;
use grep_searcher::{BinaryDetection, SearcherBuilder, Sink, SinkMatch};
use ignore::WalkBuilder;
use ignore::overrides::OverrideBuilder;
use nucleo_matcher::pattern::{CaseMatching, Normalization, Pattern};
use nucleo_matcher::{Config, Matcher as NucleoMatcher};
use serde::Serialize;

const SEARCH_RESULT_CAP: usize = 2000;

#[derive(Serialize)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    #[serde(rename = "isDir")]
    pub is_dir: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<FileNode>>,
}

#[derive(Default)]
struct TreeBuilder {
    is_dir: bool,
    rel: String,
    children: std::collections::BTreeMap<String, TreeBuilder>,
}

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

    let mut tree = TreeBuilder::default();
    for entry in builder.build().flatten() {
        let path = entry.path();
        let rel = match path.strip_prefix(root) {
            Ok(r) if !r.as_os_str().is_empty() => r,
            _ => continue,
        };
        let is_dir = entry.file_type().is_some_and(|ft| ft.is_dir());

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

fn collect_files(root: &PathBuf, include_ignored: bool) -> Vec<String> {
    let mut builder = WalkBuilder::new(root);
    builder
        .hidden(false)
        .git_ignore(!include_ignored)
        .git_global(!include_ignored)
        .git_exclude(!include_ignored)
        .ignore(!include_ignored)
        .parents(!include_ignored)
        .filter_entry(|e| e.file_name() != ".git");

    let mut files = Vec::new();
    for entry in builder.build().flatten() {
        if entry.file_type().is_some_and(|ft| ft.is_file()) {
            if let Ok(rel) = entry.path().strip_prefix(root) {
                files.push(rel.to_string_lossy().to_string());
            }
        }
    }
    files
}

pub struct QuickSearchIndex {
    key: String,
    paths: Vec<String>,
}

#[derive(Default)]
pub struct QuickSearchCache(Mutex<Option<QuickSearchIndex>>);

#[tauri::command]
pub fn quick_search(
    state: tauri::State<'_, QuickSearchCache>,
    path: String,
    query: String,
    include_ignored: bool,
    refresh: bool,
    limit: usize,
) -> Result<Vec<String>, String> {
    let expanded = shellexpand::tilde(&path).into_owned();
    let key = format!("{}::{}", expanded, include_ignored);

    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    let stale = refresh || guard.as_ref().map(|c| c.key != key).unwrap_or(true);
    if stale {
        let root = PathBuf::from(&expanded);
        if !root.exists() { return Err(format!("Path does not exist: {}", path)); }
        let paths = collect_files(&root, include_ignored);
        *guard = Some(QuickSearchIndex { key, paths });
    }
    let paths = &guard.as_ref().unwrap().paths;

    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(paths.iter().take(limit).cloned().collect());
    }

    let mut matcher = NucleoMatcher::new(Config::DEFAULT.match_paths());
    let pattern = Pattern::parse(trimmed, CaseMatching::Smart, Normalization::Smart);
    let mut matches = pattern.match_list(paths.iter(), &mut matcher);
    matches.truncate(limit);
    Ok(matches.into_iter().map(|(p, _)| p.clone()).collect())
}

#[tauri::command]
pub fn read_dir_tree(path: String, show_ignored: bool) -> Result<Vec<FileNode>, String> {
    let expanded = shellexpand::tilde(&path).into_owned();
    let root = PathBuf::from(&expanded);
    if !root.exists() { return Err(format!("Path does not exist: {}", path)); }
    Ok(build_gitignore_tree(&root, show_ignored))
}

#[tauri::command]
pub fn list_dir_names(path: String) -> Result<Vec<String>, String> {
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

#[tauri::command]
pub fn read_file(path: String) -> Result<Option<String>, String> {
    let expanded = shellexpand::tilde(&path).into_owned();
    let p = PathBuf::from(&expanded);
    if !p.exists() { return Err(format!("File not found: {}", path)); }

    // Return None for binary files
    let bytes = fs::read(&p).map_err(|e| e.to_string())?;
    match String::from_utf8(bytes) {
        Ok(text) => Ok(Some(text)),
        Err(_) => Ok(None), // binary
    }
}

#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    let expanded = shellexpand::tilde(&path).into_owned();
    let p = PathBuf::from(&expanded);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&p, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_path(path: String) -> Result<(), String> {
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
pub fn rename_path(from: String, to: String) -> Result<(), String> {
    let from_expanded = shellexpand::tilde(&from).into_owned();
    let to_expanded = shellexpand::tilde(&to).into_owned();
    let from_p = PathBuf::from(&from_expanded);
    let to_p = PathBuf::from(&to_expanded);
    if !from_p.exists() { return Err(format!("Path does not exist: {}", from)); }
    if to_p.exists() { return Err(format!("Destination already exists: {}", to)); }
    fs::rename(&from_p, &to_p).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_file_or_dir(path: String, is_dir: bool) -> Result<(), String> {
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

struct MatchSink<'a, M: Matcher> {
    matcher: &'a M,
    rel: &'a str,
    results: &'a Mutex<Vec<SearchMatch>>,
    count: &'a AtomicUsize,
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
                    self.results.lock().unwrap().push(SearchMatch {
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

        let results: Arc<Mutex<Vec<SearchMatch>>> = Arc::new(Mutex::new(Vec::new()));
        let count = Arc::new(AtomicUsize::new(0));

        WalkBuilder::new(&root_path)
            .overrides(overrides)
            .build_parallel()
            .run(|| {
                let matcher = Arc::clone(&matcher);
                let results = Arc::clone(&results);
                let count = Arc::clone(&count);
                let root_path = root_path.clone();
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
                    let mut searcher = SearcherBuilder::new()
                        .binary_detection(BinaryDetection::quit(0))
                        .line_number(true)
                        .build();
                    let sink = MatchSink { matcher: matcher.as_ref(), rel: &rel, results: &results, count: &count };
                    let _ = searcher.search_path(matcher.as_ref(), path, sink);
                    if count.load(Ordering::Relaxed) >= SEARCH_RESULT_CAP {
                        WalkState::Quit
                    } else {
                        WalkState::Continue
                    }
                })
            });

        let mut results = Arc::try_unwrap(results)
            .map(|m| m.into_inner().unwrap())
            .unwrap_or_default();
        results.sort_by(|a, b| a.path.cmp(&b.path).then(a.line.cmp(&b.line)).then(a.col.cmp(&b.col)));
        results.truncate(SEARCH_RESULT_CAP);
        Ok(results)
    })
    .await
    .map_err(|e| e.to_string())?
}
