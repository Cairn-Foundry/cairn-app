// Git operations of the review and git views, every one backed by a dedicated
// Rust command that classifies its failures into a GitError.

import { invoke } from "@tauri-apps/api/core";
import { dedupeInflight } from "./inflight";

/** One line of a diff, already classified by the Rust side. */
export type DiffLine = {
	kind: "add" | "remove" | "context";
	content: string;
};

/** A hunk with its raw `@@` header kept for display. */
export type GitDiffHunk = {
	header: string;
	lines: DiffLine[];
};

/** Every hunk of one file; `filePath` is relative to the worktree root. */
export type GitFileDiff = {
	filePath: string;
	hunks: GitDiffHunk[];
	/**
	 * The file changed more than the diff keeps, and what follows was dropped.
	 * The view says so rather than passing a partial diff off as the whole one.
	 */
	truncated?: boolean;
};

// Wire values emitted by the Rust `git_status` command. Staged entries carry a
// `staged-` prefix describing the index change; unstaged worktree changes are
// `modified` / `deleted` / `untracked`.
export type GitFileStatusValue =
	| "staged-added"
	| "staged-deleted"
	| "staged-renamed"
	| "staged-copied"
	| "staged-modified"
	| "modified"
	| "deleted"
	| "untracked"
	| "conflicted";

/** Worktree status keyed by path relative to its root. */
export type GitFileStatus = Record<string, GitFileStatusValue>;

/** A commit in the history list; `onCurrentBranch` separates it from those only reachable elsewhere. */
export type GitCommit = {
	hash: string;
	shortHash: string;
	author: string;
	date: string;
	message: string;
	onCurrentBranch: boolean;
};

/** Standing against the upstream; the counts are 0 when `hasUpstream` is false. */
export type RemoteStatus = {
	ahead: number;
	behind: number;
	remote: string;
	hasUpstream: boolean;
};

/** Which multi-step operation is halfway through, if any. */
export type GitOperationKind = "rebase" | "merge" | "none";

/**
 * State of an interrupted merge or rebase. `structuralFiles` are the conflicts
 * git cannot present as text (delete against modify, and the like); `current`
 * and `total` count rebase steps and stay at 0 for a merge.
 */
export type GitOperationState = {
	kind: GitOperationKind;
	conflictedFiles: string[];
	structuralFiles: string[];
	head: string;
	current: number;
	total: number;
};

/** Every failure the Rust classifier can name; mirrored there and in the i18n keys. */
export const GIT_ERROR_CODES = [
	"lock_exists",
	"auth_required",
	"auth_failed",
	"protected_branch",
	"hook_rejected",
	"permission_denied",
	"remote_not_found",
	"remote_unreachable",
	"no_remote",
	"network_unreachable",
	"no_upstream",
	"non_fast_forward",
	"dirty_worktree",
	"unresolved_conflict",
	"operation_in_progress",
	"identity_missing",
	"nothing_to_commit",
	"detached_head",
	"branch_exists",
	"branch_in_use",
	"branch_not_merged",
	"ref_not_found",
	"no_disk_space",
	"invalid_ref",
	"path_missing",
	"path_not_directory",
	"not_a_repository",
	"bare_repository",
	"git_unavailable",
	"unknown",
] as const;

export type GitErrorCode = (typeof GIT_ERROR_CODES)[number];

/** A classified git failure; `raw` keeps the original stderr for display. */
export type GitError = {
	code: GitErrorCode;
	raw: string;
	context?: string;
};

/** Guards a code coming from outside, an older backend included. */
export function isKnownGitErrorCode(code: string): code is GitErrorCode {
	return (GIT_ERROR_CODES as readonly string[]).includes(code);
}

/** Shape check only: the code is not verified against GIT_ERROR_CODES. */
function isGitError(value: unknown): value is GitError {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as GitError).code === "string" &&
		typeof (value as GitError).raw === "string"
	);
}

// Normalizes anything thrown by an `invoke()` call into a `GitError`, so a
// rejection that never reached the classifier still carries its raw text.
export function toGitError(value: unknown): GitError {
	if (isGitError(value)) return value;
	return { code: "unknown", raw: String(value) };
}

/**
 * Outcome of an operation that can stop on conflicts. Conflicts are not an
 * error: they come back as `ok` with `hasConflicts`, only a real failure throws.
 */
export type GitOpResult = {
	ok: boolean;
	hasConflicts: boolean;
	conflictedFiles: string[];
	output: string;
};

/** False rather than throwing when the path is not a repository. */
export async function isGitRepo(worktreePath: string): Promise<boolean> {
	return invoke("is_git_repo", { worktreePath });
}

/** Status of every changed file, staged and unstaged alike. */
export async function getStatus(worktreePath: string): Promise<GitFileStatus> {
	return invoke("git_status", { worktreePath });
}

/** The paths behind the change badges, with no diff content attached. */
export interface GitChangedPaths {
	staged: string[];
	unstaged: string[];
}

/** Which files changed on either side of the index, without reading the diffs. */
export async function getChangedPaths(
	worktreePath: string,
): Promise<GitChangedPaths> {
	return invoke("git_changed_paths", { worktreePath });
}

/** Status, changed paths and the repository check, from a single git process. */
export interface GitStatusFull {
	isGitRepo: boolean;
	status: GitFileStatus;
	changedPaths: GitChangedPaths;
}

/** The poll's whole read in one round trip; null when nothing changed since `knownVersion`. */
export interface GitSnapshot {
	version: number;
	status: GitStatusFull;
	currentBranch: string;
	remoteStatus: RemoteStatus;
	operationState: GitOperationState;
}

export async function getSnapshot(
	worktreePath: string,
	knownVersion: number,
): Promise<GitSnapshot | null> {
	return dedupeInflight(`snapshot:${worktreePath}:${knownVersion}`, () =>
		invoke("git_snapshot", { worktreePath, knownVersion }),
	);
}

/** What the status poll reads: everything above in one call. */
export async function getStatusFull(
	worktreePath: string,
): Promise<GitStatusFull> {
	return dedupeInflight(`status-full:${worktreePath}`, () =>
		invoke("git_status_full", { worktreePath }),
	);
}

/** Keeps only the paths git actually ignores. */
export async function checkIgnore(
	worktreePath: string,
	paths: string[],
): Promise<string[]> {
	return invoke("git_check_ignore", { worktreePath, paths });
}

/** Contents of the repository-local ignore file, empty when it does not exist yet. */
export async function readExclude(worktreePath: string): Promise<string> {
	return invoke("git_read_exclude", { worktreePath });
}

/** Replaces the repository-local ignore file. */
export async function writeExclude(
	worktreePath: string,
	content: string,
): Promise<void> {
	return invoke("git_write_exclude", { worktreePath, content });
}

/** Worktree against index: everything not staged yet. */
export async function getDiffUnstaged(
	worktreePath: string,
): Promise<GitFileDiff[]> {
	return invoke("git_diff_unstaged", { worktreePath });
}

/** Index against HEAD: what the next commit would contain. */
export async function getDiffStaged(
	worktreePath: string,
): Promise<GitFileDiff[]> {
	return invoke("git_diff_staged", { worktreePath });
}

/** One file's diff, on either side of the index. */
export async function getDiffFile(
	worktreePath: string,
	filePath: string,
	staged: boolean,
): Promise<GitDiffHunk[]> {
	return invoke("git_diff_file", { worktreePath, filePath, staged });
}

export type GitChangedFile = {
	filePath: string;
	status: "A" | "M" | "D";
	additions: number;
	deletions: number;
};

export type GitFileBetween = {
	oldContent: string | null;
	newContent: string | null;
};

/** Files changed by `base...head`, with their line counts. */
export async function getDiffFilesBetween(
	worktreePath: string,
	base: string,
	head: string,
): Promise<GitChangedFile[]> {
	return invoke("git_diff_files_between", { worktreePath, base, head });
}

/** One file on both sides of `base...head`. */
export async function getDiffFileBetween(
	worktreePath: string,
	base: string,
	head: string,
	filePath: string,
): Promise<GitFileBetween> {
	return invoke("git_diff_file_between", {
		worktreePath,
		base,
		head,
		filePath,
	});
}

/** Whether the commit is present in the worktree. */
export async function commitExists(
	worktreePath: string,
	commitHash: string,
): Promise<boolean> {
	return invoke("git_commit_exists", { worktreePath, commitHash });
}

/** Committed content of a file, null when it is untracked or binary. */
export async function getFileAtHead(
	worktreePath: string,
	filePath: string,
): Promise<string | null> {
	return invoke("git_file_at_head", { worktreePath, filePath });
}

/** Staged content of a file, null when it is untracked or binary. */
export async function getFileInIndex(
	worktreePath: string,
	filePath: string,
): Promise<string | null> {
	return invoke("git_file_in_index", { worktreePath, filePath });
}

/** Stages one path, a deletion included. */
export async function stageFile(
	worktreePath: string,
	filePath: string,
): Promise<void> {
	return invoke("git_stage_file", { worktreePath, filePath });
}

/** Unstages one path, leaving the worktree copy alone. */
export async function unstageFile(
	worktreePath: string,
	filePath: string,
): Promise<void> {
	return invoke("git_unstage_file", { worktreePath, filePath });
}

/** Stages every change, untracked files included. */
export async function stageAll(worktreePath: string): Promise<void> {
	return invoke("git_stage_all", { worktreePath });
}

/** Empties the index back to HEAD, leaving the worktree alone. */
export async function unstageAll(worktreePath: string): Promise<void> {
	return invoke("git_unstage_all", { worktreePath });
}

/** Configured commit identity; the fields are empty when git has none set. */
export type GitIdentity = {
	name: string;
	email: string;
};

/** Commit flags; an omitted author falls back to the configured identity. */
export type CommitOptions = {
	noVerify?: boolean;
	signOff?: boolean;
	allowEmpty?: boolean;
	authorName?: string;
	authorEmail?: string;
};

/** Resolved user.name and user.email for this worktree. */
export async function getIdentity(worktreePath: string): Promise<GitIdentity> {
	return invoke("git_get_identity", { worktreePath });
}

/**
 * Commits the index and answers with the new hash. The options are flattened
 * into the payload, an unset author being an empty string rather than absent.
 */
export async function commit(
	worktreePath: string,
	message: string,
	options: CommitOptions = {},
): Promise<string> {
	return invoke("git_commit", {
		worktreePath,
		message,
		noVerify: options.noVerify ?? false,
		signOff: options.signOff ?? false,
		allowEmpty: options.allowEmpty ?? false,
		authorName: options.authorName ?? "",
		authorEmail: options.authorEmail ?? "",
	});
}

/** Rewrites HEAD with the staged changes, so the hash always changes. */
export async function amendCommit(
	worktreePath: string,
	message: string,
	options: Pick<
		CommitOptions,
		"noVerify" | "signOff" | "authorName" | "authorEmail"
	> = {},
): Promise<string> {
	return invoke("git_amend_commit", {
		worktreePath,
		message,
		noVerify: options.noVerify ?? false,
		signOff: options.signOff ?? false,
		authorName: options.authorName ?? "",
		authorEmail: options.authorEmail ?? "",
	});
}

/** Checked-out branch name, or the short hash when HEAD is detached. */
export async function getCurrentBranch(worktreePath: string): Promise<string> {
	return invoke("git_current_branch", { worktreePath });
}

/** Switches branch; fails rather than discarding conflicting local changes. */
export async function checkoutBranch(
	worktreePath: string,
	branchName: string,
): Promise<void> {
	return invoke("git_checkout_branch", { worktreePath, branchName });
}

/** Creates a branch off `fromBranch` and checks it out. */
export async function createBranch(
	worktreePath: string,
	branchName: string,
	fromBranch: string,
): Promise<void> {
	return invoke("git_create_branch", { worktreePath, branchName, fromBranch });
}

/** Deletes a branch; an unmerged one comes back as `branch_not_merged`. */
export async function deleteBranch(
	worktreePath: string,
	branchName: string,
): Promise<void> {
	return invoke("git_delete_branch", { worktreePath, branchName });
}

/** Pushes and answers with git's own output; `force` is a lease-less force. */
export async function push(
	worktreePath: string,
	setUpstream: boolean,
	branch: string,
	force = false,
): Promise<string> {
	return invoke("git_push", { worktreePath, setUpstream, branch, force });
}

/** Pulls; conflicts come back in the result rather than as a rejection. */
export async function pull(worktreePath: string): Promise<GitOpResult> {
	return invoke("git_pull", { worktreePath });
}

/** Updates the remote refs without touching the worktree. */
export async function fetch(worktreePath: string): Promise<void> {
	return invoke("git_fetch", { worktreePath });
}

/**
 * Deletes `.git/index.lock` after a crash, which is what the `lock_exists`
 * error offers to do. Never call it while another git process may be running.
 */
export async function removeIndexLock(worktreePath: string): Promise<void> {
	return invoke("git_remove_index_lock", { worktreePath });
}

/** Reports an interrupted merge or rebase so the UI can offer to resume it. */
export async function getOperationState(
	worktreePath: string,
): Promise<GitOperationState> {
	return invoke("git_operation_state", { worktreePath });
}

/** Merges a branch in; stops on conflicts, leaving the merge to be resolved. */
export async function merge(
	worktreePath: string,
	branch: string,
): Promise<GitOpResult> {
	return invoke("git_merge", { worktreePath, branch });
}

/** Removes a path from the index and from disk, unlike unstageFile. */
export async function rmFile(
	worktreePath: string,
	filePath: string,
): Promise<void> {
	return invoke("git_rm", { worktreePath, filePath });
}

/** Concludes a merge once the conflicts are staged. */
export async function mergeContinue(
	worktreePath: string,
): Promise<GitOpResult> {
	return invoke("git_merge_continue", { worktreePath });
}

/** Throws the merge away and restores the pre-merge state. */
export async function mergeAbort(worktreePath: string): Promise<void> {
	return invoke("git_merge_abort", { worktreePath });
}

/** Replays the branch onto another; stops on the first conflicting commit. */
export async function rebase(
	worktreePath: string,
	onto: string,
): Promise<GitOpResult> {
	return invoke("git_rebase", { worktreePath, onto });
}

/** Resumes the rebase once the conflicts are staged; can stop again further on. */
export async function rebaseContinue(
	worktreePath: string,
): Promise<GitOpResult> {
	return invoke("git_rebase_continue", { worktreePath });
}

/** Drops the commit being replayed and moves on to the next one. */
export async function rebaseSkip(worktreePath: string): Promise<GitOpResult> {
	return invoke("git_rebase_skip", { worktreePath });
}

/** Unwinds the whole rebase back to where it started. */
export async function rebaseAbort(worktreePath: string): Promise<void> {
	return invoke("git_rebase_abort", { worktreePath });
}

/** Ahead and behind counts against the upstream, from the last fetch. */
export async function getRemoteStatus(
	worktreePath: string,
): Promise<RemoteStatus> {
	return invoke("git_remote_status", { worktreePath });
}

/** URL of the origin remote, an empty string when there is none. */
export async function getRemoteUrl(worktreePath: string): Promise<string> {
	return invoke("git_remote_url", { worktreePath });
}

/** Divergence against a base; `baseRef` is the ref actually resolved for it. */
export type BranchDivergence = {
	ahead: number;
	behind: number;
	baseRef: string;
};

/** Counts commits either side of the merge base with `base`. */
export async function getBranchDivergence(
	worktreePath: string,
	base: string,
): Promise<BranchDivergence> {
	return invoke("git_branch_divergence", { worktreePath, base });
}

/** A page of history, newest first. */
export async function getLog(
	worktreePath: string,
	limit = 50,
	offset = 0,
): Promise<GitCommit[]> {
	return invoke("git_log", { worktreePath, limit, offset });
}

/** Subject of HEAD, used to prefill an amend. */
export async function getHeadMessage(worktreePath: string): Promise<string> {
	return invoke("git_head_message", { worktreePath });
}

/**
 * A commit as the graph needs it: `parents` are what the lanes are drawn from,
 * two of them meaning a merge, and `refs` the branch and tag names pointing here.
 */
export type GitGraphCommit = {
	hash: string;
	shortHash: string;
	message: string;
	author: string;
	date: string;
	parents: string[];
	refs: string[];
};

/** A page of history across every branch, unlike getLog which follows HEAD. */
export async function getGraph(
	worktreePath: string,
	limit = 200,
	offset = 0,
): Promise<GitGraphCommit[]> {
	return invoke("git_graph", { worktreePath, limit, offset });
}

/** What a commit changed, against its first parent. */
export async function getDiffCommit(
	worktreePath: string,
	commitHash: string,
): Promise<GitFileDiff[]> {
	return invoke("git_diff_commit", { worktreePath, commitHash });
}

/** Message body of a commit, subject line excluded. */
export async function getCommitBody(
	worktreePath: string,
	commitHash: string,
): Promise<string> {
	return invoke("git_commit_body", { worktreePath, commitHash });
}

/**
 * One stash entry. `index` is its position in the stack, so it shifts as soon
 * as any stash is popped or dropped and must be re-read, never cached.
 */
export type GitStash = {
	index: number;
	name: string;
	message: string;
	branch: string;
	date: string;
	fileCount: number;
};

/** The stash stack, most recent first. */
export async function getStashList(worktreePath: string): Promise<GitStash[]> {
	return invoke("git_stash_list", { worktreePath });
}

/** Stashes the changes; an empty `paths` takes the whole worktree. */
export async function stashPush(
	worktreePath: string,
	message: string,
	includeUntracked: boolean,
	keepIndex: boolean,
	paths: string[] = [],
): Promise<void> {
	return invoke("git_stash_push", {
		worktreePath,
		message,
		includeUntracked,
		keepIndex,
		paths,
	});
}

/** Restores a stash and drops it from the stack. */
export async function stashPop(
	worktreePath: string,
	index: number,
): Promise<void> {
	return invoke("git_stash_pop", { worktreePath, index });
}

/** Restores a stash but keeps it on the stack. */
export async function stashApply(
	worktreePath: string,
	index: number,
): Promise<void> {
	return invoke("git_stash_apply", { worktreePath, index });
}

/** Discards a stash without restoring it. */
export async function stashDrop(
	worktreePath: string,
	index: number,
): Promise<void> {
	return invoke("git_stash_drop", { worktreePath, index });
}

/** What a stash holds, without applying it. */
export async function getStashShow(
	worktreePath: string,
	index: number,
): Promise<GitFileDiff[]> {
	return invoke("git_stash_show", { worktreePath, index });
}

/** Drops every stash at once; there is no undo. */
export async function stashClear(worktreePath: string): Promise<void> {
	return invoke("git_stash_clear", { worktreePath });
}

/** Rewrites a stash message, which git only does by recreating the entry. */
export async function stashRename(
	worktreePath: string,
	index: number,
	message: string,
): Promise<void> {
	return invoke("git_stash_rename", { worktreePath, index, message });
}

/** Commits the inverse of a commit rather than removing it from history. */
export async function revertCommit(
	worktreePath: string,
	commitHash: string,
): Promise<string> {
	return invoke("git_revert_commit", { worktreePath, commitHash });
}

/** Restores a file to HEAD, losing its uncommitted changes for good. */
export async function discardFile(
	worktreePath: string,
	filePath: string,
): Promise<void> {
	return invoke("git_discard_file", { worktreePath, filePath });
}
