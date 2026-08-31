// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GitOperationState, GitOpResult } from "$lib/services/git-service";

interface GitState {
	currentBranch: string;
	branches: string[];
	remoteBranches: string[];
	operationState: GitOperationState | null;
}

const gitState = writable<GitState>({
	currentBranch: "feature",
	branches: [],
	remoteBranches: [],
	operationState: null,
});

const fns = {
	loadBranches: vi.fn(),
	stageFile: vi.fn(),
	removeFile: vi.fn(),
	rebaseOnto: vi.fn(),
	mergeBranch: vi.fn(),
	continueRebase: vi.fn(),
	skipRebase: vi.fn(),
	abortRebase: vi.fn(),
	continueMerge: vi.fn(),
	abortMerge: vi.fn(),
};

vi.mock("$lib/stores/git", () => ({
	git: { subscribe: gitState.subscribe },
	...Object.fromEntries(
		Object.entries(fns).map(([name, fn]) => [
			name,
			(...a: unknown[]) => fn(...a),
		]),
	),
}));

const readFile = vi.fn();
vi.mock("$lib/services/file-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	readFile: (...a: unknown[]) => readFile(...a),
}));

// `instancesByProject` is private to the store, so the active instance the
// component reads is supplied directly rather than derived from a seeded list.
const setInstanceBaseBranch = vi.fn();
const activeInstanceStore = writable<unknown>(null);
vi.mock("$lib/stores/instance", () => ({
	activeInstance: { subscribe: activeInstanceStore.subscribe },
	setInstanceBaseBranch: (...a: unknown[]) => setInstanceBaseBranch(...a),
}));

const { projects, activeProjectId } = await import("$lib/stores/project");
const { project, instance } = await import("../../../test/fixtures");
const { default: MergeRebaseView } = await import("./MergeRebaseView.svelte");

const OK: GitOpResult = { ok: true } as GitOpResult;
const FAILED: GitOpResult = { ok: false } as GitOpResult;

function operation(
	overrides: Partial<GitOperationState> = {},
): GitOperationState {
	return {
		kind: "rebase",
		conflictedFiles: [],
		structuralFiles: [],
		head: "feature",
		current: 1,
		total: 3,
		...overrides,
	};
}

function mount() {
	const onOpenFile = vi.fn();
	const onFilesChanged = vi.fn();
	const result = render(MergeRebaseView, {
		props: {},
		events: {
			openFile: (e: CustomEvent) => onOpenFile(e.detail),
			filesChanged: () => onFilesChanged(),
		},
	});
	return { ...result, onOpenFile, onFilesChanged };
}

const cards = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".mr-card"));
const branches = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".mr-branch"));
const branchNamed = (name: string) =>
	branches().find(
		(b) => b.querySelector(".mr-branch-name")?.textContent === name,
	) as HTMLElement;
const runButton = () =>
	document.querySelector(".mr-footer .btn.primary") as HTMLButtonElement;
const conflictRows = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".mr-conflict-row"));
const conflictNames = () =>
	conflictRows().map((r) => r.querySelector(".mr-conflict-name")?.textContent);
const actionButtons = () =>
	Array.from(document.querySelectorAll<HTMLButtonElement>(".mr-actions .btn"));
const modal = () => document.querySelector(".mr-modal");

/** Picks a strategy card, then a target branch. */
async function choose(strategy: "rebase" | "merge", branch: string) {
	await userEvent.click(cards()[strategy === "rebase" ? 0 : 1]);
	await userEvent.click(branchNamed(branch));
}

beforeEach(() => {
	for (const fn of Object.values(fns)) {
		fn.mockReset();
		fn.mockResolvedValue(OK);
	}
	readFile.mockReset();
	readFile.mockResolvedValue("clean content");
	setInstanceBaseBranch.mockReset();
	setInstanceBaseBranch.mockResolvedValue(undefined);
	gitState.set({
		currentBranch: "feature",
		branches: ["feature", "main", "develop"],
		remoteBranches: ["origin/main"],
		operationState: null,
	});
	projects.set([project("p1")]);
	activeProjectId.set("p1");
	activeInstanceStore.set(instance("i1", "p1"));
});

describe("MergeRebaseView", () => {
	describe("choosing what to run", () => {
		it("offers every branch but the one already checked out", () => {
			mount();
			const names = branches().map(
				(b) => b.querySelector(".mr-branch-name")?.textContent,
			);
			expect(names).toContain("main");
			expect(names).toContain("origin/main");
			expect(names).not.toContain("feature");
		});

		it("refuses to run before a strategy and a target are chosen", async () => {
			mount();
			expect(runButton().disabled).toBe(true);
			await userEvent.click(cards()[0]);
			expect(runButton().disabled).toBe(true);
			await userEvent.click(branchNamed("main"));
			expect(runButton().disabled).toBe(false);
		});

		it("filters the branches by the search", async () => {
			mount();
			const search = document.querySelector(
				".mr-search input",
			) as HTMLInputElement;
			await userEvent.type(search, "deve");
			const names = branches().map(
				(b) => b.querySelector(".mr-branch-name")?.textContent,
			);
			expect(names).toEqual(["develop"]);
		});

		it("says so when nothing matches the search", async () => {
			mount();
			const search = document.querySelector(
				".mr-search input",
			) as HTMLInputElement;
			await userEvent.type(search, "zzz");
			expect(branches()).toHaveLength(0);
			expect(document.querySelector(".mr-empty")).not.toBeNull();
		});

		it("loads the branches when it has none to show", () => {
			gitState.set({
				currentBranch: "feature",
				branches: [],
				remoteBranches: [],
				operationState: null,
			});
			mount();
			expect(fns.loadBranches).toHaveBeenCalledWith("/repos/p1");
		});
	});

	describe("running the operation", () => {
		it("rebases onto the chosen branch", async () => {
			mount();
			await choose("rebase", "main");
			await userEvent.click(runButton());
			expect(fns.rebaseOnto).toHaveBeenCalledWith("main");
			expect(fns.mergeBranch).not.toHaveBeenCalled();
		});

		it("merges the chosen branch", async () => {
			mount();
			await choose("merge", "main");
			await userEvent.click(runButton());
			expect(fns.mergeBranch).toHaveBeenCalledWith("main");
			expect(fns.rebaseOnto).not.toHaveBeenCalled();
		});

		/**
		 * A rebase moves where the work starts, so the recorded base branch has
		 * to follow - otherwise the diffs and the merge request target keep
		 * pointing at a branch the instance no longer sits on.
		 */
		it("moves the instance base branch after a rebase", async () => {
			mount();
			await choose("rebase", "develop");
			await userEvent.click(runButton());
			expect(setInstanceBaseBranch).toHaveBeenCalledWith("i1", "p1", "develop");
		});

		it("leaves the base branch alone after a merge", async () => {
			mount();
			await choose("merge", "main");
			await userEvent.click(runButton());
			expect(setInstanceBaseBranch).not.toHaveBeenCalled();
		});

		it("leaves the base branch alone when the user unticks it", async () => {
			mount();
			await choose("rebase", "develop");
			await userEvent.click(
				document.querySelector(".mr-set-base input") as HTMLElement,
			);
			await userEvent.click(runButton());
			expect(fns.rebaseOnto).toHaveBeenCalledWith("develop");
			expect(setInstanceBaseBranch).not.toHaveBeenCalled();
		});

		/**
		 * Rebasing onto the branch already recorded as the base changes nothing,
		 * so the offer to move it is not shown at all.
		 */
		it("does not offer to move the base onto the branch it already is", async () => {
			mount();
			await choose("rebase", "main");
			expect(document.querySelector(".mr-set-base")).toBeNull();
		});

		it("offers to move the base onto a different branch", async () => {
			mount();
			await choose("rebase", "develop");
			expect(document.querySelector(".mr-set-base")).not.toBeNull();
		});

		it("does not offer to move the base for a merge", async () => {
			mount();
			await choose("merge", "develop");
			expect(document.querySelector(".mr-set-base")).toBeNull();
		});

		/** A rebase that failed did not move anything, so nothing should follow it. */
		it("leaves the base branch alone when the rebase failed", async () => {
			fns.rebaseOnto.mockResolvedValue(FAILED);
			mount();
			await choose("rebase", "develop");
			await userEvent.click(runButton());
			expect(setInstanceBaseBranch).not.toHaveBeenCalled();
		});

		it("clears the choice once the operation succeeded", async () => {
			mount();
			await choose("rebase", "main");
			await userEvent.click(runButton());
			await tick();
			expect(runButton().disabled).toBe(true);
		});

		/** A failed run keeps the choice, so it can be retried without re-picking. */
		it("keeps the choice when the operation failed", async () => {
			fns.rebaseOnto.mockResolvedValue(FAILED);
			mount();
			await choose("rebase", "main");
			await userEvent.click(runButton());
			await tick();
			expect(runButton().disabled).toBe(false);
		});

		it("tells the parent the files changed", async () => {
			const { onFilesChanged } = mount();
			await choose("rebase", "main");
			await userEvent.click(runButton());
			expect(onFilesChanged).toHaveBeenCalled();
		});
	});

	describe("working through the conflicts", () => {
		beforeEach(() => {
			gitState.update((s) => ({
				...s,
				operationState: operation({
					conflictedFiles: ["src/a.ts", "src/b.ts", "gone.ts"],
					structuralFiles: ["gone.ts"],
				}),
			}));
		});

		it("separates the content conflicts from the structural ones", () => {
			mount();
			expect(conflictNames()).toEqual(["src/a.ts", "src/b.ts", "gone.ts"]);
			const groups = Array.from(document.querySelectorAll(".mr-group")).map(
				(g) => g.textContent,
			);
			expect(groups).toHaveLength(2);
		});

		it("opens a conflicted file on request", async () => {
			const { onOpenFile } = mount();
			await userEvent.click(
				conflictRows()[0].querySelector(".mr-link") as HTMLElement,
			);
			expect(onOpenFile).toHaveBeenCalledWith("src/a.ts");
		});

		it("filters the conflicts by the search", async () => {
			mount();
			const search = document.querySelector(
				".mr-search input",
			) as HTMLInputElement;
			await userEvent.type(search, "a.ts");
			expect(conflictNames()).toEqual(["src/a.ts"]);
		});

		/**
		 * Staging a file that still holds conflict markers would commit the
		 * markers themselves, so it asks first rather than doing it silently.
		 */
		it("warns before staging a file that still holds conflict markers", async () => {
			readFile.mockResolvedValue(
				"<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> x",
			);
			mount();
			const resolve = Array.from(
				conflictRows()[0].querySelectorAll<HTMLElement>(".mr-link"),
			)[1];
			await userEvent.click(resolve);
			expect(fns.stageFile).not.toHaveBeenCalled();
			expect(modal()).not.toBeNull();
		});

		it("stages it anyway once the warning is accepted", async () => {
			readFile.mockResolvedValue(
				"<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> x",
			);
			mount();
			await userEvent.click(
				Array.from(
					conflictRows()[0].querySelectorAll<HTMLElement>(".mr-link"),
				)[1],
			);
			await userEvent.click(
				screen.getByRole("button", { name: /anyway|quand même/i }),
			);
			expect(fns.stageFile).toHaveBeenCalledWith("src/a.ts");
		});

		it("stages nothing when the warning is refused", async () => {
			readFile.mockResolvedValue(
				"<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> x",
			);
			mount();
			await userEvent.click(
				Array.from(
					conflictRows()[0].querySelectorAll<HTMLElement>(".mr-link"),
				)[1],
			);
			await userEvent.click(
				screen.getByRole("button", { name: /cancel|annuler/i }),
			);
			expect(fns.stageFile).not.toHaveBeenCalled();
			expect(modal()).toBeNull();
		});

		it("stages a clean file without asking", async () => {
			mount();
			await userEvent.click(
				Array.from(
					conflictRows()[0].querySelectorAll<HTMLElement>(".mr-link"),
				)[1],
			);
			expect(fns.stageFile).toHaveBeenCalledWith("src/a.ts");
			expect(modal()).toBeNull();
		});

		/** An unreadable file is treated as clean rather than blocking the resolution. */
		it("stages a file it cannot read rather than refusing", async () => {
			readFile.mockRejectedValue(new Error("gone"));
			mount();
			await userEvent.click(
				Array.from(
					conflictRows()[0].querySelectorAll<HTMLElement>(".mr-link"),
				)[1],
			);
			expect(fns.stageFile).toHaveBeenCalledWith("src/a.ts");
		});
	});

	describe("finishing or giving up", () => {
		it("refuses to continue while conflicts remain", () => {
			gitState.update((s) => ({
				...s,
				operationState: operation({ conflictedFiles: ["a.ts"] }),
			}));
			mount();
			expect(actionButtons()[0].disabled).toBe(true);
		});

		it("allows continuing once every conflict is resolved", () => {
			gitState.update((s) => ({ ...s, operationState: operation() }));
			mount();
			expect(actionButtons()[0].disabled).toBe(false);
		});

		it("continues the rebase it is in, not a merge", async () => {
			gitState.update((s) => ({ ...s, operationState: operation() }));
			mount();
			await userEvent.click(actionButtons()[0]);
			expect(fns.continueRebase).toHaveBeenCalled();
			expect(fns.continueMerge).not.toHaveBeenCalled();
		});

		it("continues the merge it is in, not a rebase", async () => {
			gitState.update((s) => ({
				...s,
				operationState: operation({ kind: "merge" }),
			}));
			mount();
			await userEvent.click(actionButtons()[0]);
			expect(fns.continueMerge).toHaveBeenCalled();
			expect(fns.continueRebase).not.toHaveBeenCalled();
		});

		/** Skipping a commit only means something during a rebase. */
		it("offers to skip a commit only during a rebase", () => {
			gitState.update((s) => ({ ...s, operationState: operation() }));
			const { unmount } = mount();
			expect(actionButtons()).toHaveLength(3);
			unmount();

			gitState.update((s) => ({
				...s,
				operationState: operation({ kind: "merge" }),
			}));
			mount();
			expect(actionButtons()).toHaveLength(2);
		});

		it("aborts the operation it is in", async () => {
			gitState.update((s) => ({
				...s,
				operationState: operation({ kind: "merge" }),
			}));
			mount();
			await userEvent.click(actionButtons()[actionButtons().length - 1]);
			expect(fns.abortMerge).toHaveBeenCalled();
			expect(fns.abortRebase).not.toHaveBeenCalled();
		});

		it("says how far along a rebase is", () => {
			gitState.update((s) => ({
				...s,
				operationState: operation({ current: 2, total: 5 }),
			}));
			mount();
			expect(document.querySelector(".mr-op-step")?.textContent).toMatch(
				/2.*5/s,
			);
		});

		it("says when every conflict is resolved", () => {
			gitState.update((s) => ({ ...s, operationState: operation() }));
			mount();
			expect(document.querySelector(".mr-resolved")).not.toBeNull();
		});

		/** One git write at a time: a second click must not stack operations. */
		it("disables the actions while one is running", async () => {
			let settle: () => void = () => {};
			fns.continueRebase.mockReturnValue(
				new Promise<void>((resolve) => {
					settle = resolve;
				}),
			);
			gitState.update((s) => ({ ...s, operationState: operation() }));
			mount();
			await userEvent.click(actionButtons()[0]);
			await tick();
			expect(actionButtons().every((b) => b.disabled)).toBe(true);
			settle();
		});

		/**
		 * The disabled buttons and the guard inside `guarded()` are two separate
		 * defences; forcing the click past the first one checks the second.
		 */
		it("still refuses a second action if the button is forced", async () => {
			let settle: () => void = () => {};
			fns.continueRebase.mockReturnValue(
				new Promise<void>((resolve) => {
					settle = resolve;
				}),
			);
			gitState.update((s) => ({ ...s, operationState: operation() }));
			mount();
			await userEvent.click(actionButtons()[0]);
			await tick();
			for (const b of actionButtons()) b.disabled = false;
			await userEvent.click(actionButtons()[0]);
			await userEvent.click(actionButtons()[actionButtons().length - 1]);
			expect(fns.continueRebase).toHaveBeenCalledTimes(1);
			expect(fns.abortRebase).not.toHaveBeenCalled();
			settle();
		});

		it("shows the choice again when no operation is running", () => {
			mount();
			expect(document.querySelector(".mr-inprogress")).toBeNull();
			expect(cards()).toHaveLength(2);
		});
	});
});
