// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Text } from "@codemirror/state";
import { isBinaryPath, readFileVersioned } from "$lib/services/file-service";
import {
	type FileState,
	getFileState,
	type PersistedPane,
	type PersistedTab,
	saveFileState,
} from "$lib/services/file-state-service";
import { docFromString } from "./document-model";
import { detectLineEndings, normalizeLineEndings } from "./files-indent";
import { absolutePathOf } from "./files-tree";

export type { PersistedPane, PersistedTab };

// Saving and restoring the editor: which files were open in which pane, and
// reading their content back from disk on the next launch.

/** A live tab: `savedDoc` is what is on disk, `doc` what the buffer holds. */
export interface Tab {
	path: string;
	doc: Text;
	savedDoc: Text;
	cursorPos: number;
	scrollTop: number;
	pinned?: boolean;
	lineEndings?: "LF" | "CRLF";
	/**
	 * When the tab was last shown, used only to decide which tab the cap drops.
	 * Never persisted: a restored session has no use order yet, and every tab
	 * it reopens is equally old.
	 */
	lastUsedAt?: number;
	/**
	 * Set when a write was refused because the file had moved and no one could be
	 * asked at the time - a save fired while the view was going away. The conflict
	 * is resolved when the user comes back to the tab.
	 */
	conflicted?: boolean;
	/**
	 * The version stamp the content in this tab was read with, handed back to
	 * `writeFile` so a save cannot overwrite a file that moved since. It belongs to
	 * the tab and not to the path: the disk snapshot opened beside a conflicting
	 * tab holds a newer version of the same file, and sharing one stamp per path
	 * would let its read re-arm the guard the live tab depends on. Never persisted -
	 * a restored session re-reads the file and gets a stamp that means something.
	 */
	version?: string | null;
	/**
	 * A snapshot of what was on disk, opened beside a tab whose save conflicted.
	 * It carries the same `path` as the tab it is compared against, so it must
	 * never be edited, saved, or mirrored into that tab: two panes on one path
	 * normally share a single document, and this is the one case where the two
	 * sides are meant to differ. Never persisted - a snapshot of a past disk state
	 * means nothing on the next launch.
	 */
	diskSnapshot?: boolean;
}

/** The layout as stored, without any file content. */
export interface PersistedState {
	panes: PersistedPane[];
	expanded: string[];
	splitMode?: boolean;
	splitLeftWidth?: number;
}

/** One pane's tabs; `activeTabIdx` is -1 when the pane is empty. */
export interface PaneTabState {
	tabs: Tab[];
	activeTabIdx: number;
}

/** The whole editor area of one instance, in its live form. */
export interface InstanceTabState {
	panes: PaneTabState[];
	expanded: Set<string>;
	splitMode: boolean;
	splitLeftWidth: number;
}

const RECENT_FILES_LIMIT = 10;

/**
 * The layout without any file content.
 *
 * Disk snapshots are dropped rather than persisted. One is a picture of a single
 * past moment, kept beside the tab it conflicts with; restoring it would reopen a
 * second editable tab on the same path as the live one, and two tabs sharing a
 * path share a document - precisely the collision the snapshot flag exists to
 * prevent. The conflict flag is not persisted either: it is settled against the
 * file as it is on the next launch, not as it was.
 */
export function toPersistedState(state: InstanceTabState): PersistedState {
	return {
		panes: state.panes.map((p) => {
			const active = p.tabs[p.activeTabIdx];
			const tabs = p.tabs.filter((t) => !t.diskSnapshot);
			return {
				tabs: tabs.map((t) => ({
					path: t.path,
					cursorPos: t.cursorPos,
					scrollTop: t.scrollTop,
					pinned: t.pinned,
				})),
				// The active tab is followed by identity. Keeping its raw index would
				// point at whatever slid into that slot once a snapshot before it was
				// dropped - a file the user was not looking at.
				activeTabIdx:
					active && !active.diskSnapshot
						? tabs.indexOf(active)
						: Math.min(p.activeTabIdx, tabs.length - 1),
			};
		}),
		expanded: [...state.expanded],
		splitMode: state.splitMode,
		splitLeftWidth: state.splitLeftWidth,
	};
}

/** Persists the layout only: content is re-read from disk on restore. */
export function saveEditorState(
	projectId: string,
	instanceId: string,
	state: InstanceTabState,
	recentFiles: string[],
): void {
	const fileState: FileState = {
		...toPersistedState(state),
		splitMode: state.splitMode,
		splitLeftWidth: state.splitLeftWidth,
		recentFiles,
	};
	saveFileState(projectId, instanceId, fileState);
}

/** The stored layout, or null for an instance opened for the first time. */
export async function loadEditorState(
	projectId: string,
	instanceId: string,
): Promise<{ persisted: PersistedState | null; recentFiles: string[] }> {
	const fileState = await getFileState(projectId, instanceId);
	if (!fileState) return { persisted: null, recentFiles: [] };
	return {
		persisted: {
			panes: fileState.panes,
			expanded: fileState.expanded,
			splitMode: fileState.splitMode,
			splitLeftWidth: fileState.splitLeftWidth,
		},
		recentFiles: fileState.recentFiles,
	};
}

/** Most recent first, no duplicates, capped at ten. */
export function pushRecent(prev: string[], path: string): string[] {
	return [path, ...prev.filter((p) => p !== path)].slice(0, RECENT_FILES_LIMIT);
}

/** The editor state rebuilt from disk, ready to render. */
export interface RehydrateResult {
	panes: PaneTabState[];
	expanded: Set<string>;
	splitMode: boolean;
	splitLeftWidth: number;
}

/**
 * Rebuilds the panes from disk, clamping each stored active index: a file that
 * disappeared between two launches leaves its tab out, so the index that was
 * saved may now point past the end.
 */
export async function rehydrateFromPersisted(
	wtp: string,
	persisted: PersistedState,
): Promise<RehydrateResult> {
	const rehydratedLists = await Promise.all(
		persisted.panes.map((p) => rehydrateTabList(wtp, p.tabs)),
	);

	const panes: PaneTabState[] = rehydratedLists.map((tabs, i) => {
		let activeTabIdx = persisted.panes[i].activeTabIdx;
		if (tabs.length === 0) activeTabIdx = -1;
		else if (activeTabIdx >= tabs.length) activeTabIdx = tabs.length - 1;
		else if (activeTabIdx < 0) activeTabIdx = 0;
		return { tabs, activeTabIdx };
	});

	return {
		panes,
		expanded: new Set(persisted.expanded),
		splitMode: persisted.splitMode ?? false,
		splitLeftWidth: persisted.splitLeftWidth ?? 0,
	};
}

/** Tabs whose file no longer reads are dropped; a binary one opens empty. */
async function rehydrateTabList(
	wtp: string,
	persistedTabs: PersistedTab[],
): Promise<Tab[]> {
	const results = await Promise.all(
		persistedTabs.map(async (p) => {
			if (isBinaryPath(p.path))
				return { path: p.path, text: "", version: null as string | null };
			try {
				const read = await readFileVersioned(absolutePathOf(p.path, wtp));
				return { path: p.path, text: read.text ?? "", version: read.version };
			} catch {
				return null;
			}
		}),
	);
	const valid = results.filter(Boolean) as {
		path: string;
		text: string;
		version: string | null;
	}[];
	return valid.map((r) => {
		const saved = persistedTabs.find((p) => p.path === r.path) as PersistedTab;
		const le = detectLineEndings(r.text);
		const doc = docFromString(normalizeLineEndings(r.text, le));
		return {
			path: r.path,
			doc,
			savedDoc: doc,
			cursorPos: saved.cursorPos,
			scrollTop: saved.scrollTop,
			pinned: saved.pinned,
			lineEndings: le,
			version: r.version,
		};
	});
}
