// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import type { TestCase, TestSuite } from "$lib/types/tests";
import { aggregateStatus, countCases, resolveRunStatus } from "./test-tree";

function makeCase(overrides: Partial<TestCase> = {}): TestCase {
	const file = overrides.file ?? "a.test.ts";
	const ancestors = overrides.ancestors ?? [];
	const name = overrides.name ?? "works";
	return {
		id: `${file}::${ancestors.join(">")}::${name}`,
		name,
		ancestors,
		file,
		line: null,
		status: "pass",
		durationMs: null,
		failure: null,
		...overrides,
	};
}

describe("aggregateStatus", () => {
	it("lets a single failure decide the suite", () => {
		expect(
			aggregateStatus([
				makeCase({ name: "a", status: "pass" }),
				makeCase({ name: "b", status: "fail" }),
				makeCase({ name: "c", status: "running" }),
			]),
		).toBe("fail");
	});

	it("stays running while a case has not answered", () => {
		expect(
			aggregateStatus([
				makeCase({ name: "a", status: "pass" }),
				makeCase({ name: "b", status: "running" }),
			]),
		).toBe("running");
	});

	it("is skipped only when every case was skipped", () => {
		expect(aggregateStatus([makeCase({ status: "skip" })])).toBe("skip");
		expect(
			aggregateStatus([
				makeCase({ name: "a", status: "skip" }),
				makeCase({ name: "b", status: "pass" }),
			]),
		).toBe("pass");
	});

	it("is pending when there is nothing yet", () => {
		expect(aggregateStatus([])).toBe("pending");
	});
});

describe("countCases", () => {
	it("counts every status across every suite", () => {
		const suites: TestSuite[] = [
			{
				file: "a.ts",
				status: "fail",
				durationMs: null,
				error: null,
				cases: [
					makeCase({ file: "a.ts", name: "1", status: "pass" }),
					makeCase({ file: "a.ts", name: "2", status: "fail" }),
				],
			},
			{
				file: "b.ts",
				status: "skip",
				durationMs: null,
				error: null,
				cases: [
					makeCase({ file: "b.ts", name: "3", status: "skip" }),
					makeCase({ file: "b.ts", name: "4", status: "todo" }),
				],
			},
		];

		expect(countCases(suites)).toEqual({
			pass: 1,
			fail: 1,
			skip: 1,
			todo: 1,
			total: 4,
		});
	});

	it("counts nothing for an empty tree", () => {
		expect(countCases([]).total).toBe(0);
	});
});

describe("resolveRunStatus", () => {
	const clean = { pass: 3, fail: 0, skip: 0, todo: 0, total: 3 };
	const broken = { pass: 2, fail: 1, skip: 0, todo: 0, total: 3 };

	it("reports a cancelled run whatever the tree says", () => {
		expect(resolveRunStatus(broken, null, true, 2)).toBe("cancelled");
	});

	it("lets a failing case outrank a zero exit code", () => {
		expect(resolveRunStatus(broken, 0, false, 2)).toBe("failed");
	});

	it("passes when nothing failed and the runner agreed", () => {
		expect(resolveRunStatus(clean, 0, false, 2)).toBe("passed");
	});

	it("is an error when the runner died before collecting anything", () => {
		expect(resolveRunStatus({ ...clean, pass: 0, total: 0 }, 1, false, 0)).toBe(
			"error",
		);
	});

	it("is a failure when the runner exited non-zero with a populated tree", () => {
		expect(resolveRunStatus(clean, 1, false, 2)).toBe("failed");
	});
});
