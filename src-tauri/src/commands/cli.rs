//! The `cairn` shell command: installing it as a symlink to the launcher shipped
//! next to the app binary, and collecting the paths a `cairn <path>` invocation
//! passed on the command line.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use serde::Serialize;

const LINK_NAME: &str = "cairn";
const LAUNCHER_NAME: &str = "cairn-cli";
const PREFERRED_DIR: &str = "/usr/local/bin";

/// Whether the `cairn` command is installed, and whether the link still points
/// at the launcher of the currently running build.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliStatus {
    pub installed: bool,
    pub path: Option<String>,
    pub target: Option<String>,
    pub up_to_date: bool,
    pub launcher_available: bool,
}

/// Paths from the launch arguments, held until the frontend is ready to ask.
#[derive(Default)]
pub struct PendingCliPaths(pub Mutex<Vec<String>>);

impl PendingCliPaths {
    /// Reads the arguments of this launch, dropping flags and resolving the
    /// paths against the shell's working directory.
    pub fn from_args() -> Self {
        let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let paths: Vec<String> = std::env::args()
            .skip(1)
            .filter(|a| !a.starts_with('-'))
            .map(|a| absolutize(&a, &cwd))
            .collect();
        Self(Mutex::new(paths))
    }
}

/// Resolves `arg` against `cwd`, falling back to the plain join when the path
/// does not exist yet and cannot be canonicalized.
pub fn absolutize(arg: &str, cwd: &Path) -> String {
    let path = Path::new(arg);
    if path.is_absolute() {
        return arg.to_string();
    }
    let joined = cwd.join(path);
    joined.canonicalize().unwrap_or(joined).to_string_lossy().into_owned()
}

/// Drains the pending paths: they are consumed once, by the first frontend that
/// asks, so a later reload does not reopen them.
#[tauri::command]
pub fn take_pending_cli_paths(state: tauri::State<'_, PendingCliPaths>) -> Vec<String> {
    let mut guard = state.0.lock().unwrap_or_else(|e| e.into_inner());
    std::mem::take(&mut *guard)
}

/// `~/.local/bin`, used when `/usr/local/bin` is not writable.
fn fallback_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".local").join("bin"))
}

/// Install locations in preference order; also the lookup order for status.
fn candidate_dirs() -> Vec<PathBuf> {
    let mut dirs = vec![PathBuf::from(PREFERRED_DIR)];
    if let Some(d) = fallback_dir() {
        dirs.push(d);
    }
    dirs
}

/// The `cairn-cli` launcher shipped beside the app binary, `None` when the
/// build did not include it.
fn launcher_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    let candidate = dir.join(LAUNCHER_NAME);
    if candidate.is_file() { Some(candidate) } else { None }
}

/// Tested by actually creating a file: the permission bits alone do not answer
/// it on a directory the user only appears to own.
fn is_writable_dir(dir: &Path) -> bool {
    let probe = dir.join(".cairn-write-probe");
    match std::fs::File::create(&probe) {
        Ok(_) => {
            let _ = std::fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

/// Reports the first candidate directory holding a `cairn` entry. A link
/// pointing at a launcher other than this build's reads as not up to date,
/// which is what a rebuild leaves behind.
#[tauri::command]
pub async fn get_cli_status() -> CliStatus {
    read_cli_status()
}

fn read_cli_status() -> CliStatus {
    let target = launcher_path();
    let target_str = target.as_ref().map(|p| p.to_string_lossy().into_owned());
    for dir in candidate_dirs() {
        let link = dir.join(LINK_NAME);
        if !link.exists() && std::fs::symlink_metadata(&link).is_err() {
            continue;
        }
        let resolved = std::fs::read_link(&link)
            .ok()
            .or_else(|| Some(link.clone()))
            .map(|p| p.to_string_lossy().into_owned());
        let up_to_date = match (&resolved, &target_str) {
            (Some(a), Some(b)) => a == b,
            _ => false,
        };
        return CliStatus {
            installed: true,
            path: Some(link.to_string_lossy().into_owned()),
            target: resolved,
            up_to_date,
            launcher_available: target_str.is_some(),
        };
    }
    CliStatus {
        installed: false,
        path: None,
        target: target_str.clone(),
        up_to_date: false,
        launcher_available: target_str.is_some(),
    }
}

/// Links the launcher into the first candidate directory that accepts it,
/// replacing an existing entry. Fails with every attempt's reason collected, so
/// the user sees why `/usr/local/bin` was refused as well as the fallback.
#[tauri::command]
pub async fn install_cli() -> Result<CliStatus, String> {
    let target = launcher_path()
        .ok_or_else(|| "The cairn launcher was not found next to the application binary.".to_string())?;

    let mut errors: Vec<String> = Vec::new();
    for dir in candidate_dirs() {
        if !dir.exists() && std::fs::create_dir_all(&dir).is_err() {
            errors.push(format!("{}: cannot create directory", dir.display()));
            continue;
        }
        if !is_writable_dir(&dir) {
            errors.push(format!("{}: not writable", dir.display()));
            continue;
        }
        let link = dir.join(LINK_NAME);
        if std::fs::symlink_metadata(&link).is_ok()
            && let Err(e) = std::fs::remove_file(&link) {
                errors.push(format!("{}: {}", link.display(), e));
                continue;
            }
        #[cfg(unix)]
        let created = std::os::unix::fs::symlink(&target, &link);
        #[cfg(windows)]
        let created = std::fs::copy(&target, &link).map(|_| ());
        match created {
            Ok(()) => return Ok(read_cli_status()),
            Err(e) => errors.push(format!("{}: {}", link.display(), e)),
        }
    }
    Err(errors.join("; "))
}

/// Removes the link from every candidate directory. Errors only matter when
/// nothing at all could be removed.
#[tauri::command]
pub async fn uninstall_cli() -> Result<CliStatus, String> {
    let mut removed = false;
    let mut errors: Vec<String> = Vec::new();
    for dir in candidate_dirs() {
        let link = dir.join(LINK_NAME);
        if std::fs::symlink_metadata(&link).is_err() {
            continue;
        }
        match std::fs::remove_file(&link) {
            Ok(()) => removed = true,
            Err(e) => errors.push(format!("{}: {}", link.display(), e)),
        }
    }
    if !removed && !errors.is_empty() {
        return Err(errors.join("; "));
    }
    Ok(read_cli_status())
}
