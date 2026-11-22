// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * How many items of a single-line row stay visible, given the right edge of
 * each one laid out at its natural width. Whenever an item is left out - or
 * `hasMore` says some were never drawn - the room for a "+N" label is kept after
 * the last one shown. The first item always shows, cut off if it has to be.
 */
export function countFittingItems(
	rightEdges: number[],
	width: number,
	labelRoom: number,
	hasMore = false,
): number {
	for (let count = rightEdges.length; count >= 1; count--) {
		const needsLabel = count < rightEdges.length || hasMore;
		if (rightEdges[count - 1] + (needsLabel ? labelRoom : 0) <= width) {
			return count;
		}
	}
	return Math.min(1, rightEdges.length);
}
