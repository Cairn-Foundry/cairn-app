// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { reusablePrefix } from "./graph-cache";

describe("reusablePrefix", () => {
	it("reuses everything when nothing changed", () => {
		expect(reusablePrefix(["a", "b"], ["a", "b"])).toBe(2);
	});

	it("reuses the computed rows when a page is appended", () => {
		expect(reusablePrefix(["a", "b"], ["a", "b", "c", "d"])).toBe(2);
	});

	it("starts over when the history was rewritten under the cache", () => {
		expect(reusablePrefix(["a", "b"], ["a", "z", "c"])).toBe(0);
	});

	it("starts over when the list shrank, as a search does", () => {
		expect(reusablePrefix(["a", "b", "c"], ["b"])).toBe(0);
	});

	it("has nothing to reuse from an empty layout", () => {
		expect(reusablePrefix([], ["a"])).toBe(0);
	});

	// A search matching nothing empties the list; answering "everything is
	// reused" there would redraw the previous rows under the empty state.
	it("reuses nothing when the list became empty", () => {
		expect(reusablePrefix(["a", "b"], [])).toBe(0);
	});
});
