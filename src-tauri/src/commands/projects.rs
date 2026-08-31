// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

//! The registered projects and how the home screen lists them: `projects.json`
//! holds the projects themselves, `listing.json` their order and folders.

use std::fs;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use crate::storage::{projects_file, listing_file, worktrees_dir, cairn_dir, write_json_atomic};

/// A repository registered in the app, identified by a frontend-minted id.
#[derive(Serialize, Deserialize, Clone)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub color: String,
    #[serde(rename = "activeInstanceId")]
    pub active_instance_id: Option<String>,
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
pub fn add_project(project: Project) -> Result<Vec<Project>, String> {
    let mut projects = read_projects()?;
    if projects.iter().any(|p| p.id == project.id) {
        return Err(format!("Project with id '{}' already exists", project.id));
    }
    let canonical = PathBuf::from(&project.path)
        .canonicalize()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| project.path.clone());
    if projects.iter().any(|p| {
        PathBuf::from(&p.path).canonicalize().map(|c| c.to_string_lossy().to_string()).unwrap_or_else(|_| p.path.clone()) == canonical
    }) {
        return Err(format!("A project for '{}' already exists", canonical));
    }
    fs::create_dir_all(worktrees_dir(&project.id)?).map_err(|e| e.to_string())?;
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

/// Renames and recolors only: the path is fixed once registered.
#[tauri::command]
pub fn update_project(id: String, name: String, color: String) -> Result<Vec<Project>, String> {
    let mut projects = read_projects()?;
    let p = projects.iter_mut()
        .find(|p| p.id == id)
        .ok_or_else(|| format!("Project '{}' not found", id))?;
    p.name = name;
    p.color = color;
    write_projects(&projects)?;
    Ok(projects)
}

/// A second entry on the same repository path, with its own data directory and
/// no instances. This is the one case where two projects may share a path.
#[tauri::command]
pub fn duplicate_project(id: String, new_id: String) -> Result<Vec<Project>, String> {
    let mut projects = read_projects()?;
    let original = projects.iter()
        .find(|p| p.id == id)
        .ok_or_else(|| format!("Project '{}' not found", id))?
        .clone();
    let duplicate = Project {
        id: new_id.clone(),
        name: format!("Copy of {}", original.name),
        path: original.path,
        color: original.color,
        active_instance_id: None,
    };
    fs::create_dir_all(worktrees_dir(&new_id)?).map_err(|e| e.to_string())?;
    projects.push(duplicate);
    write_projects(&projects)?;
    Ok(projects)
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
        };
        let json = serde_json::to_string(&original).expect("should serialize");
        let back = project_from_json(&json).expect("should parse");
        assert_eq!(back.id, "p1");
        assert_eq!(back.name, "Mon projet");
        assert_eq!(back.path, "/repos/mon été");
        assert_eq!(back.active_instance_id.as_deref(), Some("i1"));
    }

    #[test]
    fn a_project_with_no_active_instance_round_trips_too() {
        let original = Project {
            id: "p1".to_string(),
            name: "p1".to_string(),
            path: "/repos/p1".to_string(),
            color: "#fff".to_string(),
            active_instance_id: None,
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
        })
        .expect("should serialize");
        let object = json.as_object().expect("project should be an object");
        for key in ["id", "name", "path", "color", "activeInstanceId"] {
            assert!(object.contains_key(key), "{key} is missing from the payload");
        }
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
