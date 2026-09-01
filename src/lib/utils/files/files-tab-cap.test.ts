// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import type { Tab } from "./files-persistence";
import { TABS_PER_PANE_MAX, tabsToEvict } from "./files-tab-cap";

function tab(path: string, lastUsedAt: number, extra: Partial<Tab> = {}): Tab {
	const doc = Text.of([""]);
	return {
		path,
		doc,
		savedDoc: doc,
		cursorPos: 0,
		scrollTop: 0,
		lastUsedAt,
		...extra,
	};
}

/** Every tab clean, ages ascending: tab 0 is the oldest. Stamps start at 1 so a
 * tab never shown, which reads as 0, sorts below all of them. */
function pane(count: number, extra: (i: number) => Partial<Tab> = () => ({})) {
	return Array.from({ length: count }, (_, i) =>
		tab(`f${i}.ts`, i + 1, extra(i)),
	);
}

const isClean = () => false;

describe("tabsToEvict", () => {
	it("keeps a pane at or under the cap untouched", () => {
		expect(tabsToEvict(pane(TABS_PER_PANE_MAX), 0, isClean)).toEqual([]);
	});

	it("drops exactly the excess, least recently shown first", () => {
		const tabs = pane(TABS_PER_PANE_MAX + 3);
		const evicted = tabsToEvict(tabs, TABS_PER_PANE_MAX + 2, isClean);
		expect(evicted.map((t) => t.path)).toEqual(["f0.ts", "f1.ts", "f2.ts"]);
	});

	it("never picks the tab on screen, however old it is", () => {
		const tabs = pane(TABS_PER_PANE_MAX + 1);
		const evicted = tabsToEvict(tabs, 0, isClean);
		expect(evicted.map((t) => t.path)).toEqual(["f1.ts"]);
	});

	it("never picks a pinned tab", () => {
		const tabs = pane(TABS_PER_PANE_MAX + 1, (i) =>
			i === 0 ? { pinned: true } : {},
		);
		const evicted = tabsToEvict(tabs, TABS_PER_PANE_MAX, isClean);
		expect(evicted.map((t) => t.path)).toEqual(["f1.ts"]);
	});

	it("never picks a tab holding unsaved edits", () => {
		const tabs = pane(TABS_PER_PANE_MAX + 1);
		const evicted = tabsToEvict(
			tabs,
			TABS_PER_PANE_MAX,
			(t) => t.path === "f0.ts",
		);
		expect(evicted.map((t) => t.path)).toEqual(["f1.ts"]);
	});

	it("answers with nothing rather than breaking a rule to reach the cap", () => {
		const tabs = pane(TABS_PER_PANE_MAX + 2, () => ({ pinned: true }));
		expect(tabsToEvict(tabs, 0, isClean)).toEqual([]);
	});

	it("treats a tab never shown as the oldest", () => {
		const tabs = pane(TABS_PER_PANE_MAX + 1);
		tabs[5].lastUsedAt = undefined;
		const evicted = tabsToEvict(tabs, TABS_PER_PANE_MAX, isClean);
		expect(evicted.map((t) => t.path)).toEqual(["f5.ts"]);
	});
});
