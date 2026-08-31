// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { insertAt, moveItem } from "./terminal-order";

describe("moveItem", () => {
	it("moves an item forward", () => {
		expect(moveItem(["a", "b", "c"], 0, 3)).toEqual(["b", "c", "a"]);
	});

	it("moves an item backward", () => {
		expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
	});

	it("returns the same list for a no-op drop", () => {
		const list = ["a", "b", "c"];
		expect(moveItem(list, 1, 1)).toBe(list);
		expect(moveItem(list, 1, 2)).toBe(list);
	});

	it("returns the same list for an out-of-range source", () => {
		const list = ["a", "b"];
		expect(moveItem(list, 5, 0)).toBe(list);
		expect(moveItem(list, -1, 0)).toBe(list);
	});
});

describe("insertAt", () => {
	it("inserts at the given index", () => {
		expect(insertAt(["a", "c"], "b", 1)).toEqual(["a", "b", "c"]);
	});

	it("clamps out-of-range indexes", () => {
		expect(insertAt(["a"], "b", 9)).toEqual(["a", "b"]);
		expect(insertAt(["a"], "b", -3)).toEqual(["b", "a"]);
	});
});
