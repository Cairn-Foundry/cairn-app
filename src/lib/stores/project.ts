/** The registered projects, the open project tabs, and which project is active. */
import { derived, writable } from "svelte/store";
import {
	addProject,
	duplicateProject,
	getListing,
	listProjects,
	removeProject,
	saveProjectOrder,
	setActiveInstance,
	updateProject,
} from "$lib/services/project-service";
import { projectFolders } from "$lib/stores/project-folders";
import { runProjectTeardowns } from "$lib/stores/project-teardown";
import type { Project } from "$lib/types/project";

/** Every registered project, in home-list order. */
export const projects = writable<Project[]>([]);

/** The project the workspace is showing, or null on the home screen. */
export const activeProjectId = writable<string | null>(null);

/** Ids of the open project tabs, in tab order; a project can be registered without being open. */
export const openTabOrder = writable<string[]>([]);

/** The resolved active project, null while nothing is open or the id is stale. */
export const activeProject = derived(
	[projects, activeProjectId],
	([$projects, $activeProjectId]) =>
		$projects.find((p) => p.id === $activeProjectId) ?? null,
);

/** The open projects resolved in tab order, skipping ids no longer registered. */
export const openProjects = derived(
	[projects, openTabOrder],
	([$projects, $openTabOrder]) =>
		$openTabOrder.flatMap((id) => {
			const p = $projects.find((proj) => proj.id === id);
			return p ? [p] : [];
		}),
);

/**
 * The project opened most recently. Tab order cannot answer this: it is
 * positional, the user reorders it by dragging, and reopening a project that
 * already has a tab leaves it where it was. Set when a project is actually
 * switched to, not merely when a tab appears - switching between two already
 * open tabs changes which one was used last.
 */
export const lastOpenedProjectId = writable<string | null>(null);

/** Opens a tab for a project, or does nothing if it already has one. */
export function openProject(id: string): void {
	openTabOrder.update((order) => (order.includes(id) ? order : [...order, id]));
}

/** Closes the tab; the project stays registered. */
export function closeProjectTab(id: string): void {
	openTabOrder.update((order) => order.filter((oid) => oid !== id));
	lastOpenedProjectId.update((last) => (last === id ? null : last));
}

/** Commits a new tab order after a drag. */
export function reorderTabs(newOrder: string[]): void {
	openTabOrder.set(newOrder);
}

/** Reads the registered projects; call loadListing() afterwards to apply the saved order. */
export async function loadProjects(): Promise<void> {
	const data = await listProjects();
	projects.set(data);
}

/** Registers a project and replaces the list with what the backend returns. */
export async function registerProject(project: Project): Promise<void> {
	const updated = await addProject(project);
	projects.set(updated);
}

/** Sets the instance a project reopens on, persisting it before updating the store. */
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

/**
 * Removes a project and every trace of it the app still holds: the backend
 * deletes its data directory, then each per-project cache is torn down.
 *
 * The teardown is not merely housekeeping. Several stores debounce their writes,
 * and `write_json_atomic` recreates missing parent directories, so a timer left
 * running would write the project's directory back moments after it was deleted.
 * Every `forgetProject` cancels its queued writes before dropping its entries.
 */
export async function unregisterProject(id: string): Promise<void> {
	const updated = await removeProject(id);
	projects.set(updated);
	activeProjectId.update((current) => (current === id ? null : current));
	projectFolders.purgeProject(id);
	await runProjectTeardowns(id);
}

/** Renames and recolors a project. */
export async function editProject(
	id: string,
	name: string,
	color: string,
): Promise<void> {
	const updated = await updateProject(id, name, color);
	projects.set(updated);
}

/** Copies a project under a fresh id, keeping its settings but not its instances. */
export async function duplicateProjectInStore(id: string): Promise<void> {
	const newId = crypto.randomUUID();
	const updated = await duplicateProject(id, newId);
	projects.set(updated);
}

/** Reorders the list optimistically; `ids` may cover only part of it, the rest keeps its order. */
export function reorderProjects(ids: string[]): void {
	projects.update((list) => {
		const map = new Map(list.map((p) => [p.id, p]));
		const reorderedSet = new Set(ids);
		const reordered = ids.flatMap((id) => {
			const p = map.get(id);
			return p ? [p] : [];
		});
		const others = list.filter((p) => !reorderedSet.has(p.id));
		return [...reordered, ...others];
	});
	saveProjectOrder(ids).catch(console.error);
}

/** Applies the saved folders and project order on top of the already loaded projects. */
export async function loadListing(): Promise<void> {
	const listing = await getListing();
	projectFolders.init(listing.folders);
	if (listing.projectOrder.length > 0) {
		projects.update((list) => {
			const map = new Map(list.map((p) => [p.id, p]));
			const ordered = listing.projectOrder.flatMap((id) => {
				const p = map.get(id);
				return p ? [p] : [];
			});
			const orderedSet = new Set(listing.projectOrder);
			const remaining = list.filter((p) => !orderedSet.has(p.id));
			return [...ordered, ...remaining];
		});
	}
}
