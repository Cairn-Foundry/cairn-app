// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Deciding whether a laid-out graph can be extended rather than laid out again.
 *
 * Lane assignment is a fold: the lanes after a row depend only on the rows
 * before it. So a list that merely grew at the end can resume from the state
 * left after the last known row, and only the appended commits cost anything.
 * Any other change - a search narrowing the list, a refresh rewriting history -
 * invalidates the whole layout.
 */

/**
 * How much of `rows` a layout of `computed` rows can still be reused for.
 *
 * A row is identified by more than its hash - the refs drawn on it count too,
 * since a push or a pull moves a ref onto a commit already laid out without
 * touching a single hash. So the whole computed list is compared rather than
 * its last entry: a change anywhere in it, at the top as much as at the end,
 * has to redraw.
 */
export function reusablePrefix(
	computed: readonly string[],
	rows: readonly string[],
): number {
	if (computed.length === 0 || computed.length > rows.length) return 0;
	for (let i = 0; i < computed.length; i++) {
		if (computed[i] !== rows[i]) return 0;
	}
	return computed.length;
}
