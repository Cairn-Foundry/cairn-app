// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Text } from "@codemirror/state";
import type { Tab } from "./files-persistence";

/**
 * Two panes showing the same file share one document, so an edit on either side
 * is the same edit. The exception is a disk snapshot: it carries the path of the
 * tab it was opened beside, but holds a deliberately different text - what was on
 * disk when a save conflicted. Mirroring into or out of one would collapse the two
 * versions the user was given to compare, which reads as "my unsaved work was
 * overwritten by the disk version".
 *
 * Returns the tabs of the other panes that must adopt `doc`.
 */
export function tabsToMirror(
	panes: { tabs: Tab[] }[],
	sourcePaneIdx: number,
	source: Tab,
): Tab[] {
	if (source.diskSnapshot) return [];
	return panes.flatMap((pane, i) =>
		i === sourcePaneIdx
			? []
			: pane.tabs.filter((t) => t.path === source.path && !t.diskSnapshot),
	);
}

/** Applies `doc` to every tab that mirrors `source`. */
export function mirrorDoc(
	panes: { tabs: Tab[] }[],
	sourcePaneIdx: number,
	source: Tab,
	doc: Text,
): void {
	for (const tab of tabsToMirror(panes, sourcePaneIdx, source)) tab.doc = doc;
}
