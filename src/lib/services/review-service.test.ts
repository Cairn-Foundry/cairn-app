// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyReviewState } from "#lib/types/review";
import {
	getDiffHunks,
	getDiffUnified,
	loadReviewState,
	saveReviewState,
} from "./review-service";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
	mockInvoke.mockReset();
});

describe("getDiffUnified", () => {
	it("asks for the diff with whitespace kept and no ceiling by default", async () => {
		const diff = { text: "diff", truncated: false, omitted: [] };
		mockInvoke.mockResolvedValue(diff);
		expect(await getDiffUnified("/wt", "main", "feature")).toBe(diff);
		expect(mockInvoke).toHaveBeenCalledWith("get_diff_unified", {
			worktreePath: "/wt",
			base: "main",
			head: "feature",
			ignoreWhitespace: false,
			maxBytes: null,
		});
	});

	it("passes the whitespace flag and the ceiling through", async () => {
		mockInvoke.mockResolvedValue({ text: "", truncated: true, omitted: ["a"] });
		await getDiffUnified("/wt", "main", "feature", true, 4096);
		expect(mockInvoke).toHaveBeenCalledWith("get_diff_unified", {
			worktreePath: "/wt",
			base: "main",
			head: "feature",
			ignoreWhitespace: true,
			maxBytes: 4096,
		});
	});
});

describe("getDiffHunks", () => {
	it("returns the hunks the backend reports", async () => {
		const hunks = [
			{
				path: "a.ts",
				oldStart: 1,
				oldLines: 2,
				newStart: 1,
				newLines: 3,
				hunkHash: "aaa",
			},
		];
		mockInvoke.mockResolvedValue(hunks);
		expect(await getDiffHunks("/wt", "main", "feature")).toEqual(hunks);
		expect(mockInvoke).toHaveBeenCalledWith("get_diff_hunks", {
			worktreePath: "/wt",
			base: "main",
			head: "feature",
		});
	});
});

describe("loadReviewState", () => {
	it("returns the stored state", async () => {
		const state = { ...emptyReviewState(), seenHunks: ["aaa"] };
		mockInvoke.mockResolvedValue(state);
		expect(await loadReviewState("p1", "i1")).toEqual(state);
		expect(mockInvoke).toHaveBeenCalledWith("load_review_state", {
			projectId: "p1",
			instanceId: "i1",
		});
	});

	it("returns null for an instance never reviewed", async () => {
		mockInvoke.mockResolvedValue(null);
		expect(await loadReviewState("p1", "i1")).toBeNull();
	});

	it("returns null when the read fails", async () => {
		mockInvoke.mockRejectedValue(new Error("corrupt"));
		expect(await loadReviewState("p1", "i1")).toBeNull();
	});
});

describe("saveReviewState", () => {
	it("writes the state for the instance", () => {
		mockInvoke.mockResolvedValue(undefined);
		const state = { ...emptyReviewState(), isDiffMode: true };
		saveReviewState("p1", "i1", state);
		expect(mockInvoke).toHaveBeenCalledWith("save_review_state", {
			projectId: "p1",
			instanceId: "i1",
			state,
		});
	});

	it("swallows a failed write", async () => {
		mockInvoke.mockRejectedValue(new Error("disk full"));
		expect(() => saveReviewState("p1", "i1", emptyReviewState())).not.toThrow();
		await Promise.resolve();
	});
});
