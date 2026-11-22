// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import type { ListeningPort } from "#lib/services/ports-service";
import { groupByProcess, matchesProcess, shortCommand } from "./ports";

function socket(
	pid: number,
	port: number,
	overrides: Partial<ListeningPort> = {},
): ListeningPort {
	return {
		id: `${pid}:${port}`,
		pid,
		port,
		address: "127.0.0.1",
		family: "IPv4",
		process: "node",
		command: "node server.js",
		user: "dev",
		isOwned: true,
		...overrides,
	};
}

describe("groupByProcess", () => {
	/** Stopping a process frees all its ports, so it is listed once. */
	it("gathers the ports of one process", () => {
		const groups = groupByProcess([socket(1, 3000), socket(1, 9229)]);
		expect(groups).toHaveLength(1);
		expect(groups[0].ports.map((p) => p.port)).toEqual([3000, 9229]);
	});

	it("merges one port bound on two addresses", () => {
		const groups = groupByProcess([
			socket(1, 5432),
			socket(1, 5432, { address: "::1", family: "IPv6" }),
		]);
		expect(groups[0].ports).toEqual([
			{ port: 5432, addresses: ["127.0.0.1", "::1"], isExposed: false },
		]);
	});

	it("marks a port bound on every interface as exposed", () => {
		const groups = groupByProcess([socket(1, 8000, { address: "0.0.0.0" })]);
		expect(groups[0].ports[0].isExposed).toBe(true);
	});

	/** What the user can stop comes first, whatever its port. */
	it("lists the user's own processes first", () => {
		const groups = groupByProcess([
			socket(1, 22, { isOwned: false, user: "root" }),
			socket(2, 8000),
		]);
		expect(groups.map((g) => g.pid)).toEqual([2, 1]);
	});
});

describe("matchesProcess", () => {
	const [group] = groupByProcess([socket(42, 3000), socket(42, 9229)]);

	it("matches any of its ports", () => {
		expect(matchesProcess(group, "9229")).toBe(true);
	});

	it("matches its pid", () => {
		expect(matchesProcess(group, "42")).toBe(true);
	});

	it("misses what it does not hold", () => {
		expect(matchesProcess(group, "8080")).toBe(false);
	});
});

describe("shortCommand", () => {
	it("shortens the paths in a command to their basenames", () => {
		expect(
			shortCommand(
				"node",
				"/usr/local/bin/node /srv/app/server.js --port 3001",
			),
		).toBe("node server.js --port 3001");
	});

	it("drops a command that only repeats the process name", () => {
		expect(shortCommand("node", "/usr/local/bin/node")).toBe("");
	});
});
