// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { GitDiffHunk } from "#lib/services/git-service";
import { parseHunkRange } from "./diff-context";

/**
 * Where the first change of a diff sits in the new version of the file: the
 * first added line, or the line a deletion left in place. Null when the hunks
 * hold no change at all, as an expanded context can.
 */
export function firstChangedLine(hunks: GitDiffHunk[]): number | null {
	for (const hunk of hunks) {
		let newNo = parseHunkRange(hunk.header)?.newFirst ?? 1;
		for (const line of hunk.lines) {
			if (line.kind !== "context") return newNo;
			newNo++;
		}
	}
	return null;
}
