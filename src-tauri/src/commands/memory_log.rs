// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Resident memory of the app and of the process that draws it, sampled every
//! ten minutes into `memory.log`.
//!
//! The renderer is where a long session actually grows: `WebKitWebProcess` on
//! Linux, `com.apple.WebKit.WebContent` on macOS. What the trace has to answer
//! is which of two shapes the growth has - a straight line while the app sits
//! idle points at the webview itself, a staircase that steps whenever a
//! worktree is opened points at the DOM the app builds. One number is useless
//! for that; a sequence of them is the whole measurement.

use std::fmt::Write as _;
use std::fs::OpenOptions;
use std::io::Write as _;
use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::storage;

const SAMPLE_INTERVAL: Duration = Duration::from_secs(10 * 60);
/// Keeps the file from outliving its usefulness: a week of samples is 1008
/// lines, and the trace only ever gets read from the tail.
const MAX_LINES: usize = 2000;

/// One process worth reporting: its pid, its command and its resident size.
struct Sample {
    pid: u32,
    name: String,
    rss_kb: u64,
}

/// True for the process that owns the webview, whatever the platform calls it.
fn is_renderer(name: &str) -> bool {
    name.contains("WebKitWebProcess")
        || name.contains("WebKit.WebContent")
        || name.contains("WebKitNetworkProcess")
}

/// Reads `ps` once for the whole session tree. `rss` is in kilobytes on both
/// macOS and Linux, and `comm` is the executable rather than the full command
/// line, which keeps the renderer's name stable and short.
fn read_samples(own_pid: u32) -> Vec<Sample> {
    let Ok(output) = Command::new("ps").args(["-eo", "pid=,ppid=,rss=,comm="]).output() else {
        return Vec::new();
    };
    let text = String::from_utf8_lossy(&output.stdout);
    let mut samples = Vec::new();
    for line in text.lines() {
        let mut fields = line.split_whitespace();
        let (Some(pid), Some(ppid), Some(rss)) = (fields.next(), fields.next(), fields.next())
        else {
            continue;
        };
        let name = fields.collect::<Vec<_>>().join(" ");
        let (Ok(pid), Ok(ppid), Ok(rss_kb)) = (pid.parse::<u32>(), ppid.parse::<u32>(), rss.parse::<u64>())
        else {
            continue;
        };
        // The app itself, plus whatever it spawned that draws: a renderer is a
        // child of the app on macOS and, under the sandbox, of a helper on
        // Linux - so it is taken on its name as well as on its parent.
        if pid == own_pid || (ppid == own_pid && is_renderer(&name)) || is_renderer(&name) {
            samples.push(Sample { pid, name, rss_kb });
        }
    }
    samples.sort_by_key(|s| s.pid);
    samples.dedup_by_key(|s| s.pid);
    samples
}

fn format_line(uptime: Duration, samples: &[Sample]) -> String {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let total_mb: u64 = samples.iter().map(|s| s.rss_kb).sum::<u64>() / 1024;
    let mut line = format!("{stamp} uptime={}m total={total_mb}MB", uptime.as_secs() / 60);
    for sample in samples {
        let _ = write!(line, " {}({})={}MB", sample.name, sample.pid, sample.rss_kb / 1024);
    }
    line.push('\n');
    line
}

/// Appends the line, then trims the file back to `MAX_LINES` when it overshot.
/// Rewriting a file of a few thousand short lines once every ten minutes is not
/// worth a rotation scheme.
fn append(line: &str) {
    let Ok(path) = storage::memory_log_file() else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let appended = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .and_then(|mut file| file.write_all(line.as_bytes()));
    if appended.is_err() {
        return;
    }
    if let Ok(existing) = std::fs::read_to_string(&path) {
        let lines: Vec<&str> = existing.lines().collect();
        if lines.len() > MAX_LINES {
            let kept = lines[lines.len() - MAX_LINES..].join("\n");
            let _ = std::fs::write(&path, format!("{kept}\n"));
        }
    }
}

/// Starts the sampler. One thread, asleep almost all of its life.
pub fn spawn_sampler() {
    let own_pid = std::process::id();
    let started = SystemTime::now();
    std::thread::spawn(move || {
        loop {
            let samples = read_samples(own_pid);
            if !samples.is_empty() {
                let uptime = started.elapsed().unwrap_or_default();
                append(&format_line(uptime, &samples));
            }
            std::thread::sleep(SAMPLE_INTERVAL);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renderer_is_recognized_on_both_platforms() {
        assert!(is_renderer("WebKitWebProcess"));
        assert!(is_renderer("com.apple.WebKit.WebContent"));
        assert!(!is_renderer("node"));
    }

    #[test]
    fn line_carries_uptime_and_every_process() {
        let samples = vec![
            Sample { pid: 10, name: "cairn".into(), rss_kb: 200 * 1024 },
            Sample { pid: 11, name: "WebKitWebProcess".into(), rss_kb: 1024 * 1024 },
        ];
        let line = format_line(Duration::from_secs(3600), &samples);
        assert!(line.contains("uptime=60m"));
        assert!(line.contains("total=1224MB"));
        assert!(line.contains("cairn(10)=200MB"));
        assert!(line.contains("WebKitWebProcess(11)=1024MB"));
    }
}
