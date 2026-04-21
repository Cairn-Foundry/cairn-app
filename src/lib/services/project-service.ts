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

export async function setActiveInstance(projectId: string, instanceId: string | null): Promise<void> {
  return invoke<void>('set_active_instance', { projectId, instanceId });
}

export async function validateGitRepo(path: string): Promise<string> {
  return invoke<string>('validate_git_repo', { path });
}
