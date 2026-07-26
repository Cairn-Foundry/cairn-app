import { invoke } from "@tauri-apps/api/core";

export type DiffLine = {
	kind: "add" | "remove" | "context";
	content: string;
};

export type GitDiffHunk = {
	header: string;
	lines: DiffLine[];
};

export type GitFileDiff = {
	filePath: string;
	hunks: GitDiffHunk[];
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

export type GitFileStatus = Record<string, GitFileStatusValue>;

export type GitCommit = {
	hash: string;
	shortHash: string;
	author: string;
	date: string;
	message: string;
	onCurrentBranch: boolean;
};

export type RemoteStatus = {
	ahead: number;
	behind: number;
	remote: string;
	hasUpstream: boolean;
};

export type GitOperationKind = "rebase" | "merge" | "none";

export type GitOperationState = {
	kind: GitOperationKind;
	conflictedFiles: string[];
	structuralFiles: string[];
	head: string;
	current: number;
	total: number;
};

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

export type GitError = {
	code: GitErrorCode;
	raw: string;
	context?: string;
};

export function isKnownGitErrorCode(code: string): code is GitErrorCode {
	return (GIT_ERROR_CODES as readonly string[]).includes(code);
}

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

export type GitOpResult = {
	ok: boolean;
	hasConflicts: boolean;
	conflictedFiles: string[];
	output: string;
};

export async function isGitRepo(worktreePath: string): Promise<boolean> {
	return invoke("is_git_repo", { worktreePath });
}

export async function getStatus(worktreePath: string): Promise<GitFileStatus> {
	return invoke("git_status", { worktreePath });
}

export async function checkIgnore(
	worktreePath: string,
	paths: string[],
): Promise<string[]> {
	return invoke("git_check_ignore", { worktreePath, paths });
}

export async function getDiffUnstaged(
	worktreePath: string,
): Promise<GitFileDiff[]> {
	return invoke("git_diff_unstaged", { worktreePath });
}

export async function getDiffStaged(
	worktreePath: string,
): Promise<GitFileDiff[]> {
	return invoke("git_diff_staged", { worktreePath });
}

export async function getDiffFile(
	worktreePath: string,
	filePath: string,
	staged: boolean,
): Promise<GitDiffHunk[]> {
	return invoke("git_diff_file", { worktreePath, filePath, staged });
}

export async function getFileAtHead(
	worktreePath: string,
	filePath: string,
): Promise<string> {
	return invoke("git_file_at_head", { worktreePath, filePath });
}

export async function stageFile(
	worktreePath: string,
	filePath: string,
): Promise<void> {
	return invoke("git_stage_file", { worktreePath, filePath });
}

export async function unstageFile(
	worktreePath: string,
	filePath: string,
): Promise<void> {
	return invoke("git_unstage_file", { worktreePath, filePath });
}

export async function stageAll(worktreePath: string): Promise<void> {
	return invoke("git_stage_all", { worktreePath });
}

export async function unstageAll(worktreePath: string): Promise<void> {
	return invoke("git_unstage_all", { worktreePath });
}

export type GitIdentity = {
	name: string;
	email: string;
};

export type CommitOptions = {
	noVerify?: boolean;
	signOff?: boolean;
	allowEmpty?: boolean;
	authorName?: string;
	authorEmail?: string;
};

export async function getIdentity(worktreePath: string): Promise<GitIdentity> {
	return invoke("git_get_identity", { worktreePath });
}

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

export async function getCurrentBranch(worktreePath: string): Promise<string> {
	return invoke("git_current_branch", { worktreePath });
}

export async function checkoutBranch(
	worktreePath: string,
	branchName: string,
): Promise<void> {
	return invoke("git_checkout_branch", { worktreePath, branchName });
}

export async function createBranch(
	worktreePath: string,
	branchName: string,
	fromBranch: string,
): Promise<void> {
	return invoke("git_create_branch", { worktreePath, branchName, fromBranch });
}

export async function deleteBranch(
	worktreePath: string,
	branchName: string,
): Promise<void> {
	return invoke("git_delete_branch", { worktreePath, branchName });
}

export async function push(
	worktreePath: string,
	setUpstream: boolean,
	branch: string,
	force = false,
): Promise<string> {
	return invoke("git_push", { worktreePath, setUpstream, branch, force });
}

export async function pull(worktreePath: string): Promise<GitOpResult> {
	return invoke("git_pull", { worktreePath });
}

export async function fetch(worktreePath: string): Promise<void> {
	return invoke("git_fetch", { worktreePath });
}

export async function removeIndexLock(worktreePath: string): Promise<void> {
	return invoke("git_remove_index_lock", { worktreePath });
}

export async function getOperationState(
	worktreePath: string,
): Promise<GitOperationState> {
	return invoke("git_operation_state", { worktreePath });
}

export async function merge(
	worktreePath: string,
	branch: string,
): Promise<GitOpResult> {
	return invoke("git_merge", { worktreePath, branch });
}

export async function rmFile(
	worktreePath: string,
	filePath: string,
): Promise<void> {
	return invoke("git_rm", { worktreePath, filePath });
}

export async function mergeContinue(
	worktreePath: string,
): Promise<GitOpResult> {
	return invoke("git_merge_continue", { worktreePath });
}

export async function mergeAbort(worktreePath: string): Promise<void> {
	return invoke("git_merge_abort", { worktreePath });
}

export async function rebase(
	worktreePath: string,
	onto: string,
): Promise<GitOpResult> {
	return invoke("git_rebase", { worktreePath, onto });
}

export async function rebaseContinue(
	worktreePath: string,
): Promise<GitOpResult> {
	return invoke("git_rebase_continue", { worktreePath });
}

export async function rebaseSkip(worktreePath: string): Promise<GitOpResult> {
	return invoke("git_rebase_skip", { worktreePath });
}

export async function rebaseAbort(worktreePath: string): Promise<void> {
	return invoke("git_rebase_abort", { worktreePath });
}

export async function getRemoteStatus(
	worktreePath: string,
): Promise<RemoteStatus> {
	return invoke("git_remote_status", { worktreePath });
}

export async function getRemoteUrl(worktreePath: string): Promise<string> {
	return invoke("git_remote_url", { worktreePath });
}

export type BranchDivergence = {
	ahead: number;
	behind: number;
	baseRef: string;
};

export async function getBranchDivergence(
	worktreePath: string,
	base: string,
): Promise<BranchDivergence> {
	return invoke("git_branch_divergence", { worktreePath, base });
}

export async function getLog(
	worktreePath: string,
	limit = 50,
	offset = 0,
): Promise<GitCommit[]> {
	return invoke("git_log", { worktreePath, limit, offset });
}

export async function getHeadMessage(worktreePath: string): Promise<string> {
	return invoke("git_head_message", { worktreePath });
}

export type GitGraphCommit = {
	hash: string;
	shortHash: string;
	message: string;
	author: string;
	date: string;
	parents: string[];
	refs: string[];
};

export async function getGraph(
	worktreePath: string,
	limit = 200,
	offset = 0,
): Promise<GitGraphCommit[]> {
	return invoke("git_graph", { worktreePath, limit, offset });
}

export async function getDiffCommit(
	worktreePath: string,
	commitHash: string,
): Promise<GitFileDiff[]> {
	return invoke("git_diff_commit", { worktreePath, commitHash });
}

export async function getCommitBody(
	worktreePath: string,
	commitHash: string,
): Promise<string> {
	return invoke("git_commit_body", { worktreePath, commitHash });
}

export type GitStash = {
	index: number;
	name: string;
	message: string;
	branch: string;
	date: string;
	fileCount: number;
};

export async function getStashList(worktreePath: string): Promise<GitStash[]> {
	return invoke("git_stash_list", { worktreePath });
}

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

export async function stashPop(
	worktreePath: string,
	index: number,
): Promise<void> {
	return invoke("git_stash_pop", { worktreePath, index });
}

export async function stashApply(
	worktreePath: string,
	index: number,
): Promise<void> {
	return invoke("git_stash_apply", { worktreePath, index });
}

export async function stashDrop(
	worktreePath: string,
	index: number,
): Promise<void> {
	return invoke("git_stash_drop", { worktreePath, index });
}

export async function getStashShow(
	worktreePath: string,
	index: number,
): Promise<GitFileDiff[]> {
	return invoke("git_stash_show", { worktreePath, index });
}

export async function stashClear(worktreePath: string): Promise<void> {
	return invoke("git_stash_clear", { worktreePath });
}

export async function stashRename(
	worktreePath: string,
	index: number,
	message: string,
): Promise<void> {
	return invoke("git_stash_rename", { worktreePath, index, message });
}

export async function revertCommit(
	worktreePath: string,
	commitHash: string,
): Promise<string> {
	return invoke("git_revert_commit", { worktreePath, commitHash });
}

export async function discardFile(
	worktreePath: string,
	filePath: string,
): Promise<void> {
	return invoke("git_discard_file", { worktreePath, filePath });
}
