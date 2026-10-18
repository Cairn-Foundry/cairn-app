// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { GitDiffHunk } from "$lib/services/git-service";

/** FNV-1a over everything a diff shows, so two equal diffs hash alike and any edit moves it. */
export function hashHunks(hunks: GitDiffHunk[]): string {
	let hash = 0x811c9dc5;
	const feed = (text: string) => {
		for (let i = 0; i < text.length; i++) {
			hash ^= text.charCodeAt(i);
			hash = Math.imul(hash, 0x01000193);
		}
		hash ^= 0xff;
		hash = Math.imul(hash, 0x01000193);
	};
	for (const hunk of hunks) {
		feed(hunk.header);
		for (const line of hunk.lines) {
			feed(line.kind);
			feed(line.content);
		}
	}
	return (hash >>> 0).toString(16);
}
