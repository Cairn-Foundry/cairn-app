// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { GapExpansion } from "$lib/utils/git/diff-context";

export type RememberedExpansion = {
	expansions: GapExpansion[];
	fileLines: string[];
};

const MAX_REMEMBERED = 100;
const MAX_REMEMBERED_LINES = 200_000;

const remembered = new Map<string, RememberedExpansion>();

/** What was revealed around the hunks of a diff, keyed by its signature (side, path and hunk headers). */
export function recallExpansion(key: string): RememberedExpansion | undefined {
	return remembered.get(key);
}

export function rememberExpansion(
	key: string,
	value: RememberedExpansion,
): void {
	remembered.delete(key);
	remembered.set(key, value);
	let lines = 0;
	for (const entry of remembered.values()) lines += entry.fileLines.length;
	for (const oldest of remembered.keys()) {
		if (remembered.size <= MAX_REMEMBERED && lines <= MAX_REMEMBERED_LINES)
			break;
		if (oldest === key) break;
		lines -= remembered.get(oldest)?.fileLines.length ?? 0;
		remembered.delete(oldest);
	}
}
