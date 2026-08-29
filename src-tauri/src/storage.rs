//! Every path under `~/.cairn` is built here, never inlined at the call site,
//! so the on-disk layout stays described in one place.

use std::fs;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};

/// Result of a shelled-out command, as handed back to the frontend.
#[derive(Serialize, Deserialize)]
pub struct CommandOutput {
    pub stdout: String,
    pub stderr: String,
    pub success: bool,
}

/// Root of the app data directory, `~/.cairn`.
pub fn cairn_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Cannot resolve home directory")?;
    Ok(home.join(".cairn"))
}

/// Global app settings (`CairnSettings`).
pub fn settings_file() -> Result<PathBuf, String> {
    Ok(cairn_dir()?.join("settings.json"))
}

/// Provider configuration, secrets excluded.
pub fn ai_providers_file() -> Result<PathBuf, String> {
    Ok(cairn_dir()?.join("ai-providers.json"))
}

/// Provider API keys, encrypted with the secret next to it.
pub fn api_keys_file() -> Result<PathBuf, String> {
    Ok(cairn_dir()?.join("ai-keys.enc"))
}

/// The per-install secret the key file is encrypted with.
pub fn api_keys_secret_file() -> Result<PathBuf, String> {
    Ok(cairn_dir()?.join("ai-keys.secret"))
}

/// All registered projects.
pub fn projects_file() -> Result<PathBuf, String> {
    Ok(cairn_dir()?.join("projects").join("projects.json"))
}

/// Project order and folder groupings of the home list.
pub fn listing_file() -> Result<PathBuf, String> {
    Ok(cairn_dir()?.join("projects").join("listing.json"))
}

/// Instances belonging to one project.
pub fn instances_file(project_id: &str) -> Result<PathBuf, String> {
    Ok(cairn_dir()?.join("projects").join(project_id).join("instances.json"))
}

/// Git worktrees, one per instance of the project.
pub fn worktrees_dir(project_id: &str) -> Result<PathBuf, String> {
    Ok(cairn_dir()?.join("projects").join(project_id).join("worktrees"))
}

/// Terminals shared across every instance of the project.
pub fn project_terminal_state_file(project_id: &str) -> Result<PathBuf, String> {
    Ok(cairn_dir()?.join("projects").join(project_id).join("terminal-state.json"))
}

/// Agent runs recorded at project scope.
pub fn project_agent_runs_file(project_id: &str) -> Result<PathBuf, String> {
    Ok(cairn_dir()?.join("projects").join(project_id).join("agent-runs.json"))
}

/// Project-scoped conversations: `index.json` plus one file per transcript.
pub fn project_conversations_dir(project_id: &str) -> Result<PathBuf, String> {
    Ok(cairn_dir()?.join("projects").join(project_id).join("conversations"))
}

/// Instance-scoped conversations, same layout as the project-scoped ones.
pub fn instance_conversations_dir(project_id: &str, instance_id: &str) -> Result<PathBuf, String> {
    Ok(cairn_dir()?
        .join("projects")
        .join(project_id)
        .join("instances")
        .join(instance_id)
        .join("conversations"))
}

/// Formatter configuration for the project.
pub fn project_formatting_file(project_id: &str) -> Result<PathBuf, String> {
    Ok(cairn_dir()?.join("projects").join(project_id).join("formatting.json"))
}

/// User commands available in every project.
pub fn global_commands_file() -> Result<PathBuf, String> {
    Ok(cairn_dir()?.join("commands.json"))
}

/// User commands defined for this project only.
pub fn project_commands_file(project_id: &str) -> Result<PathBuf, String> {
    Ok(cairn_dir()?.join("projects").join(project_id).join("commands.json"))
}

/// Last run and output of the commands, per instance.
pub fn instance_command_state_file(project_id: &str, instance_id: &str) -> Result<PathBuf, String> {
    Ok(cairn_dir()?
        .join("projects")
        .join(project_id)
        .join("instances")
        .join(instance_id)
        .join("command-state.json"))
}

/// Environment variables injected into every spawned process.
pub fn global_env_file() -> Result<PathBuf, String> {
    Ok(cairn_dir()?.join("env.json"))
}

/// Environment variables added on top of the global ones for this project.
pub fn project_env_file(project_id: &str) -> Result<PathBuf, String> {
    Ok(cairn_dir()?.join("projects").join(project_id).join("env.json"))
}

/// Environment variables of one instance, the narrowest of the three scopes.
pub fn instance_env_file(project_id: &str, instance_id: &str) -> Result<PathBuf, String> {
    Ok(cairn_dir()?
        .join("projects")
        .join(project_id)
        .join("instances")
        .join(instance_id)
        .join("env.json"))
}

/// Integration connections (GitLab, GitHub, Jira accounts), tokens excluded.
pub fn integrations_file() -> Result<PathBuf, String> {
    Ok(cairn_dir()?.join("integrations.json"))
}

/// Which connections the project uses as tracker, forge and CI.
pub fn project_integrations_file(project_id: &str) -> Result<PathBuf, String> {
    Ok(cairn_dir()?.join("projects").join(project_id).join("integrations.json"))
}

/// Navigation state restored on launch: screen, active project, tabs, sections.
pub fn ui_state_file() -> Result<PathBuf, String> {
    Ok(cairn_dir()?.join("ui-state.json"))
}

/// Which conversation of each instance finished and has not been read yet.
pub fn agent_activity_file() -> Result<PathBuf, String> {
    Ok(cairn_dir()?.join("agent-activity.json"))
}

/// Token and cost usage accumulated across agent runs.
pub fn usage_file() -> Result<PathBuf, String> {
    Ok(cairn_dir()?.join("usage.json"))
}

/// Editor tabs, cursor, scroll and recent files of one instance.
pub fn instance_file_state_file(project_id: &str, instance_id: &str) -> Result<PathBuf, String> {
    Ok(cairn_dir()?
        .join("projects")
        .join(project_id)
        .join("instances")
        .join(instance_id)
        .join("file-state.json"))
}

/// Terminals of one instance: their order and the active one.
pub fn instance_terminal_state_file(project_id: &str, instance_id: &str) -> Result<PathBuf, String> {
    Ok(cairn_dir()?
        .join("projects")
        .join(project_id)
        .join("instances")
        .join(instance_id)
        .join("terminal-state.json"))
}

/// Draft commit message and staged selection of one instance.
pub fn instance_commit_state_file(project_id: &str, instance_id: &str) -> Result<PathBuf, String> {
    Ok(cairn_dir()?
        .join("projects")
        .join(project_id)
        .join("instances")
        .join(instance_id)
        .join("commit-state.json"))
}

/// Which file groups are folded in the git view of one instance.
pub fn instance_git_collapse_state_file(project_id: &str, instance_id: &str) -> Result<PathBuf, String> {
    Ok(cairn_dir()?
        .join("projects")
        .join(project_id)
        .join("instances")
        .join(instance_id)
        .join("git-collapse-state.json"))
}

/// The review guide, the seen hunks and the pending comments of one instance.
pub fn instance_review_state_file(project_id: &str, instance_id: &str) -> Result<PathBuf, String> {
    Ok(cairn_dir()?
        .join("projects")
        .join(project_id)
        .join("instances")
        .join(instance_id)
        .join("review-state.json"))
}

/// The last test run of one instance, with its selection and filters.
pub fn instance_test_state_file(project_id: &str, instance_id: &str) -> Result<PathBuf, String> {
    Ok(cairn_dir()?
        .join("projects")
        .join(project_id)
        .join("instances")
        .join(instance_id)
        .join("test-state.json"))
}

/// Serializes to a temp file then renames over `path`, so a crash mid-write
/// leaves the previous file intact rather than a truncated one. Missing parent
/// directories are created.
pub fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let contents = serde_json::to_string(value).map_err(|e| e.to_string())?;
    // Include the pid so two processes never collide on the same temp path.
    let tmp = path.with_extension(format!("tmp.{}", std::process::id()));
    fs::write(&tmp, contents).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })
}

/// Copies `src` into the existing directory `dst`, preserving symlinks and
/// permission bits. `.git` is skipped: a copied worktree must not inherit the
/// source repository's metadata.
pub fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        if name == ".git" {
            continue;
        }
        let src_path = entry.path();
        let dst_path = dst.join(&name);
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        if file_type.is_symlink() {
            copy_symlink(&src_path, &dst_path)?;
        } else if file_type.is_dir() {
            fs::create_dir_all(&dst_path).map_err(|e| e.to_string())?;
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            // fs::copy preserves the source's permission bits (including +x).
            fs::copy(&src_path, &dst_path).map(|_| ()).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Recreates a symlink at `dst` pointing to the same target, without following
/// it. Windows needs to know upfront whether the target is a directory.
fn copy_symlink(src: &Path, dst: &Path) -> Result<(), String> {
    let target = fs::read_link(src).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(&target, dst).map_err(|e| e.to_string())
    }
    #[cfg(windows)]
    {
        let meta = fs::symlink_metadata(src).map_err(|e| e.to_string())?;
        if meta.file_type().is_dir() {
            std::os::windows::fs::symlink_dir(&target, dst).map_err(|e| e.to_string())
        } else {
            std::os::windows::fs::symlink_file(&target, dst).map_err(|e| e.to_string())
        }
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = target;
        Err("Symlinks are not supported on this platform".to_string())
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new() -> Self {
            static COUNTER: AtomicU32 = AtomicU32::new(0);
            let n = COUNTER.fetch_add(1, Ordering::SeqCst);
            let path = std::env::temp_dir()
                .join(format!("cairn-storage-test-{}-{}", std::process::id(), n));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).unwrap();
            TempDir { path }
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn write_json_atomic_roundtrips() {
        let tmp = TempDir::new();
        let file = tmp.path.join("data.json");
        let value = vec!["a".to_string(), "b".to_string()];

        write_json_atomic(&file, &value).unwrap();

        let read: Vec<String> =
            serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
        assert_eq!(read, value);
    }

    #[test]
    fn write_json_atomic_creates_missing_parent_dirs() {
        let tmp = TempDir::new();
        let file = tmp.path.join("nested/deeper/data.json");

        write_json_atomic(&file, &vec![1, 2, 3]).unwrap();

        assert!(file.exists());
    }

    #[test]
    fn write_json_atomic_overwrites_existing() {
        let tmp = TempDir::new();
        let file = tmp.path.join("data.json");

        write_json_atomic(&file, &vec![1, 2, 3]).unwrap();
        write_json_atomic(&file, &vec![9]).unwrap();

        let read: Vec<i32> =
            serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
        assert_eq!(read, vec![9]);
    }

    #[test]
    fn write_json_atomic_leaves_no_temp_file() {
        let tmp = TempDir::new();
        let file = tmp.path.join("data.json");

        write_json_atomic(&file, &vec![1]).unwrap();

        let leftovers: Vec<String> = fs::read_dir(&tmp.path)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(leftovers, vec!["data.json".to_string()]);
    }

    #[test]
    fn copy_dir_recursive_copies_nested_content() {
        let tmp = TempDir::new();
        let src = tmp.path.join("src");
        let dst = tmp.path.join("dst");
        fs::create_dir_all(src.join("a/b")).unwrap();
        fs::write(src.join("top.txt"), "top").unwrap();
        fs::write(src.join("a/b/deep.txt"), "deep").unwrap();
        fs::create_dir_all(&dst).unwrap();

        copy_dir_recursive(&src, &dst).unwrap();

        assert_eq!(fs::read_to_string(dst.join("top.txt")).unwrap(), "top");
        assert_eq!(fs::read_to_string(dst.join("a/b/deep.txt")).unwrap(), "deep");
    }

    #[test]
    fn copy_dir_recursive_skips_git_dir() {
        let tmp = TempDir::new();
        let src = tmp.path.join("src");
        let dst = tmp.path.join("dst");
        fs::create_dir_all(src.join(".git")).unwrap();
        fs::write(src.join(".git/config"), "x").unwrap();
        fs::write(src.join("keep.txt"), "y").unwrap();
        fs::create_dir_all(&dst).unwrap();

        copy_dir_recursive(&src, &dst).unwrap();

        assert!(dst.join("keep.txt").exists());
        assert!(!dst.join(".git").exists(), ".git must not be copied");
    }

    #[cfg(unix)]
    #[test]
    fn copy_dir_recursive_preserves_symlinks() {
        let tmp = TempDir::new();
        let src = tmp.path.join("src");
        let dst = tmp.path.join("dst");
        fs::create_dir_all(&src).unwrap();
        fs::write(src.join("real.txt"), "hi").unwrap();
        std::os::unix::fs::symlink("real.txt", src.join("link.txt")).unwrap();
        fs::create_dir_all(&dst).unwrap();

        copy_dir_recursive(&src, &dst).unwrap();

        let meta = fs::symlink_metadata(dst.join("link.txt")).unwrap();
        assert!(meta.file_type().is_symlink(), "symlink must stay a symlink");
        assert_eq!(fs::read_link(dst.join("link.txt")).unwrap(), PathBuf::from("real.txt"));
    }
}
