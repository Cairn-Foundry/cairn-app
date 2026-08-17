import { beforeEach, describe, expect, it, vi } from "vitest";

const listDirNames = vi.hoisted(() => vi.fn());
const readFile = vi.hoisted(() => vi.fn());

vi.mock("$lib/services/file-service", () => ({ listDirNames, readFile }));

import { detectTestRunners } from "./test-detect";

/** Lays out a fake worktree: directory listings and file contents by path. */
function mountTree(
	dirs: Record<string, string[]>,
	files: Record<string, string> = {},
) {
	listDirNames.mockImplementation(async (dir: string) => dirs[dir] ?? []);
	readFile.mockImplementation(async (path: string) => files[path] ?? null);
}

const PKG_VITEST = JSON.stringify({
	scripts: { test: "vitest run" },
	devDependencies: { vitest: "^4.0.0" },
});

beforeEach(() => {
	listDirNames.mockReset();
	readFile.mockReset();
});

describe("detectTestRunners", () => {
	it("finds vitest and asks it for the JSON reporter", async () => {
		mountTree(
			{ "/w": ["package.json", "bun.lock"] },
			{ "/w/package.json": PKG_VITEST },
		);
		const runners = await detectTestRunners("/w", false);

		expect(runners).toHaveLength(1);
		expect(runners[0].id).toBe("vitest");
		expect(runners[0].command).toContain("bun run test");
		expect(runners[0].command).toContain("--reporter=json");
		expect(runners[0].detectedFrom).toBe("package.json#scripts.test");
	});

	it("uses the package manager the lockfile names", async () => {
		mountTree(
			{ "/w": ["package.json", "pnpm-lock.yaml"] },
			{ "/w/package.json": PKG_VITEST },
		);
		const [runner] = await detectTestRunners("/w", false);
		expect(runner.command.startsWith("pnpm run test")).toBe(true);
	});

	it("ignores a package.json with no test framework at all", async () => {
		mountTree(
			{ "/w": ["package.json"] },
			{ "/w/package.json": JSON.stringify({ scripts: { build: "tsc" } }) },
		);
		expect(await detectTestRunners("/w", false)).toHaveLength(0);
	});

	it("prefers nextest when it is installed", async () => {
		mountTree({ "/w": ["Cargo.toml"] });
		const [runner] = await detectTestRunners("/w", true);
		expect(runner.id).toBe("nextest");
		expect(runner.command).toContain("cargo nextest run");
		expect(runner.command).toContain("libtest-json");
	});

	it("falls back to plain cargo test when nextest is missing", async () => {
		mountTree({ "/w": ["Cargo.toml"] });
		const [runner] = await detectTestRunners("/w", false);
		expect(runner.id).toBe("cargo");
		expect(runner.command).toBe("cargo test");
	});

	it("detects pytest and go from their markers", async () => {
		mountTree({ "/w": ["pyproject.toml", "go.mod"] });
		const ids = (await detectTestRunners("/w", false)).map(
			(runner) => runner.id,
		);
		expect(ids).toContain("pytest");
		expect(ids).toContain("go");
	});

	it("finds a second ecosystem in a nested directory", async () => {
		mountTree(
			{
				"/w": ["package.json", "src-tauri"],
				"/w/src-tauri": ["Cargo.toml"],
			},
			{ "/w/package.json": PKG_VITEST },
		);
		const runners = await detectTestRunners("/w", false);

		expect(runners.map((runner) => runner.id)).toEqual(["vitest", "cargo"]);
		expect(runners[1].subdir).toBe("src-tauri");
	});

	it("finds the JS package in a monorepo subdirectory with no fixed name", async () => {
		mountTree(
			{ "/w": ["frontend", "README.md"], "/w/frontend": ["package.json"] },
			{ "/w/frontend/package.json": PKG_VITEST },
		);
		const runners = await detectTestRunners("/w", false);

		expect(runners).toHaveLength(1);
		expect(runners[0].id).toBe("vitest");
		expect(runners[0].subdir).toBe("frontend");
	});

	it("does not descend into node_modules or other build/VCS directories", async () => {
		mountTree(
			{
				"/w": ["package.json", "node_modules", ".git", "dist"],
				"/w/node_modules": ["package.json"],
			},
			{
				"/w/package.json": PKG_VITEST,
				"/w/node_modules/package.json": PKG_VITEST,
			},
		);
		const runners = await detectTestRunners("/w", false);

		expect(runners).toHaveLength(1);
		expect(runners[0].subdir).toBe("");
	});

	it("returns nothing for a worktree with no test setup", async () => {
		mountTree({ "/w": ["README.md", "LICENSE"] });
		expect(await detectTestRunners("/w", false)).toEqual([]);
	});

	it("survives an unreadable directory and a malformed package.json", async () => {
		listDirNames.mockRejectedValue(new Error("permission denied"));
		readFile.mockResolvedValue(null);
		expect(await detectTestRunners("/w", false)).toEqual([]);

		mountTree({ "/w": ["package.json"] }, { "/w/package.json": "{ not json" });
		expect(await detectTestRunners("/w", false)).toEqual([]);
	});

	it("still offers vitest when the project has no test script", async () => {
		mountTree(
			{ "/w": ["package.json"] },
			{
				"/w/package.json": JSON.stringify({
					devDependencies: { vitest: "^4" },
				}),
			},
		);
		const [runner] = await detectTestRunners("/w", false);
		expect(runner.id).toBe("vitest");
		expect(runner.detectedFrom).toBe("package.json");
		expect(runner.command).toContain("vitest run");
	});
});
