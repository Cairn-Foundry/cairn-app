// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import type { TestCase } from "$lib/types/tests";
import { buildTestFixPrompt } from "./test-fix-prompt";

const failing: TestCase = {
	id: "src/auth/totp.test.ts::rejects old tokens",
	name: "rejects old tokens",
	ancestors: ["totp"],
	file: "src/auth/totp.test.ts",
	line: 51,
	status: "fail",
	durationMs: 4,
	failure: {
		message: "expected false to be true",
		expected: "true",
		received: "false",
		stack: [
			{ file: "src/auth/totp.test.ts", line: 51, column: 9, inProject: true },
			{
				file: "node_modules/vitest/dist/run.js",
				line: 12,
				column: 1,
				inProject: false,
			},
		],
		location: { file: "src/auth/totp.test.ts", line: 51, column: 9 },
	},
};

describe("buildTestFixPrompt", () => {
	it("states the test, its suite and its location", () => {
		const prompt = buildTestFixPrompt(failing, "vitest", "npx vitest run");
		expect(prompt).toContain("totp > rejects old tokens");
		expect(prompt).toContain("src/auth/totp.test.ts:51");
	});

	it("quotes expected, received and the failure message", () => {
		const prompt = buildTestFixPrompt(failing, "vitest", "npx vitest run");
		expect(prompt).toContain("Expected: true");
		expect(prompt).toContain("Received: false");
		expect(prompt).toContain("expected false to be true");
	});

	it("keeps project frames and drops the runner's own", () => {
		const prompt = buildTestFixPrompt(failing, "vitest", "npx vitest run");
		expect(prompt).toContain("at src/auth/totp.test.ts:51:9");
		expect(prompt).not.toContain("node_modules/vitest");
	});

	it("ends with the command that re-runs only this test", () => {
		const prompt = buildTestFixPrompt(failing, "vitest", "npx vitest run");
		expect(prompt).toContain("npx vitest run 'src/auth/totp.test.ts' -t");
	});

	it("survives a failure the runner described poorly", () => {
		const bare: TestCase = {
			...failing,
			line: null,
			failure: {
				message: "",
				expected: null,
				received: null,
				stack: [],
				location: null,
			},
		};
		const prompt = buildTestFixPrompt(bare, "cargo", "cargo test");
		expect(prompt).toContain("src/auth/totp.test.ts");
		expect(prompt).not.toContain("Expected:");
	});

	it("works with no failure detail at all", () => {
		const prompt = buildTestFixPrompt(
			{ ...failing, failure: null },
			"go",
			"go test ./...",
		);
		expect(prompt).toContain("rejects old tokens");
	});
});
