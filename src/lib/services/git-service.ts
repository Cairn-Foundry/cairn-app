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

export type GitFileStatus = Record<
	string,
	"staged" | "modified" | "untracked" | "deleted"
>;

export type GitCommit = {
	hash: string;
	shortHash: string;
	author: string;
	date: string;
	message: string;
};

export type RemoteStatus = {
	ahead: number;
	behind: number;
	remote: string;
	hasUpstream: boolean;
};

export async function getStatus(worktreePath: string): Promise<GitFileStatus> {
	return invoke("git_status", { worktreePath });
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

export async function listBranches(projectPath: string): Promise<string[]> {
	return invoke("list_branches", { projectPath });
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
): Promise<string> {
	return invoke("git_push", { worktreePath, setUpstream, branch });
}

export async function pull(worktreePath: string): Promise<string> {
	return invoke("git_pull", { worktreePath });
}

export async function fetch(worktreePath: string): Promise<void> {
	return invoke("git_fetch", { worktreePath });
}

export async function getRemoteStatus(
	worktreePath: string,
): Promise<RemoteStatus> {
	return invoke("git_remote_status", { worktreePath });
}

export async function getLog(
	worktreePath: string,
	limit = 50,
): Promise<GitCommit[]> {
	return invoke("git_log", { worktreePath, limit });
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

export async function getGraph(worktreePath: string): Promise<GitGraphCommit[]> {
	return invoke("git_graph", { worktreePath });
}
