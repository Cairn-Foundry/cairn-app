import { writable, derived } from 'svelte/store';
import type { Project } from '$lib/types/project.ts';

export const projects = writable<Project[]>([]);
export const activeProjectId = writable<string | null>(null);

export const activeProject = derived(
  [projects, activeProjectId],
  ([$projects, $activeProjectId]) => $projects.find((p) => p.id === $activeProjectId) ?? null
);
