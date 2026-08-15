//! Locating and spawning agent CLIs across platforms, and killing them whole.

use std::path::{Path, PathBuf};
use std::process::{Child, Command};

/// Resolve a CLI binary: explicit override first, then PATH, then the common
/// install locations GUI apps miss (macOS apps inherit a reduced PATH).
pub fn resolve_binary(name: &str, override_path: Option<&str>) -> Option<PathBuf> {
    if let Some(p) = override_path.filter(|p| !p.trim().is_empty()) {
        let path = PathBuf::from(p);
        return path.exists().then_some(path);
    }
    if let Ok(found) = which::which(name) {
        return Some(found);
    }
    for dir in fallback_dirs() {
        for candidate in candidate_names(name) {
            let path = dir.join(&candidate);
            if path.exists() {
                return Some(path);
            }
        }
    }
    None
}

/// Install locations to search when the binary is not on the app's PATH.
fn fallback_dirs() -> Vec<PathBuf> {
    let mut dirs_list = Vec::new();
    if let Some(home) = dirs::home_dir() {
        dirs_list.push(home.join(".local").join("bin"));
        dirs_list.push(home.join(".claude").join("local"));
        #[cfg(target_os = "windows")]
        {
            dirs_list.push(home.join("AppData").join("Roaming").join("npm"));
            // Antigravity installs itself here rather than through npm.
            dirs_list.push(home.join("AppData").join("Local").join("agy").join("bin"));
        }
    }
    #[cfg(target_os = "macos")]
    {
        dirs_list.push(PathBuf::from("/opt/homebrew/bin"));
        dirs_list.push(PathBuf::from("/usr/local/bin"));
    }
    #[cfg(target_os = "linux")]
    dirs_list.push(PathBuf::from("/usr/local/bin"));
    dirs_list
}

/// File names a binary may carry: Windows npm shims are `.cmd`, not extensionless.
fn candidate_names(name: &str) -> Vec<String> {
    #[cfg(target_os = "windows")]
    {
        vec![format!("{name}.cmd"), format!("{name}.exe"), name.to_string()]
    }
    #[cfg(not(target_os = "windows"))]
    {
        vec![name.to_string()]
    }
}

/// Build a Command for a resolved binary: no console window on Windows,
/// its own process group on Unix so the whole tree can be killed.
pub fn new_command(path: &Path) -> Command {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let is_shim = path
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("cmd") || e.eq_ignore_ascii_case("bat"));
        let mut cmd = if is_shim {
            let mut c = Command::new("cmd");
            c.arg("/C").arg(path);
            c
        } else {
            Command::new(path)
        };
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd
    }
    #[cfg(not(target_os = "windows"))]
    {
        use std::os::unix::process::CommandExt;
        let mut cmd = Command::new(path);
        cmd.process_group(0);
        cmd
    }
}

/// Terminate a spawned CLI and every child it spawned.
pub fn kill_tree(child: &mut Child) {
    let pid = child.id();
    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .output();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = Command::new("kill")
            .args(["-TERM", &format!("-{pid}")])
            .output();
    }
    let _ = child.kill();
}
