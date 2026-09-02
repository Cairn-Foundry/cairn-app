// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { mirrorDoc, tabsToMirror } from "./files-doc-mirror";
import type { Tab } from "./files-persistence";

function tab(path: string, text: string, extra: Partial<Tab> = {}): Tab {
	const doc = Text.of(text.split("\n"));
	return { path, doc, savedDoc: doc, cursorPos: 0, scrollTop: 0, ...extra };
}

describe("tabsToMirror", () => {
	it("mirrors an edit into the twin tab of the other pane", () => {
		const left = tab("a.ts", "one");
		const right = tab("a.ts", "one");
		const panes = [{ tabs: [left] }, { tabs: [right] }];

		expect(tabsToMirror(panes, 0, left)).toEqual([right]);
	});

	it("leaves other files alone", () => {
		const left = tab("a.ts", "one");
		const other = tab("b.ts", "two");
		const panes = [{ tabs: [left] }, { tabs: [other] }];

		expect(tabsToMirror(panes, 0, left)).toEqual([]);
	});

	it("never mirrors into the pane the edit came from", () => {
		const left = tab("a.ts", "one");
		const alsoLeft = tab("a.ts", "one");
		const panes = [{ tabs: [left, alsoLeft] }];

		expect(tabsToMirror(panes, 0, left)).toEqual([]);
	});

	/**
	 * The regression: a disk snapshot shares the path of the tab it sits beside, so
	 * a plain path match would push the disk text over the user's unsaved work.
	 */
	it("does not push an edit into a disk snapshot of the same file", () => {
		const live = tab("a.ts", "my unsaved work");
		const snapshot = tab("a.ts", "what is on disk", { diskSnapshot: true });
		const panes = [{ tabs: [live] }, { tabs: [snapshot] }];

		expect(tabsToMirror(panes, 0, live)).toEqual([]);
	});

	it("does not let a disk snapshot push its text into the live tab", () => {
		const live = tab("a.ts", "my unsaved work");
		const snapshot = tab("a.ts", "what is on disk", { diskSnapshot: true });
		const panes = [{ tabs: [live] }, { tabs: [snapshot] }];

		expect(tabsToMirror(panes, 1, snapshot)).toEqual([]);
	});
});

describe("mirrorDoc", () => {
	it("applies the document to the twin and to nothing else", () => {
		const left = tab("a.ts", "one");
		const right = tab("a.ts", "one");
		const snapshot = tab("a.ts", "disk", { diskSnapshot: true });
		const unrelated = tab("b.ts", "two");
		const panes = [{ tabs: [left] }, { tabs: [right, snapshot, unrelated] }];

		const next = Text.of(["edited"]);
		mirrorDoc(panes, 0, left, next);

		expect(right.doc).toBe(next);
		expect(snapshot.doc.toString()).toBe("disk");
		expect(unrelated.doc.toString()).toBe("two");
	});
});
