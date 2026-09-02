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

const SAVE_DEBOUNCE_MS = 400;
const pending = new Map<
	string,
	{ state: FileState; timer: ReturnType<typeof setTimeout> }
>();

/**
 * Fire and forget: called on every cursor, scroll, tab and instance change, so
 * it must never throw. Writes are coalesced per instance - opening a few tabs
 * or walking the tree used to write the same file half a dozen times in a
 * couple of seconds. Only the last state of an instance is written, and each
 * instance keeps its own timer, so switching away still saves the one left
 * behind.
 */
export function saveFileState(
	projectId: string,
	instanceId: string,
	state: FileState,
): void {
	const key = `${projectId}:${instanceId}`;
	const entry = pending.get(key);
	if (entry) {
		entry.state = state;
		return;
	}
	const timer = setTimeout(() => {
		const last = pending.get(key);
		pending.delete(key);
		if (!last) return;
		persist(
			"the editor state",
			invoke("save_file_state", { projectId, instanceId, state: last.state }),
		);
	}, SAVE_DEBOUNCE_MS);
	pending.set(key, { state, timer });
}

/**
 * Writes every coalesced state now; the app is closing or the view is going away.
 * The returned promise settles once the writes have landed, so a caller that can
 * hold the window open - `onCloseRequested` - actually waits for them.
 */
export function flushFileStates(): Promise<unknown> {
	const writes: Promise<unknown>[] = [];
	for (const [key, entry] of pending) {
		clearTimeout(entry.timer);
		const [projectId, instanceId] = key.split(":");
		const write = invoke("save_file_state", {
			projectId,
			instanceId,
			state: entry.state,
		});
		persist("the editor state", write);
		writes.push(write.catch(() => {}));
	}
	pending.clear();
	return Promise.allSettled(writes);
}
