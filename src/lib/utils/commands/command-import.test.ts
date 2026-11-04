// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from "vitest";
import { listDirNames, readFile } from "#lib/services/file-service";
import {
	buildCandidates,
	candidateToCommand,
	detectPackageManager,
	iconForScript,
	parseScripts,
	runScriptCommand,
	scanPackageJson,
} from "./command-import";

vi.mock("#lib/services/file-service", () => ({
	listDirNames: vi.fn(),
	readFile: vi.fn(),
}));

describe("detectPackageManager", () => {
	it("reads the manager from the lockfile", () => {
		expect(detectPackageManager(["bun.lock", "package.json"])).toBe("bun");
		expect(detectPackageManager(["pnpm-lock.yaml"])).toBe("pnpm");
		expect(detectPackageManager(["yarn.lock"])).toBe("yarn");
	});

	it("falls back to npm when no lockfile is recognised", () => {
		expect(detectPackageManager(["package.json"])).toBe("npm");
	});
});

describe("runScriptCommand", () => {
	it("drops the run keyword for yarn", () => {
		expect(runScriptCommand("yarn", "dev")).toBe("yarn dev");
	});

	it("keeps the run keyword elsewhere", () => {
		expect(runScriptCommand("bun", "dev")).toBe("bun run dev");
		expect(runScriptCommand("npm", "build")).toBe("npm run build");
	});
});

describe("iconForScript", () => {
	it("guesses an icon from the script name", () => {
		expect(iconForScript("dev")).toBe("play");
		expect(iconForScript("build:prod")).toBe("package");
		expect(iconForScript("test:unit")).toBe("tests");
		expect(iconForScript("lint")).toBe("check");
	});

	it("falls back on an unknown name", () => {
		expect(iconForScript("zorglub")).toBe("play");
	});
});

describe("parseScripts", () => {
	it("returns the string scripts", () => {
		expect(parseScripts('{"scripts":{"dev":"vite","x":2}}')).toEqual({
			dev: "vite",
		});
	});

	it("survives a malformed package.json", () => {
		expect(parseScripts("{ not json")).toEqual({});
	});

	it("survives a package.json without scripts", () => {
		expect(parseScripts('{"name":"x"}')).toEqual({});
	});

	it("ignores a scripts field that is not an object", () => {
		expect(parseScripts('{"scripts":"build"}')).toEqual({});
		expect(parseScripts('{"scripts":null}')).toEqual({});
	});
});

describe("buildCandidates", () => {
	it("builds one candidate per script", () => {
		expect(
			buildCandidates({ dev: "vite", build: "vite build" }, "pnpm"),
		).toEqual([
			{ name: "dev", script: "pnpm run dev", icon: "play" },
			{ name: "build", script: "pnpm run build", icon: "package" },
		]);
	});
});

describe("candidateToCommand", () => {
	it("marks the command as imported and leaves it unpinned", () => {
		const command = candidateToCommand({
			name: "dev",
			script: "npm run dev",
			icon: "play",
		});
		expect(command.source).toBe("package.json");
		expect(command.pinned).toBe(false);
		expect(command.steps).toEqual(["npm run dev"]);
	});
});

describe("scanPackageJson", () => {
	beforeEach(() => {
		vi.mocked(listDirNames).mockReset();
		vi.mocked(readFile).mockReset();
	});

	it("offers the scripts through the manager the lockfile names", async () => {
		vi.mocked(listDirNames).mockResolvedValue(["pnpm-lock.yaml"]);
		vi.mocked(readFile).mockResolvedValue('{"scripts":{"dev":"vite"}}');
		expect(await scanPackageJson("/repo")).toEqual({
			manager: "pnpm",
			candidates: [{ name: "dev", script: "pnpm run dev", icon: "play" }],
		});
		expect(readFile).toHaveBeenCalledWith("/repo/package.json");
	});

	it("offers nothing when there is no package.json", async () => {
		vi.mocked(listDirNames).mockResolvedValue(["yarn.lock"]);
		vi.mocked(readFile).mockResolvedValue(null);
		expect(await scanPackageJson("/repo")).toEqual({
			manager: "yarn",
			candidates: [],
		});
	});

	it("falls back to npm and nothing when the directory cannot be read", async () => {
		vi.mocked(listDirNames).mockRejectedValue(new Error("denied"));
		vi.mocked(readFile).mockRejectedValue(new Error("denied"));
		expect(await scanPackageJson("/repo")).toEqual({
			manager: "npm",
			candidates: [],
		});
	});
});
