// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { GapExpansion } from "$lib/utils/git/diff-context";

export type RememberedExpansion = {
	expansions: GapExpansion[];
	fileLines: string[];
};

const MAX_REMEMBERED = 100;

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
	if (remembered.size > MAX_REMEMBERED) {
		const oldest = remembered.keys().next().value;
		if (oldest !== undefined) remembered.delete(oldest);
	}
}
