// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

//! The review guide: the diff the model reads, the hunks the "seen" state is
//! keyed on, and the reviewer's state on disk.

use std::fs;
use std::process::Command;
use serde::{Deserialize, Serialize};
use crate::child_env;
use crate::commands::git::resolve_revision;
use crate::commands::git_error::GitError;
use crate::storage::{instance_review_state_file, write_json_atomic};

/// Paths whose diff nobody reviews: they are generated, and they are what makes
/// a branch diff megabytes long. Kept out of the prompt entirely.
const EXCLUDED_SUFFIXES: [&str; 6] = [
    ".lock",
    "bun.lockb",
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "Cargo.lock",
];

/// Default ceiling on the diff handed to the model, in bytes. Beyond it whole
/// hunks are dropped, never half of one, so the guide reads valid code.
const DEFAULT_MAX_DIFF_BYTES: usize = 200_000;

/// One hunk of the branch diff, and the hash the "seen" state is keyed on.
#[derive(Serialize, Clone, PartialEq, Debug)]
pub struct ReviewHunk {
    pub path: String,
    /// First line of the hunk on the old side, from the `@@` header.
    #[serde(rename = "oldStart")]
    pub old_start: usize,
    #[serde(rename = "oldLines")]
    pub old_lines: usize,
    #[serde(rename = "newStart")]
    pub new_start: usize,
    #[serde(rename = "newLines")]
    pub new_lines: usize,
    #[serde(rename = "hunkHash")]
    pub hunk_hash: String,
}

/// The unified diff, whether it was cut to fit the ceiling, and the files that
/// paid for it - so the prompt can name them rather than let the guide present
/// a partial tour as a complete one.
#[derive(Serialize, Clone)]
pub struct UnifiedDiff {
    pub text: String,
    pub truncated: bool,
    #[serde(default)]
    pub omitted: Vec<String>,
}

// ---------------------------------------------------------------------------
// Persisted state
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct GuideExcerpt {
    pub path: String,
    pub side: String,
    pub from: usize,
    pub to: usize,
    #[serde(rename = "hunkHash", default)]
    pub hunk_hash: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct GuideRemark {
    pub id: String,
    pub kind: String,
    pub path: String,
    pub side: String,
    pub line: usize,
    pub title: String,
    pub body: String,
    pub status: String,
    #[serde(rename = "commentId", default, skip_serializing_if = "Option::is_none")]
    pub comment_id: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct GuideChapter {
    pub id: String,
    pub title: String,
    pub summary: String,
    #[serde(default)]
    pub excerpts: Vec<GuideExcerpt>,
    #[serde(default)]
    pub remarks: Vec<GuideRemark>,
    #[serde(rename = "isSeen", default)]
    pub is_seen: bool,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct ReviewGuide {
    #[serde(rename = "headSha", default)]
    pub head_sha: String,
    #[serde(rename = "baseSha", default)]
    pub base_sha: String,
    #[serde(rename = "generatedAt", default)]
    pub generated_at: String,
    #[serde(default)]
    pub overview: String,
    #[serde(default)]
    pub chapters: Vec<GuideChapter>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct ReviewComment {
    pub id: String,
    pub path: String,
    pub side: String,
    pub line: usize,
    pub body: String,
    #[serde(rename = "remarkId", default, skip_serializing_if = "Option::is_none")]
    pub remark_id: Option<String>,
    #[serde(rename = "createdAt", default)]
    pub created_at: String,
    #[serde(rename = "publishedAs", default, skip_serializing_if = "Option::is_none")]
    pub published_as: Option<String>,
}

/// Everything the review step remembers for one instance.
#[derive(Serialize, Deserialize, Clone, Default)]
pub struct ReviewState {
    #[serde(default)]
    pub guide: Option<ReviewGuide>,
    #[serde(rename = "seenHunks", default)]
    pub seen_hunks: Vec<String>,
    #[serde(default)]
    pub comments: Vec<ReviewComment>,
    #[serde(rename = "currentChapterId", default)]
    pub current_chapter_id: String,
    #[serde(rename = "currentExcerptIndex", default)]
    pub current_excerpt_index: usize,
    #[serde(rename = "isDiffMode", default)]
    pub is_diff_mode: bool,
    /// Whether the discussion panel of the diff mode is open. Defaults to true
    /// so a reviewer who never touched it still sees the threads.
    #[serde(rename = "isDiscussionsOpen", default = "default_true")]
    pub is_discussions_open: bool,
    /// The file the diff mode was left on, so the step reopens where the
    /// reviewer stopped rather than on the first file of the branch.
    #[serde(rename = "selectedPath", default)]
    pub selected_path: String,
    /// Which threads the discussion panel lists: `all`, `open`, `resolved` or
    /// `activity`. Stored as a plain string so an unknown value from a newer
    /// build degrades to the default rather than failing the whole read.
    #[serde(rename = "discussionFilter", default)]
    pub discussion_filter: String,
}

fn default_true() -> bool {
    true
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn expand(path: &str) -> String {
    shellexpand::tilde(path).into_owned()
}

fn git_cmd(worktree: &str) -> Command {
    let mut cmd = child_env::command("git");
    cmd.current_dir(worktree);
    cmd.env("LC_ALL", "C").env("LANG", "C");
    cmd
}

fn run(cmd: &mut Command) -> Result<String, GitError> {
    let output = cmd.output()?;
    if !output.status.success() {
        return Err(GitError::from_process(&output));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn reject_option_like(name: &str) -> Result<(), GitError> {
    if name.starts_with('-') {
        return Err(GitError::new("invalid_ref", format!("Invalid git reference: {name}"))
            .with_context(name));
    }
    Ok(())
}

fn is_excluded(path: &str) -> bool {
    EXCLUDED_SUFFIXES.iter().any(|suffix| path.ends_with(suffix))
}

/// Identity of a hunk's content, independent of where it sits in the file, so a
/// hunk that only moved stays seen. Line endings are normalized first: the same
/// hunk must hash identically on Windows and macOS.
fn hash_hunk(body: &str) -> String {
    let normalized = body.replace("\r\n", "\n");
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    std::hash::Hash::hash(&normalized, &mut hasher);
    format!("{:016x}", std::hash::Hasher::finish(&hasher))
}

/// `@@ -a,b +c,d @@` -> the four numbers. A missing count means 1.
fn parse_hunk_header(header: &str) -> Option<(usize, usize, usize, usize)> {
    let inner = header.strip_prefix("@@ ")?.split(" @@").next()?;
    let mut parts = inner.split(' ');
    let old = parts.next()?.strip_prefix('-')?;
    let new = parts.next()?.strip_prefix('+')?;
    let split = |spec: &str| -> Option<(usize, usize)> {
        let mut it = spec.split(',');
        let start = it.next()?.parse().ok()?;
        let count = match it.next() {
            Some(value) => value.parse().ok()?,
            None => 1,
        };
        Some((start, count))
    };
    let (old_start, old_lines) = split(old)?;
    let (new_start, new_lines) = split(new)?;
    Some((old_start, old_lines, new_start, new_lines))
}

/// The `+++ b/path` line of a file header, or the `a/path` when the file was
/// deleted and there is no destination.
fn path_of_header(lines: &[&str]) -> Option<String> {
    let mut fallback = None;
    for line in lines {
        if let Some(rest) = line.strip_prefix("+++ ") {
            let path = rest.strip_prefix("b/").unwrap_or(rest);
            if path != "/dev/null" {
                return Some(path.to_string());
            }
        }
        if let Some(rest) = line.strip_prefix("--- ") {
            let path = rest.strip_prefix("a/").unwrap_or(rest);
            if path != "/dev/null" {
                fallback = Some(path.to_string());
            }
        }
    }
    fallback
}

/// One file of a unified diff: its path, the lines of its header, and its hunks,
/// each hunk being its `@@` line followed by its body.
type SplitFile = (String, Vec<String>, Vec<Vec<String>>);

/// Splits a unified diff into one entry per file.
fn split_files(raw: &str) -> Vec<SplitFile> {
    let mut files = Vec::new();
    let mut header: Vec<String> = Vec::new();
    let mut hunks: Vec<Vec<String>> = Vec::new();
    let mut current: Option<Vec<String>> = None;
    let mut started = false;

    let flush = |header: &mut Vec<String>,
                 hunks: &mut Vec<Vec<String>>,
                 current: &mut Option<Vec<String>>,
                 files: &mut Vec<SplitFile>| {
        if let Some(hunk) = current.take() {
            hunks.push(hunk);
        }
        if header.is_empty() && hunks.is_empty() {
            return;
        }
        let refs: Vec<&str> = header.iter().map(|s| s.as_str()).collect();
        let path = path_of_header(&refs).unwrap_or_default();
        files.push((path, std::mem::take(header), std::mem::take(hunks)));
    };

    for line in raw.lines() {
        if line.starts_with("diff --git ") {
            if started {
                flush(&mut header, &mut hunks, &mut current, &mut files);
            }
            started = true;
            header.push(line.to_string());
            continue;
        }
        if !started {
            continue;
        }
        if line.starts_with("@@ ") {
            if let Some(hunk) = current.take() {
                hunks.push(hunk);
            }
            current = Some(vec![line.to_string()]);
            continue;
        }
        match current {
            Some(ref mut hunk) => hunk.push(line.to_string()),
            None => header.push(line.to_string()),
        }
    }
    if started {
        flush(&mut header, &mut hunks, &mut current, &mut files);
    }
    files
}

/// The raw `base...head` diff with the generated files dropped.
fn raw_diff(worktree: &str, base: &str, head: &str, ignore_whitespace: bool) -> Result<String, GitError> {
    // A merge request's target is a bare branch name the worktree may only hold
    // under `refs/remotes/origin/`; resolved here so every read of the range
    // goes through the same rule as the rest of git.rs.
    let base = resolve_revision(worktree, base);
    let head = resolve_revision(worktree, head);
    let range = format!("{base}...{head}");
    let mut cmd = git_cmd(worktree);
    cmd.args(["diff", "--no-color", "--no-renames", "--unified=3"]);
    if ignore_whitespace {
        cmd.arg("-w");
    }
    cmd.arg(&range);
    run(&mut cmd)
}

/// A hunk with every line prefixed by the number it carries in the file.
///
/// The model is asked for real line numbers, and unnumbered it has to count
/// them itself from the `@@` header down - which it does badly, landing three
/// or four lines below what it meant. Each line is prefixed with the number it
/// has on the side it belongs to (`-` lines the old side, `+` lines the new
/// one, context lines both), so the anchor is read rather than derived.
fn number_hunk(hunk: &[String]) -> String {
    let Some(header) = hunk.first() else {
        return String::new();
    };
    let Some((old_start, _, new_start, _)) = parse_hunk_header(header) else {
        return format!("{}\n", hunk.join("\n"));
    };
    let mut out = format!("{header}\n");
    let (mut old_line, mut new_line) = (old_start, new_start);
    for line in &hunk[1..] {
        let mut chars = line.chars();
        match chars.next() {
            Some('+') => {
                out.push_str(&format!("{new_line:>6} +{}\n", chars.as_str()));
                new_line += 1;
            }
            Some('-') => {
                out.push_str(&format!("{old_line:>6} -{}\n", chars.as_str()));
                old_line += 1;
            }
            Some('\\') => out.push_str(&format!("{line}\n")),
            _ => {
                out.push_str(&format!("{new_line:>6}  {}\n", chars.as_str()));
                old_line += 1;
                new_line += 1;
            }
        }
    }
    out
}

/// Rebuilds the diff without its generated files and under `max_bytes`, dropping
/// whole hunks, never half of one, so the guide only ever reads valid code.
/// Every kept file keeps its header, so a file whose hunks were cut still shows
/// up as touched rather than vanishing from the guide.
///
/// A file that does not fit is skipped rather than ending the walk: stopping at
/// the first oversized file hid every file after it, which on a wide branch is
/// most of them. What was left out is named, so the guide can say so instead of
/// presenting a partial tour as a complete one.
fn filter_diff(raw: &str, max_bytes: usize) -> (String, bool, Vec<String>) {
    let mut out = String::new();
    let mut omitted: Vec<String> = Vec::new();
    for (path, header, hunks) in split_files(raw) {
        if is_excluded(&path) {
            continue;
        }
        let header_text = format!("{}\n", header.join("\n"));
        if out.len().saturating_add(header_text.len()) > max_bytes {
            omitted.push(path);
            continue;
        }
        let mark = out.len();
        out.push_str(&header_text);
        let mut kept_any = false;
        let mut cut = false;
        for hunk in hunks {
            let hunk_text = number_hunk(&hunk);
            if out.len().saturating_add(hunk_text.len()) > max_bytes {
                cut = true;
                break;
            }
            out.push_str(&hunk_text);
            kept_any = true;
        }
        // A header alone says a file was touched without showing anything of
        // it: it is worth no bytes, so it is rolled back and named instead.
        if !kept_any {
            out.truncate(mark);
            omitted.push(path);
        } else if cut {
            omitted.push(path);
        }
    }
    let truncated = !omitted.is_empty();
    (out, truncated, omitted)
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
/// The full `base...head` diff for the prompt, generated files excluded and the
/// whole thing capped at `max_bytes` (200 Ko by default) on hunk boundaries.
pub async fn get_diff_unified(
    worktree_path: String,
    base: String,
    head: String,
    ignore_whitespace: bool,
    max_bytes: Option<usize>,
) -> Result<UnifiedDiff, GitError> {
    reject_option_like(&base)?;
    reject_option_like(&head)?;
    let expanded = expand(&worktree_path);
    let raw = raw_diff(&expanded, &base, &head, ignore_whitespace)?;
    let cap = max_bytes.unwrap_or(DEFAULT_MAX_DIFF_BYTES);
    let (text, truncated, omitted) = filter_diff(&raw, cap);
    Ok(UnifiedDiff { text, truncated, omitted })
}

#[tauri::command]
/// Every hunk of `base...head` with its content hash: the source of truth the
/// "seen" state is keyed on.
pub async fn get_diff_hunks(
    worktree_path: String,
    base: String,
    head: String,
) -> Result<Vec<ReviewHunk>, GitError> {
    reject_option_like(&base)?;
    reject_option_like(&head)?;
    let expanded = expand(&worktree_path);
    let raw = raw_diff(&expanded, &base, &head, false)?;
    let mut hunks = Vec::new();
    for (path, _, file_hunks) in split_files(&raw) {
        if is_excluded(&path) {
            continue;
        }
        for hunk in file_hunks {
            let Some(header) = hunk.first() else { continue };
            let Some((old_start, old_lines, new_start, new_lines)) = parse_hunk_header(header) else {
                continue;
            };
            // The header carries line numbers, which move when an earlier hunk
            // grows; only the body identifies the change itself.
            let body = hunk[1..].join("\n");
            hunks.push(ReviewHunk {
                hunk_hash: hash_hunk(&format!("{path}\n{body}")),
                path: path.clone(),
                old_start,
                old_lines,
                new_start,
                new_lines,
            });
        }
    }
    Ok(hunks)
}

#[tauri::command]
/// `None` when this instance has never been reviewed.
pub fn load_review_state(project_id: String, instance_id: String) -> Result<Option<ReviewState>, String> {
    let path = instance_review_state_file(&project_id, &instance_id)?;
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Ok(Some(serde_json::from_str(&content).map_err(|e| e.to_string())?))
}

#[tauri::command]
pub async fn save_review_state(
    project_id: String,
    instance_id: String,
    state: ReviewState,
) -> Result<(), String> {
    write_json_atomic(&instance_review_state_file(&project_id, &instance_id)?, &state)
}

#[cfg(test)]
mod tests {
    use super::*;

    const DIFF: &str = "diff --git a/src/a.ts b/src/a.ts\n\
index 111..222 100644\n\
--- a/src/a.ts\n\
+++ b/src/a.ts\n\
@@ -1,3 +1,4 @@\n\
 const a = 1;\n\
+const b = 2;\n\
 const c = 3;\n\
 const d = 4;\n\
@@ -10,2 +11,2 @@\n\
-const old = 5;\n\
+const new = 5;\n\
 const tail = 6;\n\
diff --git a/bun.lockb b/bun.lockb\n\
--- a/bun.lockb\n\
+++ b/bun.lockb\n\
@@ -1,1 +1,1 @@\n\
-binary\n\
+other\n";

    #[test]
    fn a_header_yields_its_four_numbers() {
        assert_eq!(parse_hunk_header("@@ -1,3 +1,4 @@"), Some((1, 3, 1, 4)));
        assert_eq!(parse_hunk_header("@@ -1,3 +1,4 @@ fn context()"), Some((1, 3, 1, 4)));
        assert_eq!(parse_hunk_header("@@ -5 +6 @@"), Some((5, 1, 6, 1)));
        assert_eq!(parse_hunk_header("not a header"), None);
    }

    #[test]
    fn the_same_hunk_at_another_position_keeps_its_hash() {
        let body = " const a = 1;\n+const b = 2;\n";
        assert_eq!(hash_hunk(body), hash_hunk(body));
    }

    #[test]
    fn one_character_of_difference_changes_the_hash() {
        assert_ne!(
            hash_hunk(" const a = 1;\n+const b = 2;\n"),
            hash_hunk(" const a = 1;\n+const b = 3;\n"),
        );
    }

    #[test]
    fn a_windows_hunk_hashes_like_its_unix_twin() {
        assert_eq!(
            hash_hunk(" const a = 1;\r\n+const b = 2;\r\n"),
            hash_hunk(" const a = 1;\n+const b = 2;\n"),
        );
    }

    #[test]
    fn splitting_finds_every_file_and_its_hunks() {
        let files = split_files(DIFF);
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].0, "src/a.ts");
        assert_eq!(files[0].2.len(), 2);
        assert_eq!(files[1].0, "bun.lockb");
    }

    #[test]
    fn generated_files_are_excluded() {
        assert!(is_excluded("bun.lockb"));
        assert!(is_excluded("Cargo.lock"));
        assert!(is_excluded("frontend/package-lock.json"));
        assert!(!is_excluded("src/lockfile-reader.ts"));
    }

    #[test]
    fn truncating_keeps_whole_hunks() {
        let (text, truncated, omitted) = filter_diff(DIFF, 200);
        assert!(truncated);
        assert_eq!(omitted, vec!["src/a.ts".to_string()]);
        assert!(text.len() <= 200);
    }

    #[test]
    fn a_small_diff_is_returned_whole() {
        let (text, truncated, omitted) = filter_diff(DIFF, usize::MAX);
        assert!(!truncated);
        assert!(omitted.is_empty());
        // The lockfile is dropped even when there is room for it.
        assert!(!text.contains("bun.lockb"));
        assert!(text.contains("src/a.ts"));
    }

    #[test]
    fn a_file_too_large_does_not_hide_the_files_after_it() {
        // Only the header of the first file fits; the walk has to carry on to
        // the second rather than stop at the one it could not take.
        let raw = format!(
            "diff --git a/big.ts b/big.ts\n--- a/big.ts\n+++ b/big.ts\n@@ -1,1 +1,1 @@\n-{}\n+{}\n{}",
            "x".repeat(400),
            "y".repeat(400),
            "diff --git a/small.ts b/small.ts\n--- a/small.ts\n+++ b/small.ts\n@@ -1,1 +1,1 @@\n-a\n+b\n",
        );
        let (text, truncated, omitted) = filter_diff(&raw, 500);
        assert!(truncated);
        assert_eq!(omitted, vec!["big.ts".to_string()]);
        assert!(text.contains("small.ts"));
        // The file that showed nothing of itself leaves no header behind.
        assert!(!text.contains("big.ts"));
    }

    #[test]
    fn every_line_carries_the_number_it_has_in_the_file() {
        let hunk: Vec<String> = "@@ -10,3 +20,4 @@\n const a = 1;\n-const b = 2;\n+const c = 3;\n const d = 4;"
            .lines()
            .map(str::to_string)
            .collect();
        let numbered = number_hunk(&hunk);
        let lines: Vec<&str> = numbered.lines().collect();
        assert_eq!(lines[0], "@@ -10,3 +20,4 @@");
        assert_eq!(lines[1], "    20  const a = 1;");
        // The removed line is numbered on the old side, which is where it lives.
        assert_eq!(lines[2], "    11 -const b = 2;");
        assert_eq!(lines[3], "    21 +const c = 3;");
        assert_eq!(lines[4], "    22  const d = 4;");
    }

    #[test]
    fn a_hunk_with_no_parsable_header_is_left_alone() {
        let hunk = vec!["not a header".to_string(), " a".to_string()];
        assert_eq!(number_hunk(&hunk), "not a header\n a\n");
    }

    #[test]
    fn a_state_predating_a_field_gains_its_default() {
        let state: ReviewState = serde_json::from_str("{}").expect("should parse");
        assert!(state.guide.is_none());
        assert!(state.seen_hunks.is_empty());
        assert!(!state.is_diff_mode);
        // A review that predates the panel still shows its threads: hiding them
        // by default would look like the merge request had no discussion.
        assert!(state.is_discussions_open);
    }

    #[test]
    fn the_state_serializes_under_the_names_the_frontend_reads() {
        let json = serde_json::to_value(ReviewState::default()).expect("should serialize");
        let object = json.as_object().expect("state should be an object");
        for key in ["guide", "seenHunks", "comments", "currentChapterId", "currentExcerptIndex", "isDiffMode", "isDiscussionsOpen", "selectedPath", "discussionFilter"] {
            assert!(object.contains_key(key), "{key} is missing from the payload");
        }
    }
}

