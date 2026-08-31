// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewHunk } from "$lib/types/review";

const getDiffHunks = vi.fn<(...a: unknown[]) => unknown>();
const getDiffUnified = vi.fn<(...a: unknown[]) => unknown>();
const loadReviewState = vi.fn<(...a: unknown[]) => unknown>();
const saveReviewState = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/services/review-service", () => ({
	getDiffHunks: (...a: unknown[]) => getDiffHunks(...a),
	getDiffUnified: (...a: unknown[]) => getDiffUnified(...a),
	loadReviewState: (...a: unknown[]) => loadReviewState(...a),
	saveReviewState: (...a: unknown[]) => saveReviewState(...a),
}));

const runOneshot = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/services/oneshot-service", () => ({
	runOneshot: (...a: unknown[]) => runOneshot(...a),
	stopOneshot: vi.fn().mockResolvedValue(undefined),
}));

const forgeSubmitReview = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/services/integration-service", () => ({
	forgeSubmitReview: (...a: unknown[]) => forgeSubmitReview(...a),
}));

const {
	addComment,
	deleteComment,
	dismissRemark,
	generateGuide,
	markChapterSeen,
	markHunkSeen,
	openReview,
	pendingComments,
	progressFor,
	publishReview,
	setCurrentPosition,
	setMergeRequestId,
	stateFor,
} = await import("./review");

const scope = { projectId: "p1", instanceId: "i1", worktreePath: "/wt" };

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
		path: "src/b.ts",
		oldStart: 1,
		oldLines: 1,
		newStart: 1,
		newLines: 6,
		hunkHash: "bbb",
	},
];

/** What the model answers: paths and lines, no ids and no hashes. */
const ANSWER = {
	overview: "It adds login.",
	chapters: [
		{
			title: "The form",
			summary: "A form appears.",
			excerpts: [{ path: "src/a.ts", side: "new", from: 2, to: 3 }],
			remarks: [
				{
					kind: "issue",
					path: "src/a.ts",
					side: "new",
					line: 2,
					title: "Unvalidated input",
					body: "It goes straight to the API.",
				},
			],
		},
		{
			title: "The route",
			summary: "A route serves it.",
			excerpts: [{ path: "src/b.ts", side: "new", from: 2, to: 4 }],
			remarks: [],
		},
	],
};

async function generate() {
	getDiffUnified.mockResolvedValue({ text: "diff", truncated: false });
	getDiffHunks.mockResolvedValue(HUNKS);
	runOneshot.mockResolvedValue(ANSWER);
	await generateGuide(scope, {
		base: "main",
		head: "feature",
		baseSha: "base1",
		headSha: "head1",
	});
}

beforeEach(async () => {
	vi.clearAllMocks();
	loadReviewState.mockResolvedValue(null);
	getDiffHunks.mockResolvedValue(HUNKS);
	// Each test starts from a clean slate for this instance.
	await openReview(scope, "main", "feature");
});

describe("openReview", () => {
	it("starts empty for an instance never reviewed", () => {
		const state = stateFor(scope);
		expect(state.guide).toBeNull();
		expect(state.comments).toEqual([]);
		expect(state.seenHunks).toEqual([]);
	});

	it("drops the hunks the branch no longer has", async () => {
		loadReviewState.mockResolvedValue({
			guide: null,
			seenHunks: ["aaa", "gone"],
			comments: [],
			currentChapterId: "",
			currentExcerptIndex: 0,
			isDiffMode: false,
		});
		await openReview(scope, "main", "feature");
		expect(stateFor(scope).seenHunks).toEqual(["aaa"]);
	});

	it("keeps the stored state when the diff cannot be read", async () => {
		loadReviewState.mockResolvedValue({
			guide: null,
			seenHunks: ["aaa"],
			comments: [],
			currentChapterId: "",
			currentExcerptIndex: 0,
			isDiffMode: true,
		});
		getDiffHunks.mockRejectedValue(new Error("not a git repository"));
		await openReview(scope, "main", "feature");
		expect(stateFor(scope).seenHunks).toEqual(["aaa"]);
		expect(stateFor(scope).isDiffMode).toBe(true);
	});

	it("survives a backend that answers with nothing", async () => {
		getDiffHunks.mockResolvedValue(undefined);
		await expect(openReview(scope, "main", "feature")).resolves.toBeUndefined();
	});
});

describe("generateGuide", () => {
	it("attaches what the model answered to the real hunks", async () => {
		await generate();
		const guide = stateFor(scope).guide;
		expect(guide?.overview).toBe("It adds login.");
		expect(guide?.chapters).toHaveLength(2);
		expect(guide?.chapters[0].excerpts[0].hunkHash).toBe("aaa");
		expect(guide?.chapters[0].remarks[0].kind).toBe("issue");
		expect(guide?.headSha).toBe("head1");
	});

	/**
	 * The overview explains the branch before its code means anything, and an
	 * empty `currentChapterId` is what the view reads as "not started".
	 */
	it("opens the guide on its overview, not on the first chapter", async () => {
		await generate();
		expect(stateFor(scope).currentChapterId).toBe("");
		expect(stateFor(scope).currentExcerptIndex).toBe(0);
	});

	/** Regenerating from deep inside an old guide comes back to the overview. */
	it("returns to the overview when a guide is regenerated", async () => {
		await generate();
		setCurrentPosition(scope, "c2", 0);
		expect(stateFor(scope).currentChapterId).toBe("c2");
		await generate();
		expect(stateFor(scope).currentChapterId).toBe("");
	});

	// Reading state is keyed on hunk hashes, so what did not change stays read.
	it("keeps what was read across an ordinary regeneration", async () => {
		await generate();
		markChapterSeen(scope, "c1");
		expect(stateFor(scope).seenHunks).not.toHaveLength(0);
		await generate();
		expect(stateFor(scope).seenHunks).toContain("aaa");
	});

	it("forgets it when the regeneration asks for a clean slate", async () => {
		await generate();
		markChapterSeen(scope, "c1");
		getDiffUnified.mockResolvedValue({ text: "diff", truncated: false });
		getDiffHunks.mockResolvedValue(HUNKS);
		runOneshot.mockResolvedValue(ANSWER);
		await generateGuide(scope, {
			base: "main",
			head: "feature",
			baseSha: "base1",
			headSha: "head1",
			resetProgress: true,
		});
		expect(stateFor(scope).seenHunks).toEqual([]);
		expect(stateFor(scope).guide?.chapters[0].isSeen).toBe(false);
	});

	it("reports a failure without wiping what was there", async () => {
		await generate();
		getDiffUnified.mockRejectedValue(new Error("boom"));
		await generateGuide(scope, {
			base: "main",
			head: "feature",
			baseSha: "b",
			headSha: "h",
		});
		expect(stateFor(scope).guide?.overview).toBe("It adds login.");
	});
});

describe("marking what was read", () => {
	beforeEach(generate);

	it("marks every hunk a chapter covers when the chapter is read", () => {
		markChapterSeen(scope, "c1");
		expect(stateFor(scope).seenHunks).toContain("aaa");
		expect(stateFor(scope).guide?.chapters[0].isSeen).toBe(true);
		expect(stateFor(scope).guide?.chapters[1].isSeen).toBe(false);
	});

	it("un-marks them again when the chapter is set back to unread", () => {
		markChapterSeen(scope, "c1");
		markChapterSeen(scope, "c1", false);
		expect(stateFor(scope).seenHunks).not.toContain("aaa");
		expect(stateFor(scope).guide?.chapters[0].isSeen).toBe(false);
	});

	it("reads a chapter as soon as its last hunk is read", () => {
		markHunkSeen(scope, "aaa");
		expect(stateFor(scope).guide?.chapters[0].isSeen).toBe(true);
		expect(stateFor(scope).guide?.chapters[1].isSeen).toBe(false);
	});

	it("counts the reading in hunks", () => {
		expect(progressFor(scope)).toMatchObject({ seenHunks: 0, totalHunks: 2 });
		markHunkSeen(scope, "aaa");
		expect(progressFor(scope)).toMatchObject({ seenHunks: 1, totalHunks: 2 });
	});
});

describe("comments", () => {
	beforeEach(generate);

	it("marks the remark it was written from as commented", () => {
		const id = addComment(scope, {
			path: "src/a.ts",
			side: "new",
			line: 2,
			body: "Validate it.",
			remarkId: "c1r1",
		});
		const remark = stateFor(scope).guide?.chapters[0].remarks[0];
		expect(remark?.status).toBe("commented");
		expect(remark?.commentId).toBe(id);
	});

	it("hands the remark back when its comment is deleted", () => {
		const id = addComment(scope, {
			path: "src/a.ts",
			side: "new",
			line: 2,
			body: "Validate it.",
			remarkId: "c1r1",
		});
		deleteComment(scope, id);
		const remark = stateFor(scope).guide?.chapters[0].remarks[0];
		expect(remark?.status).toBe("open");
		expect(remark?.commentId).toBeUndefined();
		expect(stateFor(scope).comments).toHaveLength(0);
	});

	it("leaves a dismissed remark dismissed until it is reopened", () => {
		dismissRemark(scope, "c1r1");
		expect(stateFor(scope).guide?.chapters[0].remarks[0].status).toBe(
			"dismissed",
		);
		dismissRemark(scope, "c1r1");
		expect(stateFor(scope).guide?.chapters[0].remarks[0].status).toBe("open");
	});
});

describe("publishReview", () => {
	beforeEach(async () => {
		await generate();
		setMergeRequestId(scope, "mr1");
	});

	it("refuses to submit with no merge request to submit to", async () => {
		setMergeRequestId(scope, "");
		await expect(publishReview(scope, "comment", "hi")).rejects.toThrow();
	});

	it("marks what the forge accepted", async () => {
		const id = addComment(scope, {
			path: "src/a.ts",
			side: "new",
			line: 2,
			body: "Validate it.",
		});
		forgeSubmitReview.mockResolvedValue({
			published: { [id]: "forge-1" },
			failed: [],
		});
		const result = await publishReview(scope, "approve", "Looks good.");
		expect(result).toEqual({ published: 1, failed: 0 });
		expect(stateFor(scope).comments[0].publishedAs).toBe("forge-1");
		expect(pendingComments(scope)).toHaveLength(0);
	});

	it("never sends a comment the forge already has", async () => {
		const first = addComment(scope, {
			path: "src/a.ts",
			side: "new",
			line: 2,
			body: "one",
		});
		const second = addComment(scope, {
			path: "src/b.ts",
			side: "new",
			line: 2,
			body: "two",
		});
		forgeSubmitReview.mockResolvedValue({
			published: { [first]: "forge-1" },
			failed: [{ id: second, message: "rejected" }],
		});
		await publishReview(scope, "comment", "");

		forgeSubmitReview.mockClear().mockResolvedValue({
			published: { [second]: "forge-2" },
			failed: [],
		});
		await publishReview(scope, "comment", "");
		// The retry carries only the one that failed the first time.
		const sent = forgeSubmitReview.mock.calls[0][2] as { id: string }[];
		expect(sent).toHaveLength(1);
		expect(sent[0].id).toBe(second);
	});

	it("reports a submission that only half landed", async () => {
		const id = addComment(scope, {
			path: "src/a.ts",
			side: "new",
			line: 2,
			body: "one",
		});
		forgeSubmitReview.mockResolvedValue({
			published: {},
			failed: [{ id, message: "rejected" }],
		});
		expect(await publishReview(scope, "comment", "")).toEqual({
			published: 0,
			failed: 1,
		});
	});
});
