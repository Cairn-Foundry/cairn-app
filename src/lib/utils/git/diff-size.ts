// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { GitDiffHunk } from "#lib/services/git-service";

export const MAX_INLINE_DIFF_LINES = 2000;

export function isDiffTooLarge(
	hunks: GitDiffHunk[],
	maxLines = MAX_INLINE_DIFF_LINES,
): boolean {
	let count = 0;
	for (const h of hunks) {
		count += h.lines.length;
		if (count > maxLines) return true;
	}
	return false;
}
