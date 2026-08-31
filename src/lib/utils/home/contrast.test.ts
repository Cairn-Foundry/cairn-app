// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { foregroundOn, relativeLuminance } from "./contrast";

describe("relativeLuminance", () => {
	it("is 0 for black and 1 for white", () => {
		expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
		expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
	});

	it("reads oklch as well as hex", () => {
		expect(relativeLuminance("oklch(0.96 0.005 80)")).toBeGreaterThan(0.8);
	});
});

describe("foregroundOn", () => {
	it("puts dark text on a pale accent", () => {
		expect(foregroundOn("#ffd400")).toContain("0.22");
		expect(foregroundOn("#a3e635")).toContain("0.22");
	});

	it("puts light text on a deep accent", () => {
		expect(foregroundOn("#6c8eff")).toContain("0.96");
		expect(foregroundOn("#7c3aed")).toContain("0.96");
	});
});
