// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// The write side of the git store: every mutation goes through `mutate`, which
// publishes the error and rethrows, and every command is scoped to the active
// instance worktree. What is checked here is the mapping result -> state -> UI,
// not the git calls themselves (git-service.test.ts covers those).

import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
	toGitError: vi.fn((e: unknown) => ({ code: "unknown", raw: String(e) })),
}));

vi.mock("$lib/services/git-service", () => ({
	...service,
	getStatusFull: vi.fn().mockResolvedValue({}),
	getChangedPaths: vi.fn().mockResolvedValue({ staged: [], unstaged: [] }),
	getDiffUnstaged: vi.fn().mockResolvedValue([]),
	getDiffStaged: vi.fn().mockResolvedValue([]),
	getDiffs: vi.fn().mockResolvedValue(null),
	getCurrentBranch: vi.fn().mockResolvedValue("main"),
	getRemoteStatus: vi.fn().mockResolvedValue(null),
	getOperationState: vi.fn().mockResolvedValue(null),
}));

vi.mock("./terminal", () => ({
	removeInstanceTerminals: vi.fn().mockResolvedValue(undefined),
}));

const listInstances = vi.hoisted(() => vi.fn());
vi.mock("$lib/services/instance-service", () => ({
	listInstances,
	listBranchesDetailed: vi.fn(),
	createInstance: vi.fn(),
	deleteInstance: vi.fn(),
	duplicateInstance: vi.fn(),
	updateInstanceStatus: vi.fn(),
}));

import {
	amendLastCommit,
	clearGitError,
	commitChanges,
	commitDraft,
	fetchRemote,
	git,
	loadMoreGraph,
	mergeBranch,
	pullBranch,
	pushBranch,
	recoverFromGitError,
	refreshGraph,
	refreshStatus,
	resetGitStore,
	setCommitBody,
	setCommitMessage,
	syncGraph,
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
	resetGitStore();
	listInstances.mockResolvedValue([]);
	service.getSnapshot.mockResolvedValue(null);
	service.getLog.mockResolvedValue([]);
	service.getGraph.mockResolvedValue([]);
	service.commit.mockResolvedValue("abc1234");
	service.amendCommit.mockResolvedValue("abc1234");
	service.push.mockResolvedValue("");
	service.pull.mockResolvedValue(clean());
	service.fetch.mockResolvedValue(undefined);
	service.merge.mockResolvedValue(clean());
	service.removeIndexLock.mockResolvedValue(undefined);
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
		expect(service.getGraph).toHaveBeenCalled();
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
			expect(service.getGraph).toHaveBeenCalled();
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
		expect(service.getGraph).toHaveBeenCalled();
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
		expect(service.pull).toHaveBeenCalled();
		expect(service.push).toHaveBeenCalled();
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
