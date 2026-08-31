// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Flattening the tree for the virtual list. Rebuilding the whole array on each
 * `expanded` change costs a full walk of the repository - six figures of nodes
 * with ignored files shown - for what is almost always a single folder opening
 * or closing. When exactly one folder changed, the rows of that folder are
 * spliced in or out instead, which touches only the affected slice.
 */
export interface FlatTreeNode<T> {
	node: T;
	depth: number;
}

interface TreeLike {
	path: string;
	isDir?: boolean;
	children?: TreeLike[] | null;
}

export function flattenTree<T extends TreeLike>(
	nodes: T[],
	open: ReadonlySet<string>,
	depth = 0,
	out: FlatTreeNode<T>[] = [],
): FlatTreeNode<T>[] {
	for (const node of nodes) {
		out.push({ node, depth });
		if (node.isDir && open.has(node.path) && node.children) {
			flattenTree(node.children as T[], open, depth + 1, out);
		}
	}
	return out;
}

/** The single path that differs between two sets, or null if not exactly one. */
export function soleDifference(
	prev: ReadonlySet<string>,
	next: ReadonlySet<string>,
): { path: string; opened: boolean } | null {
	if (Math.abs(prev.size - next.size) !== 1) return null;
	const [bigger, smaller, opened] =
		next.size > prev.size ? [next, prev, true] : [prev, next, false];
	let found: string | null = null;
	for (const p of bigger) {
		if (smaller.has(p)) continue;
		if (found !== null) return null;
		found = p;
	}
	return found === null ? null : { path: found, opened };
}

/**
 * The flattened tree after one folder was opened or closed, built by splicing
 * that folder's rows into the previous array. Returns null when the change
 * cannot be applied that way and the caller must rebuild.
 */
export function spliceFolder<T extends TreeLike>(
	previous: FlatTreeNode<T>[],
	open: ReadonlySet<string>,
	change: { path: string; opened: boolean },
): FlatTreeNode<T>[] | null {
	const index = previous.findIndex((r) => r.node.path === change.path);
	if (index === -1) return null;
	const row = previous[index];
	if (!row.node.isDir || !row.node.children) return null;

	/* The folder's rows are the ones that follow it while deeper than it. */
	let end = index + 1;
	while (end < previous.length && previous[end].depth > row.depth) end++;

	if (change.opened) {
		/* Opening a folder that already showed rows means the array and the set
		   disagree; rebuilding is the only safe answer. */
		if (end !== index + 1) return null;
		const inserted = flattenTree(
			row.node.children as T[],
			open,
			row.depth + 1,
			[],
		);
		return [
			...previous.slice(0, index + 1),
			...inserted,
			...previous.slice(end),
		];
	}
	return [...previous.slice(0, index + 1), ...previous.slice(end)];
}
