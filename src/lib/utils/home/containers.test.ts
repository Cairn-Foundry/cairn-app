// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import type {
	Container,
	ContainerStats,
} from "#lib/services/containers-service";
import {
	displayName,
	formatCpu,
	groupContainers,
	logsArgv,
	portUrl,
	shellArgv,
	usageOf,
} from "./containers";

function container(
	name: string,
	overrides: Partial<Container> = {},
): Container {
	return {
		id: name,
		name,
		image: "nginx",
		state: "running",
		health: "",
		exitCode: null,
		status: "Up 2 hours",
		startedAt: "",
		finishedAt: "",
		ports: [],
		composeProject: "",
		composeService: "",
		composeWorkingDir: "",
		...overrides,
	};
}

const projects = (groups: ReturnType<typeof groupContainers>) =>
	groups.map((g) => g.project);

describe("groupContainers", () => {
	const all = [
		container("lonely"),
		container("web-db-1", { composeProject: "web", composeService: "db" }),
		container("api-app-1", { composeProject: "api", composeService: "app" }),
		container("old-app-1", {
			composeProject: "old",
			composeService: "app",
			state: "exited",
		}),
		container("web-app-1", { composeProject: "web", composeService: "app" }),
	];

	it("groups by Compose project and closes the list with the standalone ones", () => {
		expect(projects(groupContainers(all, "", true))).toEqual([
			"api",
			"web",
			"old",
			"",
		]);
	});

	it("hides stopped containers unless asked, and the groups they leave empty", () => {
		expect(projects(groupContainers(all, "", false))).toEqual([
			"api",
			"web",
			"",
		]);
	});

	it("counts what runs in each group and orders running containers first", () => {
		const web = groupContainers(
			[
				...all,
				container("web-cache-1", {
					composeProject: "web",
					composeService: "cache",
					state: "exited",
				}),
			],
			"",
			true,
		).find((g) => g.project === "web");
		expect(web?.running).toBe(2);
		expect(web?.containers.map((c) => c.name)).toEqual([
			"web-app-1",
			"web-db-1",
			"web-cache-1",
		]);
	});

	it("filters on the folder a Compose project was started from", () => {
		const withDir = [
			container("a-app-1", {
				composeProject: "a",
				composeWorkingDir: "/home/me/dev/kook-api",
			}),
			container("b-app-1", {
				composeProject: "b",
				composeWorkingDir: "/home/me/dev/other",
			}),
		];
		expect(projects(groupContainers(withDir, "kook", true))).toEqual(["a"]);
	});

	it("filters on the name, the image, the project and the service", () => {
		expect(projects(groupContainers(all, "WEB", true))).toEqual(["web"]);
		expect(
			groupContainers(all, "db", true).flatMap((g) =>
				g.containers.map((c) => c.name),
			),
		).toEqual(["web-db-1"]);
		expect(groupContainers(all, "nginx", true)).toHaveLength(4);
	});
});

describe("sorting by uptime", () => {
	const hoursAgo = (h: number) =>
		new Date(Date.now() - h * 3600_000).toISOString();
	const all = [
		container("young-app-1", {
			composeProject: "a-young",
			startedAt: hoursAgo(1),
		}),
		container("old-db-1", { composeProject: "old", startedAt: hoursAgo(10) }),
		container("old-app-1", { composeProject: "old", startedAt: hoursAgo(48) }),
		container("old-gone-1", { composeProject: "old", state: "exited" }),
		container("lonely", { startedAt: hoursAgo(100) }),
	];

	it("puts the container up the longest first, stopped ones after", () => {
		const old = groupContainers(all, "", true, {
			key: "uptime",
			reversed: false,
		}).find((g) => g.project === "old");
		expect(old?.containers.map((c) => c.name)).toEqual([
			"old-app-1",
			"old-db-1",
			"old-gone-1",
		]);
	});

	it("ranks the groups by their oldest running container, standalone ones last", () => {
		expect(
			projects(
				groupContainers(all, "", true, { key: "uptime", reversed: false }),
			),
		).toEqual(["old", "a-young", ""]);
		expect(
			projects(
				groupContainers(all, "", true, { key: "name", reversed: false }),
			),
		).toEqual(["a-young", "old", ""]);
	});
});

describe("reversing a sort", () => {
	const hoursAgo = (h: number) =>
		new Date(Date.now() - h * 3600_000).toISOString();
	const all = [
		container("a-app-1", { composeProject: "a", startedAt: hoursAgo(48) }),
		container("a-db-1", { composeProject: "a", startedAt: hoursAgo(1) }),
		container("a-old-1", { composeProject: "a", state: "exited" }),
		container("b-app-1", { composeProject: "b", startedAt: hoursAgo(5) }),
		container("lonely", { startedAt: hoursAgo(100) }),
	];
	const reversed = (key: "name" | "uptime") =>
		groupContainers(all, "", true, { key, reversed: true });

	it("puts the most recently started first, still ahead of the stopped ones", () => {
		const groups = reversed("uptime");
		expect(projects(groups)).toEqual(["a", "b", ""]);
		expect(groups[0].containers.map((c) => c.name)).toEqual([
			"a-db-1",
			"a-app-1",
			"a-old-1",
		]);
	});

	it("runs the names from Z to A, the standalone ones still last", () => {
		expect(projects(reversed("name"))).toEqual(["b", "a", ""]);
	});
});

describe("sorting by resource usage", () => {
	const stat = (id: string, cpuPercent: number, memoryBytes: number) =>
		[id, { id, cpuPercent, memoryBytes, memoryLimitBytes: 0 }] as [
			string,
			ContainerStats,
		];
	const stats = new Map([
		stat("small", 80, 10),
		stat("big", 1, 900),
		stat("db-1", 5, 300),
		stat("db-2", 5, 300),
		stat("stopped", 99, 9999),
	]);
	const all = [
		container("small"),
		container("big"),
		container("unsampled"),
		container("stopped", { state: "exited" }),
		container("db-1", { composeProject: "db" }),
		container("db-2", { composeProject: "db" }),
		container("api-1", { composeProject: "api" }),
	];
	const names = (groups: ReturnType<typeof groupContainers>) =>
		groups.flatMap((g) => g.containers.map((c) => c.name));

	it("puts the heaviest first, the unsampled after, the stopped last", () => {
		const groups = groupContainers(
			all,
			"",
			true,
			{ key: "memory", reversed: false },
			stats,
		);
		expect(names(groups.filter((g) => !g.project))).toEqual([
			"big",
			"small",
			"unsampled",
			"stopped",
		]);
	});

	it("ranks the groups by what their running containers use together", () => {
		const groups = groupContainers(
			all,
			"",
			true,
			{ key: "memory", reversed: false },
			stats,
		);
		expect(projects(groups)).toEqual(["db", "api", ""]);
		const reversed = groupContainers(
			all,
			"",
			true,
			{ key: "memory", reversed: true },
			stats,
		);
		expect(projects(reversed)).toEqual(["api", "db", ""]);
	});

	it("sorts on CPU the same way", () => {
		const groups = groupContainers(
			all,
			"",
			false,
			{ key: "cpu", reversed: false },
			stats,
		);
		expect(names(groups.filter((g) => !g.project))).toEqual([
			"small",
			"big",
			"unsampled",
		]);
	});

	it("adds up the running containers only", () => {
		expect(usageOf(all, stats)).toEqual({ cpuPercent: 91, memoryBytes: 1510 });
		expect(usageOf(all, new Map())).toEqual({ cpuPercent: 0, memoryBytes: 0 });
	});

	it("keeps one decimal for a small CPU share", () => {
		expect(formatCpu(0.04)).toBe("0.0 %");
		expect(formatCpu(9.96)).toBe("10.0 %");
		expect(formatCpu(250.4)).toBe("250 %");
	});
});

describe("portUrl", () => {
	it("answers on localhost for every interface", () => {
		expect(
			portUrl({
				hostIp: "*",
				hostPort: 8080,
				containerPort: 80,
				protocol: "tcp",
			}),
		).toBe("http://localhost:8080");
	});

	it("keeps a specific address, bracketing IPv6", () => {
		expect(
			portUrl({
				hostIp: "127.0.0.1",
				hostPort: 5432,
				containerPort: 5432,
				protocol: "tcp",
			}),
		).toBe("http://127.0.0.1:5432");
		expect(
			portUrl({
				hostIp: "::1",
				hostPort: 3000,
				containerPort: 3000,
				protocol: "tcp",
			}),
		).toBe("http://[::1]:3000");
	});
});

describe("displayName", () => {
	it("prefers the Compose service, which the group already prefixes", () => {
		expect(displayName(container("web-db-1", { composeService: "db" }))).toBe(
			"db",
		);
		expect(displayName(container("lonely"))).toBe("lonely");
	});
});

describe("terminal argv", () => {
	it("follows the logs from their last lines", () => {
		expect(logsArgv(container("abc"))).toEqual([
			"docker",
			"logs",
			"--follow",
			"--tail",
			"500",
			"abc",
		]);
	});

	it("execs bash when the image has it, sh otherwise", () => {
		const argv = shellArgv(container("abc"));
		expect(argv.slice(0, 5)).toEqual(["docker", "exec", "-it", "abc", "sh"]);
		expect(argv.at(-1)).toMatch(/command -v bash.*exec bash.*exec sh/);
	});
});
