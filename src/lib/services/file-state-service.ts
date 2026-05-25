import { invoke } from "@tauri-apps/api/core";

export interface PersistedTab {
	path: string;
	cursorPos: number;
	scrollTop: number;
	pinned?: boolean;
}

export interface PersistedPane {
	tabs: PersistedTab[];
	activeTabIdx: number;
}

export interface FileState {
	panes: PersistedPane[];
	expanded: string[];
	splitMode: boolean;
	splitLeftWidth: number;
	recentFiles: string[];
}

export async function getFileState(
	projectId: string,
	instanceId: string,
): Promise<FileState | null> {
	try {
		return await invoke<FileState | null>("get_file_state", {
			projectId,
			instanceId,
		});
	} catch {
		return null;
	}
}

export function saveFileState(
	projectId: string,
	instanceId: string,
	state: FileState,
): void {
	invoke("save_file_state", { projectId, instanceId, state }).catch(() => {});
}
