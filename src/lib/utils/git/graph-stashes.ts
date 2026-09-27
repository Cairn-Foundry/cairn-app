// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { GitGraphCommit } from "$lib/services/git-service";

const STASH_REF = /^stash@\{(\d+)\}$/;

/** The stack index of a stash row, or null for an ordinary commit. */
export function stashIndexOf(commit: GitGraphCommit): number | null {
	for (const ref of commit.refs) {
		const match = STASH_REF.exec(ref);
		if (match) return Number(match[1]);
	}
	return null;
}

/**
 * Places each stash right above the commit it was taken on, where it reads as
 * a short branch off that commit. A stash whose base is not loaded yet waits
 * for the page that brings it: shown anywhere else, it would hang in mid-air.
 */
export function spliceStashes(
	commits: GitGraphCommit[],
	stashes: GitGraphCommit[],
): GitGraphCommit[] {
	if (stashes.length === 0) return commits;
	const byBase = new Map<string, GitGraphCommit[]>();
	for (const stash of stashes) {
		const base = stash.parents[0];
		if (!base) continue;
		const list = byBase.get(base);
		if (list) list.push(stash);
		else byBase.set(base, [stash]);
	}
	const out: GitGraphCommit[] = [];
	for (const commit of commits) {
		const above = byBase.get(commit.hash);
		if (above) out.push(...above);
		out.push(commit);
	}
	return out;
}
