// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Edge cases for the path helpers. These decide where a file is read from and
// written to, so a wrong answer is a write in the wrong place: unicode, spaces,
// separators and boundary conditions are worth pinning down explicitly.

import { describe, expect, it } from "vitest";
import { matchesSearch, splitSearchTerms } from "./files-search";
import {
	absolutePathOf,
	basename,
	isExternalPath,
	isUnder,
	parentPathOf,
	pathWithinWorktree,
} from "./files-tree";

const WORKTREE = "/repos/app";

describe("parentPathOf", () => {
	it("drops the last segment", () => {
		expect(parentPathOf("src/lib/a.ts")).toBe("src/lib");
	});

	it("answers the root for a file at the top level", () => {
		expect(parentPathOf("README.md")).toBe("");
	});

	it("answers the root for an empty path", () => {
		expect(parentPathOf("")).toBe("");
	});

	it("keeps a name with spaces and accents whole", () => {
		expect(parentPathOf("dossier été/mon fichier.ts")).toBe("dossier été");
	});

	it("keeps a directory whose name contains a dot", () => {
		expect(parentPathOf(".github/workflows/ci.yml")).toBe(".github/workflows");
	});

	it("treats a trailing separator as an empty last segment", () => {
		expect(parentPathOf("src/lib/")).toBe("src/lib");
	});

	it("handles a very deep path", () => {
		const deep = Array.from({ length: 200 }, (_, i) => `d${i}`).join("/");
		expect(parentPathOf(`${deep}/file.ts`)).toBe(deep);
	});
});

describe("basename", () => {
	it("takes the last segment", () => {
		expect(basename("src/lib/a.ts")).toBe("a.ts");
	});

	it("takes the whole path when there is no separator", () => {
		expect(basename("README.md")).toBe("README.md");
	});

	it("keeps accents, spaces and non-latin scripts", () => {
		expect(basename("src/mon fichier.ts")).toBe("mon fichier.ts");
		expect(basename("src/café.ts")).toBe("café.ts");
		expect(basename("src/日本語.ts")).toBe("日本語.ts");
	});

	it("answers an empty name for a path ending on a separator", () => {
		expect(basename("src/lib/")).toBe("");
	});

	it("answers an empty name for an empty path", () => {
		expect(basename("")).toBe("");
	});

	it("keeps a dotfile's leading dot", () => {
		expect(basename("src/.gitignore")).toBe(".gitignore");
	});
});

describe("isExternalPath", () => {
	it("calls an absolute path external", () => {
		expect(isExternalPath("/etc/hosts")).toBe(true);
	});

	it("calls a relative path internal", () => {
		expect(isExternalPath("src/a.ts")).toBe(false);
		expect(isExternalPath("a.ts")).toBe(false);
	});

	it("calls an empty path internal", () => {
		expect(isExternalPath("")).toBe(false);
	});

	it("calls a path that merely contains a separator internal", () => {
		expect(isExternalPath("src/lib/a.ts")).toBe(false);
	});
});

describe("absolutePathOf", () => {
	it("joins a relative path onto the worktree", () => {
		expect(absolutePathOf("src/a.ts", WORKTREE)).toBe("/repos/app/src/a.ts");
	});

	it("leaves an external path alone", () => {
		expect(absolutePathOf("/etc/hosts", WORKTREE)).toBe("/etc/hosts");
	});

	it("keeps spaces and accents through the join", () => {
		expect(absolutePathOf("dossier été/a.ts", WORKTREE)).toBe(
			"/repos/app/dossier été/a.ts",
		);
	});

	it("round-trips with pathWithinWorktree", () => {
		for (const path of ["src/a.ts", "dossier été/b.ts", ".gitignore"]) {
			expect(
				pathWithinWorktree(absolutePathOf(path, WORKTREE), WORKTREE),
				path,
			).toBe(path);
		}
	});

	it("round-trips an external path too", () => {
		const external = "/etc/hosts";
		expect(
			pathWithinWorktree(absolutePathOf(external, WORKTREE), WORKTREE),
		).toBe(external);
	});
});

describe("pathWithinWorktree", () => {
	it("makes a path inside the worktree relative", () => {
		expect(pathWithinWorktree("/repos/app/src/a.ts", WORKTREE)).toBe(
			"src/a.ts",
		);
	});

	it("leaves a path outside the worktree absolute", () => {
		expect(pathWithinWorktree("/etc/hosts", WORKTREE)).toBe("/etc/hosts");
	});

	/**
	 * The comparison must include the separator: a sibling whose name merely
	 * starts with the worktree name is not inside it, and keying its tab as a
	 * relative path would point at the wrong file.
	 */
	it("does not swallow a sibling whose name starts the same", () => {
		expect(pathWithinWorktree("/repos/app-legacy/a.ts", WORKTREE)).toBe(
			"/repos/app-legacy/a.ts",
		);
	});

	it("leaves the worktree path itself alone", () => {
		expect(pathWithinWorktree(WORKTREE, WORKTREE)).toBe(WORKTREE);
	});

	it("leaves everything absolute when there is no worktree", () => {
		expect(pathWithinWorktree("/repos/app/src/a.ts", null)).toBe(
			"/repos/app/src/a.ts",
		);
	});

	it("handles a worktree path with spaces and accents", () => {
		expect(
			pathWithinWorktree("/repos/mon été/src/a.ts", "/repos/mon été"),
		).toBe("src/a.ts");
	});
});

describe("isUnder", () => {
	it("says a file inside a directory is under it", () => {
		expect(isUnder("/repos/app/src/a.ts", "/repos/app")).toBe(true);
	});

	it("says a directory is under itself", () => {
		expect(isUnder("/repos/app", "/repos/app")).toBe(true);
	});

	it("does not let a directory swallow a sibling with a longer name", () => {
		expect(isUnder("/repos/app-legacy/a.ts", "/repos/app")).toBe(false);
	});

	it("says nothing is under no directory at all", () => {
		expect(isUnder("/repos/app/a.ts", null)).toBe(false);
		expect(isUnder("/repos/app/a.ts", "")).toBe(false);
	});

	it("says a parent is not under its child", () => {
		expect(isUnder("/repos", "/repos/app")).toBe(false);
	});

	it("handles directories with spaces and accents", () => {
		expect(isUnder("/repos/mon été/a.ts", "/repos/mon été")).toBe(true);
		expect(isUnder("/repos/mon étendu/a.ts", "/repos/mon été")).toBe(false);
	});
});

describe("splitSearchTerms", () => {
	it("splits on whitespace", () => {
		expect(splitSearchTerms("src lib")).toEqual(["src", "lib"]);
	});

	it("collapses a run of whitespace", () => {
		expect(splitSearchTerms("src   lib")).toEqual(["src", "lib"]);
		expect(splitSearchTerms("src\tlib")).toEqual(["src", "lib"]);
	});

	it("answers nothing for an empty or blank query", () => {
		expect(splitSearchTerms("")).toEqual([]);
		expect(splitSearchTerms("   ")).toEqual([]);
	});

	it("keeps accents and non-latin terms", () => {
		expect(splitSearchTerms("café 日本")).toEqual(["café", "日本"]);
	});
});

describe("matchesSearch", () => {
	it("matches a substring, ignoring case", () => {
		expect(matchesSearch("src/Main.ts", "main")).toBe(true);
		expect(matchesSearch("src/main.ts", "MAIN")).toBe(true);
	});

	it("matches everything on an empty query", () => {
		expect(matchesSearch("anything", "")).toBe(true);
	});

	it("does not match what is not there", () => {
		expect(matchesSearch("src/main.ts", "zzz")).toBe(false);
	});

	it("matches a term with an accent", () => {
		expect(matchesSearch("dossier été/a.ts", "été")).toBe(true);
	});

	it("handles an empty subject", () => {
		expect(matchesSearch("", "x")).toBe(false);
		expect(matchesSearch("", "")).toBe(true);
	});
});
