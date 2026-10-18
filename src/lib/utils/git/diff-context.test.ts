// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import type { GitDiffHunk } from "$lib/services/git-service";
import {
	buildDiffRows,
	diffGaps,
	expandGap,
	parseHunkRange,
	splitFileLines,
} from "./diff-context";

const file = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);

const hunks: GitDiffHunk[] = [
	{
		header: "@@ -30,3 +30,4 @@ fn a()",
		lines: [
			{ kind: "context", content: "line 30" },
			{ kind: "add", content: "new" },
			{ kind: "context", content: "line 31" },
			{ kind: "context", content: "line 32" },
		],
	},
	{
		header: "@@ -60,3 +61,2 @@ fn b()",
		lines: [
			{ kind: "context", content: "line 61" },
			{ kind: "remove", content: "gone" },
			{ kind: "context", content: "line 62" },
		],
	},
] as GitDiffHunk[];

describe("parseHunkRange", () => {
	it("reads both sides, an empty side starting after its line", () => {
		expect(parseHunkRange("@@ -5,0 +6,2 @@")).toEqual({
			oldFirst: 6,
			oldLast: 5,
			newFirst: 6,
			newLast: 7,
		});
		expect(parseHunkRange("@@ -3 +3 @@")).toEqual({
			oldFirst: 3,
			oldLast: 3,
			newFirst: 3,
			newLast: 3,
		});
	});

	it("rejects a combined diff header", () => {
		expect(parseHunkRange("@@@ -1,2 -1,2 +1,3 @@@")).toBeNull();
	});
});

describe("diffGaps", () => {
	it("bounds the gaps in new-side lines with the old-side offset", () => {
		expect(diffGaps(hunks, null)).toEqual([
			{ start: 1, end: 29, delta: 0 },
			{ start: 34, end: 60, delta: -1 },
			{ start: 63, end: null, delta: 0 },
		]);
		expect(diffGaps(hunks, 100)?.[2].end).toBe(100);
	});

	it("has nothing to reveal around a whole new or deleted file", () => {
		const added = [{ header: "@@ -0,0 +1,3 @@", lines: [] }] as GitDiffHunk[];
		const deleted = [{ header: "@@ -1,3 +0,0 @@", lines: [] }] as GitDiffHunk[];
		expect(diffGaps(added, 3)).toBeNull();
		expect(diffGaps(deleted, null)).toBeNull();
	});
});

describe("buildDiffRows", () => {
	it("separates hunks by their header without gaps", () => {
		const { rows, total } = buildDiffRows(hunks, null, [], null, 300);
		expect(rows.map((r) => r.kind)).toEqual([
			"context",
			"add",
			"context",
			"context",
			"sep",
			"context",
			"remove",
			"context",
		]);
		expect(total).toBe(8);
	});

	it("puts an expander on every gap still hiding lines", () => {
		const gaps = diffGaps(hunks, null);
		const { rows } = buildDiffRows(hunks, gaps, [], null, 300);
		const expanders = rows.filter((r) => r.kind === "gap");
		expect(expanders).toEqual([
			{
				kind: "gap",
				gap: 0,
				header: "@@ -30,3 +30,4 @@ fn a()",
				up: true,
				down: false,
				remaining: 29,
			},
			{
				kind: "gap",
				gap: 1,
				header: "@@ -60,3 +61,2 @@ fn b()",
				up: true,
				down: true,
				remaining: 27,
			},
			{
				kind: "gap",
				gap: 2,
				header: "",
				up: false,
				down: true,
				remaining: null,
			},
		]);
	});

	it("reveals lines on both sides of a gap with matching numbers", () => {
		const gaps = diffGaps(hunks, file.length);
		if (!gaps) throw new Error("gaps");
		let exp = expandGap([], gaps, 1, "down", 2);
		exp = expandGap(exp, gaps, 1, "up", 1);
		const { rows } = buildDiffRows(hunks, gaps, exp, file, 300);
		const i = rows.findIndex((r) => r.kind === "gap" && r.gap === 1);
		expect(rows.slice(i - 2, i + 2)).toEqual([
			{ kind: "context", oldNo: 33, newNo: 34, content: "line 34" },
			{ kind: "context", oldNo: 34, newNo: 35, content: "line 35" },
			{
				kind: "gap",
				gap: 1,
				header: "@@ -60,3 +61,2 @@ fn b()",
				up: true,
				down: true,
				remaining: 24,
			},
			{ kind: "context", oldNo: 59, newNo: 60, content: "line 60" },
		]);
	});

	it("drops the expander once a gap is fully revealed", () => {
		const gaps = diffGaps(hunks, file.length);
		if (!gaps) throw new Error("gaps");
		const exp = expandGap([], gaps, 1, "all");
		const { rows } = buildDiffRows(hunks, gaps, exp, file, 300);
		expect(rows.some((r) => r.kind === "gap" && r.gap === 1)).toBe(false);
		expect(rows.filter((r) => r.kind === "context")).toHaveLength(5 + 27);
	});

	it("stops building past the limit but still counts every row", () => {
		const gaps = diffGaps(hunks, file.length);
		const { rows, total } = buildDiffRows(hunks, gaps, [], file, 3);
		expect(rows).toHaveLength(3);
		expect(total).toBe(7 + 3);
	});
});

describe("splitFileLines", () => {
	it("drops the empty line after a final newline and strips carriage returns", () => {
		expect(splitFileLines("a\r\nb\n")).toEqual(["a", "b"]);
		expect(splitFileLines("a\nb")).toEqual(["a", "b"]);
	});
});
