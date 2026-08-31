// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { effectiveAllowedTools, normalizeToolList } from "./tools";

describe("normalizeToolList", () => {
	it("trims, drops blanks and keeps the first of each duplicate", () => {
		expect(normalizeToolList([" Read ", "Grep", "Read", "", "  "])).toEqual([
			"Read",
			"Grep",
		]);
	});

	it("keeps the order the tools were added in", () => {
		expect(normalizeToolList(["Write", "Bash", "Read"])).toEqual([
			"Write",
			"Bash",
			"Read",
		]);
	});
});

describe("effectiveAllowedTools", () => {
	it("lets the deny list win over the allow list", () => {
		expect(effectiveAllowedTools(["Read", "Bash", "Grep"], ["Bash"])).toEqual([
			"Read",
			"Grep",
		]);
	});

	it("returns the allow list untouched when nothing is denied", () => {
		expect(effectiveAllowedTools(["Read", "Grep"], [])).toEqual([
			"Read",
			"Grep",
		]);
	});

	it("can deny everything that was allowed", () => {
		expect(effectiveAllowedTools(["Read"], ["Read"])).toEqual([]);
	});
});
