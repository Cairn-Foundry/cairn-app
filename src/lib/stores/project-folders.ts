import { writable } from "svelte/store";
import { saveFolders } from "$lib/services/project-service";
import type { ProjectFolder } from "$lib/types/project";

function createFoldersStore() {
	const { subscribe, set, update } = writable<ProjectFolder[]>([]);

	function save(folders: ProjectFolder[]): ProjectFolder[] {
		saveFolders(folders).catch(console.error);
		return folders;
	}

	return {
		subscribe,

		init(folders: ProjectFolder[]): void {
			set(folders);
		},

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

		renameFolder(id: string, name: string): void {
			update((folders) =>
				save(
					folders.map((f) =>
						f.id === id ? { ...f, name: name.trim() || f.name } : f,
					),
				),
			);
		},

		deleteFolder(id: string): void {
			update((folders) => save(folders.filter((f) => f.id !== id)));
		},

		toggleCollapse(id: string): void {
			update((folders) =>
				save(
					folders.map((f) =>
						f.id === id ? { ...f, collapsed: !f.collapsed } : f,
					),
				),
			);
		},

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

		reorderProjectsInFolder(folderId: string, projectIds: string[]): void {
			update((folders) =>
				save(
					folders.map((f) => (f.id === folderId ? { ...f, projectIds } : f)),
				),
			);
		},

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

export const projectFolders = createFoldersStore();
