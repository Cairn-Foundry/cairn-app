use std::fs;
use std::path::PathBuf;
use regex::RegexBuilder;
use serde::Serialize;

#[derive(Serialize)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    #[serde(rename = "isDir")]
    pub is_dir: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<FileNode>>,
}

fn read_dir_recursive(dir: &PathBuf, root: &PathBuf, show_hidden: bool) -> Vec<FileNode> {
    let mut entries: Vec<FileNode> = match fs::read_dir(dir) {
        Ok(rd) => rd.filter_map(|e| e.ok()).collect::<Vec<_>>(),
        Err(_) => return vec![],
    }
    .iter()
    .filter_map(|entry| {
        let path = entry.path();
        let name = path.file_name()?.to_string_lossy().to_string();
        if !show_hidden && name.starts_with('.') { return None; }
        let rel = path.strip_prefix(root).ok()?.to_string_lossy().to_string();
        let is_dir = path.is_dir();
        let children = if is_dir { Some(read_dir_recursive(&path, root, show_hidden)) } else { None };
        Some(FileNode { name, path: rel, is_dir, children })
    })
    .collect();

    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    entries
}

#[tauri::command]
pub fn read_dir_tree(path: String, show_hidden: bool) -> Result<Vec<FileNode>, String> {
    let expanded = shellexpand::tilde(&path).into_owned();
    let root = PathBuf::from(&expanded);
    if !root.exists() { return Err(format!("Path does not exist: {}", path)); }
    Ok(read_dir_recursive(&root, &root, show_hidden))
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

const BINARY_EXTENSIONS: &[&str] = &[
    "png","jpg","jpeg","gif","webp","ico","bmp","tiff",
    "pdf","doc","docx","xls","xlsx","ppt","pptx",
    "zip","tar","gz","bz2","xz","7z","rar",
    "mp3","mp4","wav","ogg","flac","avi","mov","mkv",
    "wasm","bin","exe","dll","so","dylib","a","o",
    "ttf","otf","woff","woff2","eot",
    "db","sqlite","sqlite3",
];

fn glob_match(pattern: &str, name: &str) -> bool {
    let p: Vec<char> = pattern.to_lowercase().chars().collect();
    let n: Vec<char> = name.to_lowercase().chars().collect();
    let mut dp = vec![vec![false; n.len() + 1]; p.len() + 1];
    dp[0][0] = true;
    for i in 1..=p.len() {
        if p[i - 1] == '*' { dp[i][0] = dp[i - 1][0]; }
    }
    for i in 1..=p.len() {
        for j in 1..=n.len() {
            dp[i][j] = if p[i - 1] == '*' {
                dp[i - 1][j] || dp[i][j - 1]
            } else if p[i - 1] == '?' || p[i - 1] == n[j - 1] {
                dp[i - 1][j - 1]
            } else {
                false
            };
        }
    }
    dp[p.len()][n.len()]
}

fn path_matches_exclude(rel_path: &str, patterns: &[&str]) -> bool {
    patterns.iter().any(|pat| {
        let pat = pat.trim();
        if pat.is_empty() { return false; }
        rel_path.split('/').any(|seg| glob_match(pat, seg))
    })
}

fn file_matches_include(name: &str, patterns: &[&str]) -> bool {
    if patterns.iter().all(|p| p.trim().is_empty()) { return true; }
    patterns.iter().any(|pat| {
        let pat = pat.trim();
        !pat.is_empty() && glob_match(pat, name)
    })
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

fn collect_text_files(dir: &PathBuf, root: &PathBuf, include: &[&str], exclude: &[&str], out: &mut Vec<PathBuf>) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        let name = match path.file_name() { Some(n) => n.to_string_lossy().to_string(), None => continue };
        if name.starts_with('.') { continue; }
        let rel = match path.strip_prefix(root) { Ok(r) => r.to_string_lossy().to_string(), Err(_) => continue };
        if path.is_dir() {
            if path_matches_exclude(&rel, exclude) { continue; }
            collect_text_files(&path, root, include, exclude, out);
        } else {
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
            if BINARY_EXTENSIONS.contains(&ext.as_str()) { continue; }
            if path_matches_exclude(&rel, exclude) { continue; }
            if !file_matches_include(&name, include) { continue; }
            out.push(path);
        }
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
        let re = RegexBuilder::new(&pattern)
            .case_insensitive(!case_sensitive)
            .build()
            .map_err(|e| format!("Invalid regex: {}", e))?;

        let include_parts: Vec<&str> = include_glob.split(',').collect();
        let exclude_parts: Vec<&str> = exclude_glob.split(',').collect();

        let mut files = vec![];
        collect_text_files(&root_path, &root_path, &include_parts, &exclude_parts, &mut files);
        files.sort();

        let mut results: Vec<SearchMatch> = vec![];
        'file: for file_path in &files {
            let content = match fs::read(file_path) {
                Ok(b) => b,
                Err(_) => continue,
            };
            let text = match std::str::from_utf8(&content) {
                Ok(t) => t,
                Err(_) => continue,
            };
            let rel = file_path.strip_prefix(&root_path)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();

            for (line_idx, line_text) in text.lines().enumerate() {
                for m in re.find_iter(line_text) {
                    results.push(SearchMatch {
                        path: rel.clone(),
                        line: (line_idx + 1) as u32,
                        col: (m.start() + 1) as u32,
                        text: line_text.to_string(),
                        match_start: m.start() as u32,
                        match_end: m.end() as u32,
                    });
                    if results.len() >= 2000 { break 'file; }
                }
            }
        }
        Ok(results)
    })
    .await
    .map_err(|e| e.to_string())?
}
