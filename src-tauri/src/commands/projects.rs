// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

//! The registered projects and how the home screen lists them: `projects.json`
//! holds the projects themselves, `listing.json` their order and folders.

use std::fs;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use crate::storage::{projects_file, listing_file, worktrees_dir, cairn_dir, write_json_atomic, copy_dir_all};
use crate::commands::git::{clear_identity, write_identity};
use crate::commands::settings::{read_settings, GitProfile};

/// A repository registered in the app, identified by a frontend-minted id.
#[derive(Serialize, Deserialize, Clone)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub color: String,
    #[serde(rename = "activeInstanceId")]
    pub active_instance_id: Option<String>,
    #[serde(rename = "gitProfileId", default, skip_serializing_if = "Option::is_none")]
    pub git_profile_id: Option<String>,
    /// Overrides `branchTemplate` from the global settings for this repository;
    /// `None` leaves it to the global one.
    #[serde(rename = "branchTemplate", default, skip_serializing_if = "Option::is_none")]
    pub branch_template: Option<String>,
}

/// Empty on a first launch; shared with the other command modules.
pub fn read_projects() -> Result<Vec<Project>, String> {
    let path = projects_file()?;
    if !path.exists() { return Ok(vec![]); }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

/// Overwrites the whole list atomically.
pub fn write_projects(projects: &Vec<Project>) -> Result<(), String> {
    write_json_atomic(&projects_file()?, projects)
}

/// Storage order, not display order: the home list applies `listing.json`.
#[tauri::command]
pub fn list_projects() -> Result<Vec<Project>, String> {
    read_projects()
}

/// Rejects a duplicate id, and a path that canonicalizes onto an existing
/// project so the same repo cannot be registered twice through a symlink.
/// Returns the updated list.
#[tauri::command]
pub async fn add_project(project: Project) -> Result<Vec<Project>, String> {
    let mut projects = read_projects()?;
    if projects.iter().any(|p| p.id == project.id) {
        return Err(format!("Project with id '{}' already exists", project.id));
    }
    let canonical = canonical_path(&project.path);
    if projects.iter().any(|p| canonical_path(&p.path) == canonical) {
        return Err(format!("A project for '{}' already exists", canonical));
    }
    fs::create_dir_all(worktrees_dir(&project.id)?).map_err(|e| e.to_string())?;
    apply_git_profile(&read_settings()?.git_profiles, &project, None)?;
    projects.push(project);
    write_projects(&projects)?;
    Ok(projects)
}

/// Also deletes the project's whole `~/.cairn` directory (instances,
/// conversations, worktrees). The user's repository itself is never touched.
#[tauri::command]
pub fn remove_project(id: String) -> Result<Vec<Project>, String> {
    let mut projects = read_projects()?;
    projects.retain(|p| p.id != id);
    write_projects(&projects)?;
    let project_data_dir = cairn_dir()?.join("projects").join(&id);
    if project_data_dir.exists() {
        fs::remove_dir_all(&project_data_dir).map_err(|e| e.to_string())?;
    }
    Ok(projects)
}

/// Renames and recolors only: moving the checkout goes through `relocate_project`.
#[tauri::command]
pub fn update_project(
    id: String,
    name: String,
    color: String,
    branch_template: Option<String>,
) -> Result<Vec<Project>, String> {
    let mut projects = read_projects()?;
    let p = projects.iter_mut()
        .find(|p| p.id == id)
        .ok_or_else(|| format!("Project '{}' not found", id))?;
    p.name = name;
    p.color = color;
    p.branch_template = branch_template.map(|t| t.trim().to_string()).filter(|t| !t.is_empty());
    write_projects(&projects)?;
    Ok(projects)
}

/// Points the project at a new location on disk, for a checkout that was moved
/// or renamed. The instance worktrees stay in the data directory, but git
/// links them to the main checkout by absolute path in both directions, so
/// `git worktree repair` rewrites those links; a repair failure leaves the
/// relocation in place since the checkout itself is usable.
#[tauri::command]
pub async fn relocate_project(id: String, path: String) -> Result<Vec<Project>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let expanded = shellexpand::tilde(&path).into_owned();
        let target = PathBuf::from(&expanded);
        if !target.is_dir() {
            return Err(format!("Path is not a directory: {}", path));
        }
        let canonical = target.canonicalize().map_err(|e| e.to_string())?.to_string_lossy().to_string();
        let mut projects = read_projects()?;
        if projects.iter().any(|p| p.id != id && canonical_path(&p.path) == canonical) {
            return Err(format!("A project for '{}' already exists", canonical));
        }
        let project = projects.iter_mut()
            .find(|p| p.id == id)
            .ok_or_else(|| format!("Project '{}' not found", id))?;
        project.path = canonical.clone();
        write_projects(&projects)?;
        repair_worktrees(&id, &canonical);
        Ok(projects)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn canonical_path(path: &str) -> String {
    PathBuf::from(path)
        .canonicalize()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| path.to_string())
}

fn repair_worktrees(project_id: &str, repo: &str) {
    let worktrees: Vec<String> = crate::commands::instances::read_instances(project_id)
        .unwrap_or_default()
        .into_iter()
        .map(|i| i.worktree_path)
        .filter(|p| PathBuf::from(p).is_dir())
        .collect();
    if worktrees.is_empty() { return; }
    let _ = crate::child_env::command("git")
        .current_dir(repo)
        .args(["worktree", "repair"])
        .args(&worktrees)
        .output();
}

/// Copies the project's checkout on disk into `dest_parent/folder_name`, `.git`
/// included, and registers the copy as a new project. The source's instances
/// are not carried over: the copy's `.git/worktrees` is dropped so it does not
/// claim the source's worktrees as its own. Refuses an existing destination.
#[tauri::command]
pub async fn duplicate_project(
    id: String,
    new_id: String,
    name: String,
    color: String,
    dest_parent: String,
    folder_name: String,
) -> Result<Vec<Project>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut projects = read_projects()?;
        let original = projects.iter()
            .find(|p| p.id == id)
            .ok_or_else(|| format!("Project '{}' not found", id))?
            .clone();
        let source = PathBuf::from(shellexpand::tilde(&original.path).into_owned());
        if !source.is_dir() {
            return Err(format!("Path does not exist: {}", original.path));
        }
        let parent = PathBuf::from(shellexpand::tilde(&dest_parent).into_owned());
        if !parent.is_dir() {
            return Err(format!("Path is not a directory: {}", dest_parent));
        }
        let dest = parent.join(folder_name.trim());
        if dest.exists() {
            return Err(format!("Destination already exists: {}", dest.display()));
        }
        fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
        if let Err(e) = copy_dir_all(&source, &dest) {
            let _ = fs::remove_dir_all(&dest);
            return Err(e);
        }
        let copied_worktrees = dest.join(".git").join("worktrees");
        if copied_worktrees.is_dir() {
            let _ = fs::remove_dir_all(&copied_worktrees);
        }
        let path = dest.canonicalize().map_err(|e| e.to_string())?.to_string_lossy().to_string();
        fs::create_dir_all(worktrees_dir(&new_id)?).map_err(|e| e.to_string())?;
        projects.push(Project {
            id: new_id,
            name,
            path,
            color,
            active_instance_id: None,
            git_profile_id: original.git_profile_id,
            branch_template: original.branch_template,
        });
        write_projects(&projects)?;
        Ok(projects)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// `None` clears the selection, leaving the project with no instance open.
#[tauri::command]
pub async fn set_active_instance(project_id: String, instance_id: Option<String>) -> Result<(), String> {
    let mut projects = read_projects()?;
    let project = projects.iter_mut()
        .find(|p| p.id == project_id)
        .ok_or_else(|| format!("Project '{}' not found", project_id))?;
    project.active_instance_id = instance_id;
    write_projects(&projects)
}

/// An empty id stores the explicit "no profile" choice, distinct from never having picked.
#[tauri::command]
pub async fn set_project_git_profile(project_id: String, profile_id: String) -> Result<(), String> {
    let mut projects = read_projects()?;
    let project = projects.iter_mut()
        .find(|p| p.id == project_id)
        .ok_or_else(|| format!("Project '{}' not found", project_id))?;
    let profiles = read_settings()?.git_profiles;
    let previous = find_profile(&profiles, project.git_profile_id.as_deref());
    project.git_profile_id = Some(profile_id);
    apply_git_profile(&profiles, project, previous)?;
    write_projects(&projects)
}

/// `None` for the default and for an id that no longer exists.
fn find_profile<'a>(profiles: &'a [GitProfile], id: Option<&str>) -> Option<&'a GitProfile> {
    let id = id.filter(|id| !id.is_empty())?;
    profiles.iter().find(|p| p.id == id)
}

/// Fixes the identity in the repository config, where every tool committing
/// there reads it; the default takes back what `previous` wrote.
fn apply_git_profile(profiles: &[GitProfile], project: &Project, previous: Option<&GitProfile>) -> Result<(), String> {
    match find_profile(profiles, project.git_profile_id.as_deref()) {
        Some(p) => write_identity(&project.path, &p.name, &p.email),
        None => previous.map_or(Ok(()), |p| clear_identity(&project.path, &p.name, &p.email)),
    }
}

/// Brings the repository config of every project in line with a settings save:
/// an edited profile is rewritten, a deleted one is taken back. Every project is
/// tried, so one failing repository does not leave the others stale.
fn identity_failures(projects: &[Project], previous: &[GitProfile], next: &[GitProfile]) -> Vec<String> {
    let mut failures = Vec::new();
    for project in projects {
        let Some(id) = project.git_profile_id.as_deref().filter(|id| !id.is_empty()) else { continue };
        let outcome = match (previous.iter().find(|p| p.id == id), next.iter().find(|p| p.id == id)) {
            (Some(old), Some(new)) if old.name != new.name || old.email != new.email => {
                write_identity(&project.path, &new.name, &new.email)
            }
            (Some(old), None) => clear_identity(&project.path, &old.name, &old.email),
            _ => Ok(()),
        };
        if let Err(e) = outcome {
            failures.push(format!("{}: {}", project.name, e));
        }
    }
    failures
}

pub fn sync_profile_identities(previous: &[GitProfile], next: &[GitProfile]) -> Result<(), String> {
    let failures = identity_failures(&read_projects()?, previous, next);
    if failures.is_empty() {
        return Ok(());
    }
    Err(failures.join("; "))
}

fn apply_profile_in(projects: &[Project], profiles: &[GitProfile], path: &str) -> Result<(), String> {
    let target = canonical_path(path);
    match projects.iter().find(|p| canonical_path(&p.path) == target) {
        Some(project) => apply_git_profile(profiles, project, None),
        None => Ok(()),
    }
}

/// Writes the profile of the project registered at `path`: a folder that just
/// became a repository had nowhere to hold it until now.
pub fn apply_profile_at(path: &str) -> Result<(), String> {
    let expanded = shellexpand::tilde(path);
    apply_profile_in(&read_projects()?, &read_settings()?.git_profiles, &expanded)
}

// listing.json

/// A folder grouping projects in the home list.
#[derive(Serialize, Deserialize, Clone, Default)]
pub struct ProjectFolder {
    pub id: String,
    pub name: String,
    #[serde(rename = "projectIds")]
    pub project_ids: Vec<String>,
    pub collapsed: bool,
}

/// How the home screen arranges the projects: folders plus a flat order.
#[derive(Serialize, Deserialize, Clone, Default)]
pub struct ListingConfig {
    #[serde(default)]
    pub folders: Vec<ProjectFolder>,
    #[serde(rename = "projectOrder", default)]
    pub project_order: Vec<String>,
}

/// Defaults to no folders and no explicit order.
fn read_listing() -> Result<ListingConfig, String> {
    let path = listing_file()?;
    if !path.exists() { return Ok(ListingConfig::default()); }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

/// Overwrites folders and order together, atomically.
fn write_listing(listing: &ListingConfig) -> Result<(), String> {
    write_json_atomic(&listing_file()?, listing)
}

/// Folders and order in one read, both needed to draw the home list.
#[tauri::command]
pub fn get_listing() -> Result<ListingConfig, String> {
    read_listing()
}

/// Replaces the folders while leaving the project order untouched.
#[tauri::command]
pub async fn save_folders(folders: Vec<ProjectFolder>) -> Result<(), String> {
    let mut listing = read_listing()?;
    listing.folders = folders;
    write_listing(&listing)
}

/// Replaces the order after a drag, leaving the folders untouched.
#[tauri::command]
pub async fn save_project_order(ids: Vec<String>) -> Result<(), String> {
    let mut listing = read_listing()?;
    listing.project_order = ids;
    write_listing(&listing)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project_from_json(json: &str) -> Result<Project, serde_json::Error> {
        serde_json::from_str(json)
    }

    fn listing_from_json(json: &str) -> ListingConfig {
        serde_json::from_str(json).expect("listing should parse")
    }

    #[test]
    fn a_project_round_trips_through_json() {
        let original = Project {
            id: "p1".to_string(),
            name: "Mon projet".to_string(),
            path: "/repos/mon été".to_string(),
            color: "#ff0000".to_string(),
            active_instance_id: Some("i1".to_string()),
            git_profile_id: Some("work".to_string()),
            branch_template: None,
        };
        let json = serde_json::to_string(&original).expect("should serialize");
        let back = project_from_json(&json).expect("should parse");
        assert_eq!(back.id, "p1");
        assert_eq!(back.name, "Mon projet");
        assert_eq!(back.path, "/repos/mon été");
        assert_eq!(back.active_instance_id.as_deref(), Some("i1"));
        assert_eq!(back.git_profile_id.as_deref(), Some("work"));
    }

    #[test]
    fn a_project_predating_the_git_profile_has_none() {
        let project = project_from_json(r##"{"id": "p1", "name": "n", "path": "/p", "color": "#fff", "activeInstanceId": null}"##)
            .expect("should parse");
        assert!(project.git_profile_id.is_none());
    }

    #[test]
    fn a_project_with_no_active_instance_round_trips_too() {
        let original = Project {
            id: "p1".to_string(),
            name: "p1".to_string(),
            path: "/repos/p1".to_string(),
            color: "#fff".to_string(),
            active_instance_id: None,
            git_profile_id: None,
            branch_template: None,
        };
        let json = serde_json::to_string(&original).expect("should serialize");
        assert!(project_from_json(&json)
            .expect("should parse")
            .active_instance_id
            .is_none());
    }

    /// The identifying fields carry no serde default, so a truncated entry is
    /// refused rather than silently loaded as a project with an empty path.
    #[test]
    fn a_project_missing_an_identifying_field_is_refused() {
        assert!(project_from_json(r#"{"id": "p1"}"#).is_err());
        assert!(
            project_from_json(r##"{"id": "p1", "name": "n", "color": "#fff"}"##).is_err()
        );
    }

    #[test]
    fn a_project_serializes_under_the_names_the_frontend_reads() {
        let json = serde_json::to_value(Project {
            id: "p1".to_string(),
            name: "p1".to_string(),
            path: "/repos/p1".to_string(),
            color: "#fff".to_string(),
            active_instance_id: None,
            git_profile_id: None,
            branch_template: None,
        })
        .expect("should serialize");
        let object = json.as_object().expect("project should be an object");
        for key in ["id", "name", "path", "color", "activeInstanceId"] {
            assert!(object.contains_key(key), "{key} is missing from the payload");
        }
    }

    fn profile(id: &str, email: &str) -> GitProfile {
        GitProfile { id: id.into(), label: id.into(), name: "Ada".into(), email: email.into() }
    }

    #[test]
    fn the_default_and_a_deleted_profile_resolve_to_none() {
        let profiles = [profile("work", "w@x")];
        assert!(find_profile(&profiles, None).is_none());
        assert!(find_profile(&profiles, Some("")).is_none());
        assert!(find_profile(&profiles, Some("gone")).is_none());
        assert_eq!(find_profile(&profiles, Some("work")).map(|p| p.email.as_str()), Some("w@x"));
    }

    fn temp_repo(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("cairn-profile-{}-{}", tag, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        git_in(&dir, &["init", "-q"]);
        dir
    }

    fn git_in(dir: &PathBuf, args: &[&str]) -> String {
        let out = std::process::Command::new("git").current_dir(dir).args(args).output().unwrap();
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    fn project_at(dir: &PathBuf, profile: Option<&str>) -> Project {
        Project {
            id: dir.to_string_lossy().to_string(),
            name: dir.file_name().unwrap().to_string_lossy().to_string(),
            path: dir.to_string_lossy().to_string(),
            color: String::new(),
            active_instance_id: None,
            git_profile_id: profile.map(String::from),
            branch_template: None,
        }
    }

    fn email_of(dir: &PathBuf) -> String {
        git_in(dir, &["config", "--local", "user.email"])
    }

    #[test]
    fn picking_a_profile_writes_it_and_the_default_takes_it_back() {
        let repo = temp_repo("pick");
        let profiles = [profile("work", "w@x")];
        apply_git_profile(&profiles, &project_at(&repo, Some("work")), None).unwrap();
        assert_eq!(email_of(&repo), "w@x");
        apply_git_profile(&profiles, &project_at(&repo, Some("")), find_profile(&profiles, Some("work"))).unwrap();
        assert_eq!(email_of(&repo), "");
        let _ = fs::remove_dir_all(&repo);
    }

    #[test]
    fn an_edited_profile_is_rewritten_and_a_deleted_one_taken_back() {
        let edited = temp_repo("edited");
        let deleted = temp_repo("deleted");
        let before = [profile("work", "w@x"), profile("home", "h@x")];
        let projects = [project_at(&edited, Some("work")), project_at(&deleted, Some("home"))];
        write_identity(&edited.to_string_lossy(), "Ada", "w@x").unwrap();
        write_identity(&deleted.to_string_lossy(), "Ada", "h@x").unwrap();
        let after = [profile("work", "w@y")];
        assert!(identity_failures(&projects, &before, &after).is_empty());
        assert_eq!(email_of(&edited), "w@y");
        assert_eq!(email_of(&deleted), "");
        let _ = fs::remove_dir_all(&edited);
        let _ = fs::remove_dir_all(&deleted);
    }

    #[test]
    fn a_failing_repository_does_not_stop_the_others() {
        let locked = temp_repo("locked");
        let healthy = temp_repo("healthy");
        fs::write(locked.join(".git").join("config.lock"), "").unwrap();
        let before = [profile("work", "w@x")];
        let after = [profile("work", "w@y")];
        let projects = [project_at(&locked, Some("work")), project_at(&healthy, Some("work"))];
        let failures = identity_failures(&projects, &before, &after);
        assert_eq!(failures.len(), 1);
        assert!(failures[0].starts_with(&project_at(&locked, None).name));
        assert_eq!(email_of(&healthy), "w@y");
        let _ = fs::remove_dir_all(&locked);
        let _ = fs::remove_dir_all(&healthy);
    }

    #[test]
    fn a_folder_initialised_later_receives_the_profile_of_its_project() {
        let repo = temp_repo("init");
        let profiles = [profile("work", "w@x")];
        let projects = [project_at(&repo, Some("work"))];
        apply_profile_in(&projects, &profiles, &repo.to_string_lossy()).unwrap();
        assert_eq!(email_of(&repo), "w@x");
        let other = temp_repo("other");
        apply_profile_in(&projects, &profiles, &other.to_string_lossy()).unwrap();
        assert_eq!(email_of(&other), "");
        let _ = fs::remove_dir_all(&repo);
        let _ = fs::remove_dir_all(&other);
    }

    #[test]
    fn a_first_launch_has_no_folder_and_no_explicit_order() {
        let listing = listing_from_json("{}");
        assert!(listing.folders.is_empty());
        assert!(listing.project_order.is_empty());
    }

    #[test]
    fn a_listing_predating_the_folders_gains_an_empty_list() {
        let listing = listing_from_json(r#"{"projectOrder": ["p1", "p2"]}"#);
        assert_eq!(listing.project_order, vec!["p1", "p2"]);
        assert!(listing.folders.is_empty());
    }

    #[test]
    fn the_home_arrangement_survives_a_round_trip() {
        let original = ListingConfig {
            folders: vec![ProjectFolder {
                id: "f1".to_string(),
                name: "Travail".to_string(),
                project_ids: vec!["p1".to_string()],
                collapsed: true,
            }],
            project_order: vec!["p2".to_string(), "p1".to_string()],
        };
        let json = serde_json::to_string(&original).expect("should serialize");
        let back = listing_from_json(&json);
        assert_eq!(back.project_order, vec!["p2", "p1"]);
        assert_eq!(back.folders.len(), 1);
        assert_eq!(back.folders[0].name, "Travail");
        assert!(back.folders[0].collapsed);
        assert_eq!(back.folders[0].project_ids, vec!["p1"]);
    }

    #[test]
    fn a_folder_serializes_under_the_names_the_frontend_reads() {
        let json = serde_json::to_value(ProjectFolder {
            id: "f1".to_string(),
            name: "f".to_string(),
            project_ids: vec![],
            collapsed: false,
        })
        .expect("should serialize");
        let object = json.as_object().expect("folder should be an object");
        for key in ["id", "name", "projectIds", "collapsed"] {
            assert!(object.contains_key(key), "{key} is missing from the payload");
        }
    }

    #[test]
    fn a_corrupted_listing_is_reported_rather_than_panicking() {
        assert!(serde_json::from_str::<ListingConfig>("not json").is_err());
        assert!(serde_json::from_str::<ListingConfig>(r#"{"folders": "none"}"#).is_err());
    }
}
