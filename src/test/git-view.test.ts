// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanup, render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GitDiffHunk } from "#lib/services/git-service";

/** The heavy children are covered by their own suites; here they only mount. */
vi.mock("#lib/components/git/GraphView.svelte", async () => ({
	default: (await import("./stubs/DiffEditorStub.svelte")).default,
}));
vi.mock("#lib/components/git/StashView.svelte", async () => ({
	default: (await import("./stubs/DiffEditorStub.svelte")).default,
}));
vi.mock("#lib/components/git/MergeRebaseView.svelte", async () => ({
	default: (await import("./stubs/DiffEditorStub.svelte")).default,
}));
vi.mock("#lib/components/git/GitignoreView.svelte", async () => ({
	default: (await import("./stubs/DiffEditorStub.svelte")).default,
}));
vi.mock("#lib/components/git/GitDiff.svelte", async () => ({
	default: (await import("./stubs/DiffEditorStub.svelte")).default,
}));

vi.mock("#lib/services/git-collapse-state-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	saveGitCollapseState: vi.fn((..._a: unknown[]) => undefined),
	getGitCollapseState: vi.fn(async (..._a: unknown[]) => ({
		unstaged: [],
		staged: [],
	})),
}));

const checkIgnore = vi.fn<(...a: unknown[]) => unknown>();
const getDiffCommit = vi.fn<(...a: unknown[]) => unknown>();
const getCommitBody = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("#lib/services/git-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	checkIgnore: (...a: unknown[]) => checkIgnore(...a),
	getDiffCommit: (...a: unknown[]) => getDiffCommit(...a),
	getCommitBody: (...a: unknown[]) => getCommitBody(...a),
}));

const readFile = vi.fn<(...a: unknown[]) => unknown>();
const readFilePreview = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("#lib/services/file-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	readFile: (...a: unknown[]) => readFile(...a),
	readFilePreview: (...a: unknown[]) => readFilePreview(...a),
	fileMtimes: async () => ({}),
}));

const gitState = writable<Record<string, unknown>>({});
const draftState = writable({ message: "", body: "" });
const stageFile = vi.fn<(...a: unknown[]) => unknown>();
const stageFiles = vi.fn<(...a: unknown[]) => unknown>();
const unstageFile = vi.fn<(...a: unknown[]) => unknown>();
const unstageFiles = vi.fn<(...a: unknown[]) => unknown>();
const discardFile = vi.fn<(...a: unknown[]) => unknown>();
const discardFiles = vi.fn<(...a: unknown[]) => unknown>();
const commitChanges = vi.fn<(...a: unknown[]) => unknown>();
const amendLastCommit = vi.fn<(...a: unknown[]) => unknown>();
const pushBranch = vi.fn<(...a: unknown[]) => unknown>();
const pushStash = vi.fn<(...a: unknown[]) => unknown>();
const setCommitMessage = vi.fn<(...a: unknown[]) => unknown>();
const setCommitBody = vi.fn<(...a: unknown[]) => unknown>();
const refreshStatus = vi.fn<(...a: unknown[]) => unknown>();
const noop = () => vi.fn(async (..._a: unknown[]) => undefined);
vi.mock("#lib/stores/git", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	git: { subscribe: gitState.subscribe },
	commitDraft: { subscribe: draftState.subscribe },
	stageFile: (...a: unknown[]) => stageFile(...a),
	stageFiles: (...a: unknown[]) => stageFiles(...a),
	unstageFile: (...a: unknown[]) => unstageFile(...a),
	unstageFiles: (...a: unknown[]) => unstageFiles(...a),
	discardFile: (...a: unknown[]) => discardFile(...a),
	discardFiles: (...a: unknown[]) => discardFiles(...a),
	commitChanges: (...a: unknown[]) => commitChanges(...a),
	amendLastCommit: (...a: unknown[]) => amendLastCommit(...a),
	pushBranch: (...a: unknown[]) => pushBranch(...a),
	pushStash: (...a: unknown[]) => pushStash(...a),
	setCommitMessage: (...a: unknown[]) => setCommitMessage(...a),
	setCommitBody: (...a: unknown[]) => setCommitBody(...a),
	refreshStatus: (...a: unknown[]) => refreshStatus(...a),
	setDiffsWanted: noop(),
	setVisibleDiffPaths: noop(),
	refreshLog: noop(),
	loadMoreLog: noop(),
	loadAllLog: noop(),
	refreshGraph: noop(),
	loadMoreGraph: noop(),
	loadAllGraph: noop(),
	refreshStashes: noop(),
	refreshTags: noop(),
	getStashDiff: noop(),
	getHeadCommitMessage: noop(),
	revertCommit: noop(),
	clearGitError: noop(),
	recoverFromGitError: noop(),
	getRemoteUrl: vi.fn(async (..._a: unknown[]) => ""),
	gitFileCounts: { subscribe: writable({ total: 0 }).subscribe },
}));

const activeInstance = writable<unknown>(null);
const instancesStore = writable<unknown[]>([]);
vi.mock("#lib/stores/instance", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	activeInstance: { subscribe: activeInstance.subscribe },
	instances: { subscribe: instancesStore.subscribe },
}));

// The assists refuse to run when their CLI is not installed, so the detection
// answers as if it were rather than leaving every AI button disabled.
vi.mock("#lib/stores/cli-providers", async (importOriginal) => {
	const { readable } = await import("svelte/store");
	return {
		...(await importOriginal<Record<string, unknown>>()),
		loadCliProviders: vi.fn(async () => {}),
		isAssistCliInstalled: readable(() => true),
		anyAssistCliInstalled: readable(true),
	};
});

const runOneShot = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("#lib/services/ai-assist-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	runOneShotShaped: (...a: unknown[]) => runOneShot(...a),
}));

const settingsState = writable<Record<string, unknown>>({});
vi.mock("#lib/stores/settings", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	settings: { subscribe: settingsState.subscribe },
}));

const { gitLeftTab } = await import("#lib/stores/ui");
const { activeProjectId, projects } = await import("#lib/stores/project");
const { updateProjectViewState } = await import("#lib/stores/view-state");
const { project } = await import("./fixtures");
const { default: GitView } = await import("#lib/components/git/GitView.svelte");

function hunk(added: number, removed: number): GitDiffHunk {
	return {
		header: "@@ -1,1 +1,1 @@",
		lines: [
			...Array.from({ length: added }, () => ({
				kind: "add" as const,
				content: "x",
			})),
			...Array.from({ length: removed }, () => ({
				kind: "remove" as const,
				content: "y",
			})),
		],
	};
}

function diff(filePath: string, added = 1, removed = 0, truncated = false) {
	return { filePath, hunks: [hunk(added, removed)], truncated };
}

type TestDiff = { filePath: string; oldPath?: string };

/**
 * `unstagedDiffs` and `stagedDiffs` describe what git would report: they land
 * in the status the cards are listed from, and as the diffs already read.
 */
function setGit(overrides: Record<string, unknown> = {}) {
	const {
		commitMessage,
		commitBody,
		unstagedDiffs = [],
		stagedDiffs = [],
		...rest
	} = overrides as Record<string, unknown> & {
		unstagedDiffs?: TestDiff[];
		stagedDiffs?: TestDiff[];
	};
	const byPath = (list: TestDiff[]) =>
		Object.fromEntries(list.map((d) => [d.filePath, d]));
	const renames = Object.fromEntries(
		stagedDiffs.filter((d) => d.oldPath).map((d) => [d.filePath, d.oldPath]),
	);
	gitState.set({
		isGitRepo: true,
		status: {},
		statusWorktree: "/wt",
		changedPaths: {
			staged: stagedDiffs.map((d) => d.filePath),
			unstaged: unstagedDiffs.map((d) => d.filePath),
			stagedCodes: Object.fromEntries(
				stagedDiffs.map((d) => [d.filePath, d.oldPath ? "R" : "M"]),
			),
			renames,
		},
		fileDiffs: { unstaged: byPath(unstagedDiffs), staged: byPath(stagedDiffs) },
		stagedTotals: null,
		isStagedTotalsPending: false,
		log: [],
		graph: [],
		stashes: [],
		tags: [],
		branches: ["main"],
		remoteBranches: [],
		currentBranch: "main",
		remoteStatus: { hasUpstream: true, ahead: 0, behind: 0 },
		operationState: null,
		error: null,
		...rest,
	});
	draftState.set({
		message: (commitMessage as string | undefined) ?? "",
		body: (commitBody as string | undefined) ?? "",
	});
}

function mount() {
	const onOpenFile = vi.fn();
	const onFileDiscarded = vi.fn();
	render(GitView, {
		props: {},
		events: {
			openFile: (e: CustomEvent) => onOpenFile(e.detail),
			fileDiscarded: (e: CustomEvent) => onFileDiscarded(e.detail),
			filesChanged: vi.fn(),
			createInstanceFromRef: vi.fn(),
			goGitSettings: vi.fn(),
		},
	});
	return { onOpenFile, onFileDiscarded };
}

/** Unstaged rows carry a Stage button; staged ones carry Unstage. */
const unstagedList = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".hunk-card-head")).filter(
		(c) => c.querySelector(".stage-btn"),
	);
const cardFor = (name: string) =>
	unstagedList().find((c) =>
		c.querySelector(".file-basename")?.textContent?.includes(name),
	) as HTMLElement;
const cardNames = () =>
	unstagedList().map((c) =>
		c.querySelector(".file-basename")?.textContent?.trim(),
	);
const statOf = (card: HTMLElement) => ({
	add: card.querySelector(".stat-add")?.textContent ?? "",
	remove: card.querySelector(".stat-remove")?.textContent ?? "",
});
const selectAll = () =>
	document.querySelector(".select-all-cb") as HTMLInputElement;
const bulkButton = (re: RegExp) =>
	Array.from(document.querySelectorAll<HTMLButtonElement>(".bulk-btn")).find(
		(b) => re.test(b.textContent ?? ""),
	) as HTMLButtonElement;
const commitButtons = () =>
	Array.from(
		document.querySelectorAll<HTMLButtonElement>(".btn.ghost, .btn.primary"),
	);
const selectionCount = () =>
	document.querySelector(".selection-count")?.textContent;

async function settle() {
	for (let i = 0; i < 30; i++) await tick();
}

/**
 * The search box writes through `updateProjectViewState` rather than holding
 * its own value, so a test drives it the way the input does.
 */
async function typeSearch(text: string) {
	updateProjectViewState({ gitChangesSearch: text });
	await settle();
}

beforeEach(() => {
	// A previous mount can still resolve its untracked scan onto shared state.
	cleanup();
	vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
		fn(0);
		return 0;
	});
	// jsdom ships no ResizeObserver; the commit box observes its own textarea.
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	checkIgnore.mockReset().mockResolvedValue([]);
	getDiffCommit.mockReset().mockResolvedValue([]);
	getCommitBody.mockReset().mockResolvedValue("");
	readFile.mockReset().mockResolvedValue("");
	readFilePreview.mockReset().mockResolvedValue({ content: "", size: 0 });
	for (const fn of [
		stageFile,
		stageFiles,
		unstageFile,
		unstageFiles,
		discardFile,
		discardFiles,
		commitChanges,
		amendLastCommit,
		pushBranch,
		pushStash,
		refreshStatus,
	])
		fn.mockReset().mockResolvedValue(undefined);
	setCommitMessage.mockReset();
	setCommitBody.mockReset();
	runOneShot
		.mockReset()
		.mockResolvedValue({ commitTitle: "", commitDescription: "" });
	settingsState.set({ gitProfiles: [], aiFeatures: {} });
	activeInstance.set({
		id: "i1",
		projectId: "p1",
		worktreePath: "/wt",
		branch: "feature",
		ticket: { id: "CAIRN-42", title: "Login" },
	});
	instancesStore.set([]);
	projects.set([project("p1")]);
	activeProjectId.set("p1");
	// The view state is module-level and survives a mount, and a write of an
	// unchanged value is dropped: a search left by an earlier test would make
	// the next one a silent no-op.
	updateProjectViewState({
		gitChangesSearch: "",
		gitStagedSearch: "",
		gitLogSearch: "",
	});
	gitLeftTab.set("changes");
	setGit();
});

describe("GitView", () => {
	describe("the change cards", () => {
		it("lists a card per changed file", async () => {
			setGit({ unstagedDiffs: [diff("src/a.ts"), diff("src/b.ts")] });
			mount();
			await settle();
			expect(cardNames()).toEqual(["a.ts", "b.ts"]);
		});

		/** Cards are ordered by file name, not by the order git listed them. */
		it("orders the cards by file name", async () => {
			setGit({ unstagedDiffs: [diff("src/z.ts"), diff("src/a.ts")] });
			mount();
			await settle();
			expect(cardNames()).toEqual(["a.ts", "z.ts"]);
		});

		it("counts the added and removed lines of a file", async () => {
			setGit({ unstagedDiffs: [diff("src/a.ts", 3, 2)] });
			mount();
			await settle();
			expect(statOf(cardFor("a.ts"))).toEqual({ add: "+3", remove: "-2" });
		});

		/** The status says a file is gone; a diff of removals only may be a file that was shortened. */
		it("offers no open button for a file the status reports deleted", async () => {
			setGit({
				unstagedDiffs: [diff("src/a.ts", 0, 4)],
				status: { "src/a.ts": "deleted" },
			});
			mount();
			await settle();
			expect(cardFor("a.ts").querySelector(".open-file-btn")).toBeNull();
		});

		it("still opens a file that only lost lines", async () => {
			setGit({ unstagedDiffs: [diff("src/a.ts", 0, 4)] });
			mount();
			await settle();
			expect(cardFor("a.ts").querySelector(".open-file-btn")).not.toBeNull();
		});

		it("lists a modified file before its diff is read, with a placeholder", async () => {
			setGit({
				changedPaths: { staged: [], unstaged: ["src/a.ts"] },
				status: { "src/a.ts": "modified" },
			});
			mount();
			await settle();
			expect(cardNames()).toContain("a.ts");
			expect(
				cardFor("a.ts").closest(".hunk-card")?.querySelector(".hunk-pending"),
			).not.toBeNull();
		});

		it("shows a placeholder on the staged totals while they are counted again", async () => {
			setGit({
				stagedDiffs: [diff("src/a.ts")],
				stagedTotals: { added: 3, removed: 1 },
				isStagedTotalsPending: true,
			});
			mount();
			await settle();
			expect(document.querySelector(".diff-stat-pending")).not.toBeNull();
		});

		it("shows the staged totals of the whole index", async () => {
			setGit({
				stagedDiffs: [diff("src/a.ts")],
				stagedTotals: { added: 3, removed: 1 },
			});
			mount();
			await settle();
			expect(document.querySelector(".diff-stat-pending")).toBeNull();
			const head = document.querySelector(".git-col-head .diff-stat");
			expect(head?.textContent?.replace(/\s+/g, "")).toBe("+3-1");
		});

		it("offers to open a modified file", async () => {
			setGit({ unstagedDiffs: [diff("src/a.ts", 2, 1)] });
			const { onOpenFile } = mount();
			await settle();
			await userEvent.click(
				cardFor("a.ts").querySelector(".open-file-btn") as HTMLElement,
			);
			expect(onOpenFile).toHaveBeenCalledWith("src/a.ts");
		});

		/** An untracked file is rendered as a whole-file addition. */
		it("shows an untracked file as an addition", async () => {
			readFilePreview.mockResolvedValue({ content: "", size: 8 });
			readFile.mockResolvedValue("one\ntwo\n");
			setGit({ status: { "src/new.ts": "untracked" } });
			mount();
			await vi.waitFor(() => expect(statOf(cardFor("new.ts")).add).toBe("+2"));
		});

		it("lists an untracked file at once and shows a placeholder until it is read", async () => {
			readFile.mockReturnValue(new Promise(() => {}));
			readFilePreview.mockResolvedValue({ content: "", size: 8 });
			setGit({ status: { "src/new.ts": "untracked" } });
			mount();
			await settle();
			expect(cardNames()).toContain("new.ts");
			expect(
				cardFor("new.ts").closest(".hunk-card")?.querySelector(".hunk-pending"),
			).not.toBeNull();
		});

		it("reads only the untracked files on screen, and more as the list grows", async () => {
			readFilePreview.mockResolvedValue({ content: "", size: 8 });
			readFile.mockResolvedValue("one\n");
			const status = Object.fromEntries(
				Array.from({ length: 60 }, (_, i) => [
					`src/f${String(i).padStart(2, "0")}.ts`,
					"untracked",
				]),
			);
			setGit({ status });
			mount();
			await vi.waitFor(() => expect(readFile).toHaveBeenCalledTimes(25));
			await settle();
			expect(readFile).toHaveBeenCalledTimes(25);
			expect(readFile).not.toHaveBeenCalledWith("/wt/src/f30.ts");

			await userEvent.click(
				document.querySelector(".load-more-cards") as HTMLElement,
			);
			await vi.waitFor(() => expect(readFile).toHaveBeenCalledTimes(50));
		});

		it("keeps the fold of collapse all on cards read after it", async () => {
			readFilePreview.mockResolvedValue({ content: "", size: 8 });
			readFile.mockResolvedValue("one\n");
			const status = Object.fromEntries(
				Array.from({ length: 30 }, (_, i) => [
					`src/f${String(i).padStart(2, "0")}.ts`,
					"untracked",
				]),
			);
			setGit({ status });
			mount();
			await vi.waitFor(() => expect(readFile).toHaveBeenCalledTimes(25));
			await userEvent.click(
				document.querySelector(".collapse-toggle-btn") as HTMLElement,
			);
			await userEvent.click(
				document.querySelector(".load-more-cards") as HTMLElement,
			);
			await vi.waitFor(() => expect(statOf(cardFor("f29.ts")).add).toBe("+1"));
			for (const name of ["f00.ts", "f29.ts"]) {
				expect(cardFor(name).closest(".hunk-card")?.classList).toContain(
					"collapsed",
				);
			}
		});

		it("trusts the status to have left ignored files out", async () => {
			setGit({ status: { "src/new.ts": "untracked" } });
			mount();
			await vi.waitFor(() => expect(cardNames()).toContain("new.ts"));
			expect(checkIgnore).not.toHaveBeenCalled();
		});

		it("says when a diff was cut short", async () => {
			setGit({ unstagedDiffs: [diff("src/a.ts", 1, 0, true)] });
			mount();
			await settle();
			expect(document.querySelector(".hunk-truncated")).not.toBeNull();
		});
	});

	describe("staging", () => {
		it("stages the file that was asked for", async () => {
			setGit({ unstagedDiffs: [diff("src/a.ts")] });
			mount();
			await settle();
			await userEvent.click(
				cardFor("a.ts").querySelector(".stage-btn") as HTMLElement,
			);
			expect(stageFile).toHaveBeenCalledWith("src/a.ts");
		});

		it("stages every selected file at once", async () => {
			setGit({ unstagedDiffs: [diff("src/a.ts"), diff("src/b.ts")] });
			mount();
			await settle();
			await userEvent.click(
				cardFor("a.ts").querySelector(".file-select-cb") as HTMLElement,
			);
			await settle();
			await userEvent.click(bulkButton(/stage/i));
			await settle();
			expect(stageFiles).toHaveBeenCalledWith(["src/a.ts"]);
		});

		it("counts what is selected", async () => {
			setGit({ unstagedDiffs: [diff("src/a.ts"), diff("src/b.ts")] });
			mount();
			await settle();
			await userEvent.click(
				cardFor("a.ts").querySelector(".file-select-cb") as HTMLElement,
			);
			await settle();
			expect(selectionCount()).toBe("1");
		});

		it("selects and clears every visible card at once", async () => {
			setGit({ unstagedDiffs: [diff("src/a.ts"), diff("src/b.ts")] });
			mount();
			await settle();
			await userEvent.click(selectAll());
			await settle();
			expect(selectionCount()).toBe("2");
			await userEvent.click(selectAll());
			await settle();
			expect(selectionCount()).toBeUndefined();
		});

		/** A file that is no longer changed drops out of the selection. */
		it("drops a file that left the list from the selection", async () => {
			setGit({ unstagedDiffs: [diff("src/a.ts"), diff("src/b.ts")] });
			mount();
			await settle();
			await userEvent.click(selectAll());
			await settle();
			setGit({ unstagedDiffs: [diff("src/a.ts")] });
			await settle();
			expect(selectionCount()).toBe("1");
		});

		it("unstages the file that was asked for", async () => {
			setGit({ stagedDiffs: [diff("src/a.ts")] });
			mount();
			await settle();
			await userEvent.click(
				document.querySelector(".unstage-btn") as HTMLElement,
			);
			expect(unstageFiles).toHaveBeenCalledWith(["src/a.ts"]);
		});

		it("shows a pure rename with its former path and unstages both ends", async () => {
			setGit({
				stagedDiffs: [{ filePath: "src/b.ts", oldPath: "src/a.ts", hunks: [] }],
			});
			mount();
			await settle();
			const card = document
				.querySelector(".file-renamed")
				?.closest(".hunk-card") as HTMLElement;
			expect(card.querySelector(".file-renamed")?.textContent).toBe(
				"from src/a.ts",
			);
			expect(card.querySelector(".hunk-no-preview")?.textContent).toBe(
				"Renamed, content unchanged.",
			);
			await userEvent.click(card.querySelector(".unstage-btn") as HTMLElement);
			expect(unstageFiles).toHaveBeenCalledWith(["src/b.ts", "src/a.ts"]);
		});
	});

	describe("discarding", () => {
		it("asks before discarding a file", async () => {
			setGit({ unstagedDiffs: [diff("src/a.ts")] });
			const { onFileDiscarded } = mount();
			await settle();
			await userEvent.click(
				cardFor("a.ts").querySelector(".discard-btn") as HTMLElement,
			);
			await settle();
			expect(discardFile).not.toHaveBeenCalled();
			expect(onFileDiscarded).not.toHaveBeenCalled();
			expect(document.querySelector(".modal-backdrop")).not.toBeNull();
		});

		/** The editor is told, so it can drop the buffer it was showing. */
		it("discards the file and tells the editor", async () => {
			setGit({ unstagedDiffs: [diff("src/a.ts")] });
			const { onFileDiscarded } = mount();
			await settle();
			await userEvent.click(
				cardFor("a.ts").querySelector(".discard-btn") as HTMLElement,
			);
			await settle();
			await userEvent.click(
				document.querySelector(".modal .btn.danger") as HTMLElement,
			);
			await settle();
			expect(discardFile).toHaveBeenCalledWith("src/a.ts");
			expect(onFileDiscarded).toHaveBeenCalledWith("src/a.ts");
		});

		/** Every discarded path is reported, one by one. */
		it("discards every selected file and reports each", async () => {
			setGit({ unstagedDiffs: [diff("src/a.ts"), diff("src/b.ts")] });
			const { onFileDiscarded } = mount();
			await settle();
			await userEvent.click(selectAll());
			await settle();
			await userEvent.click(bulkButton(/discard/i));
			await settle();
			await userEvent.click(
				document.querySelector(".modal .btn.danger") as HTMLElement,
			);
			await settle();
			expect(discardFiles).toHaveBeenCalledWith(["src/a.ts", "src/b.ts"]);
			expect(onFileDiscarded).toHaveBeenCalledTimes(2);
		});
	});

	describe("committing", () => {
		it("refuses to commit with nothing staged", async () => {
			setGit({ commitMessage: "feat: x" });
			mount();
			await settle();
			expect(commitButtons().every((b) => b.disabled)).toBe(true);
		});

		it("refuses to commit with no message", async () => {
			setGit({ stagedDiffs: [diff("src/a.ts")] });
			mount();
			await settle();
			expect(commitButtons().some((b) => !b.disabled)).toBe(false);
		});

		it("clears the message and the description in one click", async () => {
			setGit({
				stagedDiffs: [diff("src/a.ts")],
				commitMessage: "feat: x",
				commitBody: "why",
			});
			mount();
			await settle();
			await userEvent.click(
				document.querySelector(".clear-draft-btn") as HTMLElement,
			);
			expect(setCommitMessage).toHaveBeenCalledWith("");
			expect(setCommitBody).toHaveBeenCalledWith("");
			expect(document.activeElement).toBe(
				document.querySelector(".commit-title"),
			);
		});

		it("cannot clear while a commit or a push is in flight", async () => {
			let release = () => {};
			commitChanges.mockImplementation(
				() => new Promise<void>((r) => (release = r)),
			);
			setGit({ stagedDiffs: [diff("src/a.ts")], commitMessage: "feat: x" });
			mount();
			await settle();
			const clear = () =>
				document.querySelector(".clear-draft-btn") as HTMLButtonElement;
			await userEvent.click(
				commitButtons().find((b) => !b.disabled) as HTMLElement,
			);
			await settle();
			expect(clear().disabled).toBe(true);
			release();
			await settle();
			expect(clear().disabled).toBe(false);
		});

		it("has nothing to clear while both fields are empty", async () => {
			setGit({ stagedDiffs: [diff("src/a.ts")] });
			mount();
			await settle();
			expect(
				(document.querySelector(".clear-draft-btn") as HTMLButtonElement)
					.disabled,
			).toBe(true);
		});

		it("commits the message that was written", async () => {
			setGit({
				stagedDiffs: [diff("src/a.ts")],
				commitMessage: "feat: add login",
			});
			mount();
			await settle();
			await userEvent.click(
				commitButtons().find((b) => !b.disabled) as HTMLElement,
			);
			await settle();
			expect(commitChanges).toHaveBeenCalledTimes(1);
			expect(commitChanges.mock.calls[0][0]).toBe("feat: add login");
		});

		/** Title and body are joined by a blank line, as git expects. */
		it("joins the body to the title with a blank line", async () => {
			setGit({
				stagedDiffs: [diff("src/a.ts")],
				commitMessage: "feat: add login",
				commitBody: "Why this change.",
			});
			mount();
			await settle();
			await userEvent.click(
				commitButtons().find((b) => !b.disabled) as HTMLElement,
			);
			await settle();
			expect(commitChanges.mock.calls[0][0]).toBe(
				"feat: add login\n\nWhy this change.",
			);
		});

		it("commits the title alone when there is no body", async () => {
			setGit({
				stagedDiffs: [diff("src/a.ts")],
				commitMessage: "feat: add login",
				commitBody: "   ",
			});
			mount();
			await settle();
			await userEvent.click(
				commitButtons().find((b) => !b.disabled) as HTMLElement,
			);
			await settle();
			expect(commitChanges.mock.calls[0][0]).toBe("feat: add login");
		});

		/** The instance ticket can be appended to the subject on request. */
		it("appends the ticket id when asked", async () => {
			setGit({
				stagedDiffs: [diff("src/a.ts")],
				commitMessage: "feat: add login",
			});
			mount();
			await settle();
			await userEvent.click(
				document.querySelector(".options-btn, .commit-options-btn") ??
					(Array.from(document.querySelectorAll<HTMLElement>("button")).find(
						(b) => b.className.includes("option"),
					) as HTMLElement),
			);
			await settle();
			const toggles = Array.from(
				document.querySelectorAll<HTMLInputElement>(
					'.commit-options input[type="checkbox"]',
				),
			);
			const ticketToggle = toggles.find((el) =>
				el
					.closest(".option-item")
					?.textContent?.toLowerCase()
					.includes("ticket id"),
			);
			await userEvent.click(ticketToggle as HTMLElement);
			await settle();
			await userEvent.click(
				commitButtons().find((b) => !b.disabled) as HTMLElement,
			);
			await settle();
			expect(commitChanges.mock.calls[0][0]).toBe("feat: add login, CAIRN-42");
		});

		/** An author profile overrides who the commit is attributed to. */
		it("commits under the chosen author profile", async () => {
			settingsState.set({
				gitProfiles: [
					{ id: "g1", label: "Work", name: "Alice", email: "a@x.dev" },
				],
				aiFeatures: {},
			});
			setGit({
				stagedDiffs: [diff("src/a.ts")],
				commitMessage: "feat: add login",
			});
			mount();
			await settle();
			const profileButton = document.querySelector(
				".profile-trigger",
			) as HTMLElement;
			expect(profileButton).not.toBeNull();
			await userEvent.click(profileButton);
			await settle();
			const option = Array.from(
				document.querySelectorAll<HTMLElement>(".profile-opt"),
			).find((b) => b.textContent?.includes("Work")) as HTMLElement;
			expect(option).toBeDefined();
			await userEvent.click(option);
			await settle();
			await userEvent.click(
				commitButtons().find((b) => !b.disabled) as HTMLElement,
			);
			await settle();
			expect(commitChanges).toHaveBeenCalledTimes(1);
			expect(commitChanges.mock.calls[0][1]).toMatchObject({
				authorName: "Alice",
				authorEmail: "a@x.dev",
			});
		});

		it("commits and pushes on the primary action", async () => {
			setGit({
				stagedDiffs: [diff("src/a.ts")],
				commitMessage: "feat: add login",
			});
			mount();
			await settle();
			await userEvent.click(
				document.querySelector(".btn.primary") as HTMLElement,
			);
			await settle();
			expect(commitChanges).toHaveBeenCalledWith(
				"feat: add login",
				expect.objectContaining({ allowEmpty: false }),
			);
			expect(pushBranch).toHaveBeenCalledWith();
		});
	});

	describe("writing the commit message with the agent", () => {
		const aiButton = () =>
			document.querySelector(".ai-suggest") as HTMLButtonElement;

		/**
		 * The CLI is held to `{ commitTitle, commitDescription }` by its schema flag, so both
		 * fields arrive as fields - nothing is hunted for in a block of text.
		 */
		it("fills both fields from the answer's own fields", async () => {
			runOneShot.mockResolvedValue({
				commitTitle: "feat(auth): add login",
				commitDescription: "Why it matters.",
			});
			setGit({ stagedDiffs: [diff("src/a.ts")] });
			mount();
			await settle();
			await userEvent.click(aiButton());
			await settle();
			expect(setCommitMessage).toHaveBeenCalledWith("feat(auth): add login");
			expect(setCommitBody).toHaveBeenCalledWith("Why it matters.");
		});

		/** A body that itself looks like a subject line stays the body. */
		it("never re-reads the subject out of the body", async () => {
			runOneShot.mockResolvedValue({
				commitTitle: "chore: bump",
				commitDescription: "feat: this line only describes the change",
			});
			setGit({ stagedDiffs: [diff("src/a.ts")] });
			mount();
			await settle();
			await userEvent.click(aiButton());
			await settle();
			expect(setCommitMessage).toHaveBeenCalledWith("chore: bump");
		});

		it("asks the CLI for the commit shape", async () => {
			runOneShot.mockResolvedValue({
				commitTitle: "chore: bump",
				commitDescription: "",
			});
			setGit({ stagedDiffs: [diff("src/a.ts")] });
			mount();
			await settle();
			await userEvent.click(aiButton());
			await settle();
			const schema = runOneShot.mock.calls[0][3] as { required: string[] };
			expect(schema.required).toEqual(["commitTitle", "commitDescription"]);
		});

		/**
		 * An empty subject is a failed generation. Mounting restores the draft of
		 * the worktree, so the fields are written once before the click: what
		 * matters is that the answer adds nothing on top of it.
		 */
		it("leaves the fields alone when the subject is empty", async () => {
			runOneShot.mockResolvedValue({
				commitTitle: "   ",
				commitDescription: "unwanted",
			});
			setGit({ stagedDiffs: [diff("src/a.ts")] });
			mount();
			await settle();
			const before = setCommitMessage.mock.calls.length;
			await userEvent.click(aiButton());
			await settle();
			expect(setCommitMessage.mock.calls.length).toBe(before);
			expect(setCommitBody).not.toHaveBeenCalledWith("unwanted");
		});
	});

	describe("searching the changes", () => {
		it("keeps only the files the search matched", async () => {
			setGit({
				unstagedDiffs: [diff("src/alpha.ts"), diff("src/beta.ts")],
			});
			mount();
			await settle();
			await typeSearch("alpha");
			expect(cardNames()).toEqual(["alpha.ts"]);
		});

		/** Select-all only takes the cards the filter left showing. */
		it("selects only the files the search left", async () => {
			setGit({
				unstagedDiffs: [diff("src/alpha.ts"), diff("src/beta.ts")],
			});
			mount();
			await settle();
			await typeSearch("alpha");
			await userEvent.click(selectAll());
			await settle();
			await userEvent.click(bulkButton(/stage/i));
			await settle();
			expect(stageFiles).toHaveBeenCalledWith(["src/alpha.ts"]);
		});
	});

	describe("the left tabs", () => {
		it("opens the tab that was asked for", async () => {
			mount();
			await settle();
			gitLeftTab.set("graph");
			await settle();
			expect(document.querySelector(".hunk-card-head")).toBeNull();
		});
	});
});
