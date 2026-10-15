// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewHunk } from "$lib/types/review";
import { emptyReviewState } from "$lib/types/review";

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
const stopOneshot = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/services/oneshot-service", () => ({
	runOneshot: (...a: unknown[]) => runOneshot(...a),
	stopOneshot: (...a: unknown[]) => stopOneshot(...a),
}));

const forgeSubmitReview = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/services/integration-service", () => ({
	forgeSubmitReview: (...a: unknown[]) => forgeSubmitReview(...a),
}));

const {
	addComment,
	cancelCommentDraft,
	cancelGuide,
	commentDrafting,
	deleteComment,
	dismissRemark,
	draftCommentFor,
	editComment,
	findRemark,
	generateGuide,
	guideGenerating,
	hunksFor,
	loadReview,
	markPublished,
	markChapterSeen,
	markHunkSeen,
	openReview,
	pendingComments,
	progressFor,
	publishReview,
	requestReviewAction,
	reviewAction,
	reviewErrors,
	reviewHunks,
	reviewMarkdown,
	reviewStates,
	setCurrentPosition,
	setDiffMode,
	setDiscussionFilter,
	setDiscussionsOpen,
	setMergeRequestId,
	setSelectedPath,
	stateFor,
} = await import("./review");
const { runProjectTeardowns } = await import("./project-teardown");

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
	stopOneshot.mockResolvedValue(undefined);
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
	 * The diff is in the prompt, so the run needs no tools and no MCP server -
	 * but the remarks it raises are judged against the conventions the
	 * repository writes down, which is why its CLAUDE.md stays.
	 */
	it("asks for the run that keeps the project's own rules", async () => {
		await generate();
		expect(runOneshot.mock.calls[0][8]).toBe("conventions");
	});

	/**
	 * A guide template rewritten on the Features page can ask the model to read
	 * the files around the diff; this call site never goes through
	 * `resolveAiFeature`, so it has to answer for itself.
	 */
	it("runs the full session when the guide template was rewritten", async () => {
		runOneshot.mockClear();
		await generateGuide(scope, {
			base: "main",
			head: "feature",
			baseSha: "base1",
			headSha: "head1",
			assignments: {
				reviewGuide: {
					providerId: "",
					model: "",
					promptTemplate: "Read the files around the diff.",
				},
			},
		});
		expect(runOneshot.mock.calls[0][8]).toBe("repository");
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

describe("draftCommentFor", () => {
	const remark = {
		id: "r1",
		kind: "issue" as const,
		title: "Null check",
		body: "It can be null.",
		path: "a.ts",
		line: 3,
		side: "new" as const,
		status: "open" as const,
	};

	it("runs the full session when the comment template was rewritten", async () => {
		runOneshot.mockResolvedValue({ comment: "Please guard this." });
		await draftCommentFor(scope, remark, "const a = b.c;", {
			assignments: {
				reviewComment: {
					providerId: "",
					model: "",
					promptTemplate: "Open the file and read around it.",
				},
			},
		});
		expect(runOneshot.mock.calls[0][8]).toBe("repository");
	});

	/** Path, line, excerpt and remark are all in the prompt already. */
	it("asks for a run with nothing of the project", async () => {
		runOneshot.mockResolvedValue({ comment: "Please guard this." });
		const comment = await draftCommentFor(scope, remark, "const a = b.c;");
		expect(comment).toBe("Please guard this.");
		expect(runOneshot.mock.calls[0][8]).toBe("prompt");
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
		await expect(publishReview(scope, "comment", "hi")).rejects.toThrow(
			"No merge request to submit this review to.",
		);
		expect(forgeSubmitReview).not.toHaveBeenCalled();
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

describe("loadReview", () => {
	const loneScope = { projectId: "p9", instanceId: "i9", worktreePath: "/wt9" };

	it("puts the stored reading state in place without a diff", async () => {
		const stored = {
			...emptyReviewState(),
			isDiffMode: true,
			selectedPath: "src/a.ts",
		};
		loadReviewState.mockResolvedValue(stored);
		getDiffHunks.mockClear();
		await loadReview(loneScope);
		expect(stateFor(loneScope)).toEqual(stored);
		expect(getDiffHunks).not.toHaveBeenCalled();
	});

	it("leaves the defaults when nothing was ever stored", async () => {
		const noneScope = { ...loneScope, instanceId: "i10" };
		loadReviewState.mockResolvedValue(null);
		await loadReview(noneScope);
		expect(loadReviewState).toHaveBeenCalledWith("p9", "i10");
		expect(stateFor(noneScope)).toEqual(emptyReviewState());
	});

	it("does not read the disk again once the state is in memory", async () => {
		loadReviewState.mockClear();
		await loadReview(scope);
		expect(loadReviewState).not.toHaveBeenCalled();
	});

	it("keeps what a concurrent load put in memory while it was reading", async () => {
		const racedScope = { ...loneScope, instanceId: "i11" };
		let release: (value: unknown) => void = () => {};
		loadReviewState.mockReturnValueOnce(
			new Promise((resolve) => {
				release = resolve;
			}),
		);
		const pending = loadReview(racedScope);
		loadReviewState.mockResolvedValueOnce({
			...emptyReviewState(),
			selectedPath: "winner.ts",
		});
		await openReview(racedScope, "main", "feature");
		release({ ...emptyReviewState(), selectedPath: "late.ts" });
		await pending;
		expect(stateFor(racedScope).selectedPath).toBe("winner.ts");
	});
});

describe("cancelling a run", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("stops the generation in flight under its run id", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-08-29T10:00:00Z"));
		getDiffUnified.mockResolvedValue({ text: "diff", truncated: false });
		getDiffHunks.mockResolvedValue(HUNKS);
		let reject: (error: Error) => void = () => {};
		runOneshot.mockReturnValue(
			new Promise((_, rej) => {
				reject = rej;
			}),
		);
		const running = generateGuide(scope, {
			base: "main",
			head: "feature",
			baseSha: "b",
			headSha: "h",
		});
		const runId = `guide-p1:i1-${Date.now()}`;
		expect(get(guideGenerating)["p1:i1"]).toBe(runId);
		await cancelGuide(scope);
		expect(stopOneshot).toHaveBeenCalledWith(runId);
		reject(new Error("cancelled"));
		await running;
		expect(get(guideGenerating)["p1:i1"]).toBe("");
		expect(get(reviewErrors)["p1:i1"]).toBe("");
	});

	it("reports a failure that is not a cancellation", async () => {
		getDiffUnified.mockResolvedValue({ text: "diff", truncated: false });
		getDiffHunks.mockResolvedValue(HUNKS);
		runOneshot.mockRejectedValue(new Error("model down"));
		await generateGuide(scope, {
			base: "main",
			head: "feature",
			baseSha: "b",
			headSha: "h",
		});
		expect(get(reviewErrors)["p1:i1"]).toBe("model down");
	});

	it("stops nothing when no generation is running", async () => {
		await cancelGuide(scope);
		expect(stopOneshot).not.toHaveBeenCalled();
	});

	it("stops the comment draft in flight under its run id", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-08-29T10:00:00Z"));
		let resolve: (value: unknown) => void = () => {};
		runOneshot.mockReturnValue(
			new Promise((res) => {
				resolve = res;
			}),
		);
		const remark = {
			id: "c1r1",
			kind: "issue" as const,
			path: "src/a.ts",
			side: "new" as const,
			line: 2,
			title: "Unvalidated input",
			body: "It goes straight to the API.",
			status: "open" as const,
		};
		const drafting = draftCommentFor(scope, remark, "2: x");
		const runId = `draft-p1:i1-${Date.now()}`;
		expect(get(commentDrafting)["p1:i1"]).toBe(runId);
		await cancelCommentDraft(scope);
		expect(stopOneshot).toHaveBeenCalledWith(runId);
		resolve({ comment: "Validate it." });
		await drafting;
		expect(get(commentDrafting)["p1:i1"]).toBe("");
	});

	it("stops no draft when none is running", async () => {
		await cancelCommentDraft(scope);
		expect(stopOneshot).not.toHaveBeenCalled();
	});
});

describe("draftCommentFor", () => {
	const remark = {
		id: "c1r1",
		kind: "issue" as const,
		path: "src/a.ts",
		side: "new" as const,
		line: 2,
		title: "Unvalidated input",
		body: "It goes straight to the API.",
		status: "open" as const,
	};

	it("returns the comment the model answered, run in the worktree", async () => {
		runOneshot.mockResolvedValue({ comment: "Validate it." });
		const comment = await draftCommentFor(scope, remark, "2: x", {
			provider: "codex",
			model: "m",
			binaryPath: "/bin/codex",
		});
		expect(comment).toBe("Validate it.");
		const call = runOneshot.mock.calls[0];
		expect(call[0]).toBe("/wt");
		expect(call[2]).toEqual({
			type: "object",
			required: ["comment"],
			properties: { comment: { type: "string" } },
		});
		expect(call.slice(4)).toEqual(["codex", "m", "/bin/codex", {}, "prompt"]);
		expect(String(call[1])).toContain("Unvalidated input");
	});

	it("returns an empty comment when the answer carries no text", async () => {
		runOneshot.mockResolvedValue({ comment: 4 });
		expect(await draftCommentFor(scope, remark, "2: x")).toBe("");
	});

	it("clears the pending run when the model fails", async () => {
		runOneshot.mockRejectedValue(new Error("boom"));
		await expect(draftCommentFor(scope, remark, "2: x")).rejects.toThrow(
			"boom",
		);
		expect(get(commentDrafting)["p1:i1"]).toBe("");
	});
});

describe("remarks and comments lookups", () => {
	beforeEach(generate);

	it("finds a remark by its id", () => {
		expect(findRemark(scope, "c1r1")).toMatchObject({
			id: "c1r1",
			title: "Unvalidated input",
		});
	});

	it("finds nothing for an unknown id", () => {
		expect(findRemark(scope, "c9r9")).toBeNull();
	});

	it("finds nothing without a guide", async () => {
		await openReview(scope, "main", "feature");
		expect(findRemark(scope, "c1r1")).toBeNull();
	});

	it("rewrites the body of the comment asked for only", () => {
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
		editComment(scope, second, "two, reworded");
		expect(stateFor(scope).comments.map((c) => [c.id, c.body])).toEqual([
			[first, "one"],
			[second, "two, reworded"],
		]);
	});

	it("deletes a comment written from no remark and leaves remarks alone", () => {
		const id = addComment(scope, {
			path: "src/a.ts",
			side: "new",
			line: 2,
			body: "free",
		});
		deleteComment(scope, id);
		expect(stateFor(scope).comments).toEqual([]);
		expect(stateFor(scope).guide?.chapters[0].remarks[0].status).toBe("open");
	});

	it("leaves the other remarks untouched when one is dismissed", () => {
		dismissRemark(scope, "c1r1");
		dismissRemark(scope, "c9r9");
		expect(stateFor(scope).guide?.chapters[0].remarks).toHaveLength(1);
		expect(stateFor(scope).guide?.chapters[0].remarks[0].status).toBe(
			"dismissed",
		);
	});
});

describe("marking without a guide or a match", () => {
	it("ignores a chapter mark when there is no guide", () => {
		markChapterSeen(scope, "c1");
		expect(stateFor(scope)).toEqual(emptyReviewState());
	});

	it("ignores a remark change when there is no guide", () => {
		dismissRemark(scope, "c1r1");
		expect(stateFor(scope)).toEqual(emptyReviewState());
	});

	it("records a read hunk even when there is no guide", () => {
		markHunkSeen(scope, "aaa");
		expect(stateFor(scope).seenHunks).toEqual(["aaa"]);
		expect(stateFor(scope).guide).toBeNull();
		markHunkSeen(scope, "aaa", false);
		expect(stateFor(scope).seenHunks).toEqual([]);
	});

	it("ignores a chapter mark for an unknown chapter", async () => {
		await generate();
		markChapterSeen(scope, "c9");
		expect(stateFor(scope).seenHunks).toEqual([]);
		expect(stateFor(scope).guide?.chapters.map((c) => c.isSeen)).toEqual([
			false,
			false,
		]);
	});

	it("un-reads a chapter when one of its hunks is set back to unread", async () => {
		await generate();
		markHunkSeen(scope, "aaa");
		markHunkSeen(scope, "aaa", false);
		expect(stateFor(scope).seenHunks).toEqual([]);
		expect(stateFor(scope).guide?.chapters[0].isSeen).toBe(false);
	});
});

describe("reading state setters", () => {
	it("remembers the diff mode", () => {
		setDiffMode(scope, true);
		expect(stateFor(scope).isDiffMode).toBe(true);
		setDiffMode(scope, false);
		expect(stateFor(scope).isDiffMode).toBe(false);
	});

	it("remembers the discussion filter", () => {
		setDiscussionFilter(scope, "open");
		expect(stateFor(scope).discussionFilter).toBe("open");
	});

	it("remembers the file being read", () => {
		setSelectedPath(scope, "src/b.ts");
		expect(stateFor(scope).selectedPath).toBe("src/b.ts");
	});

	it("remembers whether the discussions panel is open", () => {
		setDiscussionsOpen(scope, false);
		expect(stateFor(scope).isDiscussionsOpen).toBe(false);
		setDiscussionsOpen(scope, true);
		expect(stateFor(scope).isDiscussionsOpen).toBe(true);
	});
});

describe("publishReview with nothing to send", () => {
	beforeEach(() => {
		setMergeRequestId(scope, "mr1");
	});

	it("does not call the forge for an empty plain comment", async () => {
		expect(await publishReview(scope, "comment", "   ")).toEqual({
			published: 0,
			failed: 0,
		});
		expect(forgeSubmitReview).not.toHaveBeenCalled();
	});

	it("still submits a verdict with no comment", async () => {
		forgeSubmitReview.mockResolvedValue({ published: {}, failed: [] });
		await publishReview(scope, "approve", "");
		expect(forgeSubmitReview).toHaveBeenCalledWith(
			"p1",
			"mr1",
			[],
			"approve",
			"",
		);
	});
});

describe("reviewMarkdown", () => {
	it("renders the comments of the instance with the verdict", () => {
		addComment(scope, {
			path: "src/a.ts",
			side: "new",
			line: 2,
			body: "Validate it.",
		});
		expect(reviewMarkdown(scope, "changes", "Needs work.")).toBe(
			"Needs work.\n\nVerdict: changes\n\n### src/a.ts:2\n\nValidate it.",
		);
	});
});

describe("requestReviewAction", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("publishes the action with the moment it was asked", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-08-29T10:00:00Z"));
		requestReviewAction("review.next");
		expect(get(reviewAction)).toEqual({
			id: "review.next",
			at: new Date("2026-08-29T10:00:00Z").getTime(),
		});
	});
});

describe("the reading state of an instance that was never opened", () => {
	let instanceCount = 0;
	let freshScope = scope;
	let freshKey = "";

	beforeEach(() => {
		instanceCount += 1;
		freshScope = {
			projectId: "p7",
			instanceId: `i${instanceCount}`,
			worktreePath: "/wt7",
		};
		freshKey = `p7:i${instanceCount}`;
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("has no hunks", () => {
		expect(hunksFor(freshScope)).toEqual([]);
	});

	it("builds a change on the empty state", () => {
		setDiffMode(freshScope, true);
		expect(stateFor(freshScope)).toEqual({
			...emptyReviewState(),
			isDiffMode: true,
		});
	});

	it("stays empty when a chapter is marked with no guide", () => {
		markChapterSeen(freshScope, "c1");
		expect(get(reviewStates)[freshKey]).toEqual(emptyReviewState());
	});

	it("stays empty when a remark is dismissed with no guide", () => {
		dismissRemark(freshScope, "c1r1");
		expect(get(reviewStates)[freshKey]).toEqual(emptyReviewState());
	});

	it("is not given a state by loading one that was never stored", async () => {
		loadReviewState.mockResolvedValue(null);
		await loadReview(freshScope);
		expect(get(reviewStates)[freshKey]).toBeUndefined();
	});

	it("writes a change to disk once the debounce delay has passed", () => {
		vi.useFakeTimers();
		setDiffMode(freshScope, true);
		vi.advanceTimersByTime(499);
		expect(saveReviewState).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(saveReviewState).toHaveBeenCalledWith("p7", freshScope.instanceId, {
			...emptyReviewState(),
			isDiffMode: true,
		});
	});

	it("restarts the delay on each change and writes once", () => {
		vi.useFakeTimers();
		setDiffMode(freshScope, true);
		vi.advanceTimersByTime(300);
		setSelectedPath(freshScope, "src/a.ts");
		vi.advanceTimersByTime(300);
		expect(saveReviewState).not.toHaveBeenCalled();
		vi.advanceTimersByTime(200);
		expect(saveReviewState).toHaveBeenCalledTimes(1);
		expect(saveReviewState).toHaveBeenCalledWith("p7", freshScope.instanceId, {
			...emptyReviewState(),
			isDiffMode: true,
			selectedPath: "src/a.ts",
		});
	});

	it("writes the state an opened review settled on", async () => {
		vi.useFakeTimers();
		loadReviewState.mockResolvedValue(null);
		await openReview(freshScope, "main", "feature");
		vi.advanceTimersByTime(500);
		expect(saveReviewState).toHaveBeenCalledWith(
			"p7",
			freshScope.instanceId,
			emptyReviewState(),
		);
	});
});

describe("the hunks kept for an instance", () => {
	it("holds the hunks the diff answered with once the review is open", () => {
		expect(get(reviewHunks)["p1:i1"]).toEqual(HUNKS);
	});

	it("holds an empty list when the backend answers with nothing", async () => {
		getDiffHunks.mockResolvedValue(undefined);
		await openReview(scope, "main", "feature");
		expect(get(reviewHunks)["p1:i1"]).toEqual([]);
	});

	it("takes the hunks a guide generation read", async () => {
		getDiffUnified.mockResolvedValue({ text: "diff", truncated: false });
		getDiffHunks.mockResolvedValue([HUNKS[0]]);
		runOneshot.mockResolvedValue(ANSWER);
		await generateGuide(scope, {
			base: "main",
			head: "feature",
			baseSha: "b",
			headSha: "h",
		});
		expect(get(reviewHunks)["p1:i1"]).toEqual([HUNKS[0]]);
	});

	it("generates a guide when the backend answers with no hunks", async () => {
		getDiffUnified.mockResolvedValue({ text: "diff", truncated: false });
		getDiffHunks.mockResolvedValue(undefined);
		runOneshot.mockResolvedValue(ANSWER);
		await generateGuide(scope, {
			base: "main",
			head: "feature",
			baseSha: "b",
			headSha: "h",
		});
		expect(get(reviewErrors)["p1:i1"]).toBe("");
		expect(get(reviewHunks)["p1:i1"]).toEqual([]);
	});
});

describe("addComment ids", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("ends with six characters of randomness", () => {
		vi.spyOn(Math, "random").mockReturnValue(0.123456789012345);
		const id = addComment(scope, {
			path: "src/a.ts",
			side: "new",
			line: 2,
			body: "x",
		});
		expect(id).toMatch(/^rc-\d+-4fzzzx$/);
	});
});

describe("markPublished", () => {
	it("leaves a comment the forge did not accept without a publishedAs", () => {
		const accepted = addComment(scope, {
			path: "src/a.ts",
			side: "new",
			line: 2,
			body: "one",
		});
		addComment(scope, { path: "src/b.ts", side: "new", line: 2, body: "two" });
		markPublished(scope, { [accepted]: "forge-1" });
		const [first, second] = stateFor(scope).comments;
		expect(first.publishedAs).toBe("forge-1");
		expect(Object.keys(second)).not.toContain("publishedAs");
	});
});

describe("removing a project", () => {
	it("forgets the review state and hunks of its instances", async () => {
		await runProjectTeardowns("p1");
		expect(get(reviewStates)["p1:i1"]).toBeUndefined();
		expect(get(reviewHunks)["p1:i1"]).toBeUndefined();
	});
});
