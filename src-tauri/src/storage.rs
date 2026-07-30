use std::fs;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct CommandOutput {
    pub stdout: String,
    pub stderr: String,
    pub success: bool,
}

pub fn cairn_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Cannot resolve home directory")?;
    Ok(home.join(".cairn"))
}

pub fn settings_file() -> Result<PathBuf, String> {
    Ok(cairn_dir()?.join("settings.json"))
}

pub fn projects_file() -> Result<PathBuf, String> {
    Ok(cairn_dir()?.join("projects").join("projects.json"))
}

pub fn listing_file() -> Result<PathBuf, String> {
    Ok(cairn_dir()?.join("projects").join("listing.json"))
}

pub fn instances_file(project_id: &str) -> Result<PathBuf, String> {
    Ok(cairn_dir()?.join("projects").join(project_id).join("instances.json"))
}

pub fn worktrees_dir(project_id: &str) -> Result<PathBuf, String> {
    Ok(cairn_dir()?.join("projects").join(project_id).join("worktrees"))
}

pub fn project_terminal_state_file(project_id: &str) -> Result<PathBuf, String> {
    Ok(cairn_dir()?.join("projects").join(project_id).join("terminal-state.json"))
}

pub fn project_conversations_dir(project_id: &str) -> Result<PathBuf, String> {
    Ok(cairn_dir()?.join("projects").join(project_id).join("conversations"))
}

pub fn instance_conversations_dir(project_id: &str, instance_id: &str) -> Result<PathBuf, String> {
    Ok(cairn_dir()?
        .join("projects")
        .join(project_id)
        .join("instances")
        .join(instance_id)
        .join("conversations"))
}

pub fn global_commands_file() -> Result<PathBuf, String> {
    Ok(cairn_dir()?.join("commands.json"))
}

pub fn project_commands_file(project_id: &str) -> Result<PathBuf, String> {
    Ok(cairn_dir()?.join("projects").join(project_id).join("commands.json"))
}

pub fn instance_command_state_file(project_id: &str, instance_id: &str) -> Result<PathBuf, String> {
    Ok(cairn_dir()?
        .join("projects")
        .join(project_id)
        .join("instances")
        .join(instance_id)
        .join("command-state.json"))
}

pub fn global_env_file() -> Result<PathBuf, String> {
    Ok(cairn_dir()?.join("env.json"))
}

pub fn project_env_file(project_id: &str) -> Result<PathBuf, String> {
    Ok(cairn_dir()?.join("projects").join(project_id).join("env.json"))
}

pub fn instance_env_file(project_id: &str, instance_id: &str) -> Result<PathBuf, String> {
    Ok(cairn_dir()?
        .join("projects")
        .join(project_id)
        .join("instances")
        .join(instance_id)
        .join("env.json"))
}

pub fn ui_state_file() -> Result<PathBuf, String> {
    Ok(cairn_dir()?.join("ui-state.json"))
}

pub fn agent_activity_file() -> Result<PathBuf, String> {
    Ok(cairn_dir()?.join("agent-activity.json"))
}

pub fn instance_file_state_file(project_id: &str, instance_id: &str) -> Result<PathBuf, String> {
    Ok(cairn_dir()?
        .join("projects")
        .join(project_id)
        .join("instances")
        .join(instance_id)
        .join("file-state.json"))
}

pub fn instance_terminal_state_file(project_id: &str, instance_id: &str) -> Result<PathBuf, String> {
    Ok(cairn_dir()?
        .join("projects")
        .join(project_id)
        .join("instances")
        .join(instance_id)
        .join("terminal-state.json"))
}

pub fn instance_commit_state_file(project_id: &str, instance_id: &str) -> Result<PathBuf, String> {
    Ok(cairn_dir()?
        .join("projects")
        .join(project_id)
        .join("instances")
        .join(instance_id)
        .join("commit-state.json"))
}

pub fn instance_git_collapse_state_file(project_id: &str, instance_id: &str) -> Result<PathBuf, String> {
    Ok(cairn_dir()?
        .join("projects")
        .join(project_id)
        .join("instances")
        .join(instance_id)
        .join("git-collapse-state.json"))
}

pub fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let contents = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    // Include the pid so two processes never collide on the same temp path.
    let tmp = path.with_extension(format!("tmp.{}", std::process::id()));
    fs::write(&tmp, contents).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })
}

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
