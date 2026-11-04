// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	addRemote,
	amendCommit,
	checkIgnore,
	checkoutBranch,
	cherryPick,
	cherryPickAbort,
	cherryPickContinue,
	cherryPickSkip,
	commit,
	commitExists,
	createBranch,
	deleteBranch,
	deleteRemoteBranch,
	discardFile,
	discardFiles,
	fetch,
	forgetRepoRoots,
	GIT_ERROR_CODES,
	type GitError,
	getBranchDivergence,
	getChangedPaths,
	getCommitBody,
	getCurrentBranch,
	getDiffCommit,
	getDiffFileBetween,
	getDiffFilesBetween,
	getDiffStaged,
	getDiffUnstaged,
	getFileAtHead,
	getFileDiffs,
	getFileInIndex,
	getGraph,
	getGraphStashes,
	getHeadMessage,
	getIdentity,
	getLog,
	getOperationState,
	getRemoteStatus,
	getRemoteUrl,
	getSnapshot,
	getStagedTotals,
	getStashList,
	getStashShow,
	getStatusFull,
	getTagList,
	initRepository,
	isGitRepo,
	isKnownGitErrorCode,
	listRemotes,
	merge,
	mergeAbort,
	mergeContinue,
	pull,
	push,
	readExclude,
	rebase,
	rebaseAbort,
	rebaseContinue,
	rebaseSkip,
	removeIndexLock,
	removeRemote,
	renameBranch,
	renameRemote,
	resetToCommit,
	revertCommit,
	rmFile,
	setRemoteUrl,
	stageAll,
	stageFile,
	stageFiles,
	stashApply,
	stashClear,
	stashDrop,
	stashPop,
	stashPush,
	stashRename,
	tagCreate,
	tagDelete,
	tagDeleteRemote,
	tagPush,
	tagRemoteList,
	toGitError,
	unstageAll,
	unstageFile,
	unstageFiles,
	writeExclude,
} from "./git-service";

const mockInvoke = vi.mocked(invoke);

/** The payload the service handed to invoke on its last call. */
const lastPayload = () =>
	mockInvoke.mock.calls.at(-1)?.[1] as Record<string, unknown>;

beforeEach(() => {
	mockInvoke.mockReset();
	mockInvoke.mockResolvedValue(undefined);
});

describe("isKnownGitErrorCode", () => {
	it("accepts every code the classifier can produce", () => {
		for (const code of GIT_ERROR_CODES) {
			expect(isKnownGitErrorCode(code), code).toBe(true);
		}
	});

	it("rejects a code an older or newer backend might send", () => {
		expect(isKnownGitErrorCode("not_a_real_code")).toBe(false);
		expect(isKnownGitErrorCode("")).toBe(false);
	});

	it("is case sensitive, since the codes are a closed vocabulary", () => {
		expect(isKnownGitErrorCode("LOCK_EXISTS")).toBe(false);
	});
});

describe("toGitError", () => {
	it("passes a classified error through untouched", () => {
		const error: GitError = { code: "auth_failed", raw: "stderr text" };
		expect(toGitError(error)).toBe(error);
	});

	it("keeps the context a classified error carries", () => {
		const error: GitError = {
			code: "no_upstream",
			raw: "raw",
			context: "push",
		};
		expect(toGitError(error)).toEqual(error);
	});

	it("wraps a plain string rejection, keeping its text readable", () => {
		expect(toGitError("fatal: not a git repository")).toEqual({
			code: "unknown",
			raw: "fatal: not a git repository",
		});
	});

	it("wraps an Error, keeping its message in raw", () => {
		expect(toGitError(new Error("boom"))).toEqual({
			code: "unknown",
			raw: "Error: boom",
		});
	});

	it("wraps what a rejected promise may carry instead of an error", () => {
		expect(toGitError(undefined).code).toBe("unknown");
		expect(toGitError(null).raw).toBe("null");
		expect(toGitError(42).raw).toBe("42");
	});

	it("wraps an object that is not shaped like a git error", () => {
		expect(toGitError({ message: "nope" })).toEqual({
			code: "unknown",
			raw: "[object Object]",
		});
	});

	it("wraps a half-shaped error rather than trusting it", () => {
		expect(toGitError({ code: "auth_failed" }).code).toBe("unknown");
		expect(toGitError({ raw: "text" }).code).toBe("unknown");
		expect(toGitError({ code: 1, raw: "text" }).code).toBe("unknown");
	});

	/**
	 * The shape check does not verify the code against GIT_ERROR_CODES, so an
	 * unknown code from a newer backend passes through as-is rather than being
	 * flattened to "unknown". Callers guard with isKnownGitErrorCode.
	 */
	it("lets an unrecognised code through, as the shape check allows", () => {
		const error = { code: "from_a_newer_backend", raw: "text" };
		expect(toGitError(error)).toBe(error);
		expect(isKnownGitErrorCode(error.code)).toBe(false);
	});

	it("always answers with something a caller can render", () => {
		for (const value of [undefined, null, 0, "", [], {}, new Error("x")]) {
			const result = toGitError(value);
			expect(typeof result.code, String(value)).toBe("string");
			expect(typeof result.raw, String(value)).toBe("string");
		}
	});
});

describe("commit", () => {
	it("sends the message and the worktree", async () => {
		await commit("/repo", "feat: add thing");
		expect(mockInvoke).toHaveBeenCalledWith(
			"git_commit",
			expect.objectContaining({
				worktreePath: "/repo",
				message: "feat: add thing",
			}),
		);
	});

	it("defaults every flag to off rather than leaving it undefined", async () => {
		await commit("/repo", "msg");
		expect(lastPayload()).toEqual({
			worktreePath: "/repo",
			message: "msg",
			noVerify: false,
			signOff: false,
			allowEmpty: false,
			authorName: "",
			authorEmail: "",
		});
	});

	it("carries the flags the caller does set", async () => {
		await commit("/repo", "msg", {
			noVerify: true,
			signOff: true,
			allowEmpty: true,
		});
		expect(lastPayload()).toMatchObject({
			noVerify: true,
			signOff: true,
			allowEmpty: true,
		});
	});

	it("carries an author identity when one is applied", async () => {
		await commit("/repo", "msg", {
			authorName: "Ada",
			authorEmail: "ada@example.com",
		});
		expect(lastPayload()).toMatchObject({
			authorName: "Ada",
			authorEmail: "ada@example.com",
		});
	});

	it("keeps an explicit false rather than replacing it with the default", async () => {
		await commit("/repo", "msg", { noVerify: false });
		expect(lastPayload()).toMatchObject({ noVerify: false });
	});

	it("sends a multiline message whole", async () => {
		await commit("/repo", "subject\n\nbody line one\nbody line two");
		expect(lastPayload()).toMatchObject({
			message: "subject\n\nbody line one\nbody line two",
		});
	});

	it("answers with the hash the backend reports", async () => {
		mockInvoke.mockResolvedValue("abc1234");
		await expect(commit("/repo", "msg")).resolves.toBe("abc1234");
	});

	it("lets a git failure reach the caller", async () => {
		const error: GitError = { code: "nothing_to_commit", raw: "nothing" };
		mockInvoke.mockRejectedValue(error);
		await expect(commit("/repo", "msg")).rejects.toBe(error);
	});
});

describe("amendCommit", () => {
	it("defaults its flags to off, and carries no allowEmpty", async () => {
		await amendCommit("/repo", "msg");
		expect(lastPayload()).toEqual({
			worktreePath: "/repo",
			message: "msg",
			noVerify: false,
			signOff: false,
			authorName: "",
			authorEmail: "",
		});
	});

	it("carries the flags it is given", async () => {
		await amendCommit("/repo", "msg", { noVerify: true, authorName: "Ada" });
		expect(lastPayload()).toMatchObject({
			noVerify: true,
			authorName: "Ada",
		});
	});
});

describe("operations that can stop on conflicts", () => {
	it("reports a conflicted merge as a result, not as a failure", async () => {
		mockInvoke.mockResolvedValue({
			ok: true,
			hasConflicts: true,
			conflictedFiles: ["a.ts", "b.ts"],
			output: "CONFLICT",
		});
		const result = await merge("/repo", "feature");
		expect(result.hasConflicts).toBe(true);
		expect(result.conflictedFiles).toEqual(["a.ts", "b.ts"]);
	});

	it("reports a clean merge with no conflicted file", async () => {
		mockInvoke.mockResolvedValue({
			ok: true,
			hasConflicts: false,
			conflictedFiles: [],
			output: "Fast-forward",
		});
		await expect(merge("/repo", "feature")).resolves.toMatchObject({
			hasConflicts: false,
		});
	});

	it("still throws on a real failure", async () => {
		const error: GitError = { code: "dirty_worktree", raw: "uncommitted" };
		mockInvoke.mockRejectedValue(error);
		await expect(merge("/repo", "feature")).rejects.toBe(error);
	});
});

describe("push", () => {
	it("sends the branch, the upstream flag and force", async () => {
		mockInvoke.mockResolvedValue("");
		await push("/repo", true, "main");
		expect(lastPayload()).toEqual({
			worktreePath: "/repo",
			setUpstream: true,
			branch: "main",
			force: false,
			mode: "normal",
		});
	});

	it("defaults force to off", async () => {
		mockInvoke.mockResolvedValue("");
		await push("/repo", false, "main");
		expect(lastPayload()).toMatchObject({ force: false });
	});

	it("carries an explicit force", async () => {
		mockInvoke.mockResolvedValue("");
		await push("/repo", false, "main", true);
		expect(lastPayload()).toMatchObject({ force: true });
	});

	it("lets an auth failure through for the caller to classify", async () => {
		const error: GitError = { code: "auth_required", raw: "credentials" };
		mockInvoke.mockRejectedValue(error);
		await expect(push("/repo", false, "main")).rejects.toBe(error);
		expect(toGitError(error).code).toBe("auth_required");
	});
});

describe("getSnapshot sharing", () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	/** Each case uses its own worktree, so entries never leak between tests. */
	let n = 0;
	const wt = () => `/w/${++n}`;

	it("lets a click claim the snapshot the hover already read", async () => {
		const path = wt();
		mockInvoke.mockResolvedValue({ version: "v1" });
		await getSnapshot(path, "");
		await getSnapshot(path, "");
		expect(mockInvoke).toHaveBeenCalledTimes(1);
	});

	it("never serves a stored snapshot to a read that knows a version", async () => {
		const path = wt();
		mockInvoke.mockResolvedValue({ version: "v1" });
		await getSnapshot(path, "");
		await getSnapshot(path, "v1");
		expect(mockInvoke).toHaveBeenCalledTimes(2);
	});

	it("stops sharing a worktree once a versioned read has passed", async () => {
		const path = wt();
		mockInvoke.mockResolvedValue({ version: "v1" });
		await getSnapshot(path, "");
		await getSnapshot(path, "v1");
		await getSnapshot(path, "");
		expect(mockInvoke).toHaveBeenCalledTimes(3);
	});

	it("keeps worktrees apart", async () => {
		mockInvoke.mockResolvedValue({ version: "v1" });
		await getSnapshot(wt(), "");
		await getSnapshot(wt(), "");
		expect(mockInvoke).toHaveBeenCalledTimes(2);
	});
});

const WT = "/repo";

/** Commands that only forward their arguments: name, how it is called, what invoke must receive. */
const FORWARDERS: [
	string,
	() => Promise<unknown>,
	string,
	Record<string, unknown>,
][] = [
	["isGitRepo", () => isGitRepo(WT), "is_git_repo", { worktreePath: WT }],
	[
		"forgetRepoRoots",
		() => forgetRepoRoots("p1", "/p"),
		"git_forget_repo_roots",
		{ projectId: "p1", projectPath: "/p" },
	],
	[
		"getChangedPaths",
		() => getChangedPaths(WT),
		"git_changed_paths",
		{ worktreePath: WT },
	],
	[
		"stageFiles",
		() => stageFiles(WT, ["a", "b"]),
		"git_stage_files",
		{ worktreePath: WT, filePaths: ["a", "b"] },
	],
	[
		"unstageFiles",
		() => unstageFiles(WT, ["a", "b"]),
		"git_unstage_files",
		{ worktreePath: WT, filePaths: ["a", "b"] },
	],
	[
		"discardFiles",
		() => discardFiles(WT, ["a", "b"]),
		"git_discard_files",
		{ worktreePath: WT, filePaths: ["a", "b"] },
	],
	[
		"getFileDiffs",
		() => getFileDiffs(WT, ["a"], [{ path: "b", oldPath: "c" }]),
		"git_file_diffs",
		{
			worktreePath: WT,
			unstaged: ["a"],
			staged: [{ path: "b", oldPath: "c" }],
		},
	],
	[
		"getStagedTotals",
		() => getStagedTotals(WT),
		"git_staged_totals",
		{ worktreePath: WT },
	],
	[
		"checkIgnore",
		() => checkIgnore(WT, ["a", "b"]),
		"git_check_ignore",
		{ worktreePath: WT, paths: ["a", "b"] },
	],
	[
		"readExclude",
		() => readExclude(WT),
		"git_read_exclude",
		{ worktreePath: WT },
	],
	[
		"initRepository",
		() => initRepository(WT),
		"git_init",
		{ worktreePath: WT },
	],
	[
		"writeExclude",
		() => writeExclude(WT, "*.log"),
		"git_write_exclude",
		{ worktreePath: WT, content: "*.log" },
	],
	[
		"getDiffUnstaged",
		() => getDiffUnstaged(WT),
		"git_diff_unstaged",
		{ worktreePath: WT },
	],
	[
		"getDiffStaged",
		() => getDiffStaged(WT),
		"git_diff_staged",
		{ worktreePath: WT },
	],
	[
		"getDiffFilesBetween",
		() => getDiffFilesBetween(WT, "main", "feat"),
		"git_diff_files_between",
		{ worktreePath: WT, base: "main", head: "feat" },
	],
	[
		"getDiffFileBetween",
		() => getDiffFileBetween(WT, "main", "feat", "a.ts"),
		"git_diff_file_between",
		{ worktreePath: WT, base: "main", head: "feat", filePath: "a.ts" },
	],
	[
		"commitExists",
		() => commitExists(WT, "abc"),
		"git_commit_exists",
		{ worktreePath: WT, commitHash: "abc" },
	],
	[
		"getFileAtHead",
		() => getFileAtHead(WT, "a.ts"),
		"git_file_at_head",
		{ worktreePath: WT, filePath: "a.ts" },
	],
	[
		"getFileInIndex",
		() => getFileInIndex(WT, "a.ts"),
		"git_file_in_index",
		{ worktreePath: WT, filePath: "a.ts" },
	],
	[
		"stageFile",
		() => stageFile(WT, "a.ts"),
		"git_stage_file",
		{ worktreePath: WT, filePath: "a.ts" },
	],
	[
		"unstageFile",
		() => unstageFile(WT, "a.ts"),
		"git_unstage_file",
		{ worktreePath: WT, filePath: "a.ts" },
	],
	["stageAll", () => stageAll(WT), "git_stage_all", { worktreePath: WT }],
	["unstageAll", () => unstageAll(WT), "git_unstage_all", { worktreePath: WT }],
	[
		"getIdentity",
		() => getIdentity(WT),
		"git_get_identity",
		{ worktreePath: WT },
	],
	[
		"getCurrentBranch",
		() => getCurrentBranch(WT),
		"git_current_branch",
		{ worktreePath: WT },
	],
	[
		"checkoutBranch",
		() => checkoutBranch(WT, "feat"),
		"git_checkout_branch",
		{ worktreePath: WT, branchName: "feat" },
	],
	[
		"createBranch",
		() => createBranch(WT, "feat", "main"),
		"git_create_branch",
		{ worktreePath: WT, branchName: "feat", fromBranch: "main" },
	],
	[
		"deleteBranch",
		() => deleteBranch(WT, "feat", true),
		"git_delete_branch",
		{ worktreePath: WT, branchName: "feat", force: true },
	],
	[
		"deleteRemoteBranch",
		() => deleteRemoteBranch(WT, "origin", "feat"),
		"git_delete_remote_branch",
		{ worktreePath: WT, remote: "origin", branchName: "feat" },
	],
	[
		"renameBranch",
		() => renameBranch(WT, "old", "new"),
		"git_rename_branch",
		{ worktreePath: WT, oldName: "old", newName: "new" },
	],
	["fetch", () => fetch(WT), "git_fetch", { worktreePath: WT }],
	[
		"removeIndexLock",
		() => removeIndexLock(WT),
		"git_remove_index_lock",
		{ worktreePath: WT },
	],
	[
		"getOperationState",
		() => getOperationState(WT),
		"git_operation_state",
		{ worktreePath: WT },
	],
	[
		"rmFile",
		() => rmFile(WT, "a.ts"),
		"git_rm",
		{ worktreePath: WT, filePath: "a.ts" },
	],
	[
		"mergeContinue",
		() => mergeContinue(WT),
		"git_merge_continue",
		{ worktreePath: WT },
	],
	["mergeAbort", () => mergeAbort(WT), "git_merge_abort", { worktreePath: WT }],
	[
		"rebase",
		() => rebase(WT, "main"),
		"git_rebase",
		{ worktreePath: WT, onto: "main" },
	],
	[
		"rebaseContinue",
		() => rebaseContinue(WT),
		"git_rebase_continue",
		{ worktreePath: WT },
	],
	["rebaseSkip", () => rebaseSkip(WT), "git_rebase_skip", { worktreePath: WT }],
	[
		"rebaseAbort",
		() => rebaseAbort(WT),
		"git_rebase_abort",
		{ worktreePath: WT },
	],
	[
		"cherryPick",
		() => cherryPick(WT, ["a", "b"]),
		"git_cherry_pick",
		{ worktreePath: WT, commits: ["a", "b"] },
	],
	[
		"cherryPickContinue",
		() => cherryPickContinue(WT),
		"git_cherry_pick_continue",
		{ worktreePath: WT },
	],
	[
		"cherryPickSkip",
		() => cherryPickSkip(WT),
		"git_cherry_pick_skip",
		{ worktreePath: WT },
	],
	[
		"cherryPickAbort",
		() => cherryPickAbort(WT),
		"git_cherry_pick_abort",
		{ worktreePath: WT },
	],
	[
		"getRemoteStatus",
		() => getRemoteStatus(WT),
		"git_remote_status",
		{ worktreePath: WT },
	],
	[
		"getRemoteUrl",
		() => getRemoteUrl(WT),
		"git_remote_url",
		{ worktreePath: WT },
	],
	[
		"listRemotes",
		() => listRemotes(WT),
		"git_remote_list",
		{ worktreePath: WT },
	],
	[
		"addRemote",
		() => addRemote(WT, "up", "git@x:y.git"),
		"git_remote_add",
		{ worktreePath: WT, name: "up", url: "git@x:y.git" },
	],
	[
		"renameRemote",
		() => renameRemote(WT, "old", "new"),
		"git_remote_rename",
		{ worktreePath: WT, oldName: "old", newName: "new" },
	],
	[
		"setRemoteUrl",
		() => setRemoteUrl(WT, "up", "git@x:z.git"),
		"git_remote_set_url",
		{ worktreePath: WT, name: "up", url: "git@x:z.git" },
	],
	[
		"removeRemote",
		() => removeRemote(WT, "up"),
		"git_remote_remove",
		{ worktreePath: WT, name: "up" },
	],
	[
		"getBranchDivergence",
		() => getBranchDivergence(WT, "main"),
		"git_branch_divergence",
		{ worktreePath: WT, base: "main" },
	],
	[
		"getHeadMessage",
		() => getHeadMessage(WT),
		"git_head_message",
		{ worktreePath: WT },
	],
	[
		"getGraphStashes",
		() => getGraphStashes(WT),
		"git_graph_stashes",
		{ worktreePath: WT },
	],
	[
		"getDiffCommit",
		() => getDiffCommit(WT, "abc"),
		"git_diff_commit",
		{ worktreePath: WT, commitHash: "abc" },
	],
	[
		"getCommitBody",
		() => getCommitBody(WT, "abc"),
		"git_commit_body",
		{ worktreePath: WT, commitHash: "abc" },
	],
	[
		"getStashList",
		() => getStashList(WT),
		"git_stash_list",
		{ worktreePath: WT },
	],
	[
		"stashPop",
		() => stashPop(WT, 2),
		"git_stash_pop",
		{ worktreePath: WT, index: 2 },
	],
	[
		"stashApply",
		() => stashApply(WT, 2),
		"git_stash_apply",
		{ worktreePath: WT, index: 2 },
	],
	[
		"stashDrop",
		() => stashDrop(WT, 2),
		"git_stash_drop",
		{ worktreePath: WT, index: 2 },
	],
	[
		"getStashShow",
		() => getStashShow(WT, 2),
		"git_stash_show",
		{ worktreePath: WT, index: 2 },
	],
	["stashClear", () => stashClear(WT), "git_stash_clear", { worktreePath: WT }],
	[
		"stashRename",
		() => stashRename(WT, 2, "renamed"),
		"git_stash_rename",
		{ worktreePath: WT, index: 2, message: "renamed" },
	],
	[
		"revertCommit",
		() => revertCommit(WT, "abc"),
		"git_revert_commit",
		{ worktreePath: WT, commitHash: "abc" },
	],
	[
		"resetToCommit",
		() => resetToCommit(WT, "abc", "hard"),
		"git_reset",
		{ worktreePath: WT, commitHash: "abc", mode: "hard" },
	],
	[
		"discardFile",
		() => discardFile(WT, "a.ts"),
		"git_discard_file",
		{ worktreePath: WT, filePath: "a.ts" },
	],
	["getTagList", () => getTagList(WT), "git_tag_list", { worktreePath: WT }],
	[
		"tagCreate",
		() => tagCreate(WT, "v1", "release", "abc"),
		"git_tag_create",
		{ worktreePath: WT, name: "v1", message: "release", commitHash: "abc" },
	],
	[
		"tagDelete",
		() => tagDelete(WT, "v1"),
		"git_tag_delete",
		{ worktreePath: WT, name: "v1" },
	],
	[
		"tagPush",
		() => tagPush(WT, "origin", "v1"),
		"git_tag_push",
		{ worktreePath: WT, remote: "origin", name: "v1" },
	],
	[
		"tagDeleteRemote",
		() => tagDeleteRemote(WT, "origin", "v1"),
		"git_tag_delete_remote",
		{ worktreePath: WT, remote: "origin", name: "v1" },
	],
	[
		"tagRemoteList",
		() => tagRemoteList(WT, "origin"),
		"git_tag_remote_list",
		{ worktreePath: WT, remote: "origin" },
	],
];

describe("commands that forward their arguments", () => {
	it.each(FORWARDERS)(
		"%s forwards its arguments to its command and returns the answer",
		async (_name, call, command, args) => {
			const answer = { sentinel: command };
			mockInvoke.mockResolvedValue(answer);
			await expect(call()).resolves.toBe(answer);
			expect(mockInvoke).toHaveBeenCalledTimes(1);
			expect(mockInvoke).toHaveBeenCalledWith(command, args);
		},
	);

	it.each(FORWARDERS)(
		"%s rejects with what the backend rejected with",
		async (_name, call) => {
			const error = { code: "unknown", raw: "boom" };
			mockInvoke.mockRejectedValue(error);
			await expect(call()).rejects.toBe(error);
		},
	);
});

describe("defaults of forwarded commands", () => {
	it("pulls with a rebase by default", async () => {
		await pull(WT);
		expect(mockInvoke).toHaveBeenCalledWith("git_pull", {
			worktreePath: WT,
			mode: "rebase",
		});
	});

	it("forwards the pull mode", async () => {
		await pull(WT, "ff-only");
		expect(mockInvoke).toHaveBeenCalledWith("git_pull", {
			worktreePath: WT,
			mode: "ff-only",
		});
	});

	it("reads the first 50 commits of the log by default", async () => {
		await getLog(WT);
		expect(mockInvoke).toHaveBeenCalledWith("git_log", {
			worktreePath: WT,
			limit: 50,
			offset: 0,
		});
	});

	it("forwards the log window", async () => {
		await getLog(WT, 10, 30);
		expect(mockInvoke).toHaveBeenCalledWith("git_log", {
			worktreePath: WT,
			limit: 10,
			offset: 30,
		});
	});

	it("reads the first 200 commits of the graph by default", async () => {
		await getGraph(WT);
		expect(mockInvoke).toHaveBeenCalledWith("git_graph", {
			worktreePath: WT,
			limit: 200,
			offset: 0,
		});
	});

	it("forwards the graph window", async () => {
		await getGraph(WT, 5, 15);
		expect(mockInvoke).toHaveBeenCalledWith("git_graph", {
			worktreePath: WT,
			limit: 5,
			offset: 15,
		});
	});

	it("stashes everything tracked when no paths are given", async () => {
		await stashPush(WT, "wip", true, false);
		expect(mockInvoke).toHaveBeenCalledWith("git_stash_push", {
			worktreePath: WT,
			message: "wip",
			includeUntracked: true,
			keepIndex: false,
			paths: [],
		});
	});

	it("forwards the paths to stash", async () => {
		await stashPush(WT, "wip", false, true, ["a.ts"]);
		expect(mockInvoke).toHaveBeenCalledWith("git_stash_push", {
			worktreePath: WT,
			message: "wip",
			includeUntracked: false,
			keepIndex: true,
			paths: ["a.ts"],
		});
	});
});

describe("shared reads", () => {
	let n = 0;
	const wt = () => `/shared/${++n}`;

	it("reads the full status and shares it between concurrent callers", async () => {
		const path = wt();
		const status = { isGitRepo: true };
		mockInvoke.mockResolvedValue(status);
		const [first, second] = await Promise.all([
			getStatusFull(path),
			getStatusFull(path),
		]);
		expect(first).toBe(status);
		expect(second).toBe(status);
		expect(mockInvoke).toHaveBeenCalledTimes(1);
		expect(mockInvoke).toHaveBeenCalledWith("git_status_full", {
			worktreePath: path,
		});
	});

	it("forwards the known version to the snapshot read", async () => {
		const path = wt();
		mockInvoke.mockResolvedValue(null);
		await expect(getSnapshot(path, "v1")).resolves.toBeNull();
		expect(mockInvoke).toHaveBeenCalledWith("git_snapshot", {
			worktreePath: path,
			knownVersion: "v1",
		});
	});
});
