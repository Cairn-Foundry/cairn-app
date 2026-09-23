// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

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

/**
 * The name, the colour and the project's own branch template; the path changes
 * through relocateProject. An empty template clears the override and hands the
 * project back to the global setting.
 */
export async function updateProject(
	id: string,
	name: string,
	color: string,
	branchTemplate: string | null = null,
): Promise<Project[]> {
	return invoke<Project[]>("update_project", {
		id,
		name,
		color,
		branchTemplate,
	});
}

/** Points the project at a moved checkout and repairs its instance worktrees; throws on a missing or taken path. */
export async function relocateProject(
	id: string,
	path: string,
): Promise<Project[]> {
	return invoke<Project[]>("relocate_project", { id, path });
}

/** Where and under which identity a project is copied. */
export type ProjectCopy = {
	name: string;
	color: string;
	destParent: string;
	folderName: string;
};

/** Copies the checkout into `destParent/folderName` and registers it, with no instances. Slow. */
export async function duplicateProject(
	id: string,
	newId: string,
	copy: ProjectCopy,
): Promise<Project[]> {
	return invoke<Project[]>("duplicate_project", {
		id,
		newId,
		name: copy.name,
		color: copy.color,
		destParent: copy.destParent,
		folderName: copy.folderName,
	});
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

/** The git profile the project commits with; null when never picked, "" when none was chosen. */
export async function getProjectGitProfile(
	projectId: string,
): Promise<string | null> {
	try {
		return await invoke<string | null>("get_project_git_profile", {
			projectId,
		});
	} catch {
		return null;
	}
}

/** Fire and forget, like the other sticky commit options. */
export function setProjectGitProfile(
	projectId: string,
	profileId: string,
): void {
	invoke("set_project_git_profile", { projectId, profileId }).catch(() => {});
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
