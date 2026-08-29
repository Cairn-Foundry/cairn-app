// Registered projects, and the folder grouping and order of the home list.
// Only this layer calls invoke().

import { invoke } from "@tauri-apps/api/core";
import type { Project, ProjectFolder } from "$lib/types/project.ts";

/** Contents of listing.json: how the home list is grouped and ordered, not the projects themselves. */
export type ListingConfig = {
	folders: ProjectFolder[];
	projectOrder: string[];
};

/** Reads projects.json; the home ordering lives in listing.json instead. */
export async function listProjects(): Promise<Project[]> {
	return invoke<Project[]>("list_projects");
}

/** Returns the full list after the write, so the caller replaces its state rather than appending. */
export async function addProject(project: Project): Promise<Project[]> {
	return invoke<Project[]>("add_project", { project });
}

/** Unregisters the project and returns the remaining list; the checkout on disk stays. */
export async function removeProject(id: string): Promise<Project[]> {
	return invoke<Project[]>("remove_project", { id });
}

/** Only the name and colour are editable; the path is fixed at registration. */
export async function updateProject(
	id: string,
	name: string,
	color: string,
): Promise<Project[]> {
	return invoke<Project[]>("update_project", { id, name, color });
}

/** Registers a second project over the same checkout, named "Copy of ..." and with no instances. */
export async function duplicateProject(
	id: string,
	newId: string,
): Promise<Project[]> {
	return invoke<Project[]>("duplicate_project", { id, newId });
}

/** Opens the OS file manager on the path (Finder on macOS). */
export async function revealInFileManager(path: string): Promise<void> {
	return invoke<void>("reveal_in_file_manager", { path });
}

/** Records which instance the project reopens on; null clears the selection. */
export async function setActiveInstance(
	projectId: string,
	instanceId: string | null,
): Promise<void> {
	return invoke<void>("set_active_instance", { projectId, instanceId });
}

/** Expands `~`, then returns the canonical path; throws when it is missing or not a directory. */
export async function validateDirectory(path: string): Promise<string> {
	return invoke<string>("validate_directory", { path });
}

/** Clones into `destParent/name` and returns it; refuses an existing destination. Slow. */
export async function cloneRepository(
	url: string,
	destParent: string,
	name: string,
): Promise<string> {
	return invoke<string>("clone_repository", { url, destParent, name });
}

/** Folders and order of the home list; a project absent from `projectOrder` still exists. */
export async function getListing(): Promise<ListingConfig> {
	return invoke<ListingConfig>("get_listing");
}

/** Rewrites the folder groupings only, leaving the project order alone. */
export async function saveFolders(folders: ProjectFolder[]): Promise<void> {
	return invoke<void>("save_folders", { folders });
}

/** Rewrites the project order only, leaving the folders alone. */
export async function saveProjectOrder(ids: string[]): Promise<void> {
	return invoke<void>("save_project_order", { ids });
}
