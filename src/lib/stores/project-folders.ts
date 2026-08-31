// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/** Folders of the home project list: grouping, order and collapsed state. */
import { writable } from "svelte/store";
import { saveFolders } from "$lib/services/project-service";
import type { ProjectFolder } from "$lib/types/project";

/** Builds the store; every mutation writes listing.json back, fire and forget. */
function createFoldersStore() {
	const { subscribe, set, update } = writable<ProjectFolder[]>([]);

	/** Passes the folders through while persisting them, so it can wrap an update() return. */
	function save(folders: ProjectFolder[]): ProjectFolder[] {
		saveFolders(folders).catch(console.error);
		return folders;
	}

	return {
		subscribe,

		/** Seeds the folders read from listing.json, without writing them back. */
		init(folders: ProjectFolder[]): void {
			set(folders);
		},

		/** Appends an empty folder. */
		createFolder(name: string): void {
			update((folders) =>
				save([
					...folders,
					{
						id: crypto.randomUUID(),
						name: name.trim() || "Nouveau dossier",
						projectIds: [],
						collapsed: false,
					},
				]),
			);
		},

		/** Renames a folder; a blank name is ignored rather than applied. */
		renameFolder(id: string, name: string): void {
			update((folders) =>
				save(
					folders.map((f) =>
						f.id === id ? { ...f, name: name.trim() || f.name } : f,
					),
				),
			);
		},

		/** Deletes the folder; its projects stay registered and fall back to the ungrouped list. */
		deleteFolder(id: string): void {
			update((folders) => save(folders.filter((f) => f.id !== id)));
		},

		/** Folds or unfolds a folder in the home list; the state is persisted. */
		toggleCollapse(id: string): void {
			update((folders) =>
				save(
					folders.map((f) =>
						f.id === id ? { ...f, collapsed: !f.collapsed } : f,
					),
				),
			);
		},

		/** Moves a project into a folder, removing it from any other: membership is exclusive. */
		addProjectToFolder(projectId: string, folderId: string): void {
			update((folders) =>
				save(
					folders.map((f) => {
						if (f.id === folderId) {
							return f.projectIds.includes(projectId)
								? f
								: { ...f, projectIds: [...f.projectIds, projectId] };
						}
						return {
							...f,
							projectIds: f.projectIds.filter((pid) => pid !== projectId),
						};
					}),
				),
			);
		},

		/** Sends a project back to the ungrouped list. */
		removeProjectFromFolder(projectId: string): void {
			update((folders) =>
				save(
					folders.map((f) => ({
						...f,
						projectIds: f.projectIds.filter((pid) => pid !== projectId),
					})),
				),
			);
		},

		/** Reorders the folders; `ids` must list them all, any id missing from it is dropped. */
		reorderFolders(ids: string[]): void {
			update((folders) => {
				const map = new Map(folders.map((f) => [f.id, f]));
				return save(
					ids.flatMap((id) => {
						const f = map.get(id);
						return f ? [f] : [];
					}),
				);
			});
		},

		/** Reorders the projects inside one folder. */
		reorderProjectsInFolder(folderId: string, projectIds: string[]): void {
			update((folders) =>
				save(
					folders.map((f) => (f.id === folderId ? { ...f, projectIds } : f)),
				),
			);
		},

		/** Clears every reference to a project being unregistered. */
		purgeProject(projectId: string): void {
			update((folders) =>
				save(
					folders.map((f) => ({
						...f,
						projectIds: f.projectIds.filter((pid) => pid !== projectId),
					})),
				),
			);
		},
	};
}

/** The folders grouping the home project list, persisted in listing.json. */
export const projectFolders = createFoldersStore();
