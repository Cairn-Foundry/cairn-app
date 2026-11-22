// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { countFittingItems } from "./fit-in-row";

describe("countFittingItems", () => {
	it("keeps every item when they all fit and nothing else waits", () => {
		expect(countFittingItems([100, 200, 300], 300, 50)).toBe(3);
	});

	it("drops items until the last one shown leaves room for the label", () => {
		expect(countFittingItems([100, 200, 300], 280, 50)).toBe(2);
		expect(countFittingItems([100, 200, 300], 240, 50)).toBe(1);
	});

	it("keeps room for the label when items were never drawn", () => {
		expect(countFittingItems([100, 200], 220, 50, true)).toBe(1);
		expect(countFittingItems([100, 200], 250, 50, true)).toBe(2);
	});

	it("always shows the first item, even when it does not fit", () => {
		expect(countFittingItems([400, 500], 300, 50)).toBe(1);
	});

	it("shows nothing when there is nothing", () => {
		expect(countFittingItems([], 300, 50)).toBe(0);
	});
});
