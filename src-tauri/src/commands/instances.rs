// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Instances: one git worktree and branch per unit of work. Creating one adds a
//! branch and a worktree under the project's `worktrees/` directory; deleting
//! one takes both away again.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use git2::{Repository, BranchType};
use serde::{Deserialize, Serialize};
use crate::storage::{instances_file, worktrees_dir, copy_dir_recursive, write_json_atomic};
use super::file_state::delete_file_state_dir;
use super::projects::read_projects;

// Read-modify-write of instances.json is not atomic on its own, so every
// mutation serializes through this lock.
static INSTANCES_WRITE_LOCK: Mutex<()> = Mutex::new(());

/// What the instance is about, as shown in the instance list.
#[derive(Serialize, Deserialize, Clone)]
pub struct InstanceTicket {
    pub id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(rename = "connectionId", default, skip_serializing_if = "Option::is_none")]
    pub connection_id: Option<String>,
}

/// An instance as written to `instances.json`, where the project id is implied
/// by the file's location and therefore not stored.
#[derive(Serialize, Deserialize, Clone)]
pub struct StoredInstance {
    pub id: String,
    pub ticket: InstanceTicket,
    pub branch: String,
    #[serde(rename = "worktreePath")]
    pub worktree_path: String,
    pub status: String,
    #[serde(rename = "createdAt")]
    pub created_at: u64,
    #[serde(rename = "baseBranch", default)]
    pub base_branch: String,
    #[serde(rename = "parentInstanceId", default, skip_serializing_if = "Option::is_none")]
    pub parent_instance_id: Option<String>,
}

/// The same instance as handed to the frontend, with its project id attached.
#[derive(Serialize, Clone)]
pub struct Instance {
    pub id: String,
    #[serde(rename = "projectId")]
    pub project_id: String,
    pub ticket: InstanceTicket,
    pub branch: String,
    #[serde(rename = "worktreePath")]
    pub worktree_path: String,
    pub status: String,
    #[serde(rename = "createdAt")]
    pub created_at: u64,
    #[serde(rename = "baseBranch")]
    pub base_branch: String,
    #[serde(rename = "parentInstanceId", skip_serializing_if = "Option::is_none")]
    pub parent_instance_id: Option<String>,
}

impl StoredInstance {
    /// Attaches the project id the stored form leaves out.
    pub fn with_project(self, project_id: String) -> Instance {
        Instance {
            id: self.id,
            project_id,
            ticket: self.ticket,
            branch: self.branch,
            worktree_path: self.worktree_path,
            status: self.status,
            created_at: self.created_at,
            base_branch: self.base_branch,
            parent_instance_id: self.parent_instance_id,
        }
    }
}

/// `link_existing` picks up a branch that already exists (local, or tracked
/// from a remote) instead of cutting a new one off `base_branch`.
#[derive(Deserialize)]
pub struct CreateInstanceArgs {
    pub id: String,
    #[serde(rename = "projectId")]
    pub project_id: String,
    #[serde(rename = "projectPath")]
    pub project_path: String,
    pub ticket: InstanceTicket,
    pub branch: Option<String>,
    #[serde(rename = "baseBranch")]
    pub base_branch: Option<String>,
    #[serde(rename = "linkExisting", default)]
    pub link_existing: bool,
}

/// Empty for a project that has no instance yet.
pub fn read_instances(project_id: &str) -> Result<Vec<StoredInstance>, String> {
    let path = instances_file(project_id)?;
    if !path.exists() { return Ok(vec![]); }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

/// Callers must hold `INSTANCES_WRITE_LOCK` around the read they are updating.
pub fn write_instances(project_id: &str, instances: &Vec<StoredInstance>) -> Result<(), String> {
    write_json_atomic(&instances_file(project_id)?, instances)
}

/// Every instance of the project, in storage order.
#[tauri::command]
pub fn list_instances(project_id: String) -> Result<Vec<Instance>, String> {
    let stored = read_instances(&project_id)?;
    Ok(stored.into_iter().map(|i| i.with_project(project_id.clone())).collect())
}

/// Creates the branch and its worktree, then records the instance. A stale git
/// worktree entry or leftover directory under the same slug is cleared first,
/// and a branch this call created is deleted again if the worktree fails.
/// Async: worktree creation blocks long enough to freeze the UI thread.
/// Dependency folders are git-ignored and take minutes and gigabytes to
/// rebuild per worktree; APFS, btrfs and XFS copy a directory in milliseconds,
/// copy-on-write, so a new instance starts with the base's. Only attempted on
/// the same volume, and a failed clone leaves nothing behind.
const DEPENDENCY_DIRS: &[&str] = &["node_modules", ".venv", "vendor", "target"];

fn clone_dependency_dirs(repo: &Repository, source: &Path, target: &Path) {
    for name in DEPENDENCY_DIRS {
        let from = source.join(name);
        let to = target.join(name);
        if !from.is_dir() || to.exists() || !repo.is_path_ignored(Path::new(name)).unwrap_or(false) {
            continue;
        }
        if !same_volume(&from, target) {
            continue;
        }
        let status = clone_command(&from, &to)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
        if !matches!(status, Ok(s) if s.success()) {
            let _ = fs::remove_dir_all(&to);
        }
    }
}

#[cfg(unix)]
fn same_volume(a: &Path, b: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    match (fs::metadata(a), fs::metadata(b)) {
        (Ok(a), Ok(b)) => a.dev() == b.dev(),
        _ => false,
    }
}

#[cfg(not(unix))]
fn same_volume(_a: &Path, _b: &Path) -> bool {
    false
}

#[cfg(target_os = "macos")]
fn clone_command(from: &Path, to: &Path) -> std::process::Command {
    let mut cmd = std::process::Command::new("cp");
    cmd.args(["-c", "-R"]).arg(from).arg(to);
    cmd
}

#[cfg(not(target_os = "macos"))]
fn clone_command(from: &Path, to: &Path) -> std::process::Command {
    let mut cmd = std::process::Command::new("cp");
    cmd.args(["-R", "--reflink=always"]).arg(from).arg(to);
    cmd
}

#[tauri::command]
pub async fn create_instance(args: CreateInstanceArgs) -> Result<Instance, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let expanded_project = shellexpand::tilde(&args.project_path).into_owned();

        let (branch, worktree_path_str) = {
            let branch_input = args.branch.clone().ok_or("branch is required")?;

            let repo = Repository::open(&expanded_project).map_err(|e| e.to_string())?;

            let (branch, branch_created) = if args.link_existing {
                if repo.find_branch(&branch_input, BranchType::Local).is_ok() {
                    (branch_input.clone(), false)
                } else {
                    let remote_obj = repo
                        .revparse_single(&format!("refs/remotes/{}", branch_input))
                        .map_err(|_| format!("Branch '{}' not found", branch_input))?;
                    let remote_commit = remote_obj.peel_to_commit().map_err(|e| e.to_string())?;
                    let local_name = branch_input.split_once('/').map(|x| x.1)
                        .unwrap_or(&branch_input)
                        .to_string();
                    if repo.find_branch(&local_name, BranchType::Local).is_ok() {
                        (local_name, false)
                    } else {
                        let mut local = repo
                            .branch(&local_name, &remote_commit, false)
                            .map_err(|e| format!("Failed to create branch '{}': {}", local_name, e))?;
                        let _ = local.set_upstream(Some(&branch_input));
                        (local_name, true)
                    }
                }
            } else {
                let base_branch = args.base_branch.clone().ok_or("baseBranch is required")?;

                let base_obj = repo
                    .revparse_single(&format!("refs/heads/{}", base_branch))
                    .or_else(|_| repo.revparse_single(&format!("refs/remotes/{}", base_branch)))
                    .or_else(|_| repo.revparse_single(&base_branch))
                    .map_err(|_| format!("Base branch '{}' not found", base_branch))?;
                let base_commit = base_obj.peel_to_commit().map_err(|e| e.to_string())?;

                match repo.branch(&branch_input, &base_commit, false) {
                    Ok(_) => (branch_input.clone(), true),
                    Err(e) if e.code() == git2::ErrorCode::Exists => (branch_input.clone(), false),
                    Err(e) => return Err(format!("Failed to create branch '{}': {}", branch_input, e)),
                }
            };

            let slug = branch.replace('/', "-");
            let worktree_path = worktrees_dir(&args.project_id)?.join(&slug);

            let git_worktree_entry = repo.path().join("worktrees").join(&slug);
            if git_worktree_entry.exists() {
                fs::remove_dir_all(&git_worktree_entry).map_err(|e| e.to_string())?;
            }
            if worktree_path.exists() {
                fs::remove_dir_all(&worktree_path).map_err(|e| e.to_string())?;
            }

            let worktree_parent = worktree_path
                .parent()
                .ok_or_else(|| format!("Invalid worktree path: {}", worktree_path.display()))?;
            fs::create_dir_all(worktree_parent).map_err(|e| e.to_string())?;

            let worktree_result = repo.worktree(
                &slug,
                &worktree_path,
                Some(git2::WorktreeAddOptions::new().reference(Some(
                    &repo.find_branch(&branch, BranchType::Local)
                        .map_err(|e| e.to_string())?
                        .into_reference(),
                ))),
            );

            if let Err(e) = worktree_result {
                if branch_created
                    && let Ok(mut b) = repo.find_branch(&branch, BranchType::Local) {
                        let _ = b.delete();
                    };
                let _ = fs::remove_dir_all(&worktree_path);
                return Err(format!("Failed to create worktree: {}", e));
            }

            clone_dependency_dirs(&repo, Path::new(&expanded_project), &worktree_path);

            (branch, worktree_path.to_string_lossy().to_string())
        };

        let stored = StoredInstance {
            id: args.id,
            ticket: args.ticket,
            branch,
            worktree_path: worktree_path_str,
            status: "idle".to_string(),
            created_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
            base_branch: args.base_branch.unwrap_or_default(),
            parent_instance_id: None,
        };

        let _guard = INSTANCES_WRITE_LOCK.lock().map_err(|e| e.to_string())?;
        let mut instances = read_instances(&args.project_id)?;
        instances.push(stored.clone());
        write_instances(&args.project_id, &instances)?;

        Ok(stored.with_project(args.project_id))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// `copy_working_changes` carries the source worktree's uncommitted files over.
#[derive(Deserialize)]
pub struct DuplicateInstanceArgs {
    #[serde(rename = "sourceId")]
    pub source_id: String,
    #[serde(rename = "projectId")]
    pub project_id: String,
    #[serde(rename = "newId")]
    pub new_id: String,
    pub ticket: InstanceTicket,
    #[serde(rename = "copyWorkingChanges")]
    pub copy_working_changes: bool,
}

/// Branches off the source instance's tip into `{branch}--{short id}` and gives
/// it its own worktree. Async for the same reason as `create_instance`.
#[tauri::command]
pub async fn duplicate_instance(args: DuplicateInstanceArgs) -> Result<Instance, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let instances = read_instances(&args.project_id)?;
        let source = instances.iter()
            .find(|i| i.id == args.source_id)
            .ok_or_else(|| format!("Instance '{}' not found", args.source_id))?
            .clone();

        let (branch, worktree_path_str) = {
            let projects = read_projects()?;
            let expanded_project = projects.iter()
                .find(|p| p.id == args.project_id)
                .map(|p| shellexpand::tilde(&p.path).into_owned())
                .ok_or_else(|| "Project not found".to_string())?;

            let repo = Repository::open(&expanded_project).map_err(|e| e.to_string())?;

            let src_branch = repo.find_branch(&source.branch, BranchType::Local)
                .map_err(|e| e.to_string())?;
            let src_commit = src_branch.get().peel_to_commit().map_err(|e| e.to_string())?;

            let short_id: String = args.new_id.chars().take(8).collect();
            let new_branch = format!("{}--{}", source.branch, short_id);
            repo.branch(&new_branch, &src_commit, false).map_err(|e| e.to_string())?;

            let slug = new_branch.replace('/', "-");
            let worktree_path = worktrees_dir(&args.project_id)?.join(&slug);

            if let Err(e) = repo.worktree(
                &slug,
                &worktree_path,
                Some(git2::WorktreeAddOptions::new().reference(Some(
                    &repo.find_branch(&new_branch, BranchType::Local)
                        .map_err(|e| e.to_string())?
                        .into_reference(),
                ))),
            ) {
                if let Ok(mut b) = repo.find_branch(&new_branch, BranchType::Local) {
                    let _ = b.delete();
                }
                return Err(format!("Failed to create worktree: {}", e));
            }

            if args.copy_working_changes {
                copy_dir_recursive(std::path::Path::new(&source.worktree_path), &worktree_path)?;
            }

            (new_branch, worktree_path.to_string_lossy().to_string())
        };

        let stored = StoredInstance {
            id: args.new_id,
            ticket: args.ticket,
            branch,
            worktree_path: worktree_path_str,
            status: "idle".to_string(),
            created_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
            base_branch: source.base_branch.clone(),
            parent_instance_id: Some(args.source_id.clone()),
        };

        let _guard = INSTANCES_WRITE_LOCK.lock().map_err(|e| e.to_string())?;
        let mut all_instances = read_instances(&args.project_id)?;
        all_instances.push(stored.clone());
        write_instances(&args.project_id, &all_instances)?;

        Ok(stored.with_project(args.project_id))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Moves the instance's status dot; nothing on disk changes but the JSON.
#[tauri::command]
pub fn update_instance_status(id: String, project_id: String, status: String) -> Result<Instance, String> {
    let _guard = INSTANCES_WRITE_LOCK.lock().map_err(|e| e.to_string())?;
    let mut instances = read_instances(&project_id)?;
    let instance = instances.iter_mut().find(|i| i.id == id)
        .ok_or_else(|| format!("Instance '{}' not found", id))?;
    instance.status = status;
    let updated = instance.clone();
    write_instances(&project_id, &instances)?;
    Ok(updated.with_project(project_id))
}

/// Replaces the instance ticket, which is how a manual id gets linked to a tracker.
#[tauri::command]
pub fn update_instance_ticket(id: String, project_id: String, ticket: InstanceTicket) -> Result<Instance, String> {
    let _guard = INSTANCES_WRITE_LOCK.lock().map_err(|e| e.to_string())?;
    let mut instances = read_instances(&project_id)?;
    let instance = instances.iter_mut().find(|i| i.id == id)
        .ok_or_else(|| format!("Instance '{}' not found", id))?;
    instance.ticket = ticket;
    let updated = instance.clone();
    write_instances(&project_id, &instances)?;
    Ok(updated.with_project(project_id))
}

/// Records the branch the instance's work is measured against. The worktree is
/// not touched: rebasing onto the new base is the caller's move, this only keeps
/// the diffs, the divergence counts and the merge request target in step with it.
#[tauri::command]
pub fn update_instance_base_branch(id: String, project_id: String, base_branch: String) -> Result<Instance, String> {
    let _guard = INSTANCES_WRITE_LOCK.lock().map_err(|e| e.to_string())?;
    let mut instances = read_instances(&project_id)?;
    let instance = instances.iter_mut().find(|i| i.id == id)
        .ok_or_else(|| format!("Instance '{}' not found", id))?;
    instance.base_branch = base_branch;
    let updated = instance.clone();
    write_instances(&project_id, &instances)?;
    Ok(updated.with_project(project_id))
}

/// Removes the worktree directory, prunes the git worktree entry, deletes the
/// branch, then drops the instance and its editor state. The git cleanup is
/// best effort: a missing worktree or branch must not block the deletion.
/// Async: removing the worktree directory blocks long enough to freeze the UI thread.
#[tauri::command]
pub async fn delete_instance(id: String, project_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = INSTANCES_WRITE_LOCK.lock().map_err(|e| e.to_string())?;
        let mut instances = read_instances(&project_id)?;
        let instance = instances.iter().find(|i| i.id == id)
            .ok_or_else(|| format!("Instance '{}' not found", id))?
            .clone();

        let wt_path = PathBuf::from(&instance.worktree_path);
        if wt_path.exists() {
            fs::remove_dir_all(&wt_path).map_err(|e| e.to_string())?;
        }

        let projects = read_projects()?;
        let expanded_project = projects.iter()
            .find(|p| p.id == project_id)
            .map(|p| shellexpand::tilde(&p.path).into_owned())
            .ok_or_else(|| "Project not found".to_string())?;

        let repo = Repository::open(&expanded_project).map_err(|e| e.to_string())?;

        let slug = instance.branch.replace('/', "-");
        if let Ok(wt) = repo.find_worktree(&slug) {
            let _ = wt.prune(None);
        }
        if let Ok(mut branch) = repo.find_branch(&instance.branch, BranchType::Local) {
            let _ = branch.delete();
        };

        instances.retain(|i| i.id != id);
        write_instances(&project_id, &instances)?;
        let _ = delete_file_state_dir(&project_id, &id);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stored(id: &str) -> StoredInstance {
        StoredInstance {
            id: id.to_string(),
            ticket: InstanceTicket {
                id: "CAIRN-1".to_string(),
                title: "Ajouter une chose".to_string(),
                key: None,
                url: None,
                source: None,
                connection_id: None,
            },
            branch: "feat/x".to_string(),
            worktree_path: "/worktrees/p1/i1".to_string(),
            status: "idle".to_string(),
            created_at: 1_700_000_000,
            base_branch: "main".to_string(),
            parent_instance_id: None,
        }
    }

    fn from_json(json: &str) -> StoredInstance {
        serde_json::from_str(json).expect("instance should parse")
    }

    #[test]
    fn attaching_the_project_id_loses_nothing_else() {
        let original = stored("i1");
        let instance = original.clone().with_project("p1".to_string());
        assert_eq!(instance.project_id, "p1");
        assert_eq!(instance.id, original.id);
        assert_eq!(instance.branch, original.branch);
        assert_eq!(instance.worktree_path, original.worktree_path);
        assert_eq!(instance.status, original.status);
        assert_eq!(instance.created_at, original.created_at);
        assert_eq!(instance.base_branch, original.base_branch);
        assert_eq!(instance.ticket.title, original.ticket.title);
    }

    #[test]
    fn a_branched_instance_keeps_the_instance_it_came_from() {
        let mut original = stored("i2");
        original.parent_instance_id = Some("i1".to_string());
        let instance = original.with_project("p1".to_string());
        assert_eq!(instance.parent_instance_id.as_deref(), Some("i1"));
    }

    /// The project id is implied by where the file lives, so it must never be
    /// written into the stored form.
    #[test]
    fn the_stored_form_carries_no_project_id() {
        let json = serde_json::to_value(stored("i1")).expect("should serialize");
        let object = json.as_object().expect("instance should be an object");
        assert!(!object.contains_key("projectId"));
    }

    #[test]
    fn the_frontend_form_carries_the_project_id() {
        let json = serde_json::to_value(stored("i1").with_project("p1".to_string()))
            .expect("should serialize");
        assert_eq!(json["projectId"], "p1");
    }

    #[test]
    fn a_stored_instance_survives_a_round_trip() {
        let original = stored("i1");
        let json = serde_json::to_string(&original).expect("should serialize");
        let back = from_json(&json);
        assert_eq!(back.id, "i1");
        assert_eq!(back.branch, "feat/x");
        assert_eq!(back.worktree_path, "/worktrees/p1/i1");
        assert_eq!(back.created_at, 1_700_000_000);
        assert_eq!(back.ticket.title, "Ajouter une chose");
    }

    #[test]
    fn an_instance_predating_the_base_branch_gains_an_empty_one() {
        let back = from_json(
            r#"{"id":"i1","ticket":{"id":"t","title":"t"},"branch":"b",
                "worktreePath":"/w","status":"idle","createdAt":1}"#,
        );
        assert_eq!(back.base_branch, "");
        assert!(back.parent_instance_id.is_none());
    }

    #[test]
    fn a_ticket_from_an_integration_keeps_its_key_and_url() {
        let back = from_json(
            r#"{"id":"i1","ticket":{"id":"1","title":"t","key":"CAIRN-42",
                "url":"https://example.test/1","source":"gitlab"},
                "branch":"b","worktreePath":"/w","status":"idle","createdAt":1}"#,
        );
        assert_eq!(back.ticket.key.as_deref(), Some("CAIRN-42"));
        assert_eq!(back.ticket.url.as_deref(), Some("https://example.test/1"));
        assert_eq!(back.ticket.source.as_deref(), Some("gitlab"));
    }

    #[test]
    fn a_ticket_typed_by_hand_carries_no_integration_field() {
        let json = serde_json::to_value(stored("i1")).expect("should serialize");
        let ticket = json["ticket"].as_object().expect("ticket should be an object");
        assert!(!ticket.contains_key("key"));
        assert!(!ticket.contains_key("url"));
        assert!(!ticket.contains_key("connectionId"));
    }

    #[test]
    fn a_branch_and_a_worktree_with_accents_come_back_unchanged() {
        let mut original = stored("i1");
        original.branch = "feat/été".to_string();
        original.worktree_path = "/worktrees/mon projet/i1".to_string();
        let json = serde_json::to_string(&original).expect("should serialize");
        let back = from_json(&json);
        assert_eq!(back.branch, "feat/été");
        assert_eq!(back.worktree_path, "/worktrees/mon projet/i1");
    }

    #[test]
    fn an_instance_missing_an_identifying_field_is_refused() {
        assert!(serde_json::from_str::<StoredInstance>(r#"{"id":"i1"}"#).is_err());
        assert!(serde_json::from_str::<StoredInstance>("not json").is_err());
    }

    #[test]
    fn it_serializes_under_the_names_the_frontend_reads() {
        let json = serde_json::to_value(stored("i1").with_project("p1".to_string()))
            .expect("should serialize");
        let object = json.as_object().expect("instance should be an object");
        for key in [
            "id",
            "projectId",
            "ticket",
            "branch",
            "worktreePath",
            "status",
            "createdAt",
            "baseBranch",
        ] {
            assert!(object.contains_key(key), "{key} is missing from the payload");
        }
    }
}
