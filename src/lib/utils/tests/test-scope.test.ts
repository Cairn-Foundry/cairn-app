import { describe, expect, it } from "vitest";
import { type RunScope, scopedCommand, supportsFileScope } from "./test-scope";

const ALL: RunScope = { kind: "all" };
const FILE: RunScope = { kind: "file", file: "src/totp.test.js" };
const CASE: RunScope = {
	kind: "case",
	file: "src/totp.test.js",
	name: "rejects an old token",
};

describe("scopedCommand", () => {
	it("leaves a whole-worktree run untouched", () => {
		expect(scopedCommand("npm run test", "vitest", ALL)).toBe("npm run test");
	});

	it("appends the file path for vitest and jest", () => {
		expect(scopedCommand("npm run test", "vitest", FILE)).toBe(
			"npm run test 'src/totp.test.js'",
		);
		expect(scopedCommand("npx jest", "jest", FILE)).toBe(
			"npx jest 'src/totp.test.js'",
		);
	});

	it("adds the name filter for a single case", () => {
		expect(scopedCommand("npm run test", "vitest", CASE)).toBe(
			"npm run test 'src/totp.test.js' -t 'rejects an old token'",
		);
	});

	it("escapes regex characters in a test name", () => {
		const scope: RunScope = {
			kind: "case",
			file: "a.test.js",
			name: "handles a.b (c)",
		};
		expect(scopedCommand("vitest run", "vitest", scope)).toContain(
			"-t 'handles a\\.b \\(c\\)'",
		);
	});

	it("escapes a single quote in a name so the shell keeps it whole", () => {
		const scope: RunScope = {
			kind: "case",
			file: "a.test.js",
			name: "it's fine",
		};
		// The name must not terminate the quoted string early.
		expect(scopedCommand("vitest run", "vitest", scope)).toContain(
			`-t 'it'\\''s fine'`,
		);
	});

	it("uses double quotes on Windows, where cmd ignores single ones", () => {
		expect(scopedCommand("npm run test", "vitest", FILE, true)).toBe(
			'npm run test "src/totp.test.js"',
		);
	});

	it("uses -k for pytest", () => {
		expect(scopedCommand("pytest -v", "pytest", CASE)).toBe(
			"pytest -v 'src/totp.test.js' -k 'rejects an old token'",
		);
	});

	it("anchors the go -run regex on the whole name", () => {
		expect(scopedCommand("go test ./...", "go", CASE)).toBe(
			"go test ./... -run '^rejects an old token$'",
		);
	});

	it("filters cargo by substring, since it has no path filter", () => {
		expect(scopedCommand("cargo test", "cargo", CASE)).toBe(
			"cargo test 'rejects an old token'",
		);
		// A file scope means nothing to cargo: the command stays whole.
		expect(scopedCommand("cargo test", "cargo", FILE)).toBe("cargo test");
	});

	it("leaves go alone for a file scope", () => {
		expect(scopedCommand("go test ./...", "go", FILE)).toBe("go test ./...");
	});
});

describe("supportsFileScope", () => {
	it("is true only for the runners that take a path filter", () => {
		expect(supportsFileScope("vitest")).toBe(true);
		expect(supportsFileScope("jest")).toBe(true);
		expect(supportsFileScope("pytest")).toBe(true);
		expect(supportsFileScope("cargo")).toBe(false);
		expect(supportsFileScope("nextest")).toBe(false);
		expect(supportsFileScope("go")).toBe(false);
	});
});
