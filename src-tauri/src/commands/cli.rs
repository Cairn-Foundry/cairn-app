use std::path::{Path, PathBuf};
use std::sync::Mutex;
use serde::Serialize;

const LINK_NAME: &str = "cairn";
const LAUNCHER_NAME: &str = "cairn-cli";
const PREFERRED_DIR: &str = "/usr/local/bin";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliStatus {
    pub installed: bool,
    pub path: Option<String>,
    pub target: Option<String>,
    pub up_to_date: bool,
    pub launcher_available: bool,
}

#[derive(Default)]
pub struct PendingCliPaths(pub Mutex<Vec<String>>);

impl PendingCliPaths {
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

pub fn absolutize(arg: &str, cwd: &Path) -> String {
    let path = Path::new(arg);
    if path.is_absolute() {
        return arg.to_string();
    }
    let joined = cwd.join(path);
    joined.canonicalize().unwrap_or(joined).to_string_lossy().into_owned()
}

#[tauri::command]
pub fn take_pending_cli_paths(state: tauri::State<'_, PendingCliPaths>) -> Vec<String> {
    let mut guard = state.0.lock().unwrap_or_else(|e| e.into_inner());
    std::mem::take(&mut *guard)
}

fn fallback_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".local").join("bin"))
}

fn candidate_dirs() -> Vec<PathBuf> {
    let mut dirs = vec![PathBuf::from(PREFERRED_DIR)];
    if let Some(d) = fallback_dir() {
        dirs.push(d);
    }
    dirs
}

fn launcher_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    let candidate = dir.join(LAUNCHER_NAME);
    if candidate.is_file() { Some(candidate) } else { None }
}

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

#[tauri::command]
pub fn get_cli_status() -> CliStatus {
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

#[tauri::command]
pub fn install_cli() -> Result<CliStatus, String> {
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
        if std::fs::symlink_metadata(&link).is_ok() {
            if let Err(e) = std::fs::remove_file(&link) {
                errors.push(format!("{}: {}", link.display(), e));
                continue;
            }
        }
        #[cfg(unix)]
        let created = std::os::unix::fs::symlink(&target, &link);
        #[cfg(windows)]
        let created = std::fs::copy(&target, &link).map(|_| ());
        match created {
            Ok(()) => return Ok(get_cli_status()),
            Err(e) => errors.push(format!("{}: {}", link.display(), e)),
        }
    }
    Err(errors.join("; "))
}

#[tauri::command]
pub fn uninstall_cli() -> Result<CliStatus, String> {
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
    Ok(get_cli_status())
}
