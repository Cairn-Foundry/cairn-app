// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import {
	belongsToProject,
	dropProjectKeys,
	purgeProjectEntries,
} from "./project-scope";

describe("belongsToProject", () => {
	it("matches the bare project key", () => {
		expect(belongsToProject("p1", "p1")).toBe(true);
	});

	it("matches an instance-scoped key", () => {
		expect(belongsToProject("p1:i1", "p1")).toBe(true);
	});

	it("matches a command-scoped key", () => {
		expect(belongsToProject("p1:i1:c1", "p1")).toBe(true);
	});

	it("does not match a project whose id merely starts the same", () => {
		expect(belongsToProject("p10", "p1")).toBe(false);
		expect(belongsToProject("p10:i1", "p1")).toBe(false);
	});

	it("does not match an unrelated project", () => {
		expect(belongsToProject("p2:i1", "p1")).toBe(false);
	});
});

describe("dropProjectKeys", () => {
	it("keeps every entry of the other projects", () => {
		const map = { p1: 1, "p1:i1": 2, "p1:i1:c1": 3, p2: 4, "p2:i1": 5, p10: 6 };
		expect(dropProjectKeys(map, "p1")).toEqual({
			p2: 4,
			"p2:i1": 5,
			p10: 6,
		});
	});

	it("leaves the original untouched", () => {
		const map = { p1: 1, p2: 2 };
		dropProjectKeys(map, "p1");
		expect(map).toEqual({ p1: 1, p2: 2 });
	});

	it("is a no-op for a project with nothing cached", () => {
		expect(dropProjectKeys({ p2: 1 }, "p1")).toEqual({ p2: 1 });
	});
});

describe("purgeProjectEntries", () => {
	it("drops the project's keys from a Map", () => {
		const map = new Map<string, number>([
			["p1", 1],
			["p1:i1", 2],
			["p2", 3],
			["p10", 4],
		]);
		purgeProjectEntries(map, "p1");
		expect([...map.keys()]).toEqual(["p2", "p10"]);
	});

	it("drops the project's keys from a Set", () => {
		const set = new Set(["p1", "p1:i1", "p2", "p10"]);
		purgeProjectEntries(set, "p1");
		expect([...set]).toEqual(["p2", "p10"]);
	});

	it("hands each removed value to the callback, so a timer can be cleared", () => {
		const map = new Map<string, number>([
			["p1", 1],
			["p1:i1", 2],
			["p2", 3],
		]);
		const seen: unknown[] = [];
		purgeProjectEntries(map, "p1", (v) => seen.push(v));
		expect(seen).toEqual([1, 2]);
	});

	it("does not call the callback for a Set", () => {
		const set = new Set(["p1"]);
		const seen: unknown[] = [];
		purgeProjectEntries(set, "p1", (v) => seen.push(v));
		expect(seen).toEqual([]);
		expect(set.size).toBe(0);
	});
});
