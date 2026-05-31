import { describe, expect, it, vi } from "vitest";
import * as fileService from "../../../lib/services/file-service";
import * as gitService from "../../../lib/services/git-service";
import { emptyDiffState, loadPaneBase } from "./files-diff";

vi.mock("$lib/services/file-service", () => ({
	gitBlame: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock("$lib/services/git-service", () => ({
	getFileAtHead: vi.fn().mockResolvedValue(""),
}));

describe("emptyDiffState", () => {
	it("returns empty base content and blame", () => {
		const state = emptyDiffState();
		expect(state.baseContent).toBe("");
		expect(state.currentBlame).toEqual(new Map());
	});
});

describe("loadPaneBase", () => {
	it("returns empty state for deleted files without calling git", async () => {
		const state = await loadPaneBase("/wt", "file.ts", "deleted");
		expect(state).toEqual(emptyDiffState());
		expect(gitService.getFileAtHead).not.toHaveBeenCalled();
	});

	it("returns empty state for untracked files without calling git", async () => {
		const state = await loadPaneBase("/wt", "file.ts", "untracked");
		expect(state).toEqual(emptyDiffState());
		expect(gitService.getFileAtHead).not.toHaveBeenCalled();
	});

	it("loads HEAD content and blame for modified files", async () => {
		vi.mocked(gitService.getFileAtHead).mockResolvedValueOnce("head text");
		const state = await loadPaneBase("/wt", "file.ts", "modified");
		expect(state.baseContent).toBe("head text");
		expect(state.currentBlame).toBeInstanceOf(Map);
	});

	it("loads HEAD content when status is undefined", async () => {
		vi.mocked(gitService.getFileAtHead).mockResolvedValueOnce("clean");
		const state = await loadPaneBase("/wt", "file.ts", undefined);
		expect(state.baseContent).toBe("clean");
	});

	it("falls back to empty base when git show fails", async () => {
		vi.mocked(gitService.getFileAtHead).mockRejectedValueOnce(
			new Error("git show failed"),
		);
		const state = await loadPaneBase("/wt", "file.ts", "modified");
		expect(state.baseContent).toBe("");
	});

	it("handles gitBlame failure gracefully", async () => {
		vi.mocked(fileService.gitBlame).mockRejectedValueOnce(
			new Error("blame failed"),
		);
		const state = await loadPaneBase("/wt", "file.ts", "modified");
		expect(state.currentBlame).toEqual(new Map());
	});
});
