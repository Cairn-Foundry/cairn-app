import { derived, writable } from "svelte/store";
import {
	addProject,
	duplicateProject,
	listProjects,
	removeProject,
	setActiveInstance,
	updateProject,
} from "$lib/services/project-service";
import type { Project } from "$lib/types/project";

export const projects = writable<Project[]>([]);
export const activeProjectId = writable<string | null>(null);
export const openTabOrder = writable<string[]>([]);

export const activeProject = derived(
	[projects, activeProjectId],
	([$projects, $activeProjectId]) =>
		$projects.find((p) => p.id === $activeProjectId) ?? null,
);

export const openProjects = derived(
	[projects, openTabOrder],
	([$projects, $openTabOrder]) =>
		$openTabOrder.flatMap((id) => {
			const p = $projects.find((proj) => proj.id === id);
			return p ? [p] : [];
		}),
);

export function openProject(id: string): void {
	openTabOrder.update((order) => (order.includes(id) ? order : [...order, id]));
}

export function closeProjectTab(id: string): void {
	openTabOrder.update((order) => order.filter((oid) => oid !== id));
}

export function reorderTabs(newOrder: string[]): void {
	openTabOrder.set(newOrder);
}

export async function loadProjects(): Promise<void> {
	const data = await listProjects();
	projects.set(data);
}

export async function registerProject(project: Project): Promise<void> {
	const updated = await addProject(project);
	projects.set(updated);
}

export async function activateInstance(
	projectId: string,
	instanceId: string | null,
): Promise<void> {
	await setActiveInstance(projectId, instanceId);
	projects.update((list) =>
		list.map((p) =>
			p.id === projectId ? { ...p, activeInstanceId: instanceId } : p,
		),
	);
}

export async function unregisterProject(id: string): Promise<void> {
	const updated = await removeProject(id);
	projects.set(updated);
	activeProjectId.update((current) => (current === id ? null : current));
}

export async function editProject(
	id: string,
	name: string,
	color: string,
): Promise<void> {
	const updated = await updateProject(id, name, color);
	projects.set(updated);
}

export async function duplicateProjectInStore(id: string): Promise<void> {
	const newId = crypto.randomUUID();
	const updated = await duplicateProject(id, newId);
	projects.set(updated);
}
