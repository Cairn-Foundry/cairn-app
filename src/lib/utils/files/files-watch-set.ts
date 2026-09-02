// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { parentPathOf } from "./files-tree";

/**
 * The directories worth watching for one worktree: the ones the user can
 * actually see change.
 *
 * A watch covers a single directory's own entries, so the cost follows what is on
 * screen rather than the size of the repository. That distinction matters on
 * Linux, where inotify has no recursive watch and `notify` emulates one by
 * placing a watch on every directory of the tree - `node_modules` included -
 * against a per-user quota shared with every other program running.
 *
 * Included:
 * - every expanded directory of the tree, because its entries are on screen;
 * - the parent of every open tab, so an external edit to an open file is seen
 *   (the parent, not the file: most tools write a temporary file and rename it
 *   over the target, which leaves a watch on the file itself pointing at a dead
 *   inode while the parent still sees the rename);
 * - the ancestors of each expanded directory, which are on screen too - a
 *   directory is only reachable when its parents are open.
 *
 * The worktree root and the git metadata are added by the backend and are not
 * returned here.
 *
 * Paths are worktree-relative, as the tree and the tabs hold them; the empty
 * string, meaning the root itself, is dropped.
 */
export function watchSet(
	expanded: Iterable<string>,
	openTabPaths: Iterable<string>,
): string[] {
	const dirs = new Set<string>();

	const addWithAncestors = (dir: string) => {
		let current = dir;
		while (current !== "" && !dirs.has(current)) {
			dirs.add(current);
			current = parentPathOf(current);
		}
	};

	for (const dir of expanded) addWithAncestors(dir);
	for (const path of openTabPaths) addWithAncestors(parentPathOf(path));

	return [...dirs].sort();
}

/** Absolute paths for the backend, which knows nothing of worktree-relative ones. */
export function absoluteWatchSet(
	worktreePath: string,
	expanded: Iterable<string>,
	openTabPaths: Iterable<string>,
): string[] {
	// The trailing slash is stripped: `/wt//src` and `/wt/src` name one directory
	// but are two different keys, so the backend would watch it twice and its diff
	// would never drop the first - one leaked watch per sync.
	const base = worktreePath.replace(/\/+$/, "");
	return watchSet(expanded, openTabPaths).map((d) => `${base}/${d}`);
}
