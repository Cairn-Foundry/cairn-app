// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Reordering the terminal lists. Kept apart from the store so the index
// arithmetic can be tested on plain arrays.

/**
 * Moves one item, treating an insert point at either side of its current slot
 * as a no-op: `insertIndex` counts gaps, so both mean "leave it where it is".
 */
export function moveItem<T>(
	list: T[],
	fromIndex: number,
	insertIndex: number,
): T[] {
	if (fromIndex < 0 || fromIndex >= list.length) return list;
	if (insertIndex === fromIndex || insertIndex === fromIndex + 1) return list;
	const next = [...list];
	const [moved] = next.splice(fromIndex, 1);
	next.splice(
		insertIndex > fromIndex ? insertIndex - 1 : insertIndex,
		0,
		moved,
	);
	return next;
}

/** Inserts at `insertIndex`, clamped to the list rather than left sparse. */
export function insertAt<T>(list: T[], item: T, insertIndex: number): T[] {
	const next = [...list];
	next.splice(Math.max(0, Math.min(insertIndex, next.length)), 0, item);
	return next;
}
