// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { DEFAULT_COMMAND_ICON, ICON_GROUPS, ICON_NAMES } from "./icons";

describe("ICON_GROUPS", () => {
	it("carries groups, each with names", () => {
		expect(ICON_GROUPS.length).toBeGreaterThan(0);
		for (const group of ICON_GROUPS) {
			expect(group.names.length, group.id).toBeGreaterThan(0);
		}
	});

	it("identifies every group, with no duplicate id", () => {
		const ids = ICON_GROUPS.map((g) => g.id);
		for (const id of ids) {
			expect(typeof id).toBe("string");
			expect(id).toMatch(/^[a-z0-9-]+$/);
		}
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("names icons in a shape the picker can render", () => {
		for (const name of ICON_NAMES) {
			expect(name, name).toMatch(/^[a-z0-9-]+$/);
		}
	});
});

describe("ICON_NAMES", () => {
	it("flattens every group, losing none", () => {
		const total = ICON_GROUPS.reduce((n, g) => n + g.names.length, 0);
		expect(ICON_NAMES.length).toBe(total);
	});

	it("lists no icon twice, so the picker shows no duplicate", () => {
		expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length);
	});

	it("keeps the groups' order", () => {
		expect(ICON_NAMES[0]).toBe(ICON_GROUPS[0].names[0]);
		expect(ICON_NAMES.at(-1)).toBe(ICON_GROUPS.at(-1)?.names.at(-1));
	});
});

describe("DEFAULT_COMMAND_ICON", () => {
	it("is an icon the picker actually offers", () => {
		expect(ICON_NAMES).toContain(DEFAULT_COMMAND_ICON);
	});
});
