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
	getGraph: vi.fn().mockResolvedValue([]),
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
	mergeBranch,
	pullBranch,
	pushBranch,
	recoverFromGitError,
	refreshStatus,
	resetGitStore,
	setCommitBody,
	setCommitMessage,
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
		expect(service.push).toHaveBeenCalledWith(WORKTREE, true, "", false);
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
		expect(service.push).toHaveBeenCalledWith(WORKTREE, false, "main", false);
	});

	it("sets the upstream on request even when one exists", async () => {
		await pushBranch(true);
		expect(service.push).toHaveBeenCalledWith(
			WORKTREE,
			true,
			expect.any(String),
			false,
		);
	});

	it("passes force through", async () => {
		await pushBranch(false, true);
		expect(service.push).toHaveBeenCalledWith(
			WORKTREE,
			true,
			expect.any(String),
			true,
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
