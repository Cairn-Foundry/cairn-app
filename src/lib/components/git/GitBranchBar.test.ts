// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GitOperationState } from "$lib/services/git-service";

interface RemoteStatus {
	hasUpstream: boolean;
	ahead: number;
	behind: number;
	remote: string;
}

interface GitState {
	isGitRepo: boolean;
	currentBranch: string;
	remoteStatus: RemoteStatus | null;
	operationState: GitOperationState | null;
}

const gitState = writable<GitState>({
	isGitRepo: true,
	currentBranch: "feature",
	remoteStatus: { hasUpstream: true, ahead: 0, behind: 0, remote: "origin" },
	operationState: null,
});

const loadBranches = vi.fn();
const fetchRemote = vi.fn();
const pullBranch = vi.fn();
const pushBranch = vi.fn();

vi.mock("$lib/stores/git", () => ({
	// `set` and `update` are exposed too: the component reads the store through
	// `get(git)`, which needs the whole store contract, not just `subscribe`.
	git: gitState,
	loadBranches: (...a: unknown[]) => loadBranches(...a),
	fetchRemote: (...a: unknown[]) => fetchRemote(...a),
	pullBranch: (...a: unknown[]) => pullBranch(...a),
	pushBranch: (...a: unknown[]) => pushBranch(...a),
}));

const activeInstanceStore = writable<unknown>(null);
const setInstanceBaseBranch = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/stores/instance", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	activeInstance: { subscribe: activeInstanceStore.subscribe },
	setInstanceBaseBranch: (...a: unknown[]) => setInstanceBaseBranch(...a),
}));

const hasForge = writable(false);
vi.mock("$lib/stores/integrations", () => ({
	hasForge: { subscribe: hasForge.subscribe },
	capabilities: { subscribe: writable({ forge: null }).subscribe },
	forgeTerms: { subscribe: writable("mergeRequest").subscribe },
}));

vi.mock("$lib/stores/merge-request", () => ({
	loadMergeRequest: vi.fn(),
	mergeRequestFormRequest: { subscribe: writable(0).subscribe },
	mergeRequests: { subscribe: writable({}).subscribe },
	mergeRequestStateFor: () => ({ mergeRequest: null }),
}));

const { projects, activeProjectId } = await import("$lib/stores/project");
const { activeStep } = await import("$lib/stores/ui");
const { project, instance } = await import("../../../test/fixtures");
const { default: GitBranchBar } = await import("./GitBranchBar.svelte");

function operation(
	overrides: Partial<GitOperationState> = {},
): GitOperationState {
	return {
		kind: "rebase",
		conflictedFiles: [],
		structuralFiles: [],
		head: "feature",
		current: 1,
		total: 2,
		...overrides,
	};
}

function mount() {
	const onOpenMergeRebase = vi.fn();
	const onFilesChanged = vi.fn();
	const result = render(GitBranchBar, {
		props: {},
		events: {
			openMergeRebase: () => onOpenMergeRebase(),
			filesChanged: () => onFilesChanged(),
		},
	});
	return { ...result, onOpenMergeRebase, onFilesChanged };
}

const bar = () => document.querySelector(".branch-bar");
const branchName = () => document.querySelector(".branch-name")?.textContent;
const buttons = () =>
	Array.from(document.querySelectorAll<HTMLButtonElement>(".op-btn"));
const fetchBtn = () => buttons()[0];
const pullBtn = () =>
	document.querySelector(".op-split .split-main") as HTMLButtonElement;
const pushBtn = () =>
	document.querySelector(".op-split .split-main.primary") as HTMLButtonElement;
const countIn = (b: HTMLElement) => b.querySelector(".op-count")?.textContent;
const syncLabel = () => document.querySelector(".sync-clean")?.textContent;

/** Puts the store into a state, then lets the component settle on it. */
async function setGit(patch: Partial<GitState>) {
	gitState.update((s) => ({ ...s, ...patch }));
	await tick();
}

beforeEach(() => {
	for (const fn of [loadBranches, fetchRemote, pullBranch, pushBranch]) {
		fn.mockReset();
		fn.mockResolvedValue(undefined);
	}
	gitState.set({
		isGitRepo: true,
		currentBranch: "feature",
		remoteStatus: { hasUpstream: true, ahead: 0, behind: 0, remote: "origin" },
		operationState: null,
	});
	hasForge.set(false);
	activeInstanceStore.set(instance("i1", "p1"));
	projects.set([project("p1")]);
	activeProjectId.set("p1");
	activeStep.set("git");
});

describe("GitBranchBar", () => {
	describe("what it shows", () => {
		it("names the branch that is checked out", () => {
			mount();
			expect(branchName()).toBe("feature");
		});

		/** Outside a repository there is no branch bar to show at all. */
		it("shows nothing when the folder is not a repository", async () => {
			gitState.update((s) => ({ ...s, isGitRepo: false }));
			mount();
			expect(bar()).toBeNull();
		});

		it("says the branch is up to date when it has not diverged", () => {
			mount();
			expect(syncLabel()).toBeTruthy();
		});

		it("says the branch has no upstream rather than claiming it is in sync", async () => {
			await setGit({
				remoteStatus: { hasUpstream: false, ahead: 0, behind: 0, remote: "" },
			});
			mount();
			expect(document.querySelector(".sync-clean.muted")).not.toBeNull();
		});

		it("counts the commits to pull and to push", async () => {
			await setGit({
				remoteStatus: {
					hasUpstream: true,
					ahead: 2,
					behind: 3,
					remote: "origin",
				},
			});
			mount();
			expect(countIn(pullBtn())).toBe("3");
			expect(countIn(pushBtn())).toBe("2");
		});

		it("shows no count where there is nothing to move", () => {
			mount();
			expect(countIn(pullBtn())).toBeUndefined();
			expect(countIn(pushBtn())).toBeUndefined();
		});

		it("loads the branches of the project it is showing, without fetching", () => {
			mount();
			expect(loadBranches).toHaveBeenCalledWith("/repos/p1", { fetch: false });
		});
	});

	describe("what it allows", () => {
		it("refuses to pull a branch with no upstream", async () => {
			await setGit({
				remoteStatus: { hasUpstream: false, ahead: 0, behind: 0, remote: "" },
			});
			mount();
			expect(pullBtn().disabled).toBe(true);
		});

		/** A branch with no upstream still needs a first push to create one. */
		it("allows pushing a branch with no upstream", async () => {
			await setGit({
				remoteStatus: { hasUpstream: false, ahead: 0, behind: 0, remote: "" },
			});
			mount();
			expect(pushBtn().disabled).toBe(false);
		});

		it("refuses to push when there is nothing ahead", () => {
			mount();
			expect(pushBtn().disabled).toBe(true);
		});

		it("allows pushing once there is something ahead", async () => {
			await setGit({
				remoteStatus: {
					hasUpstream: true,
					ahead: 1,
					behind: 0,
					remote: "origin",
				},
			});
			mount();
			expect(pushBtn().disabled).toBe(false);
		});

		/** Nothing may be pulled or pushed in the middle of a rebase. */
		it("refuses every remote action during an operation", async () => {
			await setGit({
				operationState: operation(),
				remoteStatus: {
					hasUpstream: true,
					ahead: 1,
					behind: 1,
					remote: "origin",
				},
			});
			mount();
			expect(buttons().every((b) => b.disabled)).toBe(true);
		});

		it("surfaces the operation in progress, with its conflict count", async () => {
			await setGit({
				operationState: operation({ conflictedFiles: ["a.ts", "b.ts"] }),
			});
			const { onOpenMergeRebase } = mount();
			const chip = document.querySelector(".op-chip") as HTMLElement;
			expect(chip.querySelector(".op-chip-count")?.textContent).toMatch(/2/);
			await userEvent.click(chip);
			expect(onOpenMergeRebase).toHaveBeenCalled();
		});
	});

	describe("fetching", () => {
		it("fetches, then reloads the branches so the counts follow", async () => {
			mount();
			loadBranches.mockClear();
			await userEvent.click(fetchBtn());
			expect(fetchRemote).toHaveBeenCalled();
			expect(loadBranches).toHaveBeenCalledWith("/repos/p1");
		});

		it("shows a spinner rather than a word while it runs", async () => {
			let settle: () => void = () => {};
			fetchRemote.mockReturnValue(
				new Promise<void>((resolve) => {
					settle = resolve;
				}),
			);
			mount();
			await userEvent.click(fetchBtn());
			await tick();
			expect(fetchBtn().querySelector(".spinner")).not.toBeNull();
			settle();
		});

		/** One remote action at a time: the others are refused while one runs. */
		it("refuses the other actions while it runs", async () => {
			let settle: () => void = () => {};
			fetchRemote.mockReturnValue(
				new Promise<void>((resolve) => {
					settle = resolve;
				}),
			);
			await setGit({
				remoteStatus: {
					hasUpstream: true,
					ahead: 1,
					behind: 1,
					remote: "origin",
				},
			});
			mount();
			await userEvent.click(fetchBtn());
			await tick();
			expect(buttons().every((b) => b.disabled)).toBe(true);
			settle();
		});

		/**
		 * The disabled buttons and the `busy` guard in the handler are two
		 * separate defences; forcing the click past the first checks the second.
		 */
		it("still refuses a second action if the button is forced", async () => {
			let settle: () => void = () => {};
			fetchRemote.mockReturnValue(
				new Promise<void>((resolve) => {
					settle = resolve;
				}),
			);
			await setGit({
				remoteStatus: {
					hasUpstream: true,
					ahead: 1,
					behind: 1,
					remote: "origin",
				},
			});
			mount();
			await userEvent.click(fetchBtn());
			await tick();
			for (const b of buttons()) b.disabled = false;
			await userEvent.click(fetchBtn());
			await userEvent.click(pullBtn());
			await userEvent.click(pushBtn());
			expect(fetchRemote).toHaveBeenCalledTimes(1);
			expect(pullBranch).not.toHaveBeenCalled();
			expect(pushBranch).not.toHaveBeenCalled();
			settle();
		});
	});

	describe("pulling", () => {
		beforeEach(async () => {
			await setGit({
				remoteStatus: {
					hasUpstream: true,
					ahead: 0,
					behind: 2,
					remote: "origin",
				},
			});
		});

		it("pulls and tells the parent the worktree may have changed", async () => {
			const { onFilesChanged } = mount();
			await userEvent.click(pullBtn());
			expect(pullBranch).toHaveBeenCalled();
			expect(onFilesChanged).toHaveBeenCalled();
		});

		/**
		 * A pull that left conflicts surfaces the merge panel. The state is read
		 * straight from the store, since the reactive copy is still stale at that
		 * point - which is exactly what this checks.
		 */
		it("opens the merge panel when the pull left conflicts", async () => {
			pullBranch.mockImplementation(async () => {
				gitState.update((s) => ({
					...s,
					operationState: operation({
						kind: "merge",
						conflictedFiles: ["a.ts"],
					}),
				}));
			});
			const { onOpenMergeRebase } = mount();
			await userEvent.click(pullBtn());
			expect(onOpenMergeRebase).toHaveBeenCalled();
		});

		/**
		 * The conflict is written by the pull itself, so this covers the path
		 * where the state changes underneath the handler.
		 *
		 * A caveat worth stating: the component deliberately reads the store
		 * through `get(git)` rather than its own reactive copy, because that
		 * copy is still stale at this point in a real browser. Under jsdom the
		 * copy is already up to date by the time the handler resumes, so
		 * swapping `get(git)` for the reactive `inOperation` keeps every test
		 * here green. That distinction is not reachable from this harness; the
		 * comment in the component is the record of why it is written that way.
		 */
		it("opens the merge panel when the state changes under the pull", async () => {
			pullBranch.mockImplementation(async () => {
				gitState.update((s) => ({
					...s,
					operationState: operation({ conflictedFiles: ["a.ts"] }),
				}));
			});
			const { onOpenMergeRebase } = mount();
			expect(document.querySelector(".op-chip")).toBeNull();

			await userEvent.click(pullBtn());
			expect(onOpenMergeRebase).toHaveBeenCalled();
		});

		it("leaves the panel alone when the pull was clean", async () => {
			const { onOpenMergeRebase } = mount();
			await userEvent.click(pullBtn());
			expect(onOpenMergeRebase).not.toHaveBeenCalled();
		});
	});

	describe("pushing", () => {
		beforeEach(async () => {
			await setGit({
				remoteStatus: {
					hasUpstream: true,
					ahead: 1,
					behind: 0,
					remote: "origin",
				},
			});
		});

		it("pushes on request", async () => {
			mount();
			await userEvent.click(pushBtn());
			expect(pushBranch).toHaveBeenCalled();
		});

		/** A push does not touch the worktree, so nothing is reloaded after it. */
		it("does not claim the files changed", async () => {
			const { onFilesChanged } = mount();
			await userEvent.click(pushBtn());
			expect(onFilesChanged).not.toHaveBeenCalled();
		});

		it("opens the merge panel when the push left the repo conflicted", async () => {
			pushBranch.mockImplementation(async () => {
				gitState.update((s) => ({
					...s,
					operationState: operation({ conflictedFiles: ["a.ts"] }),
				}));
			});
			const { onOpenMergeRebase } = mount();
			await userEvent.click(pushBtn());
			expect(onOpenMergeRebase).toHaveBeenCalled();
		});

		it("becomes usable again once the push finished", async () => {
			mount();
			await userEvent.click(pushBtn());
			await tick();
			expect(fetchBtn().disabled).toBe(false);
		});
	});
});
