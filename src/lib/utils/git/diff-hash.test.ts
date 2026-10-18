// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import type { GitDiffHunk } from "$lib/services/git-service";
import { hashHunks } from "$lib/utils/git/diff-hash";

const hunk = (content: string, kind = "add"): GitDiffHunk =>
	({ header: "@@ -1 +1 @@", lines: [{ kind, content }] }) as GitDiffHunk;

describe("hashHunks", () => {
	it("is stable for the same diff", () => {
		expect(hashHunks([hunk("a")])).toBe(hashHunks([hunk("a")]));
	});

	it("moves when a line, its kind or the header changes", () => {
		const base = hashHunks([hunk("a")]);
		expect(hashHunks([hunk("b")])).not.toBe(base);
		expect(hashHunks([hunk("a", "remove")])).not.toBe(base);
		expect(
			hashHunks([{ ...hunk("a"), header: "@@ -2 +2 @@" } as GitDiffHunk]),
		).not.toBe(base);
	});

	it("does not confuse where one line ends and the next begins", () => {
		const split = { header: "h", lines: [{ kind: "add", content: "ab" }] };
		const joined = {
			header: "h",
			lines: [
				{ kind: "add", content: "a" },
				{ kind: "add", content: "b" },
			],
		};
		expect(hashHunks([split as GitDiffHunk])).not.toBe(
			hashHunks([joined as GitDiffHunk]),
		);
	});
});
