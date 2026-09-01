// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import type { ReviewHunk, ReviewState } from "$lib/types/review";
import { emptyReviewState } from "$lib/types/review";
import {
	guideProgress,
	hunkFor,
	isGuideStale,
	reconcileWithDiff,
	resolveGuide,
	reviewAsMarkdown,
} from "./review-guide";

const HUNKS: ReviewHunk[] = [
	{
		path: "src/a.ts",
		oldStart: 1,
		oldLines: 3,
		newStart: 1,
		newLines: 4,
		hunkHash: "aaa",
	},
	{
		path: "src/a.ts",
		oldStart: 40,
		oldLines: 2,
		newStart: 41,
		newLines: 2,
		hunkHash: "bbb",
	},
	{
		path: "src/b.ts",
		oldStart: 1,
		oldLines: 1,
		newStart: 1,
		newLines: 6,
		hunkHash: "ccc",
	},
];

function guideOf(chapters: unknown[]) {
	return resolveGuide(
		{ overview: "what it does", chapters },
		HUNKS,
		"base1",
		"head1",
		"2026-08-29T10:00:00Z",
	);
}

describe("hunkFor", () => {
	it("finds the hunk a line falls inside", () => {
		expect(hunkFor(HUNKS, "src/a.ts", "new", 2)?.hunkHash).toBe("aaa");
		expect(hunkFor(HUNKS, "src/a.ts", "new", 42)?.hunkHash).toBe("bbb");
	});

	it("takes the sides apart", () => {
		// Line 41 is inside the second hunk on the new side, outside it on the old.
		expect(hunkFor(HUNKS, "src/a.ts", "new", 41)?.hunkHash).toBe("bbb");
		expect(hunkFor(HUNKS, "src/a.ts", "old", 41)?.hunkHash).toBe("bbb");
		expect(hunkFor(HUNKS, "src/a.ts", "old", 42)).toBeNull();
	});

	it("returns nothing for a line in no hunk", () => {
		expect(hunkFor(HUNKS, "src/a.ts", "new", 20)).toBeNull();
		expect(hunkFor(HUNKS, "src/unknown.ts", "new", 1)).toBeNull();
	});
});

describe("resolveGuide", () => {
	it("attaches an excerpt to the hunk that contains it", () => {
		const guide = guideOf([
			{
				title: "The parser",
				summary: "it parses",
				excerpts: [{ path: "src/a.ts", side: "new", from: 2, to: 3 }],
				remarks: [],
			},
		]);
		expect(guide.chapters).toHaveLength(1);
		expect(guide.chapters[0].excerpts[0].hunkHash).toBe("aaa");
		expect(guide.chapters[0].id).toBe("c1");
		expect(guide.overview).toBe("what it does");
	});

	it("keeps an excerpt that starts in a hunk and runs past its end", () => {
		const guide = guideOf([
			{
				title: "Straddling",
				summary: "",
				excerpts: [{ path: "src/a.ts", side: "new", from: 3, to: 60 }],
				remarks: [],
			},
		]);
		expect(guide.chapters[0].excerpts[0].hunkHash).toBe("aaa");
		expect(guide.chapters[0].excerpts[0].to).toBe(60);
	});

	it("drops an excerpt pointing at a line the diff does not have", () => {
		const guide = guideOf([
			{
				title: "Invented",
				summary: "",
				excerpts: [
					{ path: "src/a.ts", side: "new", from: 999, to: 1000 },
					{ path: "src/b.ts", side: "new", from: 2, to: 2 },
				],
				remarks: [],
			},
		]);
		expect(guide.chapters[0].excerpts).toHaveLength(1);
		expect(guide.chapters[0].excerpts[0].hunkHash).toBe("ccc");
	});

	it("stretches an excerpt to reach a remark of the same hunk", () => {
		const guide = guideOf([
			{
				title: "Reachable",
				summary: "",
				excerpts: [{ path: "src/b.ts", side: "new", from: 1, to: 2 }],
				remarks: [
					{
						kind: "issue",
						path: "src/b.ts",
						side: "new",
						line: 5,
						title: "t",
						body: "b",
					},
				],
			},
		]);
		// The panel lists the remarks of the extract on screen, so a remark
		// outside every extract can never be read nor posted.
		const [excerpt] = guide.chapters[0].excerpts;
		expect(excerpt.to).toBe(5);
		expect(excerpt.hunkHash).toBe("ccc");
	});

	it("gives a remark of another hunk an excerpt of its own", () => {
		const guide = guideOf([
			{
				title: "Two hunks",
				summary: "",
				excerpts: [{ path: "src/a.ts", side: "new", from: 2, to: 3 }],
				remarks: [
					{
						kind: "note",
						path: "src/a.ts",
						side: "new",
						line: 42,
						title: "t",
						body: "b",
					},
				],
			},
		]);
		const excerpts = guide.chapters[0].excerpts;
		expect(excerpts).toHaveLength(2);
		// The first extract keeps its own hunk rather than reaching across into
		// a hash it does not cover.
		expect(excerpts[0]).toMatchObject({ from: 2, to: 3, hunkHash: "aaa" });
		expect(excerpts[1]).toMatchObject({ from: 42, to: 42, hunkHash: "bbb" });
	});

	it("keeps a chapter whose only anchor is a remark", () => {
		const guide = guideOf([
			{
				title: "Remark only",
				summary: "",
				excerpts: [{ path: "nowhere.ts", side: "new", from: 1, to: 2 }],
				remarks: [
					{
						kind: "issue",
						path: "src/b.ts",
						side: "new",
						line: 3,
						title: "t",
						body: "b",
					},
				],
			},
		]);
		expect(guide.chapters).toHaveLength(1);
		expect(guide.chapters[0].excerpts).toEqual([
			{ path: "src/b.ts", side: "new", from: 3, to: 3, hunkHash: "ccc" },
		]);
	});

	it("drops a chapter left with no excerpt at all", () => {
		const guide = guideOf([
			{
				title: "All invented",
				summary: "",
				excerpts: [{ path: "nowhere.ts", side: "new", from: 1, to: 2 }],
				remarks: [],
			},
		]);
		expect(guide.chapters).toHaveLength(0);
	});

	it("keeps a remark anchored in the diff and drops one that is not", () => {
		const guide = guideOf([
			{
				title: "Mixed",
				summary: "",
				excerpts: [{ path: "src/a.ts", side: "new", from: 2, to: 3 }],
				remarks: [
					{
						kind: "issue",
						path: "src/a.ts",
						side: "new",
						line: 3,
						title: "off by one",
						body: "the loop",
					},
					{
						kind: "note",
						path: "src/a.ts",
						side: "new",
						line: 900,
						title: "ghost",
						body: "",
					},
				],
			},
		]);
		expect(guide.chapters[0].remarks).toHaveLength(1);
		expect(guide.chapters[0].remarks[0].id).toBe("c1r1");
		expect(guide.chapters[0].remarks[0].kind).toBe("issue");
		expect(guide.chapters[0].remarks[0].status).toBe("open");
	});

	it("falls back to a note for a kind it does not know", () => {
		const guide = guideOf([
			{
				title: "Odd kind",
				summary: "",
				excerpts: [{ path: "src/a.ts", side: "new", from: 2, to: 2 }],
				remarks: [
					{
						kind: "catastrophe",
						path: "src/a.ts",
						side: "new",
						line: 2,
						title: "hm",
						body: "",
					},
				],
			},
		]);
		expect(guide.chapters[0].remarks[0].kind).toBe("note");
	});

	it("survives an answer that is not shaped like a guide at all", () => {
		const guide = resolveGuide({}, HUNKS, "base1", "head1", "now");
		expect(guide.chapters).toEqual([]);
		expect(guide.overview).toBe("");
		expect(
			resolveGuide({ chapters: "nope" }, HUNKS, "b", "h", "now").chapters,
		).toEqual([]);
	});
});

describe("reconcileWithDiff", () => {
	function stateWithGuide(): ReviewState {
		return {
			...emptyReviewState(),
			seenHunks: ["aaa", "bbb", "ccc"],
			guide: guideOf([
				{
					title: "One",
					summary: "",
					excerpts: [{ path: "src/a.ts", side: "new", from: 2, to: 2 }],
					remarks: [],
				},
				{
					title: "Two",
					summary: "",
					excerpts: [{ path: "src/b.ts", side: "new", from: 2, to: 2 }],
					remarks: [],
				},
			]),
		};
	}

	/** The same state with every chapter already read. */
	function allSeen(): ReviewState {
		const state = stateWithGuide();
		const guide = state.guide;
		if (!guide) throw new Error("the fixture must carry a guide");
		return {
			...state,
			guide: {
				...guide,
				chapters: guide.chapters.map((c) => ({ ...c, isSeen: true })),
			},
		};
	}

	it("forgets a hunk that is no longer in the diff", () => {
		const state = allSeen();
		// The author rewrote the first hunk: it comes back under a new hash.
		const moved: ReviewHunk[] = [
			{ ...HUNKS[0], hunkHash: "zzz" },
			HUNKS[1],
			HUNKS[2],
		];
		const next = reconcileWithDiff(state, moved);
		expect(next.seenHunks).toEqual(["bbb", "ccc"]);
	});

	it("un-reads the chapter whose hunk changed and leaves the others alone", () => {
		const state = allSeen();
		const moved: ReviewHunk[] = [
			{ ...HUNKS[0], hunkHash: "zzz" },
			HUNKS[1],
			HUNKS[2],
		];
		const next = reconcileWithDiff(state, moved);
		expect(next.guide?.chapters[0].isSeen).toBe(false);
		expect(next.guide?.chapters[1].isSeen).toBe(true);
	});

	it("leaves an untouched branch exactly as it was", () => {
		const state = allSeen();
		const next = reconcileWithDiff(state, HUNKS);
		expect(next.seenHunks).toEqual(["aaa", "bbb", "ccc"]);
		expect(next.guide?.chapters.every((chapter) => chapter.isSeen)).toBe(true);
	});

	it("copes with a state that has no guide", () => {
		const next = reconcileWithDiff(
			{ ...emptyReviewState(), seenHunks: ["gone"] },
			HUNKS,
		);
		expect(next.guide).toBeNull();
		expect(next.seenHunks).toEqual([]);
	});
});

describe("guideProgress", () => {
	const guide = guideOf([
		{
			title: "One",
			summary: "",
			excerpts: [
				{ path: "src/a.ts", side: "new", from: 2, to: 2 },
				{ path: "src/a.ts", side: "new", from: 41, to: 41 },
			],
			remarks: [],
		},
		{
			title: "Two",
			summary: "",
			excerpts: [{ path: "src/b.ts", side: "new", from: 2, to: 2 }],
			remarks: [],
		},
	]);

	it("counts nothing read as zero", () => {
		const progress = guideProgress({ ...emptyReviewState(), guide }, HUNKS);
		expect(progress).toMatchObject({
			seenHunks: 0,
			totalHunks: 3,
			seenChapters: 0,
			totalChapters: 2,
			ratio: 0,
		});
	});

	it("counts the hunks read, not the chapters", () => {
		const progress = guideProgress(
			{ ...emptyReviewState(), guide, seenHunks: ["aaa", "bbb"] },
			HUNKS,
		);
		expect(progress.seenHunks).toBe(2);
		expect(progress.ratio).toBeCloseTo(2 / 3);
	});

	it("ignores a seen hunk no chapter covers", () => {
		const progress = guideProgress(
			{ ...emptyReviewState(), guide, seenHunks: ["aaa", "unrelated"] },
			HUNKS,
		);
		expect(progress.seenHunks).toBe(1);
	});

	it("has no ratio to report without a guide", () => {
		expect(guideProgress(emptyReviewState(), HUNKS)).toMatchObject({
			totalHunks: 0,
			ratio: 0,
		});
	});
});

describe("isGuideStale", () => {
	const guide = guideOf([]);

	it("is stale once the branch moved", () => {
		expect(isGuideStale(guide, "head2")).toBe(true);
	});

	it("is fresh on the head it was generated for", () => {
		expect(isGuideStale(guide, "head1")).toBe(false);
	});

	it("says nothing without a guide or without a head", () => {
		expect(isGuideStale(null, "head2")).toBe(false);
		expect(isGuideStale(guide, "")).toBe(false);
	});
});

describe("reviewAsMarkdown", () => {
	it("renders the body, the verdict and every comment", () => {
		const state: ReviewState = {
			...emptyReviewState(),
			comments: [
				{
					id: "1",
					path: "src/a.ts",
					side: "new",
					line: 2,
					body: "rename this",
					createdAt: "now",
				},
			],
		};
		const markdown = reviewAsMarkdown(state, "changes", "Looks good overall.");
		expect(markdown).toContain("Looks good overall.");
		expect(markdown).toContain("Verdict: changes");
		expect(markdown).toContain("### src/a.ts:2");
		expect(markdown).toContain("rename this");
	});
});
