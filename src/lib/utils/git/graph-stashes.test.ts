// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import type { GitGraphCommit } from "$lib/services/git-service";
import { spliceStashes, stashIndexOf } from "./graph-stashes";

function commit(
	hash: string,
	parents: string[] = [],
	refs: string[] = [],
): GitGraphCommit {
	return {
		hash,
		shortHash: hash,
		message: hash,
		author: "",
		authorEmail: "",
		date: "",
		committer: "",
		committerDate: "",
		parents,
		refs,
	};
}

const hashes = (list: GitGraphCommit[]) => list.map((c) => c.hash);

describe("spliceStashes", () => {
	const history = [commit("c", ["b"]), commit("b", ["a"]), commit("a")];

	it("places a stash right above the commit it was taken on", () => {
		const stash = commit("s0", ["b"], ["stash@{0}"]);
		expect(hashes(spliceStashes(history, [stash]))).toEqual([
			"c",
			"s0",
			"b",
			"a",
		]);
	});

	it("keeps the stack order when several stashes share a base", () => {
		const stashes = [
			commit("s0", ["a"], ["stash@{0}"]),
			commit("s1", ["a"], ["stash@{1}"]),
		];
		expect(hashes(spliceStashes(history, stashes))).toEqual([
			"c",
			"b",
			"s0",
			"s1",
			"a",
		]);
	});

	/** Its base is further down the history, on a page not loaded yet. */
	it("leaves out a stash whose base is not loaded", () => {
		const stash = commit("s0", ["older"], ["stash@{0}"]);
		expect(hashes(spliceStashes(history, [stash]))).toEqual(["c", "b", "a"]);
	});

	it("returns the list untouched without stashes", () => {
		expect(spliceStashes(history, [])).toBe(history);
	});
});

describe("stashIndexOf", () => {
	it("reads the stack index off the stash ref", () => {
		expect(stashIndexOf(commit("s", [], ["stash@{3}"]))).toBe(3);
	});

	it("is null for an ordinary commit", () => {
		expect(stashIndexOf(commit("c", [], ["HEAD -> main"]))).toBeNull();
	});
});
