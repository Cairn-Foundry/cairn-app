// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// The write side of the git store: every mutation goes through `mutate`, which
// publishes the error and rethrows, and every command is scoped to the active
// instance worktree. What is checked here is the mapping result -> state -> UI,
// not the git calls themselves (git-service.test.ts covers those).

import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { instance, project } from "../../test/fixtures";

const service = vi.hoisted(() => ({
	commit: vi.fn(),
	amendCommit: vi.fn(),
	push: vi.fn(),
	pull: vi.fn(),
	fetch: vi.fn(),
	merge: vi.fn(),
	removeIndexLock: vi.fn(),
	stageFile: vi.fn(),
	getSnapshot: vi.fn(),
	getLog: vi.fn(),
	getGraph: vi.fn(),
	tagCreate: vi.fn(),
	tagPush: vi.fn(),
	tagDeleteRemote: vi.fn(),
	tagRemoteList: vi.fn(),
	getTagList: vi.fn(),
	deleteBranch: vi.fn(),
	deleteRemoteBranch: vi.fn(),
	renameBranch: vi.fn(),
	listRemotes: vi.fn(),
	addRemote: vi.fn(),
	renameRemote: vi.fn(),
	setRemoteUrl: vi.fn(),
	removeRemote: vi.fn(),
	initRepository: vi.fn(),
	getHeadMessage: vi.fn(),
	unstageFile: vi.fn(),
	stageAll: vi.fn(),
	unstageAll: vi.fn(),
	rebase: vi.fn(),
	rebaseContinue: vi.fn(),
	rebaseSkip: vi.fn(),
	rebaseAbort: vi.fn(),
	rmFile: vi.fn(),
	mergeContinue: vi.fn(),
	mergeAbort: vi.fn(),
	cherryPick: vi.fn(),
	cherryPickContinue: vi.fn(),
	cherryPickSkip: vi.fn(),
	cherryPickAbort: vi.fn(),
	getRemoteUrl: vi.fn(),
	getBranchDivergence: vi.fn(),
	checkoutBranch: vi.fn(),
	createBranch: vi.fn(),
	getGraphStashes: vi.fn(),
	getFileDiffs: vi.fn(),
	stageFiles: vi.fn(),
	unstageFiles: vi.fn(),
	discardFiles: vi.fn(),
	getStagedTotals: vi.fn(),
	getStashList: vi.fn(),
	readExclude: vi.fn(),
	writeExclude: vi.fn(),
	tagDelete: vi.fn(),
	stashPush: vi.fn(),
	discardFile: vi.fn(),
	stashPop: vi.fn(),
	stashApply: vi.fn(),
	stashDrop: vi.fn(),
	stashClear: vi.fn(),
	stashRename: vi.fn(),
	getStashShow: vi.fn(),
	revertCommit: vi.fn(),
	resetToCommit: vi.fn(),
	toGitError: vi.fn((e: unknown) => ({ code: "unknown", raw: String(e) })),
}));

vi.mock("#lib/services/git-service", () => ({
	...service,
	getStatusFull: vi.fn().mockResolvedValue({}),
	getChangedPaths: vi.fn().mockResolvedValue({ staged: [], unstaged: [] }),
	getDiffUnstaged: vi.fn().mockResolvedValue([]),
	getDiffStaged: vi.fn().mockResolvedValue([]),
	getCurrentBranch: vi.fn().mockResolvedValue("main"),
	getRemoteStatus: vi.fn().mockResolvedValue(null),
	getOperationState: vi.fn().mockResolvedValue(null),
}));

vi.mock("./terminal", () => ({
	removeInstanceTerminals: vi.fn().mockResolvedValue(undefined),
}));

const listInstances = vi.hoisted(() => vi.fn());
const branchLists = vi.hoisted(() => vi.fn());
vi.mock("#lib/services/instance-service", () => ({
	listInstances,
	listBranchesDetailed: branchLists,
	createInstance: vi.fn(),
	deleteInstance: vi.fn(),
	duplicateInstance: vi.fn(),
	updateInstanceStatus: vi.fn(),
}));

import {
	abortCherryPick,
	abortMerge,
	abortRebase,
	amendLastCommit,
	applyStash,
	checkoutBranch,
	cherryPickCommits,
	clearGitData,
	clearGitError,
	clearStashes,
	commitChanges,
	commitDraft,
	continueCherryPick,
	continueMerge,
	continueRebase,
	createBranch,
	createTag,
	deleteBranch,
	deleteRemoteBranch,
	deleteRemoteTag,
	deleteTag,
	discardFile,
	discardFiles,
	dropStash,
	editRemote,
	fetchRemote,
	getBranchDivergence,
	getHeadCommitMessage,
	getRemoteUrl,
	getStashDiff,
	git,
	gitFileCounts,
	gitHasConflicts,
	initRepository,
	loadAllGraph,
	loadAllLog,
	loadBranches,
	loadMoreGraph,
	loadMoreLog,
	mergeBranch,
	popStash,
	pullBranch,
	pushBranch,
	pushStash,
	pushTag,
	readExclude,
	rebaseOnto,
	recoverFromGitError,
	refreshGraph,
	refreshLog,
	refreshRemotes,
	refreshRemoteTags,
	refreshStashes,
	refreshStatus,
	refreshTags,
	removeFile,
	renameBranch,
	renameStash,
	resetGitStore,
	resetToCommit,
	revertCommit,
	setCommitBody,
	setCommitMessage,
	setDiffsWanted,
	setVisibleDiffPaths,
	skipCherryPick,
	skipRebase,
	stageAll,
	stageFile,
	stageFiles,
	syncGraph,
	unstageAll,
	unstageFile,
	unstageFiles,
	writeExclude,
} from "./git";
import { activeInstance, loadInstances } from "./instance";
import { activeProjectId, projects } from "./project";

const WORKTREE = "/worktrees/p1/i1";

/** Points the store at an instance whose worktree every command must use. */
async function withWorktree() {
	listInstances.mockResolvedValue([instance("i1", "p1")]);
	projects.set([project("p1", { activeInstanceId: "i1" })]);
	activeProjectId.set("p1");
	await loadInstances("p1");
	expect(get(activeInstance)?.worktreePath).toBe(WORKTREE);
}

/** Leaves no active instance, so every command must bail out. */
function withoutWorktree() {
	projects.set([]);
	activeProjectId.set(null);
	expect(get(activeInstance)).toBeNull();
}

/** A clean result from an operation that can stop on conflicts. */
const clean = () => ({
	ok: true,
	hasConflicts: false,
	conflictedFiles: [],
	output: "",
});

beforeEach(async () => {
	vi.clearAllMocks();
	for (const fn of Object.values(service)) fn.mockReset();
	resetGitStore();
	listInstances.mockResolvedValue([]);
	service.getSnapshot.mockResolvedValue(null);
	service.getLog.mockResolvedValue([]);
	service.getGraphStashes.mockResolvedValue([]);
	service.getFileDiffs.mockResolvedValue({ unstaged: [], staged: [] });
	service.getStagedTotals.mockResolvedValue({ added: 0, removed: 0 });
	service.getGraph.mockResolvedValue([]);
	service.commit.mockResolvedValue("abc1234");
	service.amendCommit.mockResolvedValue("abc1234");
	service.push.mockResolvedValue("");
	service.pull.mockResolvedValue(clean());
	service.fetch.mockResolvedValue(undefined);
	service.merge.mockResolvedValue(clean());
	service.removeIndexLock.mockResolvedValue(undefined);
	service.tagCreate.mockResolvedValue(undefined);
	service.tagPush.mockResolvedValue(undefined);
	service.tagDeleteRemote.mockResolvedValue(undefined);
	service.tagRemoteList.mockResolvedValue([]);
	service.getTagList.mockResolvedValue([]);
	for (const fn of [
		service.deleteBranch,
		service.deleteRemoteBranch,
		service.renameBranch,
		service.addRemote,
		service.renameRemote,
		service.setRemoteUrl,
		service.removeRemote,
	]) {
		fn.mockResolvedValue(undefined);
	}
	service.listRemotes.mockResolvedValue([]);
	branchLists.mockResolvedValue({ local: ["main"], remote: [] });
	service.toGitError.mockImplementation((e: unknown) => ({
		code: "unknown",
		raw: String(e),
	}));
	await withWorktree();
});

describe("commitChanges", () => {
	it("commits the message in the active worktree", async () => {
		await commitChanges("feat: thing");
		expect(service.commit).toHaveBeenCalledWith(WORKTREE, "feat: thing", {});
	});

	it("carries the options through", async () => {
		await commitChanges("msg", { noVerify: true });
		expect(service.commit).toHaveBeenCalledWith(WORKTREE, "msg", {
			noVerify: true,
		});
	});

	it("clears the message fields once the commit lands", async () => {
		setCommitMessage("subject");
		setCommitBody("body");
		await commitChanges("subject");
		expect(get(commitDraft).message).toBe("");
		expect(get(commitDraft).body).toBe("");
	});

	it("keeps the message on screen when the commit fails", async () => {
		setCommitMessage("subject");
		service.commit.mockRejectedValue({ code: "nothing_to_commit", raw: "x" });
		await expect(commitChanges("subject")).rejects.toBeDefined();
		expect(get(commitDraft).message).toBe("subject");
	});

	it("publishes the failure for the banner to show", async () => {
		service.commit.mockRejectedValue({ code: "hook_rejected", raw: "denied" });
		service.toGitError.mockReturnValue({
			code: "hook_rejected",
			raw: "denied",
		});
		await expect(commitChanges("msg")).rejects.toBeDefined();
		expect(get(git).error).toEqual({ code: "hook_rejected", raw: "denied" });
	});

	it("rethrows, so the caller knows it did not commit", async () => {
		const cause = { code: "identity_missing", raw: "no name" };
		service.commit.mockRejectedValue(cause);
		await expect(commitChanges("msg")).rejects.toBe(cause);
	});

	it("clears a previous error once a commit succeeds", async () => {
		service.commit.mockRejectedValueOnce({ code: "hook_rejected", raw: "x" });
		await expect(commitChanges("msg")).rejects.toBeDefined();
		expect(get(git).error).not.toBeNull();
		service.commit.mockResolvedValue("abc");
		await commitChanges("msg");
		expect(get(git).error).toBeNull();
	});

	it("does nothing without an active worktree", async () => {
		withoutWorktree();
		await commitChanges("msg");
		expect(service.commit).not.toHaveBeenCalled();
	});
});

describe("amendLastCommit", () => {
	it("amends in the active worktree", async () => {
		await amendLastCommit("reworded");
		expect(service.amendCommit).toHaveBeenCalledWith(WORKTREE, "reworded", {});
	});

	it("leaves the message fields alone, unlike a fresh commit", async () => {
		setCommitMessage("kept");
		await amendLastCommit("reworded");
		expect(get(commitDraft).message).toBe("kept");
	});

	it("publishes a failure and rethrows", async () => {
		service.amendCommit.mockRejectedValue({ code: "unknown", raw: "boom" });
		await expect(amendLastCommit("msg")).rejects.toBeDefined();
		expect(get(git).error).not.toBeNull();
	});

	it("does nothing without an active worktree", async () => {
		withoutWorktree();
		await amendLastCommit("msg");
		expect(service.amendCommit).not.toHaveBeenCalled();
	});
});

describe("pushBranch", () => {
	it("sets the upstream when the branch has none", async () => {
		await pushBranch();
		expect(service.push).toHaveBeenCalledWith(
			WORKTREE,
			true,
			"",
			false,
			"normal",
		);
	});

	it("does not set it again when the branch already has one", async () => {
		service.getSnapshot.mockResolvedValue({
			version: 1,
			status: {
				isGitRepo: true,
				status: {},
				changedPaths: { staged: [], unstaged: [] },
			},
			currentBranch: "main",
			remoteStatus: { hasUpstream: true, ahead: 0, behind: 0 },
			operationState: null,
		});
		await refreshStatus();
		await pushBranch();
		expect(service.push).toHaveBeenCalledWith(
			WORKTREE,
			false,
			"main",
			false,
			"normal",
		);
	});

	it("sets the upstream on request even when one exists", async () => {
		await pushBranch(true);
		expect(service.push).toHaveBeenCalledWith(
			WORKTREE,
			true,
			expect.any(String),
			false,
			"normal",
		);
	});

	it("passes force through", async () => {
		await pushBranch(false, true);
		expect(service.push).toHaveBeenCalledWith(
			WORKTREE,
			true,
			expect.any(String),
			true,
			"normal",
		);
	});

	it("publishes an auth failure and rethrows", async () => {
		const cause = { code: "auth_required", raw: "credentials" };
		service.push.mockRejectedValue(cause);
		service.toGitError.mockReturnValue(cause);
		await expect(pushBranch()).rejects.toBe(cause);
		expect(get(git).error).toEqual(cause);
	});

	it("does nothing without an active worktree", async () => {
		withoutWorktree();
		await pushBranch();
		expect(service.push).not.toHaveBeenCalled();
	});
});

/** One graph row; only the hash is read by the store. */
const graphRow = (hash: string) => ({
	hash,
	shortHash: hash.slice(0, 7),
	message: `commit ${hash}`,
	author: "someone",
	date: "2026-01-01T00:00:00Z",
	parents: [],
	refs: [],
});

describe("keeping the graph in step with the writes", () => {
	/** Puts rows in the graph, the way opening the tab does. */
	async function graphLoaded(rows: string[]) {
		service.getGraph.mockResolvedValue(rows.map(graphRow));
		await refreshGraph();
		service.getGraph.mockClear();
	}

	it("reloads the graph after a push, so the remote ref moves with it", async () => {
		await graphLoaded(["a"]);
		service.getGraph.mockResolvedValue([graphRow("b"), graphRow("a")]);
		await pushBranch();
		expect(service.getGraph).toHaveBeenCalledWith(WORKTREE, 20, 0);
		expect(get(git).graph.map((c) => c.hash)).toEqual(["b", "a"]);
	});

	it("reloads it after a commit, a pull, a fetch and a merge alike", async () => {
		for (const op of [
			() => commitChanges("feat: thing"),
			() => pullBranch(),
			() => fetchRemote(),
			() => mergeBranch("other"),
		]) {
			await graphLoaded(["a"]);
			await op();
			expect(service.getGraph).toHaveBeenCalledWith(WORKTREE, 20, 0);
		}
	});

	/** Nothing shows the graph, so a write must not pay for one. */
	it("leaves the graph alone while it has never been read", async () => {
		await pushBranch();
		expect(service.getGraph).not.toHaveBeenCalled();
	});

	/** An empty graph was still read: a first commit belongs in it. */
	it("fills a graph read while the repository had no commit yet", async () => {
		await graphLoaded([]);
		service.getGraph.mockResolvedValue([graphRow("a")]);
		await commitChanges("feat: first");
		expect(get(git).graph.map((c) => c.hash)).toEqual(["a"]);
	});

	/** A commit or a push from a terminal moves refs too. */
	it("reloads it when the status poll finds the repository moved", async () => {
		await graphLoaded(["a"]);
		service.getSnapshot.mockResolvedValue({
			version: 7,
			status: {
				isGitRepo: true,
				status: {},
				changedPaths: { staged: [], unstaged: [] },
			},
			currentBranch: "main",
			remoteStatus: { hasUpstream: true, ahead: 0, behind: 0 },
			operationState: null,
		});
		await refreshStatus(true);
		expect(service.getGraph).toHaveBeenCalledWith(WORKTREE, 20, 0);
	});

	/** Nothing moved, so the poll answers with nothing and asks for nothing. */
	it("leaves it alone when the poll finds the repository unchanged", async () => {
		await graphLoaded(["a"]);
		service.getSnapshot.mockResolvedValue(null);
		await refreshStatus(true);
		expect(service.getGraph).not.toHaveBeenCalled();
	});

	it("collapses the reloads that pile up during a flight", async () => {
		await graphLoaded(["a"]);
		await Promise.all([syncGraph(), syncGraph(), syncGraph()]);
		expect(service.getGraph).toHaveBeenCalledTimes(2);
	});

	/** A reload asked for after a write must not answer with a read from before it. */
	it("never serves a caller a graph read from before it asked", async () => {
		await graphLoaded(["a"]);
		const first = syncGraph();
		service.getGraph.mockResolvedValue([graphRow("b")]);
		await Promise.all([first, syncGraph()]);
		expect(get(git).graph.map((c) => c.hash)).toEqual(["b"]);
	});

	/** A push must not collapse a list the user had scrolled through. */
	it("reloads every row already loaded, not just the first page", async () => {
		const first = Array.from({ length: 20 }, (_, i) => `a${i}`);
		await graphLoaded(first);
		service.getGraph.mockResolvedValue(
			Array.from({ length: 20 }, (_, i) => graphRow(`b${i}`)),
		);
		await loadMoreGraph();
		service.getGraph.mockClear();
		service.getGraph.mockResolvedValue([]);
		await pushBranch();
		expect(service.getGraph).toHaveBeenCalledWith(WORKTREE, 40, 0);
	});
});

describe("loadMoreGraph", () => {
	const page = (prefix: string) =>
		Array.from({ length: 20 }, (_, i) => graphRow(`${prefix}${i}`));

	beforeEach(async () => {
		service.getGraph.mockResolvedValue(page("a"));
		await refreshGraph();
	});

	it("appends the next page and keeps the scroll armed", async () => {
		service.getGraph.mockResolvedValue(page("b"));
		await loadMoreGraph();
		expect(get(git).graph).toHaveLength(40);
		expect(get(git).graphHasMore).toBe(true);
		expect(get(git).graphPaging).toBe("idle");
	});

	/** The same page again would come back forever: nothing new ends the scroll. */
	it("ends the scroll on a page of commits already listed", async () => {
		service.getGraph.mockResolvedValue(page("a"));
		await loadMoreGraph();
		expect(get(git).graph).toHaveLength(20);
		expect(get(git).graphHasMore).toBe(false);
		expect(get(git).graphPaging).toBe("idle");
	});

	it("reports a failed page instead of swallowing it", async () => {
		service.getGraph.mockRejectedValue(new Error("boom"));
		await loadMoreGraph();
		expect(get(git).graphPaging).toBe("failed");
		expect(get(git).error).not.toBeNull();
		expect(get(git).graphHasMore).toBe(true);
	});

	/** A page landing after a switch belongs to the worktree it was asked for. */
	it("drops a page that arrives after the worktree changed", async () => {
		let resolvePage: (rows: ReturnType<typeof graphRow>[]) => void = () => {};
		service.getGraph.mockReturnValue(
			new Promise((resolve) => {
				resolvePage = resolve;
			}),
		);
		const pending = loadMoreGraph();
		withoutWorktree();
		resolvePage(page("b"));
		await pending;
		expect(get(git).graph.map((c) => c.hash)).not.toContain("b0");
		expect(get(git).graphPaging).toBe("idle");
	});

	it("retries a failed page when asked again", async () => {
		service.getGraph.mockRejectedValue(new Error("boom"));
		await loadMoreGraph();
		service.getGraph.mockResolvedValue(page("b"));
		await loadMoreGraph();
		expect(get(git).graph).toHaveLength(40);
		expect(get(git).graphPaging).toBe("idle");
	});
});

describe("tags and the remote", () => {
	it("leaves the remote state unknown until the remote answered", async () => {
		expect(get(git).remoteTags).toBeNull();
		service.tagRemoteList.mockResolvedValue(["v1"]);
		await refreshRemoteTags();
		expect(get(git).remoteTags).toEqual(["v1"]);
	});

	/** Offline is not "nothing pushed": the list must not claim tags are local only. */
	it("falls back to unknown when the remote cannot be reached", async () => {
		service.tagRemoteList.mockResolvedValue(["v1"]);
		await refreshRemoteTags();
		service.tagRemoteList.mockRejectedValue(new Error("offline"));
		await refreshRemoteTags();
		expect(get(git).remoteTags).toBeNull();
	});

	it("pushes a tag right after creating it when asked", async () => {
		await refreshRemoteTags();
		await createTag("v2", "", "", true);
		expect(service.tagCreate).toHaveBeenCalledWith(WORKTREE, "v2", "", "");
		expect(service.tagPush).toHaveBeenCalledWith(WORKTREE, "origin", "v2");
		expect(get(git).remoteTags).toEqual(["v2"]);
	});

	it("does not push when not asked", async () => {
		await createTag("v2", "", "");
		expect(service.tagPush).not.toHaveBeenCalled();
	});

	/** The tag exists either way; a failed push must not read as a failed creation. */
	it("keeps the creation when the push fails, and reports the push", async () => {
		service.tagPush.mockRejectedValue(new Error("rejected"));
		await expect(createTag("v2", "", "", true)).resolves.toBeUndefined();
		expect(get(git).error).not.toBeNull();
	});

	it("drops a tag deleted on the remote from the remote list", async () => {
		service.tagRemoteList.mockResolvedValue(["v1", "v2"]);
		await refreshRemoteTags();
		await deleteRemoteTag("v1");
		expect(get(git).remoteTags).toEqual(["v2"]);
	});
});

describe("branches and remotes", () => {
	it("deletes a branch safely unless forced", async () => {
		await deleteBranch("feat/x");
		expect(service.deleteBranch).toHaveBeenLastCalledWith(
			WORKTREE,
			"feat/x",
			false,
		);
		await deleteBranch("feat/x", { force: true });
		expect(service.deleteBranch).toHaveBeenLastCalledWith(
			WORKTREE,
			"feat/x",
			true,
		);
	});

	/** A local write needs no network to show: the lists are reread without a fetch. */
	it("rereads the branch lists after a write, without fetching", async () => {
		branchLists.mockResolvedValue({ local: ["main", "renamed"], remote: [] });
		await renameBranch("old", "renamed");
		expect(service.renameBranch).toHaveBeenCalledWith(
			WORKTREE,
			"old",
			"renamed",
		);
		expect(get(git).branches).toEqual(["main", "renamed"]);
		expect(service.fetch).not.toHaveBeenCalled();
	});

	it("deletes on the remote apart from the local branch", async () => {
		await deleteRemoteBranch("feat/x", "upstream");
		expect(service.deleteRemoteBranch).toHaveBeenCalledWith(
			WORKTREE,
			"upstream",
			"feat/x",
		);
		expect(service.deleteBranch).not.toHaveBeenCalled();
	});

	it("surfaces a refused deletion and rethrows it", async () => {
		service.deleteBranch.mockRejectedValue(new Error("not fully merged"));
		await expect(deleteBranch("feat/x")).rejects.toThrow();
		expect(get(git).error).not.toBeNull();
	});

	it("routes each remote edit to its command and rereads the remotes", async () => {
		service.listRemotes.mockResolvedValue([
			{ name: "up", fetchUrl: "u", pushUrl: "u" },
		]);
		await editRemote({ kind: "add", name: "up", url: "u" });
		await editRemote({ kind: "rename", oldName: "up", newName: "up2" });
		await editRemote({ kind: "set-url", name: "up2", url: "v" });
		await editRemote({ kind: "remove", name: "up2" });
		expect(service.addRemote).toHaveBeenCalledWith(WORKTREE, "up", "u");
		expect(service.renameRemote).toHaveBeenCalledWith(WORKTREE, "up", "up2");
		expect(service.setRemoteUrl).toHaveBeenCalledWith(WORKTREE, "up2", "v");
		expect(service.removeRemote).toHaveBeenCalledWith(WORKTREE, "up2");
		expect(get(git).remotes).toEqual([
			{ name: "up", fetchUrl: "u", pushUrl: "u" },
		]);
	});
});

describe("pullBranch", () => {
	it("reports a clean pull", async () => {
		await expect(pullBranch()).resolves.toMatchObject({
			ok: true,
			hasConflicts: false,
		});
	});

	it("reports the conflicts a pull left behind, rather than throwing", async () => {
		service.pull.mockResolvedValue({
			ok: true,
			hasConflicts: true,
			conflictedFiles: ["a.ts"],
			output: "CONFLICT",
		});
		const result = await pullBranch();
		expect(result?.conflictedFiles).toEqual(["a.ts"]);
		expect(get(git).error).toBeNull();
	});

	it("publishes a real failure and rethrows", async () => {
		service.pull.mockRejectedValue({ code: "dirty_worktree", raw: "x" });
		await expect(pullBranch()).rejects.toBeDefined();
		expect(get(git).error).not.toBeNull();
	});

	it("answers null without an active worktree", async () => {
		withoutWorktree();
		await expect(pullBranch()).resolves.toBeNull();
		expect(service.pull).not.toHaveBeenCalled();
	});
});

describe("mergeBranch", () => {
	it("merges the branch it is given", async () => {
		await mergeBranch("feature");
		expect(service.merge).toHaveBeenCalledWith(WORKTREE, "feature");
	});

	it("reports conflicts as a result, not as an error", async () => {
		service.merge.mockResolvedValue({
			ok: true,
			hasConflicts: true,
			conflictedFiles: ["a.ts", "b.ts"],
			output: "CONFLICT",
		});
		const result = await mergeBranch("feature");
		expect(result?.hasConflicts).toBe(true);
		expect(get(git).error).toBeNull();
	});

	it("publishes a real failure and rethrows", async () => {
		service.merge.mockRejectedValue({ code: "dirty_worktree", raw: "x" });
		await expect(mergeBranch("feature")).rejects.toBeDefined();
		expect(get(git).error).not.toBeNull();
	});

	it("answers null without an active worktree", async () => {
		withoutWorktree();
		await expect(mergeBranch("feature")).resolves.toBeNull();
	});
});

describe("fetchRemote", () => {
	it("fetches in the active worktree", async () => {
		await fetchRemote();
		expect(service.fetch).toHaveBeenCalledWith(WORKTREE);
	});

	it("publishes a failure and rethrows", async () => {
		service.fetch.mockRejectedValue({ code: "network_unreachable", raw: "x" });
		await expect(fetchRemote()).rejects.toBeDefined();
		expect(get(git).error).not.toBeNull();
	});

	it("does nothing without an active worktree", async () => {
		withoutWorktree();
		await fetchRemote();
		expect(service.fetch).not.toHaveBeenCalled();
	});
});

describe("recoverFromGitError", () => {
	it("sets the upstream and pushes for a missing upstream", async () => {
		await recoverFromGitError("setUpstream");
		expect(service.push).toHaveBeenCalledWith(
			WORKTREE,
			true,
			expect.any(String),
			false,
			"normal",
		);
	});

	it("pulls then pushes when the branch is behind", async () => {
		await recoverFromGitError("pullThenPush");
		expect(service.pull).toHaveBeenCalledWith(WORKTREE, expect.anything());
		expect(service.push).toHaveBeenCalledWith(
			WORKTREE,
			expect.any(Boolean),
			expect.any(String),
			expect.any(Boolean),
			expect.anything(),
		);
	});

	it("does not push when the pull did not land cleanly", async () => {
		service.pull.mockResolvedValue({
			ok: false,
			hasConflicts: true,
			conflictedFiles: ["a.ts"],
			output: "CONFLICT",
		});
		await recoverFromGitError("pullThenPush");
		expect(service.push).not.toHaveBeenCalled();
	});

	it("gives up on the push when the pull itself failed", async () => {
		service.pull.mockRejectedValue({ code: "dirty_worktree", raw: "x" });
		await expect(recoverFromGitError("pullThenPush")).rejects.toBeDefined();
		expect(service.push).not.toHaveBeenCalled();
	});

	it("removes the index lock for any other action", async () => {
		await recoverFromGitError("removeLock");
		expect(service.removeIndexLock).toHaveBeenCalledWith(WORKTREE);
	});

	it("replaces the banner when the recovery itself fails", async () => {
		service.removeIndexLock.mockRejectedValue({
			code: "permission_denied",
			raw: "denied",
		});
		service.toGitError.mockReturnValue({
			code: "permission_denied",
			raw: "denied",
		});
		await expect(recoverFromGitError("removeLock")).rejects.toBeDefined();
		expect(get(git).error).toEqual({
			code: "permission_denied",
			raw: "denied",
		});
	});

	it("does nothing without an active worktree", async () => {
		withoutWorktree();
		await recoverFromGitError("removeLock");
		expect(service.removeIndexLock).not.toHaveBeenCalled();
	});
});

describe("clearGitError", () => {
	it("takes the banner down", async () => {
		service.commit.mockRejectedValue({ code: "unknown", raw: "boom" });
		await expect(commitChanges("msg")).rejects.toBeDefined();
		clearGitError();
		expect(get(git).error).toBeNull();
	});

	it("does nothing when no error is showing", () => {
		const before = get(git);
		clearGitError();
		expect(get(git)).toBe(before);
	});
});

const conflicted = () => ({
	ok: false,
	hasConflicts: true,
	conflictedFiles: ["a.ts"],
	output: "CONFLICT",
});

describe("gitFileCounts", () => {
	it("counts untracked files as unstaged and a file once in the total", async () => {
		service.getSnapshot.mockResolvedValue({
			version: 1,
			status: {
				isGitRepo: true,
				status: { "u.txt": "untracked", "m.txt": "modified" },
				changedPaths: { staged: ["s.txt", "m.txt"], unstaged: ["m.txt"] },
			},
			currentBranch: "main",
			remoteStatus: null,
			operationState: null,
		});
		await refreshStatus();
		expect(get(gitFileCounts)).toEqual({ staged: 2, unstaged: 2, total: 3 });
	});
});

describe("initRepository", () => {
	it("initialises the worktree and rereads its status", async () => {
		await initRepository();
		expect(service.initRepository).toHaveBeenCalledWith(WORKTREE);
		expect(service.getSnapshot).toHaveBeenCalledWith(WORKTREE, "");
	});

	it("does nothing without an active worktree", async () => {
		withoutWorktree();
		await initRepository();
		expect(service.initRepository).not.toHaveBeenCalled();
	});
});

describe("the log", () => {
	const commits = (count: number, prefix = "c") =>
		Array.from({ length: count }, (_, i) => ({
			hash: `${prefix}${i}`,
			message: `commit ${i}`,
		}));

	it("loads the first page and arms the scroll when the page is full", async () => {
		const page = commits(50);
		service.getLog.mockResolvedValue(page);
		await refreshLog();
		expect(service.getLog).toHaveBeenCalledWith(WORKTREE, 50, 0);
		expect(get(git).log).toEqual(page);
		expect(get(git).logHasMore).toBe(true);
	});

	it("does not arm the scroll on a short page", async () => {
		service.getLog.mockResolvedValue(commits(3));
		await refreshLog();
		expect(get(git).logHasMore).toBe(false);
	});

	it("does nothing without an active worktree", async () => {
		withoutWorktree();
		await refreshLog();
		expect(service.getLog).not.toHaveBeenCalled();
	});

	it("publishes a failure while nothing is listed yet", async () => {
		const error = { code: "unknown", raw: "no log" };
		service.getLog.mockRejectedValue(new Error("no log"));
		service.toGitError.mockReturnValue(error);
		await refreshLog();
		expect(get(git).error).toEqual(error);
	});

	it("keeps quiet about a failed reload when a list is already showing", async () => {
		service.getLog.mockResolvedValue(commits(2));
		await refreshLog();
		service.getLog.mockRejectedValue(new Error("no log"));
		await refreshLog();
		expect(get(git).error).toBeNull();
		expect(get(git).log).toEqual(commits(2));
	});

	it("appends the next page without the hashes already listed", async () => {
		service.getLog.mockResolvedValue(commits(50));
		await refreshLog();
		const next = [...commits(1, "c").slice(0, 1), ...commits(10, "n")];
		service.getLog.mockResolvedValue(next);
		await loadMoreLog();
		expect(service.getLog).toHaveBeenLastCalledWith(WORKTREE, 50, 50);
		expect(get(git).log).toHaveLength(60);
		expect(get(git).log.slice(50)).toEqual(commits(10, "n"));
		expect(get(git).logHasMore).toBe(false);
	});

	it("does not ask for a page once the end was reached", async () => {
		service.getLog.mockResolvedValue(commits(3));
		await refreshLog();
		service.getLog.mockClear();
		await loadMoreLog();
		expect(service.getLog).not.toHaveBeenCalled();
	});

	it("does not load more without an active worktree", async () => {
		service.getLog.mockResolvedValue(commits(50));
		await refreshLog();
		service.getLog.mockClear();
		withoutWorktree();
		await loadMoreLog();
		expect(service.getLog).not.toHaveBeenCalled();
	});

	it("swallows a failed page and keeps what is listed", async () => {
		service.getLog.mockResolvedValue(commits(50));
		await refreshLog();
		service.getLog.mockRejectedValue(new Error("boom"));
		await expect(loadMoreLog()).resolves.toBeUndefined();
		expect(get(git).log).toHaveLength(50);
		expect(get(git).error).toBeNull();
	});

	it("loads the whole history in one request", async () => {
		service.getLog.mockResolvedValue(commits(50));
		await refreshLog();
		const all = commits(120);
		service.getLog.mockResolvedValue(all);
		await loadAllLog();
		expect(service.getLog).toHaveBeenLastCalledWith(WORKTREE, 1_000_000, 0);
		expect(get(git).log).toEqual(all);
		expect(get(git).logHasMore).toBe(false);
	});

	it("keeps the list when loading everything fails", async () => {
		service.getLog.mockResolvedValue(commits(2));
		await refreshLog();
		service.getLog.mockRejectedValue(new Error("boom"));
		await loadAllLog();
		expect(get(git).log).toEqual(commits(2));
	});

	it("loads nothing at all without an active worktree", async () => {
		withoutWorktree();
		await loadAllLog();
		expect(service.getLog).not.toHaveBeenCalled();
	});
});

describe("the graph reads", () => {
	it("does not read the graph without an active worktree or project", async () => {
		withoutWorktree();
		await refreshGraph();
		await loadMoreGraph();
		await loadAllGraph();
		expect(service.getGraph).not.toHaveBeenCalled();
	});

	it("keeps the rows when a reload fails", async () => {
		service.getGraph.mockResolvedValue([graphRow("a")]);
		await refreshGraph();
		service.getGraph.mockRejectedValue(new Error("boom"));
		await refreshGraph();
		expect(get(git).graph.map((c) => c.hash)).toEqual(["a"]);
		expect(get(git).error).toBeNull();
	});

	it("keeps the rows when a sync fails", async () => {
		service.getGraph.mockResolvedValue([graphRow("a")]);
		await refreshGraph();
		service.getGraph.mockRejectedValue(new Error("boom"));
		await expect(syncGraph()).resolves.toBeUndefined();
		expect(get(git).graph.map((c) => c.hash)).toEqual(["a"]);
	});

	it("ignores a second page request while one is in flight", async () => {
		const page = Array.from({ length: 20 }, (_, i) => graphRow(`a${i}`));
		service.getGraph.mockResolvedValue(page);
		await refreshGraph();
		service.getGraph.mockClear();
		let resolvePage: (rows: ReturnType<typeof graphRow>[]) => void = () => {};
		service.getGraph.mockReturnValue(
			new Promise((resolve) => {
				resolvePage = resolve;
			}),
		);
		const first = loadMoreGraph();
		await loadMoreGraph();
		expect(get(git).graphPaging).toBe("loading");
		resolvePage([]);
		await first;
		expect(service.getGraph).toHaveBeenCalledTimes(1);
		expect(service.getGraph).toHaveBeenCalledWith(WORKTREE, 20, 20);
	});

	it("loads the whole graph in one request and stops the scroll", async () => {
		const stash = graphRow("s");
		service.getGraph.mockResolvedValue([graphRow("a"), graphRow("b")]);
		service.getGraphStashes.mockResolvedValue([stash]);
		await loadAllGraph();
		expect(service.getGraph).toHaveBeenCalledWith(WORKTREE, 1_000_000, 0);
		expect(get(git).graph.map((c) => c.hash)).toEqual(["a", "b"]);
		expect(get(git).graphStashes).toEqual([stash]);
		expect(get(git).graphHasMore).toBe(false);
	});

	it("keeps the graph when loading everything fails", async () => {
		service.getGraph.mockResolvedValue([graphRow("a")]);
		await refreshGraph();
		service.getGraph.mockRejectedValue(new Error("boom"));
		await loadAllGraph();
		expect(get(git).graph.map((c) => c.hash)).toEqual(["a"]);
	});

	it("still shows the graph when the stashes cannot be read", async () => {
		service.getGraph.mockResolvedValue([graphRow("a")]);
		service.getGraphStashes.mockRejectedValue(new Error("boom"));
		await refreshGraph();
		expect(get(git).graph.map((c) => c.hash)).toEqual(["a"]);
		expect(get(git).graphStashes).toEqual([]);
	});
});

describe("reads that fall back to an empty answer", () => {
	it("reads the message of HEAD", async () => {
		service.getHeadMessage.mockResolvedValue("feat: head");
		await expect(getHeadCommitMessage()).resolves.toBe("feat: head");
		expect(service.getHeadMessage).toHaveBeenCalledWith(WORKTREE);
	});

	it("answers an empty message when HEAD cannot be read", async () => {
		service.getHeadMessage.mockRejectedValue(new Error("no commit"));
		await expect(getHeadCommitMessage()).resolves.toBe("");
	});

	it("answers an empty message without an active worktree", async () => {
		withoutWorktree();
		await expect(getHeadCommitMessage()).resolves.toBe("");
		expect(service.getHeadMessage).not.toHaveBeenCalled();
	});

	it("reads the origin url", async () => {
		service.getRemoteUrl.mockResolvedValue("git@host:a/b.git");
		await expect(getRemoteUrl()).resolves.toBe("git@host:a/b.git");
		expect(service.getRemoteUrl).toHaveBeenCalledWith(WORKTREE);
	});

	it("answers an empty url when there is no remote", async () => {
		service.getRemoteUrl.mockRejectedValue(new Error("no remote"));
		await expect(getRemoteUrl()).resolves.toBe("");
	});

	it("answers an empty url without an active worktree", async () => {
		withoutWorktree();
		await expect(getRemoteUrl()).resolves.toBe("");
		expect(service.getRemoteUrl).not.toHaveBeenCalled();
	});

	it("reads the divergence against a base", async () => {
		service.getBranchDivergence.mockResolvedValue({ ahead: 2, behind: 1 });
		await expect(getBranchDivergence("main")).resolves.toEqual({
			ahead: 2,
			behind: 1,
		});
		expect(service.getBranchDivergence).toHaveBeenCalledWith(WORKTREE, "main");
	});

	it("answers null for an empty base or a failed read", async () => {
		await expect(getBranchDivergence("")).resolves.toBeNull();
		expect(service.getBranchDivergence).not.toHaveBeenCalled();
		service.getBranchDivergence.mockRejectedValue(new Error("bad base"));
		await expect(getBranchDivergence("nope")).resolves.toBeNull();
	});

	it("answers null for a divergence without an active worktree", async () => {
		withoutWorktree();
		await expect(getBranchDivergence("main")).resolves.toBeNull();
		expect(service.getBranchDivergence).not.toHaveBeenCalled();
	});

	it("reads the local ignore file", async () => {
		service.readExclude.mockResolvedValue("dist\n");
		await expect(readExclude()).resolves.toBe("dist\n");
		expect(service.readExclude).toHaveBeenCalledWith(WORKTREE);
	});

	it("answers an empty ignore file without an active worktree", async () => {
		withoutWorktree();
		await expect(readExclude()).resolves.toBe("");
		expect(service.readExclude).not.toHaveBeenCalled();
	});

	it("reads the diff a stash holds", async () => {
		const diffs = [{ filePath: "a.ts", hunks: [] }];
		service.getStashShow.mockResolvedValue(diffs);
		await expect(getStashDiff(3)).resolves.toEqual(diffs);
		expect(service.getStashShow).toHaveBeenCalledWith(WORKTREE, 3);
	});

	it("answers no diff for a stash without an active worktree", async () => {
		withoutWorktree();
		await expect(getStashDiff(0)).resolves.toEqual([]);
		expect(service.getStashShow).not.toHaveBeenCalled();
	});
});

describe("loadBranches", () => {
	it("fetches first, then lists the branches of the project path", async () => {
		branchLists.mockResolvedValue({ local: ["main"], remote: ["origin/x"] });
		await loadBranches("/repos/p1");
		expect(service.fetch).toHaveBeenCalledWith("/repos/p1");
		expect(get(git).branches).toEqual(["main"]);
		expect(get(git).remoteBranches).toEqual(["origin/x"]);
		expect(get(git).isLoadingBranches).toBe(false);
	});

	it("lists the stale refs when the fetch fails", async () => {
		service.fetch.mockRejectedValue(new Error("offline"));
		await loadBranches("/repos/p1");
		expect(get(git).branches).toEqual(["main"]);
	});

	it("stops loading when the listing fails", async () => {
		branchLists.mockRejectedValue(new Error("boom"));
		await loadBranches("/repos/p1");
		expect(get(git).isLoadingBranches).toBe(false);
		expect(get(git).branches).toEqual([]);
	});
});

describe("remotes", () => {
	it("reloads the configured remotes", async () => {
		const remotes = [{ name: "origin", fetchUrl: "u", pushUrl: "u" }];
		service.listRemotes.mockResolvedValue(remotes);
		await refreshRemotes();
		expect(get(git).remotes).toEqual(remotes);
	});

	it("keeps the remotes when the listing fails", async () => {
		const remotes = [{ name: "origin", fetchUrl: "u", pushUrl: "u" }];
		service.listRemotes.mockResolvedValue(remotes);
		await refreshRemotes();
		service.listRemotes.mockRejectedValue(new Error("boom"));
		await expect(refreshRemotes()).resolves.toBeUndefined();
		expect(get(git).remotes).toEqual(remotes);
	});

	it("does nothing without an active worktree", async () => {
		withoutWorktree();
		await refreshRemotes();
		await editRemote({ kind: "remove", name: "up" });
		expect(service.listRemotes).not.toHaveBeenCalled();
		expect(service.removeRemote).not.toHaveBeenCalled();
	});
});

describe("tags without a worktree or a known remote", () => {
	it("does nothing without an active worktree", async () => {
		withoutWorktree();
		await refreshTags();
		await refreshRemoteTags();
		await createTag("v1", "", "");
		await pushTag("v1");
		await deleteRemoteTag("v1");
		await deleteTag("v1");
		expect(service.getTagList).not.toHaveBeenCalled();
		expect(service.tagRemoteList).not.toHaveBeenCalled();
		expect(service.tagCreate).not.toHaveBeenCalled();
		expect(service.tagPush).not.toHaveBeenCalled();
		expect(service.tagDeleteRemote).not.toHaveBeenCalled();
		expect(service.tagDelete).not.toHaveBeenCalled();
	});

	it("keeps the remote tags unknown after a push while they were never read", async () => {
		await pushTag("v1");
		expect(get(git).remoteTags).toBeNull();
	});

	it("deletes a tag locally and rereads the tag list", async () => {
		service.getTagList.mockResolvedValue([{ name: "v2" }]);
		await deleteTag("v1");
		expect(service.tagDelete).toHaveBeenCalledWith(WORKTREE, "v1");
		expect(get(git).tags).toEqual([{ name: "v2" }]);
	});
});

describe("branch and stash writes without a worktree", () => {
	it("does nothing", async () => {
		withoutWorktree();
		await deleteBranch("b");
		await deleteRemoteBranch("b");
		await renameBranch("a", "b");
		expect(service.deleteBranch).not.toHaveBeenCalled();
		expect(service.deleteRemoteBranch).not.toHaveBeenCalled();
		expect(service.renameBranch).not.toHaveBeenCalled();
	});
});

describe("stashes", () => {
	it("reloads the stash list", async () => {
		const stashes = [{ index: 0, message: "wip" }];
		service.getStashList.mockResolvedValue(stashes);
		await refreshStashes();
		expect(get(git).stashes).toEqual(stashes);
	});

	it("keeps the stash list when the read fails", async () => {
		const stashes = [{ index: 0, message: "wip" }];
		service.getStashList.mockResolvedValue(stashes);
		await refreshStashes();
		service.getStashList.mockRejectedValue(new Error("boom"));
		await refreshStashes();
		expect(get(git).stashes).toEqual(stashes);
	});

	it("leaves the graph stashes alone while the graph was never read", async () => {
		service.getStashList.mockResolvedValue([]);
		await refreshStashes();
		expect(service.getGraphStashes).not.toHaveBeenCalled();
	});

	it("moves the graph stashes with the list once the graph was read", async () => {
		service.getGraph.mockResolvedValue([graphRow("a")]);
		await refreshGraph();
		const moved = [graphRow("s")];
		service.getGraphStashes.mockResolvedValue(moved);
		service.getStashList.mockResolvedValue([]);
		await refreshStashes();
		expect(get(git).graphStashes).toEqual(moved);
	});

	it("does nothing without an active worktree", async () => {
		withoutWorktree();
		await refreshStashes();
		expect(service.getStashList).not.toHaveBeenCalled();
	});

	it("stashes the selection and rereads the stashes and the status", async () => {
		await pushStash("wip", true, false, ["a.ts"]);
		expect(service.stashPush).toHaveBeenCalledWith(
			WORKTREE,
			"wip",
			true,
			false,
			["a.ts"],
		);
		expect(service.getStashList).toHaveBeenCalledWith(WORKTREE);
		expect(service.getSnapshot).toHaveBeenCalledWith(WORKTREE, "");
	});

	it("stashes everything when no path is given", async () => {
		await pushStash("wip", false, true);
		expect(service.stashPush).toHaveBeenCalledWith(
			WORKTREE,
			"wip",
			false,
			true,
			[],
		);
	});

	it("pops a stash and rereads the stashes and the status", async () => {
		await popStash(2);
		expect(service.stashPop).toHaveBeenCalledWith(WORKTREE, 2);
		expect(service.getStashList).toHaveBeenCalledWith(WORKTREE);
		expect(service.getSnapshot).toHaveBeenCalledWith(WORKTREE, "");
	});

	it("applies a stash and rereads only the status", async () => {
		await applyStash(1);
		expect(service.stashApply).toHaveBeenCalledWith(WORKTREE, 1);
		expect(service.getSnapshot).toHaveBeenCalledWith(WORKTREE, "");
		expect(service.getStashList).not.toHaveBeenCalled();
	});

	it("drops, clears and renames, then rereads the stashes", async () => {
		await dropStash(1);
		expect(service.stashDrop).toHaveBeenLastCalledWith(WORKTREE, 1);
		await clearStashes();
		expect(service.stashClear).toHaveBeenLastCalledWith(WORKTREE);
		await renameStash(0, "renamed");
		expect(service.stashRename).toHaveBeenLastCalledWith(
			WORKTREE,
			0,
			"renamed",
		);
		expect(service.getStashList).toHaveBeenCalledTimes(3);
	});

	it("publishes a refused stash write and rethrows it", async () => {
		service.stashPop.mockRejectedValue(new Error("conflict"));
		await expect(popStash(0)).rejects.toThrow("conflict");
		expect(get(git).error).toEqual({ code: "unknown", raw: "Error: conflict" });
	});
});

describe("stash and selection writes without an active worktree", () => {
	const writes: [
		string,
		() => Promise<unknown>,
		() => ReturnType<typeof vi.fn>,
	][] = [
		[
			"pushStash",
			() => pushStash("wip", false, false),
			() => service.stashPush,
		],
		["stageFiles", () => stageFiles(["a.ts"]), () => service.stageFiles],
		["unstageFiles", () => unstageFiles(["a.ts"]), () => service.unstageFiles],
		["discardFiles", () => discardFiles(["a.ts"]), () => service.discardFiles],
		["popStash", () => popStash(0), () => service.stashPop],
		["applyStash", () => applyStash(0), () => service.stashApply],
		["dropStash", () => dropStash(0), () => service.stashDrop],
		["clearStashes", () => clearStashes(), () => service.stashClear],
		["renameStash", () => renameStash(0, "x"), () => service.stashRename],
	];

	it.each(writes)(
		"%s does nothing and reads nothing back",
		async (_n, run, call) => {
			withoutWorktree();
			await run();
			expect(call()).not.toHaveBeenCalled();
			expect(service.getSnapshot).not.toHaveBeenCalled();
			expect(service.getStashList).not.toHaveBeenCalled();
		},
	);
});

describe("writes on a selection", () => {
	it.each([
		["stages", () => stageFiles(["a.ts", "b.ts"]), () => service.stageFiles],
		[
			"unstages",
			() => unstageFiles(["a.ts", "b.ts"]),
			() => service.unstageFiles,
		],
		[
			"discards",
			() => discardFiles(["a.ts", "b.ts"]),
			() => service.discardFiles,
		],
	] as const)(
		"%s the whole selection in one call",
		async (_name, run, call) => {
			await run();
			expect(call().mock.calls).toEqual([[WORKTREE, ["a.ts", "b.ts"]]]);
		},
	);

	it("publishes a partial failure and still reads back what went through", async () => {
		service.stageFiles.mockRejectedValueOnce(new Error("b.ts: did not match"));
		service.getSnapshot.mockClear();
		await expect(stageFiles(["a.ts", "b.ts"])).rejects.toThrow("did not match");
		expect(service.stageFiles).toHaveBeenCalledTimes(1);
		expect(get(git).error).not.toBeNull();
		expect(service.getSnapshot).toHaveBeenCalled();
	});

	it("calls nothing for an empty selection", async () => {
		await stageFiles([]);
		expect(service.stageFiles).not.toHaveBeenCalled();
	});
});

const worktreeWrites: {
	name: string;
	run: () => Promise<unknown>;
	call: () => ReturnType<typeof vi.fn>;
	args: unknown[];
}[] = [
	{
		name: "stageFile",
		run: () => stageFile("a.ts"),
		call: () => service.stageFile,
		args: [WORKTREE, "a.ts"],
	},
	{
		name: "unstageFile",
		run: () => unstageFile("a.ts"),
		call: () => service.unstageFile,
		args: [WORKTREE, "a.ts"],
	},
	{
		name: "stageAll",
		run: () => stageAll(),
		call: () => service.stageAll,
		args: [WORKTREE],
	},
	{
		name: "unstageAll",
		run: () => unstageAll(),
		call: () => service.unstageAll,
		args: [WORKTREE],
	},
	{
		name: "removeFile",
		run: () => removeFile("a.ts"),
		call: () => service.rmFile,
		args: [WORKTREE, "a.ts"],
	},
	{
		name: "discardFile",
		run: () => discardFile("a.ts"),
		call: () => service.discardFile,
		args: [WORKTREE, "a.ts"],
	},
	{
		name: "writeExclude",
		run: () => writeExclude("dist\n"),
		call: () => service.writeExclude,
		args: [WORKTREE, "dist\n"],
	},
	{
		name: "abortRebase",
		run: () => abortRebase(),
		call: () => service.rebaseAbort,
		args: [WORKTREE],
	},
	{
		name: "abortMerge",
		run: () => abortMerge(),
		call: () => service.mergeAbort,
		args: [WORKTREE],
	},
	{
		name: "abortCherryPick",
		run: () => abortCherryPick(),
		call: () => service.cherryPickAbort,
		args: [WORKTREE],
	},
	{
		name: "checkoutBranch",
		run: () => checkoutBranch("feat"),
		call: () => service.checkoutBranch,
		args: [WORKTREE, "feat"],
	},
	{
		name: "createBranch",
		run: () => createBranch("feat", "main"),
		call: () => service.createBranch,
		args: [WORKTREE, "feat", "main"],
	},
	{
		name: "revertCommit",
		run: () => revertCommit("abc"),
		call: () => service.revertCommit,
		args: [WORKTREE, "abc"],
	},
	{
		name: "resetToCommit",
		run: () => resetToCommit("abc", "hard"),
		call: () => service.resetToCommit,
		args: [WORKTREE, "abc", "hard"],
	},
];

describe("worktree writes", () => {
	it.each(worktreeWrites)(
		"$name runs in the active worktree and rereads its status",
		async ({ run, call, args }) => {
			await run();
			expect(call()).toHaveBeenCalledWith(...args);
			expect(service.getSnapshot).toHaveBeenCalledWith(WORKTREE, "");
		},
	);

	it.each(worktreeWrites)(
		"$name does nothing without an active worktree",
		async ({ run, call }) => {
			withoutWorktree();
			await run();
			expect(call()).not.toHaveBeenCalled();
		},
	);

	it.each(worktreeWrites)(
		"$name publishes a failure and rethrows it",
		async ({ run, call }) => {
			call().mockRejectedValue(new Error("refused"));
			await expect(run()).rejects.toThrow("refused");
			expect(get(git).error).toEqual({
				code: "unknown",
				raw: "Error: refused",
			});
		},
	);
});

const operationWrites: {
	name: string;
	run: () => Promise<unknown>;
	call: () => ReturnType<typeof vi.fn>;
	args: unknown[];
}[] = [
	{
		name: "rebaseOnto",
		run: () => rebaseOnto("main"),
		call: () => service.rebase,
		args: [WORKTREE, "main"],
	},
	{
		name: "continueRebase",
		run: () => continueRebase(),
		call: () => service.rebaseContinue,
		args: [WORKTREE],
	},
	{
		name: "skipRebase",
		run: () => skipRebase(),
		call: () => service.rebaseSkip,
		args: [WORKTREE],
	},
	{
		name: "continueMerge",
		run: () => continueMerge(),
		call: () => service.mergeContinue,
		args: [WORKTREE],
	},
	{
		name: "cherryPickCommits",
		run: () => cherryPickCommits(["a1", "b2"]),
		call: () => service.cherryPick,
		args: [WORKTREE, ["a1", "b2"]],
	},
	{
		name: "continueCherryPick",
		run: () => continueCherryPick(),
		call: () => service.cherryPickContinue,
		args: [WORKTREE],
	},
	{
		name: "skipCherryPick",
		run: () => skipCherryPick(),
		call: () => service.cherryPickSkip,
		args: [WORKTREE],
	},
];

describe("operations that can stop on conflicts", () => {
	it.each(operationWrites)(
		"$name hands back the result it was given",
		async ({ run, call, args }) => {
			const result = conflicted();
			call().mockResolvedValue(result);
			await expect(run()).resolves.toBe(result);
			expect(call()).toHaveBeenCalledWith(...args);
			expect(service.getSnapshot).toHaveBeenCalledWith(WORKTREE, "");
			expect(get(git).error).toBeNull();
		},
	);

	it.each(operationWrites)(
		"$name answers null without an active worktree",
		async ({ run, call }) => {
			withoutWorktree();
			await expect(run()).resolves.toBeNull();
			expect(call()).not.toHaveBeenCalled();
		},
	);

	it.each(operationWrites)(
		"$name publishes a failure and rethrows it",
		async ({ run, call }) => {
			call().mockRejectedValue(new Error("refused"));
			await expect(run()).rejects.toThrow("refused");
			expect(get(git).error).toEqual({
				code: "unknown",
				raw: "Error: refused",
			});
		},
	);

	it("cherry-picks nothing when no commit is given", async () => {
		await expect(cherryPickCommits([])).resolves.toBeNull();
		expect(service.cherryPick).not.toHaveBeenCalled();
	});
});

describe("clearGitData", () => {
	it("empties what was read from the worktree and keeps the commit draft", async () => {
		service.getSnapshot.mockResolvedValue({
			version: 1,
			status: {
				isGitRepo: true,
				status: { "a.txt": "modified" },
				changedPaths: { staged: [], unstaged: ["a.txt"] },
			},
			currentBranch: "main",
			remoteStatus: null,
			operationState: null,
		});
		await refreshStatus();
		setCommitMessage("kept");
		expect(get(git).statusWorktree).toBe(WORKTREE);
		clearGitData();
		expect(get(git).status).toEqual({});
		expect(get(git).statusWorktree).toBeNull();
		expect(get(git).currentBranch).toBe("");
		expect(get(git).error).toBeNull();
		expect(get(commitDraft).message).toBe("kept");
	});
});

const changed = (
	staged: string[],
	unstaged: string[],
	renames: Record<string, string> = {},
) => ({
	isGitRepo: true,
	status: {},
	changedPaths: { staged, unstaged, renames },
});

const fileDiff = (filePath: string) => ({
	filePath,
	hunks: [
		{ header: "@@ -1 +1 @@", lines: [{ kind: "add", content: filePath }] },
	],
});

const snapshotOf = (
	status: Record<string, string> = {},
	overrides: Record<string, unknown> = {},
) => ({
	version: 1,
	status: {
		isGitRepo: true,
		status,
		changedPaths: { staged: [], unstaged: [] },
	},
	currentBranch: "main",
	remoteStatus: null,
	operationState: null,
	...overrides,
});

function deferred<T>() {
	let resolve: (value: T) => void = () => {};
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

const operationStateOf = (conflictedFiles: string[]) => ({
	kind: "merge",
	conflictedFiles,
	structuralFiles: [],
	head: "",
	current: 0,
	total: 0,
});

async function useInstances(ids: string[], activeId: string) {
	listInstances.mockResolvedValue(ids.map((id) => instance(id, "p1")));
	projects.set([project("p1", { activeInstanceId: activeId })]);
	activeProjectId.set("p1");
	await loadInstances("p1");
}

function activateInstance(id: string) {
	projects.set([project("p1", { activeInstanceId: id })]);
}

const worktreeOf = (id: string) => `/worktrees/p1/${id}`;

describe("gitFileCounts on untracked files only", () => {
	it("leaves a modified file out of the unstaged count when git did not list it", async () => {
		service.getSnapshot.mockResolvedValue(snapshotOf({ "m.txt": "modified" }));
		await refreshStatus();
		expect(get(gitFileCounts)).toEqual({ staged: 0, unstaged: 0, total: 0 });
	});
});

describe("gitHasConflicts", () => {
	it("is false on a clean worktree with no operation in progress", async () => {
		service.getSnapshot.mockResolvedValue(snapshotOf({ "m.txt": "modified" }));
		await refreshStatus();
		expect(get(gitHasConflicts)).toBe(false);
	});

	it("is false before anything was read", () => {
		expect(get(gitHasConflicts)).toBe(false);
	});

	it("is true when the status lists a conflicted file", async () => {
		service.getSnapshot.mockResolvedValue(snapshotOf({ "a.ts": "conflicted" }));
		await refreshStatus();
		expect(get(gitHasConflicts)).toBe(true);
	});

	it("is true when an interrupted operation holds a single conflicted file", async () => {
		service.getSnapshot.mockResolvedValue(
			snapshotOf({}, { operationState: operationStateOf(["a.ts"]) }),
		);
		await refreshStatus();
		expect(get(gitHasConflicts)).toBe(true);
	});

	it("is false when the operation has no conflicted file left", async () => {
		service.getSnapshot.mockResolvedValue(
			snapshotOf({}, { operationState: operationStateOf([]) }),
		);
		await refreshStatus();
		expect(get(gitHasConflicts)).toBe(false);
	});
});

describe("a successful write", () => {
	it("takes down the banner of an earlier failure", async () => {
		service.commit.mockRejectedValueOnce({ code: "hook_rejected", raw: "x" });
		await expect(commitChanges("msg")).rejects.toBeDefined();
		expect(get(git).error).not.toBeNull();
		await pushTag("v1");
		expect(get(git).error).toBeNull();
	});
});

describe("refreshStatus without a worktree", () => {
	it("still answers with a promise and reads nothing", async () => {
		withoutWorktree();
		const answer = refreshStatus();
		expect(answer).toBeInstanceOf(Promise);
		await answer;
		expect(service.getSnapshot).not.toHaveBeenCalled();
	});
});

describe("refreshStatus in flight", () => {
	afterEach(() => {
		setDiffsWanted(false);
		setVisibleDiffPaths([], []);
	});

	it("shows the loading state while a visible refresh runs", async () => {
		service.commit.mockRejectedValueOnce({ code: "hook_rejected", raw: "x" });
		await expect(commitChanges("msg")).rejects.toBeDefined();
		const snapshot = deferred<null>();
		service.getSnapshot.mockReturnValue(snapshot.promise);
		const pending = refreshStatus();
		expect(get(git).isLoading).toBe(true);
		expect(get(git).error).toBeNull();
		snapshot.resolve(null);
		await pending;
		expect(get(git).isLoading).toBe(false);
	});

	it("stays quiet while a silent refresh runs", async () => {
		const snapshot = deferred<null>();
		service.getSnapshot.mockReturnValue(snapshot.promise);
		const pending = refreshStatus(true);
		expect(get(git).isLoading).toBe(false);
		snapshot.resolve(null);
		await pending;
	});

	it("does not notify anyone when a poll finds nothing changed", async () => {
		await refreshStatus(true);
		let notifications = 0;
		const unsubscribe = git.subscribe(() => {
			notifications += 1;
		});
		notifications = 0;
		await refreshStatus(true);
		unsubscribe();
		expect(notifications).toBe(0);
	});

	it("asks for the snapshot version it already holds on the same worktree", async () => {
		service.getSnapshot.mockResolvedValue(snapshotOf({}, { version: 5 }));
		await refreshStatus();
		await refreshStatus();
		expect(service.getSnapshot).toHaveBeenLastCalledWith(WORKTREE, 5);
	});

	it("does not read a diff while nothing shows them", async () => {
		service.getSnapshot.mockResolvedValue(
			snapshotOf({}, { status: changed(["s.ts"], ["u.ts"]) }),
		);
		setVisibleDiffPaths(["u.ts"], ["s.ts"]);
		await refreshStatus();
		expect(service.getFileDiffs).not.toHaveBeenCalled();
		expect(service.getStagedTotals).not.toHaveBeenCalled();
	});

	it("asks from scratch when the last read came from another worktree", async () => {
		await useInstances(["sa", "sb"], "sa");
		const snapshot = deferred<ReturnType<typeof snapshotOf>>();
		service.getSnapshot.mockReturnValue(snapshot.promise);
		const stale = refreshStatus();
		activateInstance("sb");
		snapshot.resolve(snapshotOf({}, { version: 7 }));
		await stale;
		service.getSnapshot.mockResolvedValue(null);
		await refreshStatus();
		expect(service.getSnapshot).toHaveBeenLastCalledWith(worktreeOf("sb"), "");
	});

	it("reads the diffs of the visible cards only, and all of them again on each poll", async () => {
		service.getSnapshot.mockResolvedValue(
			snapshotOf({}, { status: changed(["s.ts"], ["u.ts", "far.ts"]) }),
		);
		service.getFileDiffs.mockResolvedValue({
			unstaged: [fileDiff("u.ts")],
			staged: [fileDiff("s.ts")],
		});
		setDiffsWanted(true);
		setVisibleDiffPaths(["u.ts"], ["s.ts"]);
		await refreshStatus();
		await vi.waitFor(() =>
			expect(get(git).fileDiffs.unstaged["u.ts"]).toBeTruthy(),
		);
		expect(get(git).fileDiffs.staged["s.ts"]?.filePath).toBe("s.ts");
		expect(service.getFileDiffs).toHaveBeenLastCalledWith(
			WORKTREE,
			["u.ts"],
			[{ path: "s.ts" }],
		);

		service.getFileDiffs.mockClear();
		service.getSnapshot.mockResolvedValue(null);
		await refreshStatus();
		await vi.waitFor(() =>
			expect(service.getFileDiffs).toHaveBeenCalledWith(
				WORKTREE,
				["u.ts"],
				[{ path: "s.ts" }],
			),
		);
	});

	it("reads only the cards it lacks when the list grows", async () => {
		service.getSnapshot.mockResolvedValue(
			snapshotOf({}, { status: changed([], ["a.ts", "b.ts"]) }),
		);
		service.getFileDiffs.mockResolvedValue({
			unstaged: [fileDiff("a.ts")],
			staged: [],
		});
		setDiffsWanted(true);
		setVisibleDiffPaths(["a.ts"], []);
		await refreshStatus();
		await vi.waitFor(() =>
			expect(get(git).fileDiffs.unstaged["a.ts"]).toBeTruthy(),
		);

		service.getFileDiffs.mockClear();
		service.getFileDiffs.mockResolvedValue({
			unstaged: [fileDiff("b.ts")],
			staged: [],
		});
		setVisibleDiffPaths(["a.ts", "b.ts"], []);
		await vi.waitFor(() =>
			expect(get(git).fileDiffs.unstaged["b.ts"]).toBeTruthy(),
		);
		expect(service.getFileDiffs).toHaveBeenCalledTimes(1);
		expect(service.getFileDiffs).toHaveBeenCalledWith(WORKTREE, ["b.ts"], []);
		expect(get(git).fileDiffs.unstaged["a.ts"]).toBeTruthy();
	});

	it("marks a visible path read with nothing to show, and forgets the paths scrolled away", async () => {
		service.getSnapshot.mockResolvedValue(
			snapshotOf({}, { status: changed([], ["a.ts", "b.ts"]) }),
		);
		service.getFileDiffs.mockResolvedValue({
			unstaged: [fileDiff("a.ts")],
			staged: [],
		});
		setDiffsWanted(true);
		setVisibleDiffPaths(["a.ts", "b.ts"], []);
		await refreshStatus();
		await vi.waitFor(() =>
			expect("b.ts" in get(git).fileDiffs.unstaged).toBe(true),
		);
		expect(get(git).fileDiffs.unstaged["b.ts"]).toBeNull();

		setVisibleDiffPaths(["b.ts"], []);
		service.getSnapshot.mockResolvedValue(null);
		service.getFileDiffs.mockResolvedValue({ unstaged: [], staged: [] });
		await refreshStatus();
		await vi.waitFor(() =>
			expect("a.ts" in get(git).fileDiffs.unstaged).toBe(false),
		);
	});

	it("keeps an unchanged diff, and notifies nobody, on a quiet poll", async () => {
		service.getSnapshot.mockResolvedValue(
			snapshotOf({}, { status: changed([], ["a.ts"]) }),
		);
		service.getFileDiffs.mockImplementation(async () => ({
			unstaged: [fileDiff("a.ts")],
			staged: [],
		}));
		setDiffsWanted(true);
		setVisibleDiffPaths(["a.ts"], []);
		await refreshStatus();
		await vi.waitFor(() =>
			expect(get(git).fileDiffs.unstaged["a.ts"]).toBeTruthy(),
		);
		const held = get(git).fileDiffs.unstaged["a.ts"];

		service.getSnapshot.mockResolvedValue(null);
		let notifications = 0;
		const unsubscribe = git.subscribe(() => {
			notifications += 1;
		});
		notifications = 0;
		service.getFileDiffs.mockClear();
		await refreshStatus(true);
		await vi.waitFor(() => expect(service.getFileDiffs).toHaveBeenCalled());
		await Promise.resolve();
		unsubscribe();
		expect(notifications).toBe(0);
		expect(get(git).fileDiffs.unstaged["a.ts"]).toBe(held);
	});

	it("hands a staged rename its source, so git pairs the two", async () => {
		service.getSnapshot.mockResolvedValue(
			snapshotOf(
				{},
				{ status: changed(["new.ts"], [], { "new.ts": "old.ts" }) },
			),
		);
		service.getFileDiffs.mockResolvedValue({ unstaged: [], staged: [] });
		setDiffsWanted(true);
		setVisibleDiffPaths([], ["new.ts"]);
		await refreshStatus();
		await vi.waitFor(() =>
			expect(service.getFileDiffs).toHaveBeenCalledWith(
				WORKTREE,
				[],
				[{ path: "new.ts", oldPath: "old.ts" }],
			),
		);
	});

	it("shows the staged totals as pending while they are read again after a change", async () => {
		const totals = deferred<{ added: number; removed: number }>();
		service.getStagedTotals.mockReturnValue(totals.promise);
		service.getFileDiffs.mockResolvedValue({ unstaged: [], staged: [] });
		service.getSnapshot.mockResolvedValue(
			snapshotOf({}, { status: changed(["s.ts"], []) }),
		);
		setDiffsWanted(true);
		await refreshStatus();
		await vi.waitFor(() => expect(get(git).isStagedTotalsPending).toBe(true));
		totals.resolve({ added: 12, removed: 3 });
		await vi.waitFor(() => expect(get(git).isStagedTotalsPending).toBe(false));
		expect(get(git).stagedTotals).toEqual({ added: 12, removed: 3 });
	});

	it("does not ask for totals when nothing is staged", async () => {
		service.getFileDiffs.mockResolvedValue({ unstaged: [], staged: [] });
		service.getSnapshot.mockResolvedValue(
			snapshotOf({}, { status: changed([], ["u.ts"]) }),
		);
		setDiffsWanted(true);
		await refreshStatus();
		await vi.waitFor(() =>
			expect(get(git).stagedTotals).toEqual({ added: 0, removed: 0 }),
		);
		expect(service.getStagedTotals).not.toHaveBeenCalled();
	});

	it("drops the diffs and the totals when the git view closes", async () => {
		service.getSnapshot.mockResolvedValue(
			snapshotOf({}, { status: changed(["s.ts"], ["a.ts"]) }),
		);
		service.getFileDiffs.mockResolvedValue({
			unstaged: [fileDiff("a.ts")],
			staged: [],
		});
		service.getStagedTotals.mockResolvedValue({ added: 1, removed: 0 });
		setDiffsWanted(true);
		setVisibleDiffPaths(["a.ts"], []);
		await refreshStatus();
		await vi.waitFor(() => expect(get(git).stagedTotals).not.toBeNull());
		setDiffsWanted(false);
		expect(get(git).fileDiffs).toEqual({ unstaged: {}, staged: {} });
		expect(get(git).stagedTotals).toBeNull();
	});

	it("publishes a failed read and stops the loading state", async () => {
		service.getSnapshot.mockRejectedValue(new Error("boom"));
		await refreshStatus();
		expect(get(git).isLoading).toBe(false);
		expect(get(git).error).toEqual({ code: "unknown", raw: "Error: boom" });
	});

	it("survives a diff read that fails", async () => {
		service.getSnapshot.mockResolvedValue(
			snapshotOf({}, { status: changed([], ["a.ts"]) }),
		);
		service.getFileDiffs.mockRejectedValue(new Error("diffs"));
		setDiffsWanted(true);
		setVisibleDiffPaths(["a.ts"], []);
		await refreshStatus();
		await vi.waitFor(() => expect(service.getFileDiffs).toHaveBeenCalled());
		expect(get(git).error).toBeNull();
		expect(get(git).fileDiffs.unstaged).toEqual({});
	});

	it("does not reload the graph for a write that left the snapshot unchanged", async () => {
		service.getGraph.mockResolvedValue([graphRow("a")]);
		await refreshGraph();
		service.getGraph.mockClear();
		await stageFile("a.ts");
		expect(service.getGraph).not.toHaveBeenCalled();
	});
});

describe("pages landing after the worktree is gone", () => {
	it("does not ask for another log page", async () => {
		const page = deferred<{ hash: string; message: string }[]>();
		service.getLog.mockReturnValue(page.promise);
		const pending = refreshLog();
		withoutWorktree();
		page.resolve(
			Array.from({ length: 50 }, (_, i) => ({
				hash: `c${i}`,
				message: `commit ${i}`,
			})),
		);
		await pending;
		expect(get(git).logHasMore).toBe(true);
		service.getLog.mockClear();
		await loadMoreLog();
		expect(service.getLog).not.toHaveBeenCalled();
	});

	it("does not ask for another graph page", async () => {
		const page = deferred<ReturnType<typeof graphRow>[]>();
		service.getGraph.mockReturnValue(page.promise);
		const pending = refreshGraph();
		withoutWorktree();
		page.resolve(Array.from({ length: 20 }, (_, i) => graphRow(`a${i}`)));
		await pending;
		expect(get(git).graphHasMore).toBe(true);
		service.getGraph.mockClear();
		await loadMoreGraph();
		expect(service.getGraph).not.toHaveBeenCalled();
	});
});

describe("a log reload that fails", () => {
	it("stays quiet when a single commit is already listed", async () => {
		service.getLog.mockResolvedValue([{ hash: "c0", message: "one" }]);
		await refreshLog();
		service.getLog.mockRejectedValue(new Error("no log"));
		await refreshLog();
		expect(get(git).error).toBeNull();
	});
});

describe("the graph of a project with no active instance", () => {
	const page = (prefix: string) =>
		Array.from({ length: 20 }, (_, i) => graphRow(`${prefix}${i}`));

	beforeEach(() => {
		projects.set([project("pz")]);
		activeProjectId.set("pz");
		expect(get(activeInstance)).toBeNull();
		service.getGraph.mockResolvedValue(page("a"));
	});

	it("reads the first page from the project path", async () => {
		await refreshGraph();
		expect(service.getGraph).toHaveBeenCalledWith("/repos/pz", 20, 0);
		expect(get(git).graph).toHaveLength(20);
	});

	it("appends the next page and settles", async () => {
		await refreshGraph();
		service.getGraph.mockResolvedValue(page("b"));
		await loadMoreGraph();
		expect(service.getGraph).toHaveBeenLastCalledWith("/repos/pz", 20, 20);
		expect(get(git).graph).toHaveLength(40);
		expect(get(git).graphPaging).toBe("idle");
	});

	it("loads everything from the project path", async () => {
		await loadAllGraph();
		expect(service.getGraph).toHaveBeenCalledWith("/repos/pz", 1_000_000, 0);
	});

	it("keeps the graph in step once it was read", async () => {
		await refreshGraph();
		service.getGraph.mockClear();
		await syncGraph();
		expect(service.getGraph).toHaveBeenCalledWith("/repos/pz", 20, 0);
	});
});

describe("graph paging", () => {
	const page = (prefix: string) =>
		Array.from({ length: 20 }, (_, i) => graphRow(`${prefix}${i}`));

	beforeEach(async () => {
		service.getGraph.mockResolvedValue(page("a"));
		await refreshGraph();
	});

	it("counts a page that brings a single new commit", async () => {
		service.getGraph.mockResolvedValue([...page("a").slice(1), graphRow("z")]);
		await loadMoreGraph();
		expect(get(git).graph).toHaveLength(21);
		expect(get(git).graph[20].hash).toBe("z");
		expect(get(git).graphHasMore).toBe(true);
	});

	it("leaves the list itself untouched on a page of known commits", async () => {
		const before = get(git).graph;
		service.getGraph.mockResolvedValue(page("a"));
		await loadMoreGraph();
		expect(get(git).graph).toBe(before);
	});

	it("keeps the graph in step after loading everything", async () => {
		service.getGraph.mockResolvedValue([graphRow("a")]);
		await loadAllGraph();
		service.getGraph.mockClear();
		await pushBranch();
		expect(service.getGraph).toHaveBeenCalledWith(WORKTREE, 20, 0);
	});

	it("arms the scroll when a sync fills a graph that was empty", async () => {
		service.getGraph.mockResolvedValue([]);
		await refreshGraph();
		service.getGraph.mockResolvedValue(page("b"));
		await syncGraph();
		expect(get(git).graphHasMore).toBe(true);
	});

	it("leaves the scroll as it was once rows are listed", async () => {
		service.getGraph.mockResolvedValue([graphRow("a")]);
		await refreshGraph();
		expect(get(git).graphHasMore).toBe(false);
		service.getGraph.mockResolvedValue(page("b"));
		await syncGraph();
		expect(get(git).graphHasMore).toBe(false);
	});
});

describe("the writes reread what they changed", () => {
	const rereadingWrites: {
		name: string;
		run: () => Promise<unknown>;
		rereads: ("status" | "log" | "graph" | "branches" | "tags")[];
	}[] = [
		{
			name: "commitChanges",
			run: () => commitChanges("feat: x"),
			rereads: ["status", "log", "graph"],
		},
		{
			name: "amendLastCommit",
			run: () => amendLastCommit("feat: x"),
			rereads: ["status", "log", "graph"],
		},
		{
			name: "recoverFromGitError",
			run: () => recoverFromGitError("removeLock"),
			rereads: ["status"],
		},
		{
			name: "cherryPickCommits",
			run: () => cherryPickCommits(["a1"]),
			rereads: ["status", "log"],
		},
		{
			name: "continueCherryPick",
			run: () => continueCherryPick(),
			rereads: ["status", "log"],
		},
		{
			name: "skipCherryPick",
			run: () => skipCherryPick(),
			rereads: ["status", "log"],
		},
		{
			name: "abortCherryPick",
			run: () => abortCherryPick(),
			rereads: ["status", "log"],
		},
		{
			name: "deleteBranch",
			run: () => deleteBranch("topic"),
			rereads: ["status", "graph", "branches"],
		},
		{
			name: "deleteRemoteBranch",
			run: () => deleteRemoteBranch("topic"),
			rereads: ["status", "graph", "branches"],
		},
		{
			name: "createTag",
			run: () => createTag("v1", ""),
			rereads: ["graph", "tags"],
		},
		{
			name: "deleteRemoteTag",
			run: () => deleteRemoteTag("v1"),
			rereads: ["tags"],
		},
		{
			name: "stageFiles",
			run: () => stageFiles(["a.ts"]),
			rereads: ["status"],
		},
		{
			name: "unstageFiles",
			run: () => unstageFiles(["a.ts"]),
			rereads: ["status"],
		},
		{
			name: "discardFiles",
			run: () => discardFiles(["a.ts"]),
			rereads: ["status"],
		},
	];

	it.each(rereadingWrites)(
		"$name rereads $rereads",
		async ({ run, rereads }) => {
			service.getGraph.mockResolvedValue([graphRow("a")]);
			await refreshGraph();
			for (const fn of [
				service.getGraph,
				service.getSnapshot,
				service.getLog,
				service.getTagList,
				branchLists,
			]) {
				fn.mockClear();
			}
			await run();
			if (rereads.includes("status")) {
				expect(service.getSnapshot).toHaveBeenCalledWith(WORKTREE, "");
			}
			if (rereads.includes("log")) {
				expect(service.getLog).toHaveBeenCalledWith(WORKTREE, 50, 0);
			}
			if (rereads.includes("graph")) {
				expect(service.getGraph).toHaveBeenCalledWith(WORKTREE, 20, 0);
			}
			if (rereads.includes("branches")) {
				expect(branchLists).toHaveBeenCalledWith(WORKTREE);
			}
			if (rereads.includes("tags")) {
				expect(service.getTagList).toHaveBeenCalledWith(WORKTREE);
			}
		},
	);

	it("deleteRemoteTag asks the remote to delete the tag", async () => {
		await deleteRemoteTag("v1");
		expect(service.tagDeleteRemote).toHaveBeenCalledWith(
			WORKTREE,
			"origin",
			"v1",
		);
	});

	it("sets the upstream on request even when the branch already has one", async () => {
		service.getSnapshot.mockResolvedValue(
			snapshotOf(
				{},
				{ remoteStatus: { hasUpstream: true, ahead: 0, behind: 0 } },
			),
		);
		await refreshStatus();
		await recoverFromGitError("setUpstream");
		expect(service.push).toHaveBeenCalledWith(
			WORKTREE,
			true,
			"main",
			false,
			"normal",
		);
	});
});

describe("loadBranches in flight", () => {
	it("shows the loading state until the lists arrive", async () => {
		const lists = deferred<{ local: string[]; remote: string[] }>();
		branchLists.mockReturnValue(lists.promise);
		const pending = loadBranches("/repos/p1", { fetch: false });
		expect(get(git).isLoadingBranches).toBe(true);
		lists.resolve({ local: [], remote: [] });
		await pending;
		expect(get(git).isLoadingBranches).toBe(false);
	});
});

describe("the commit draft", () => {
	it("keeps the subject when the body is typed", () => {
		setCommitMessage("subject");
		setCommitBody("body");
		expect(get(commitDraft)).toEqual({ message: "subject", body: "body" });
	});

	it("is emptied by a reset of the store", () => {
		setCommitMessage("subject");
		setCommitBody("body");
		resetGitStore();
		expect(get(commitDraft)).toEqual({ message: "", body: "" });
	});
});

describe("clearing what was read", () => {
	it("stops keeping the graph in step", async () => {
		service.getGraph.mockResolvedValue([graphRow("a")]);
		await refreshGraph();
		clearGitData();
		service.getGraph.mockClear();
		await syncGraph();
		expect(service.getGraph).not.toHaveBeenCalled();
	});

	it("is not undone by leaving and coming back", async () => {
		await useInstances(["ca", "cb"], "ca");
		service.getSnapshot.mockResolvedValue(snapshotOf({ "a.txt": "modified" }));
		await refreshStatus();
		activateInstance("cb");
		activateInstance("ca");
		expect(get(git).status).toEqual({ "a.txt": "modified" });
		clearGitData();
		activateInstance("cb");
		activateInstance("ca");
		expect(get(git).statusWorktree).toBeNull();
		expect(get(git).status).toEqual({});
	});
});

describe("the worktree cache", () => {
	const cacheIds = Array.from({ length: 10 }, (_, i) => `k${i}`);

	async function readOn(id: string) {
		activateInstance(id);
		await refreshStatus();
	}

	async function emptyCache() {
		await useInstances(["i1", ...cacheIds], "i1");
		for (const id of ["i1", ...cacheIds]) {
			activateInstance(id);
			clearGitData();
		}
	}

	beforeEach(async () => {
		service.getSnapshot.mockResolvedValue(snapshotOf({ "a.txt": "modified" }));
		await emptyCache();
	});

	it("lets the least recently left worktree go once the bound is passed", async () => {
		for (const id of cacheIds.slice(0, 9)) await readOn(id);
		activateInstance("k9");
		activateInstance("k0");
		expect(get(git).statusWorktree).toBeNull();
		activateInstance("k1");
		expect(get(git).statusWorktree).toBe(worktreeOf("k1"));
	});

	it("counts a worktree that was visited again as the most recent", async () => {
		for (const id of cacheIds.slice(0, 8)) await readOn(id);
		activateInstance("k8");
		activateInstance("k0");
		expect(get(git).statusWorktree).toBe(worktreeOf("k0"));
		await readOn("k8");
		activateInstance("k9");
		activateInstance("k1");
		expect(get(git).statusWorktree).toBeNull();
		activateInstance("k0");
		expect(get(git).statusWorktree).toBe(worktreeOf("k0"));
	});

	it("does not keep a worktree whose status was never read", async () => {
		await useInstances(["ka", "kb"], "ka");
		service.getLog.mockResolvedValue([{ hash: "c0", message: "one" }]);
		await refreshLog();
		activateInstance("kb");
		activateInstance("ka");
		expect(get(git).log).toEqual([]);
	});

	it("gives back the graph a worktree was left with", async () => {
		await useInstances(["ga", "gb"], "ga");
		service.getGraph.mockResolvedValue([graphRow("a")]);
		await refreshStatus();
		await refreshGraph();
		activateInstance("gb");
		activateInstance("ga");
		service.getGraph.mockClear();
		await syncGraph();
		expect(service.getGraph).toHaveBeenCalledWith(worktreeOf("ga"), 20, 0);
		activateInstance("gb");
		service.getGraph.mockClear();
		await syncGraph();
		expect(service.getGraph).not.toHaveBeenCalled();
	});

	it("gives a worktree back after a moment with no instance at all", async () => {
		await useInstances(["na"], "na");
		await refreshStatus();
		withoutWorktree();
		projects.set([project("p1", { activeInstanceId: "na" })]);
		activeProjectId.set("p1");
		expect(get(git).statusWorktree).toBe(worktreeOf("na"));
	});

	it("keeps what was read when the instance is republished unchanged", async () => {
		await useInstances(["ra"], "ra");
		service.getLog.mockResolvedValue([{ hash: "c0", message: "one" }]);
		await refreshLog();
		listInstances.mockResolvedValue([instance("ra", "p1", { createdAt: 1 })]);
		await loadInstances("p1");
		expect(get(git).log).toHaveLength(1);
	});
});
