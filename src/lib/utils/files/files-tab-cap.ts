// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Tab } from "./files-persistence";

/**
 * How many tabs a pane keeps alive. Every open tab pins its document, its
 * CodeMirror state and its git base in memory for the whole session, and a
 * session that opens files all day never puts any of it down. The cap is
 * generous on purpose: it is there to stop the unbounded case, not to close
 * tabs out from under someone working across a dozen files.
 */
export const TABS_PER_PANE_MAX = 24;

/**
 * Which tabs a pane must let go of to come back under the cap, oldest use
 * first.
 *
 * Three kinds of tab are never picked, whatever their age: a pinned one, since
 * pinning is the user saying to keep it; one holding unsaved edits, since
 * closing it would either lose the work or write a file the user never asked
 * to save; and the one being shown. So a pane can legitimately sit above the
 * cap - the answer is then empty rather than a tab closed against those rules.
 */
export function tabsToEvict(
	tabs: Tab[],
	activeTabIdx: number,
	isDirty: (tab: Tab) => boolean,
): Tab[] {
	const excess = tabs.length - TABS_PER_PANE_MAX;
	if (excess <= 0) return [];
	return tabs
		.map((tab, index) => ({ tab, index }))
		.filter(
			({ tab, index }) =>
				!tab.pinned && index !== activeTabIdx && !isDirty(tab),
		)
		.sort((a, b) => (a.tab.lastUsedAt ?? 0) - (b.tab.lastUsedAt ?? 0))
		.slice(0, excess)
		.map(({ tab }) => tab);
}
