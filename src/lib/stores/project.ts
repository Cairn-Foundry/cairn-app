import { writable, derived } from 'svelte/store';
import type { Project } from '$lib/types/project';
import { listProjects, addProject, removeProject, setActiveInstance } from '$lib/services/project-service';

export const projects = writable<Project[]>([]);
export const activeProjectId = writable<string | null>(null);

export const activeProject = derived(
  [projects, activeProjectId],
  ([$projects, $activeProjectId]) => $projects.find((p) => p.id === $activeProjectId) ?? null
);

export async function loadProjects(): Promise<void> {
  const data = await listProjects();
  projects.set(data);
}

export async function registerProject(project: Project): Promise<void> {
  const updated = await addProject(project);
  projects.set(updated);
}

export async function activateInstance(projectId: string, instanceId: string | null): Promise<void> {
  await setActiveInstance(projectId, instanceId);
  projects.update((list) =>
    list.map((p) => p.id === projectId ? { ...p, activeInstanceId: instanceId } : p)
  );
}

export async function unregisterProject(id: string): Promise<void> {
  const updated = await removeProject(id);
  projects.set(updated);
  activeProjectId.update((current) => (current === id ? null : current));
}
