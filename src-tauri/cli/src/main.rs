// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::{Path, PathBuf};
use std::process::Command;

/// The bundled binary is named after `productName`; the short name is kept so a
/// launcher sitting next to an older install still finds it.
const APP_BINARIES: [&str; 2] = ["Cairn Foundry", "cairn"];

fn absolutize(arg: &str) -> String {
    let path = Path::new(arg);
    if path.is_absolute() {
        return arg.to_string();
    }
    match std::env::current_dir() {
        Ok(cwd) => {
            let joined = cwd.join(path);
            joined
                .canonicalize()
                .unwrap_or(joined)
                .to_string_lossy()
                .into_owned()
        }
        Err(_) => arg.to_string(),
    }
}

fn from_env() -> Option<PathBuf> {
    let raw = std::env::var("CAIRN_APP_BINARY").ok()?;
    let path = PathBuf::from(raw);
    if path.is_file() { Some(path) } else { None }
}

fn resolve_app_binary() -> Option<PathBuf> {
    if let Some(path) = from_env() {
        return Some(path);
    }

    // The launcher normally sits next to the real binary inside the bundle.
    if let Ok(exe) = std::env::current_exe() {
        let exe = exe.canonicalize().unwrap_or(exe);
        if let Some(dir) = exe.parent() {
            for name in APP_BINARIES {
                let sibling = dir.join(name);
                if sibling.is_file() && sibling != exe {
                    return Some(sibling);
                }
            }
        }
    }

    let mut candidates: Vec<PathBuf> = Vec::new();
    #[cfg(target_os = "macos")]
    {
        for name in APP_BINARIES {
            candidates.push(PathBuf::from(format!(
                "/Applications/Cairn Foundry.app/Contents/MacOS/{name}"
            )));
            candidates.push(PathBuf::from(format!(
                "/Applications/cairn.app/Contents/MacOS/{name}"
            )));
            candidates.push(PathBuf::from(format!(
                "/Applications/Cairn.app/Contents/MacOS/{name}"
            )));
            if let Some(home) = dirs::home_dir() {
                candidates
                    .push(home.join(format!("Applications/Cairn Foundry.app/Contents/MacOS/{name}")));
                candidates.push(home.join(format!("Applications/cairn.app/Contents/MacOS/{name}")));
                candidates.push(home.join(format!("Applications/Cairn.app/Contents/MacOS/{name}")));
            }
        }
    }
    #[cfg(target_os = "linux")]
    {
        candidates.push(PathBuf::from("/usr/bin/cairn-foundry"));
        candidates.push(PathBuf::from("/usr/local/bin/cairn-foundry"));
        candidates.push(PathBuf::from("/opt/cairn-foundry/cairn-foundry"));
        candidates.push(PathBuf::from("/usr/bin/cairn"));
        candidates.push(PathBuf::from("/usr/local/bin/cairn"));
        candidates.push(PathBuf::from("/opt/cairn/cairn"));
    }
    #[cfg(target_os = "windows")]
    {
        if let Some(local) = dirs::data_local_dir() {
            candidates.push(local.join("Cairn Foundry/Cairn Foundry.exe"));
            candidates.push(local.join("cairn/cairn.exe"));
        }
        candidates.push(PathBuf::from("C:/Program Files/Cairn Foundry/Cairn Foundry.exe"));
        candidates.push(PathBuf::from("C:/Program Files/cairn/cairn.exe"));
    }

    candidates.into_iter().find(|p| p.is_file())
}

/// `clone <url>` names a repository, not a filesystem path: absolutizing it
/// against the shell's cwd would turn a URL or an `ssh`-style `user@host:repo`
/// spec into nonsense.
fn is_clone_invocation(args: &[String]) -> bool {
    matches!(args, [cmd, ..] if cmd == "clone")
}

fn main() {
    let raw_args: Vec<String> = std::env::args().skip(1).collect();
    let args: Vec<String> = if is_clone_invocation(&raw_args) {
        raw_args
    } else {
        raw_args.iter().map(|a| absolutize(a)).collect()
    };

    let Some(binary) = resolve_app_binary() else {
        eprintln!(
            "cairn: could not locate the Cairn Foundry application. Set CAIRN_APP_BINARY to its executable path."
        );
        std::process::exit(1);
    };

    match Command::new(&binary).args(&args).spawn() {
        Ok(_) => {}
        Err(e) => {
            eprintln!("cairn: failed to launch {}: {}", binary.display(), e);
            std::process::exit(1);
        }
    }
}
