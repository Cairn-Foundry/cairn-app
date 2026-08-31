// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from "vitest";
import * as fileService from "../../../lib/services/file-service";
import * as gitService from "../../../lib/services/git-service";
import { emptyDiffState, loadPaneBase } from "./files-diff";

vi.mock("$lib/services/file-service", () => ({
	gitBlame: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock("$lib/services/git-service", () => ({
	getFileAtHead: vi.fn().mockResolvedValue(null),
	getFileInIndex: vi.fn().mockResolvedValue(null),
	checkIgnore: vi.fn().mockResolvedValue([]),
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

	it("suppresses the gutter (null base) for untracked files without calling git", async () => {
		const state = await loadPaneBase("/wt", "file.ts", "untracked");
		expect(state.baseContent).toBeNull();
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

	it("suppresses the gutter (null base) for ignored files", async () => {
		vi.mocked(gitService.checkIgnore).mockResolvedValueOnce([".env"]);
		const state = await loadPaneBase("/wt", ".env", undefined);
		expect(state.baseContent).toBeNull();
	});

	it("normalizes CRLF HEAD content to LF so it matches the editor buffer", async () => {
		vi.mocked(gitService.getFileAtHead).mockResolvedValueOnce("a\r\nb\r\nc");
		const state = await loadPaneBase("/wt", "file.ts", "modified");
		expect(state.baseContent).toBe("a\nb\nc");
	});

	it("suppresses the gutter (null base) when git show fails", async () => {
		vi.mocked(gitService.getFileAtHead).mockRejectedValueOnce(
			new Error("git show failed"),
		);
		const state = await loadPaneBase("/wt", "file.ts", "modified");
		expect(state.baseContent).toBeNull();
	});

	it("suppresses the gutter when the file has no baseline in HEAD", async () => {
		vi.mocked(gitService.getFileAtHead).mockResolvedValueOnce(null);
		const state = await loadPaneBase("/wt", "brand-new.ts", "modified");
		expect(state.baseContent).toBeNull();
	});

	it("keeps an empty baseline distinct from a missing one", async () => {
		vi.mocked(gitService.getFileAtHead).mockResolvedValueOnce("");
		const state = await loadPaneBase("/wt", "was-empty.ts", "modified");
		expect(state.baseContent).toBe("");
	});

	it("suppresses the gutter for a new file whose status is not known yet", async () => {
		vi.mocked(gitService.getFileAtHead).mockResolvedValueOnce(null);
		const state = await loadPaneBase("/wt", "created.ts", undefined);
		expect(state.baseContent).toBeNull();
	});

	it("prefers the index over HEAD so staged changes leave the gutter", async () => {
		vi.mocked(gitService.getFileAtHead).mockClear();
		vi.mocked(gitService.getFileInIndex).mockResolvedValueOnce("staged text");
		const state = await loadPaneBase("/wt", "file.ts", "modified");
		expect(state.baseContent).toBe("staged text");
		expect(gitService.getFileAtHead).not.toHaveBeenCalled();
	});

	it("falls back to HEAD when the file is absent from the index", async () => {
		vi.mocked(gitService.getFileInIndex).mockResolvedValueOnce(null);
		vi.mocked(gitService.getFileAtHead).mockResolvedValueOnce("head text");
		const state = await loadPaneBase("/wt", "file.ts", "modified");
		expect(state.baseContent).toBe("head text");
	});

	it("falls back to HEAD when reading the index fails", async () => {
		vi.mocked(gitService.getFileInIndex).mockRejectedValueOnce(
			new Error("git show failed"),
		);
		vi.mocked(gitService.getFileAtHead).mockResolvedValueOnce("head text");
		const state = await loadPaneBase("/wt", "file.ts", "modified");
		expect(state.baseContent).toBe("head text");
	});

	it("keeps the baseline when the ignore check fails", async () => {
		vi.mocked(gitService.checkIgnore).mockRejectedValueOnce(
			new Error("check-ignore failed"),
		);
		vi.mocked(gitService.getFileInIndex).mockResolvedValueOnce("head text");
		const state = await loadPaneBase("/wt", "file.ts", undefined);
		expect(state.baseContent).toBe("head text");
	});

	it("handles gitBlame failure gracefully", async () => {
		vi.mocked(fileService.gitBlame).mockRejectedValueOnce(
			new Error("blame failed"),
		);
		const state = await loadPaneBase("/wt", "file.ts", "modified");
		expect(state.currentBlame).toEqual(new Map());
	});
});
