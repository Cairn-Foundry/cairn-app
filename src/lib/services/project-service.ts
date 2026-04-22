import { invoke } from '@tauri-apps/api/core';
import type { Project } from '$lib/types/project.ts';

export async function listProjects(): Promise<Project[]> {
  return invoke<Project[]>('list_projects');
}

export async function addProject(project: Project): Promise<Project[]> {
  return invoke<Project[]>('add_project', { project });
}

export async function removeProject(id: string): Promise<Project[]> {
  return invoke<Project[]>('remove_project', { id });
}

export async function updateProject(id: string, name: string, color: string): Promise<Project[]> {
  return invoke<Project[]>('update_project', { id, name, color });
}

export async function duplicateProject(id: string, newId: string): Promise<Project[]> {
  return invoke<Project[]>('duplicate_project', { id, newId });
}

export async function revealInFileManager(path: string): Promise<void> {
  return invoke<void>('reveal_in_file_manager', { path });
}

export async function setActiveInstance(projectId: string, instanceId: string | null): Promise<void> {
  return invoke<void>('set_active_instance', { projectId, instanceId });
}

export async function validateDirectory(path: string): Promise<string> {
  return invoke<string>('validate_directory', { path });
}

export async function cloneRepository(url: string, destParent: string, name: string): Promise<string> {
  return invoke<string>('clone_repository', { url, destParent, name });
}

export async function validateGitRepo(path: string): Promise<string> {
  return invoke<string>('validate_git_repo', { path });
}
