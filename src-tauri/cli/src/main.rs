use std::path::{Path, PathBuf};
use std::process::Command;

const APP_BINARY: &str = "cairn";

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
            let sibling = dir.join(APP_BINARY);
            if sibling.is_file() && sibling != exe {
                return Some(sibling);
            }
        }
    }

    let mut candidates: Vec<PathBuf> = Vec::new();
    #[cfg(target_os = "macos")]
    {
        candidates.push(PathBuf::from("/Applications/cairn.app/Contents/MacOS/cairn"));
        candidates.push(PathBuf::from("/Applications/Cairn.app/Contents/MacOS/cairn"));
        if let Some(home) = dirs::home_dir() {
            candidates.push(home.join("Applications/cairn.app/Contents/MacOS/cairn"));
            candidates.push(home.join("Applications/Cairn.app/Contents/MacOS/cairn"));
        }
    }
    #[cfg(target_os = "linux")]
    {
        candidates.push(PathBuf::from("/usr/bin/cairn"));
        candidates.push(PathBuf::from("/usr/local/bin/cairn"));
        candidates.push(PathBuf::from("/opt/cairn/cairn"));
    }
    #[cfg(target_os = "windows")]
    {
        if let Some(local) = dirs::data_local_dir() {
            candidates.push(local.join("cairn/cairn.exe"));
        }
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
            "cairn: could not locate the Cairn application. Set CAIRN_APP_BINARY to its executable path."
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
