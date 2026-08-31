// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { virtualWindow } from "./virtual-window";

describe("virtualWindow", () => {
	it("renders only the rows the viewport can show, plus the overscan", () => {
		const w = virtualWindow(1000, 500, 200, 25, 2);
		expect(w.first).toBe(18);
		expect(w.last).toBe(30);
	});

	it("pads for the rows it left out, so the scrollbar keeps its size", () => {
		const w = virtualWindow(1000, 500, 200, 25, 2);
		expect(w.padTop).toBe(18 * 25);
		expect(w.padBottom).toBe((1000 - 30) * 25);
		expect(w.padTop + (w.last - w.first) * 25 + w.padBottom).toBe(1000 * 25);
	});

	it("clamps at both ends rather than running past the list", () => {
		expect(virtualWindow(10, 0, 200, 25, 2).first).toBe(0);
		const end = virtualWindow(10, 1e6, 200, 25, 2);
		expect(end.last).toBe(10);
		expect(end.padBottom).toBe(0);
	});

	it("renders everything when the row height is unknown", () => {
		const w = virtualWindow(10, 0, 200, 0, 2);
		expect(w).toEqual({ first: 0, last: 10, padTop: 0, padBottom: 0 });
	});
});
