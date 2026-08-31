// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The slice of a fixed-height list that is worth putting in the DOM, plus the
 * two spacers that keep the scrollbar the size the full list would give it.
 *
 * Extracted from the file tree, which is where it was first needed: a list
 * long enough to matter costs the same whether it holds files, commits or
 * branches, and the arithmetic is the same too.
 */
export interface VirtualWindow {
	/** Index of the first rendered row. */
	first: number;
	/** Index one past the last rendered row. */
	last: number;
	/** Height standing in for the rows before `first`, in pixels. */
	padTop: number;
	/** Height standing in for the rows after `last`, in pixels. */
	padBottom: number;
}

export function virtualWindow(
	total: number,
	scrollTop: number,
	viewportHeight: number,
	rowHeight: number,
	overscan: number,
): VirtualWindow {
	if (rowHeight <= 0) {
		return { first: 0, last: total, padTop: 0, padBottom: 0 };
	}
	const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
	const last = Math.min(
		total,
		Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan,
	);
	return {
		first,
		last,
		padTop: first * rowHeight,
		padBottom: Math.max(0, (total - last) * rowHeight),
	};
}
