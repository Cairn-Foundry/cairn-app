// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import type { GitDiffHunk } from "#lib/services/git-service";
import { firstChangedLine } from "./diff-open-line";

const hunk = (header: string, kinds: string): GitDiffHunk => ({
	header,
	lines: Array.from(kinds, (k) => ({
		kind: k === "+" ? "add" : k === "-" ? "remove" : "context",
		content: "",
	})),
});

describe("firstChangedLine", () => {
	it("points at the first added line, past the leading context", () => {
		expect(firstChangedLine([hunk("@@ -10,5 +10,6 @@", "  +  ")])).toBe(12);
	});

	it("points at the first line of a hunk that opens on a change", () => {
		expect(firstChangedLine([hunk("@@ -10,5 +10,6 @@", "+    ")])).toBe(10);
	});

	it("points at the line a deletion left in place", () => {
		expect(firstChangedLine([hunk("@@ -10,5 +10,4 @@", " -   ")])).toBe(11);
	});

	/** A file created from nothing: git writes `-0,0`, which starts at line 1. */
	it("points at the first line of a new file", () => {
		expect(firstChangedLine([hunk("@@ -0,0 +1,3 @@", "+++")])).toBe(1);
	});

	it("skips a hunk left with context only", () => {
		expect(
			firstChangedLine([
				hunk("@@ -3,2 +3,2 @@", "   "),
				hunk("@@ -40,2 +41,3 @@", " + "),
			]),
		).toBe(42);
	});

	it("is null without hunks", () => {
		expect(firstChangedLine([])).toBeNull();
	});

	it("is null when nothing in the hunks changed", () => {
		expect(firstChangedLine([hunk("@@ -3,2 +3,2 @@", "  ")])).toBeNull();
	});
});
