import { describe, expect, it, vi } from "vitest";
import type { DiffHunk } from "../../../lib/services/file-service";
import * as fileService from "../../../lib/services/file-service";
import {
	buildRevertedContent,
	emptyDiffState,
	hunkToSplit,
	loadPaneDiff,
	untrackedDiffHunk,
} from "./files-diff";

vi.mock("$lib/services/file-service", () => ({
	gitBlame: vi.fn().mockResolvedValue(new Map()),
	gitFileDiff: vi.fn().mockResolvedValue({ hunks: [], lineMap: new Map() }),
	gitStagedFileDiff: vi
		.fn()
		.mockResolvedValue({ hunks: [], lineMap: new Map() }),
}));

const makeHunk = (
	lines: { type: "+" | "-" | " "; content: string }[],
	newStart = 1,
	newEnd = lines.filter((l) => l.type !== "-").length,
): DiffHunk => ({ oldStart: 1, newStart, newEnd, lines });

describe("emptyDiffState", () => {
	it("returns empty hunks and blame", () => {
		const state = emptyDiffState();
		expect(state.currentDiffHunks).toEqual([]);
		expect(state.currentStagedHunks).toEqual([]);
		expect(state.currentBlame).toEqual(new Map());
	});
});

describe("hunkToSplit", () => {
	it("splits added/removed lines correctly", () => {
		const hunk = makeHunk([
			{ type: "-", content: "old line" },
			{ type: "+", content: "new line" },
			{ type: " ", content: "context" },
		]);
		const { old: oldText, new: newText } = hunkToSplit(hunk);
		expect(oldText).toBe("old line\ncontext");
		expect(newText).toBe("new line\ncontext");
	});

	it("handles hunk with only context lines", () => {
		const hunk = makeHunk([{ type: " ", content: "ctx" }]);
		expect(hunkToSplit(hunk)).toEqual({ old: "ctx", new: "ctx" });
	});

	it("handles addition-only hunk", () => {
		const hunk = makeHunk([{ type: "+", content: "added" }]);
		expect(hunkToSplit(hunk).old).toBe("");
		expect(hunkToSplit(hunk).new).toBe("added");
	});
});

describe("untrackedDiffHunk", () => {
	it("creates a hunk where all lines are additions", () => {
		const hunk = untrackedDiffHunk("line1\nline2");
		expect(hunk.lines.every((l) => l.type === "+")).toBe(true);
	});

	it("sets newStart to 1 and newEnd to line count", () => {
		const hunk = untrackedDiffHunk("a\nb\nc");
		expect(hunk.newStart).toBe(1);
		expect(hunk.newEnd).toBe(3);
	});

	it("preserves line content", () => {
		const hunk = untrackedDiffHunk("hello\nworld");
		expect(hunk.lines.map((l) => l.content)).toEqual(["hello", "world"]);
	});
});

describe("buildRevertedContent", () => {
	it("reverts an inline replacement", () => {
		const pending = "line1\nnew line\nline3";
		const hunk = makeHunk(
			[
				{ type: "-", content: "old line" },
				{ type: "+", content: "new line" },
			],
			2,
			2,
		);
		expect(buildRevertedContent(pending, hunk)).toBe("line1\nold line\nline3");
	});

	it("reverts an addition-only hunk (removes added lines)", () => {
		const pending = "line1\nnew\nline2";
		const hunk = makeHunk([{ type: "+", content: "new" }], 2, 2);
		expect(buildRevertedContent(pending, hunk)).toBe("line1\nline2");
	});

	it("reverts a delete-only hunk (restores removed lines)", () => {
		// pending is the file after line2 was deleted: line1, line3
		// hunk records that line2 (a "-" line) was at position 2 in the new file
		const pending = "line1\nline3";
		const hunk = makeHunk([{ type: "-", content: "line2" }], 2, 1);
		expect(buildRevertedContent(pending, hunk)).toBe("line1\nline2\nline3");
	});
});

describe("loadPaneDiff", () => {
	it("returns empty state for deleted files", async () => {
		const state = await loadPaneDiff("/wt", "file.ts", "deleted", "");
		expect(state).toEqual(emptyDiffState());
	});

	it("returns untracked hunk for untracked files without calling git", async () => {
		const state = await loadPaneDiff(
			"/wt",
			"file.ts",
			"untracked",
			"hello\nworld",
		);
		expect(state.currentDiffHunks).toHaveLength(1);
		expect(state.currentDiffHunks[0].lines.every((l) => l.type === "+")).toBe(
			true,
		);
		expect(state.currentStagedHunks).toEqual([]);
		expect(fileService.gitFileDiff).not.toHaveBeenCalled();
	});

	it("loads unstaged and staged diff for modified files", async () => {
		const mockHunk = makeHunk([{ type: "+", content: "x" }]);
		vi.mocked(fileService.gitFileDiff).mockResolvedValueOnce({
			hunks: [mockHunk],
			lineMap: new Map(),
		});
		vi.mocked(fileService.gitStagedFileDiff).mockResolvedValueOnce({
			hunks: [mockHunk],
			lineMap: new Map(),
		});

		const state = await loadPaneDiff("/wt", "file.ts", "modified", "x");
		expect(state.currentDiffHunks).toHaveLength(1);
		expect(state.currentStagedHunks).toHaveLength(1);
	});

	it("returns empty hunks with blame when status is undefined", async () => {
		const state = await loadPaneDiff("/wt", "file.ts", undefined, "");
		expect(state.currentDiffHunks).toEqual([]);
		expect(state.currentStagedHunks).toEqual([]);
		expect(state.currentBlame).toBeInstanceOf(Map);
	});

	it("handles gitBlame failure gracefully", async () => {
		vi.mocked(fileService.gitBlame).mockRejectedValueOnce(
			new Error("blame failed"),
		);
		const state = await loadPaneDiff("/wt", "file.ts", undefined, "");
		expect(state.currentBlame).toEqual(new Map());
	});
});
