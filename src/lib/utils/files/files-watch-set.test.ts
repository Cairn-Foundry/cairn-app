// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { absoluteWatchSet, watchSet } from "./files-watch-set";

describe("watchSet", () => {
	it("watches the expanded directories", () => {
		expect(watchSet(["src", "docs"], [])).toEqual(["docs", "src"]);
	});

	/**
	 * The parent, never the file: most tools write a temporary file and rename it
	 * over the target, and inotify follows the inode - a watch on the file itself
	 * would go deaf after the first save from outside.
	 */
	it("watches the parent of an open tab, not the file", () => {
		expect(watchSet([], ["src/lib/a.ts"])).toEqual(["src", "src/lib"]);
	});

	it("keeps the ancestors of an expanded directory, which are on screen too", () => {
		expect(watchSet(["a/b/c"], [])).toEqual(["a", "a/b", "a/b/c"]);
	});

	/** The root is the backend's business, and "" is not a directory name. */
	it("never returns the root", () => {
		expect(watchSet([], ["README.md"])).toEqual([]);
		expect(watchSet([""], [])).toEqual([]);
	});

	it("returns each directory once even when several things point at it", () => {
		const set = watchSet(["src"], ["src/a.ts", "src/b.ts"]);
		expect(set).toEqual(["src"]);
	});

	it("is empty when nothing is open or expanded", () => {
		expect(watchSet([], [])).toEqual([]);
	});

	/**
	 * The cost has to follow the view, not the repository: this is the whole
	 * reason the set exists.
	 */
	it("does not grow with directories nobody expanded", () => {
		const set = watchSet(["src"], ["src/a.ts"]);
		expect(set).toEqual(["src"]);
		expect(set).not.toContain("node_modules");
	});

	it("watches an ignored directory once it is expanded", () => {
		expect(watchSet(["node_modules"], [])).toEqual(["node_modules"]);
	});
});

describe("absoluteWatchSet", () => {
	it("prefixes each directory with the worktree", () => {
		expect(absoluteWatchSet("/wt", ["src"], [])).toEqual(["/wt/src"]);
	});

	it("returns nothing rather than the bare worktree when the set is empty", () => {
		expect(absoluteWatchSet("/wt", [], [])).toEqual([]);
	});

	/**
	 * Two spellings of one directory are two keys for the backend, so it would
	 * watch it twice and its diff would never drop the first.
	 */
	it("produces one spelling whatever the worktree's trailing slashes", () => {
		expect(absoluteWatchSet("/wt/", ["src"], [])).toEqual(["/wt/src"]);
		expect(absoluteWatchSet("/wt///", ["src"], [])).toEqual(["/wt/src"]);
	});
});
