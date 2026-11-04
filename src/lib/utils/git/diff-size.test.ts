// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import type { GitDiffHunk } from "#lib/services/git-service";
import { isDiffTooLarge } from "./diff-size";

const hunk = (n: number) =>
	({
		header: "@@",
		lines: Array.from({ length: n }, () => ({})),
	}) as unknown as GitDiffHunk;

describe("isDiffTooLarge", () => {
	it("accepts a diff at the limit", () => {
		expect(isDiffTooLarge([hunk(5), hunk(5)], 10)).toBe(false);
	});
	it("rejects a diff past the limit across hunks", () => {
		expect(isDiffTooLarge([hunk(6), hunk(5)], 10)).toBe(true);
	});
	it("accepts an empty diff", () => {
		expect(isDiffTooLarge([], 10)).toBe(false);
	});
});
