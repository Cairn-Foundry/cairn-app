// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import type { TestCase, TestSuite } from "$lib/types/tests";
import {
	countVisible,
	filterSuites,
	highlightRanges,
	matchesFilter,
	matchesQuery,
	parseQuery,
	splitHighlight,
} from "./test-search";

function makeCase(overrides: Partial<TestCase> = {}): TestCase {
	const file = overrides.file ?? "totp.test.js";
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

function makeSuite(
	file: string,
	cases: TestCase[],
	error: string | null = null,
): TestSuite {
	return { file, status: "pass", durationMs: null, cases, error };
}

describe("parseQuery", () => {
	it("splits on whitespace and lowercases", () => {
		expect(parseQuery("  Totp   Window ")).toEqual(["totp", "window"]);
	});

	it("is empty for a blank query", () => {
		expect(parseQuery("   ")).toEqual([]);
	});
});

describe("matchesQuery", () => {
	const entry = makeCase({
		ancestors: ["verifyToken"],
		name: "rejects a token from the previous window",
	});

	it("matches nothing in particular when the query is empty", () => {
		expect(matchesQuery(entry, "totp.test.js", [])).toBe(true);
	});

	it("requires every term, in any order", () => {
		expect(matchesQuery(entry, "totp.test.js", ["previous", "verify"])).toBe(
			true,
		);
		expect(matchesQuery(entry, "totp.test.js", ["verify", "previous"])).toBe(
			true,
		);
		expect(matchesQuery(entry, "totp.test.js", ["previous", "absent"])).toBe(
			false,
		);
	});

	it("searches the describe trail, not just the test name", () => {
		expect(matchesQuery(entry, "totp.test.js", ["verifytoken"])).toBe(true);
	});

	it("searches the file name too", () => {
		expect(matchesQuery(entry, "cart.test.js", ["cart"])).toBe(true);
	});

	it("ignores case", () => {
		expect(matchesQuery(entry, "totp.test.js", ["REJECTS".toLowerCase()])).toBe(
			true,
		);
	});
});

describe("matchesFilter", () => {
	it("keeps everything on all", () => {
		expect(matchesFilter(makeCase({ status: "skip" }), "all")).toBe(true);
	});

	it("maps each filter to its status", () => {
		expect(matchesFilter(makeCase({ status: "fail" }), "failed")).toBe(true);
		expect(matchesFilter(makeCase({ status: "pass" }), "failed")).toBe(false);
		expect(matchesFilter(makeCase({ status: "pass" }), "passed")).toBe(true);
	});

	it("counts todo as skipped", () => {
		expect(matchesFilter(makeCase({ status: "todo" }), "skipped")).toBe(true);
		expect(matchesFilter(makeCase({ status: "skip" }), "skipped")).toBe(true);
	});
});

describe("highlightRanges", () => {
	it("finds every occurrence of a term", () => {
		expect(highlightRanges("token to token", ["token"])).toEqual([
			{ start: 0, end: 5 },
			{ start: 9, end: 14 },
		]);
	});

	it("merges overlapping matches from different terms", () => {
		// "tok" and "oken" overlap and must not produce two nested spans.
		expect(highlightRanges("token", ["tok", "oken"])).toEqual([
			{ start: 0, end: 5 },
		]);
	});

	it("returns nothing when a term is absent", () => {
		expect(highlightRanges("token", ["absent"])).toEqual([]);
		expect(highlightRanges("token", [])).toEqual([]);
	});
});

describe("splitHighlight", () => {
	it("cuts a label into matched and unmatched runs", () => {
		expect(splitHighlight("rejects a token", ["token"])).toEqual([
			{ text: "rejects a ", hit: false },
			{ text: "token", hit: true },
		]);
	});

	it("keeps the label whole when nothing matches", () => {
		expect(splitHighlight("rejects", ["absent"])).toEqual([
			{ text: "rejects", hit: false },
		]);
	});

	it("preserves the original casing of the label", () => {
		expect(splitHighlight("Token", ["token"])).toEqual([
			{ text: "Token", hit: true },
		]);
	});

	it("rebuilds the label exactly", () => {
		const label = "verifyToken rejects a token from the window";
		const parts = splitHighlight(label, ["token", "window"]);
		expect(parts.map((part) => part.text).join("")).toBe(label);
	});
});

describe("filterSuites", () => {
	const suites = [
		makeSuite("totp.test.js", [
			makeCase({
				file: "totp.test.js",
				name: "accepts a token",
				status: "pass",
			}),
			makeCase({
				file: "totp.test.js",
				name: "rejects an old token",
				status: "fail",
			}),
		]),
		makeSuite("cart.test.js", [
			makeCase({
				file: "cart.test.js",
				name: "sums the lines",
				status: "pass",
			}),
			makeCase({
				file: "cart.test.js",
				name: "rounds half up",
				status: "skip",
			}),
		]),
	];

	it("returns everything when nothing is asked", () => {
		expect(countVisible(filterSuites(suites, "", "all"))).toBe(4);
	});

	it("drops a suite whose cases all filtered out", () => {
		const result = filterSuites(suites, "", "failed");
		expect(result).toHaveLength(1);
		expect(result[0].file).toBe("totp.test.js");
		expect(countVisible(result)).toBe(1);
	});

	it("combines the query and the status filter", () => {
		expect(countVisible(filterSuites(suites, "token", "failed"))).toBe(1);
		expect(countVisible(filterSuites(suites, "token", "passed"))).toBe(1);
		expect(countVisible(filterSuites(suites, "sums", "failed"))).toBe(0);
	});

	it("keeps a whole suite when the file name matches", () => {
		const result = filterSuites(suites, "cart", "all");
		expect(result).toHaveLength(1);
		expect(countVisible(result)).toBe(2);
	});

	it("does not mutate the suites it was given", () => {
		filterSuites(suites, "token", "failed");
		expect(suites[0].cases).toHaveLength(2);
	});

	describe("a suite that failed to load", () => {
		const broken = [makeSuite("broken.test.js", [], "Cannot find module")];

		it("survives with no cases at all", () => {
			expect(filterSuites(broken, "", "all")).toHaveLength(1);
		});

		it("is kept by the failed filter, since it is a failure", () => {
			expect(filterSuites(broken, "", "failed")).toHaveLength(1);
		});

		it("is dropped by a filter it cannot satisfy", () => {
			expect(filterSuites(broken, "", "passed")).toHaveLength(0);
			expect(filterSuites(broken, "", "skipped")).toHaveLength(0);
		});

		it("is dropped when the query does not match its file", () => {
			expect(filterSuites(broken, "broken", "all")).toHaveLength(1);
			expect(filterSuites(broken, "totp", "all")).toHaveLength(0);
		});
	});
});
