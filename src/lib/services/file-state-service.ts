// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Editor layout of one instance - tabs, cursor, scroll, tree expansion - in
// file-state.json. Only this layer calls invoke().

import { invoke } from "@tauri-apps/api/core";
import { persist } from "$lib/utils/persist-error";

/** One reopened tab; `cursorPos` is a document offset, not a line number. */
export interface PersistedTab {
	path: string;
	cursorPos: number;
	scrollTop: number;
	pinned?: boolean;
}

/** One editor pane and which of its tabs was in front. */
export interface PersistedPane {
	tabs: PersistedTab[];
	activeTabIdx: number;
}

/** Everything the Files view restores on reopen; mirrors the Rust `FileState`. */
export interface FileState {
	panes: PersistedPane[];
	/** Directories left open in the file tree. */
	expanded: string[];
	splitMode: boolean;
	splitLeftWidth: number;
	recentFiles: string[];
}

/** Null for an instance that was never opened; the caller starts from an empty layout. */
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

/** Fire and forget: called on every cursor and scroll change, so it must never throw. */
export function saveFileState(
	projectId: string,
	instanceId: string,
	state: FileState,
): void {
	persist(
		"the editor state",
		invoke("save_file_state", { projectId, instanceId, state }),
	);
}
