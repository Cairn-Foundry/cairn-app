use std::fs;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use crate::storage::{projects_file, listing_file, worktrees_dir, cairn_dir, write_json_atomic};

#[derive(Serialize, Deserialize, Clone)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub color: String,
    #[serde(rename = "activeInstanceId")]
    pub active_instance_id: Option<String>,
}

pub fn read_projects() -> Result<Vec<Project>, String> {
    let path = projects_file()?;
    if !path.exists() { return Ok(vec![]); }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

pub fn write_projects(projects: &Vec<Project>) -> Result<(), String> {
    write_json_atomic(&projects_file()?, projects)
}

#[tauri::command]
pub fn list_projects() -> Result<Vec<Project>, String> {
    read_projects()
}

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

#[tauri::command]
pub fn set_active_instance(project_id: String, instance_id: Option<String>) -> Result<(), String> {
    let mut projects = read_projects()?;
    let project = projects.iter_mut()
        .find(|p| p.id == project_id)
        .ok_or_else(|| format!("Project '{}' not found", project_id))?;
    project.active_instance_id = instance_id;
    write_projects(&projects)
}

// listing.json

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct ProjectFolder {
    pub id: String,
    pub name: String,
    #[serde(rename = "projectIds")]
    pub project_ids: Vec<String>,
    pub collapsed: bool,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct ListingConfig {
    #[serde(default)]
    pub folders: Vec<ProjectFolder>,
    #[serde(rename = "projectOrder", default)]
    pub project_order: Vec<String>,
}

fn read_listing() -> Result<ListingConfig, String> {
    let path = listing_file()?;
    if !path.exists() { return Ok(ListingConfig::default()); }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

fn write_listing(listing: &ListingConfig) -> Result<(), String> {
    write_json_atomic(&listing_file()?, listing)
}

#[tauri::command]
pub fn get_listing() -> Result<ListingConfig, String> {
    read_listing()
}

#[tauri::command]
pub fn save_folders(folders: Vec<ProjectFolder>) -> Result<(), String> {
    let mut listing = read_listing()?;
    listing.folders = folders;
    write_listing(&listing)
}

#[tauri::command]
pub fn save_project_order(ids: Vec<String>) -> Result<(), String> {
    let mut listing = read_listing()?;
    listing.project_order = ids;
    write_listing(&listing)
}
