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

/// What a `cairn` invocation asked for, once its arguments are parsed:
/// files/directories to open, a directory to import as a project, or a repo
/// to clone. At most one of `open_dir` / `clone_url` is set; `paths` holds
/// everything else (files, and directories handed to `take_pending_cli_paths`
/// callers that only care about file tabs).
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliRequest {
    pub paths: Vec<String>,
    pub open_dir: Option<String>,
    pub clone_url: Option<String>,
}

/// Parses the arguments of a `cairn` invocation against `cwd`: `clone <url>`
/// opens the clone modal, a single directory argument (`.` included) opens
/// the import modal, anything else is handed to the frontend as file paths.
pub fn parse_cli_args(args: &[String], cwd: &Path) -> CliRequest {
    let args: Vec<&String> = args.iter().filter(|a| !a.starts_with('-')).collect();

    if let [cmd, url] = args.as_slice()
        && cmd.as_str() == "clone" {
            return CliRequest {
                clone_url: Some((*url).clone()),
                ..Default::default()
            };
        }

    if let [arg] = args.as_slice() {
        let absolute = absolutize(arg, cwd);
        if Path::new(&absolute).is_dir() {
            return CliRequest {
                open_dir: Some(absolute),
                ..Default::default()
            };
        }
    }

    CliRequest {
        paths: args.iter().map(|a| absolutize(a, cwd)).collect(),
        ..Default::default()
    }
}

/// The parsed launch request, held until the frontend is ready to ask.
#[derive(Default)]
pub struct PendingCliPaths(pub Mutex<CliRequest>);

impl PendingCliPaths {
    /// Reads the arguments of this launch and resolves them against the
    /// shell's working directory.
    pub fn from_args() -> Self {
        let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let args: Vec<String> = std::env::args().skip(1).collect();
        Self(Mutex::new(parse_cli_args(&args, &cwd)))
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

/// Drains the pending request: consumed once, by the first frontend that
/// asks, so a later reload does not reopen it.
#[tauri::command]
pub fn take_pending_cli_paths(state: tauri::State<'_, PendingCliPaths>) -> CliRequest {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clone_subcommand_yields_clone_url() {
        let cwd = std::env::temp_dir();
        let args = vec!["clone".to_string(), "git@github.com:user/repo.git".to_string()];
        let req = parse_cli_args(&args, &cwd);
        assert_eq!(req.clone_url.as_deref(), Some("git@github.com:user/repo.git"));
        assert!(req.open_dir.is_none());
        assert!(req.paths.is_empty());
    }

    #[test]
    fn dot_argument_yields_open_dir() {
        let cwd = std::env::temp_dir().canonicalize().unwrap();
        let args = vec![".".to_string()];
        let req = parse_cli_args(&args, &cwd);
        assert_eq!(req.open_dir.as_deref(), Some(cwd.to_string_lossy().as_ref()));
        assert!(req.clone_url.is_none());
        assert!(req.paths.is_empty());
    }

    #[test]
    fn file_argument_yields_paths() {
        let cwd = std::env::temp_dir();
        let file = cwd.join("cairn-cli-test-file.txt");
        std::fs::write(&file, b"x").unwrap();
        let args = vec![file.to_string_lossy().into_owned()];
        let req = parse_cli_args(&args, &cwd);
        assert_eq!(req.paths, vec![file.to_string_lossy().into_owned()]);
        assert!(req.open_dir.is_none());
        assert!(req.clone_url.is_none());
        std::fs::remove_file(&file).unwrap();
    }

    #[test]
    fn flags_are_dropped() {
        let cwd = std::env::temp_dir();
        let file = cwd.join("cairn-cli-test-flag.txt");
        std::fs::write(&file, b"x").unwrap();
        let args = vec!["--verbose".to_string(), file.to_string_lossy().into_owned()];
        let req = parse_cli_args(&args, &cwd);
        assert_eq!(req.paths, vec![file.to_string_lossy().into_owned()]);
        std::fs::remove_file(&file).unwrap();
    }
}
