import { describe, expect, it } from "vitest";
import { shortenPaths } from "./tool-label";

const WORKTREE =
	"/Users/ada/.cairn/projects/36c73747-dcd9/worktrees/feat-000-init";

describe("shortenPaths", () => {
	it("keeps only what the worktree does not already say", () => {
		expect(shortenPaths(`${WORKTREE}/index.html`, [WORKTREE])).toBe(
			"index.html",
		);
	});

	it("shortens every path on the line", () => {
		const line = `cp ${WORKTREE}/a.txt ${WORKTREE}/b.txt`;
		expect(shortenPaths(line, [WORKTREE])).toBe("cp a.txt b.txt");
	});

	it("turns the worktree itself into the place it is", () => {
		expect(shortenPaths(`cd ${WORKTREE}`, [WORKTREE])).toBe("cd .");
	});

	it("prefers the deepest root, so a worktree wins over its project", () => {
		const project = "/Users/ada/.cairn/projects/36c73747-dcd9";
		expect(shortenPaths(`${WORKTREE}/index.html`, [project, WORKTREE])).toBe(
			"index.html",
		);
	});

	it("keeps a path outside the worktree readable, under a tilde", () => {
		const outside = "/Users/ada/.claude/skills/pixel-art/review.py";
		expect(shortenPaths(outside, [WORKTREE])).toBe(
			"~/.claude/skills/pixel-art/review.py",
		);
	});

	it("leaves a line with no path of ours alone", () => {
		expect(shortenPaths("git status --short", [WORKTREE])).toBe(
			"git status --short",
		);
	});

	it("does nothing without a root to strip", () => {
		expect(shortenPaths(`${WORKTREE}/index.html`, [])).toBe(
			`${WORKTREE}/index.html`,
		);
	});
});
