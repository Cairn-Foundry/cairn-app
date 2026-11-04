// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import type { Discussion } from "#lib/types/integrations";
import {
	diffMarkersFor,
	excerptAround,
	guideMarkersFor,
	normalizeAnchorPath,
	openDiscussionCount,
} from "./diff-markers";

function discussion(
	id: string,
	anchor: Discussion["anchor"],
	resolved = false,
): Discussion {
	return { id, resolved, resolvable: true, anchor, comments: [] };
}

const anchor = (path: string, line: number, side: "old" | "new" = "new") => ({
	path,
	line,
	side,
	sha: "abc",
});

describe("normalizeAnchorPath", () => {
	it("uses forward slashes and drops a leading ./", () => {
		expect(normalizeAnchorPath("src\\lib\\a.ts")).toBe("src/lib/a.ts");
		expect(normalizeAnchorPath("./src/a.ts")).toBe("src/a.ts");
	});
});

describe("openDiscussionCount", () => {
	it("counts unresolved anchored discussions of the file only", () => {
		const list = [
			discussion("1", anchor("src/a.ts", 3)),
			discussion("2", anchor("src/a.ts", 5), true),
			discussion("3", anchor("src/b.ts", 1)),
			discussion("4", null),
		];
		expect(openDiscussionCount(list, "src/a.ts")).toBe(1);
		expect(openDiscussionCount(list, "src/c.ts")).toBe(0);
	});
});

describe("diffMarkersFor", () => {
	it("merges threads on the same line and side", () => {
		const list = [
			discussion("1", anchor("a.ts", 3)),
			discussion("2", anchor("a.ts", 3), true),
			discussion("3", anchor("a.ts", 3, "old")),
		];
		const markers = diffMarkersFor(list, "a.ts");
		expect(markers).toHaveLength(2);
		const newSide = markers.find((m) => m.side === "new");
		expect(newSide).toEqual({
			kind: "discussion",
			line: 3,
			side: "new",
			count: 2,
			isResolved: false,
		});
	});

	it("marks a line resolved only when every thread is", () => {
		const list = [
			discussion("1", anchor("a.ts", 3), true),
			discussion("2", anchor("a.ts", 3), true),
		];
		expect(diffMarkersFor(list, "a.ts")[0].isResolved).toBe(true);
	});
});

describe("excerptAround", () => {
	it("keeps a window of numbered lines clamped to the document", () => {
		const content = ["a", "b", "c", "d", "e"].join("\n");
		expect(excerptAround(content, 1, 1)).toBe("1: a\n2: b");
		expect(excerptAround(content, 5, 1)).toBe("4: d\n5: e");
		expect(excerptAround(content, 3, 1)).toBe("2: b\n3: c\n4: d");
	});
});

describe("guideMarkersFor", () => {
	const remark = (
		line: number,
		overrides: Partial<Parameters<typeof guideMarkersFor>[0][number]> = {},
	) => ({
		path: "a.ts",
		side: "new" as const,
		line,
		kind: "issue" as const,
		status: "open",
		...overrides,
	});
	const comment = (line: number, path = "a.ts") => ({
		path,
		side: "new" as const,
		line,
	});

	it("turns a remark into a marker of its kind", () => {
		expect(guideMarkersFor([remark(4)], [], "a.ts", [])).toEqual([
			{ line: 4, side: "new", count: 1, isResolved: false, kind: "issue" },
		]);
	});

	it("ignores the comments of other files", () => {
		expect(
			guideMarkersFor(
				[],
				[comment(2, "b.ts"), comment(3, "./a.ts")],
				"a.ts",
				[],
			),
		).toEqual([
			{ line: 3, side: "new", count: 1, isResolved: false, kind: "comment" },
		]);
	});

	it("ignores dismissed remarks and the remarks of other files", () => {
		expect(
			guideMarkersFor(
				[remark(4, { status: "dismissed" }), remark(5, { path: "b.ts" })],
				[],
				"a.ts",
				[],
			),
		).toEqual([]);
	});

	it("counts two remarks of the same kind on one line once more", () => {
		const markers = guideMarkersFor([remark(4), remark(4)], [], "a.ts", []);
		expect(markers).toEqual([
			{ line: 4, side: "new", count: 2, isResolved: false, kind: "issue" },
		]);
	});

	it("keeps the first kind when another lands on the same line", () => {
		const markers = guideMarkersFor(
			[remark(4, { kind: "question" })],
			[comment(4)],
			"a.ts",
			[],
		);
		expect(markers).toEqual([
			{ line: 4, side: "new", count: 1, isResolved: false, kind: "comment" },
		]);
	});

	it("leaves a line already carrying a discussion to it", () => {
		const taken = [
			{
				line: 4,
				side: "new" as const,
				count: 1,
				isResolved: false,
				kind: "discussion" as const,
			},
		];
		expect(
			guideMarkersFor([remark(4), remark(6)], [comment(4)], "a.ts", taken),
		).toEqual([
			{ line: 6, side: "new", count: 1, isResolved: false, kind: "issue" },
		]);
	});
});
