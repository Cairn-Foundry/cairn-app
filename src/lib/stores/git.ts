import { derived, get, writable } from "svelte/store";
import type {
	GitCommit,
	GitFileDiff,
	GitFileStatus,
	GitGraphCommit,
	GitStash,
	RemoteStatus,
} from "$lib/services/git-service";
import * as gitService from "$lib/services/git-service";
import { activeInstance } from "./instance";
import { activeProject } from "./project";

type GitState = {
	status: GitFileStatus;
	unstagedDiffs: GitFileDiff[];
	stagedDiffs: GitFileDiff[];
	currentBranch: string;
	branches: string[];
	log: GitCommit[];
	graph: GitGraphCommit[];
	stashes: GitStash[];
	remoteStatus: RemoteStatus | null;
	commitMessage: string;
	isLoading: boolean;
	error: string | null;
};

const INITIAL: GitState = {
	status: {},
	unstagedDiffs: [],
	stagedDiffs: [],
	currentBranch: "",
	branches: [],
	log: [],
	graph: [],
	stashes: [],
	remoteStatus: null,
	commitMessage: "",
	isLoading: false,
	error: null,
};

const _git = writable<GitState>(INITIAL);

export const git = { subscribe: _git.subscribe };

const isStaged = (s: string) => s.startsWith("staged-");

// Derived helpers consumed by components
export const stagedFiles = derived(_git, ($g) =>
	Object.entries($g.status)
		.filter(([, s]) => isStaged(s))
		.map(([path]) => path),
);

export const unstagedFiles = derived(_git, ($g) =>
	Object.entries($g.status)
		.filter(([, s]) => !isStaged(s))
		.map(([path, status]) => ({ path, status })),
);

function worktree(): string | null {
	return get(activeInstance)?.worktreePath ?? null;
}

export async function refreshStatus(): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	_git.update((s) => ({ ...s, isLoading: true, error: null }));
	try {
		const [status, unstagedDiffs, stagedDiffs, currentBranch, remoteStatus] =
			await Promise.all([
				gitService.getStatus(wt),
				gitService.getDiffUnstaged(wt),
				gitService.getDiffStaged(wt),
				gitService.getCurrentBranch(wt),
				gitService.getRemoteStatus(wt).catch(() => null),
			]);
		_git.update((s) => ({
			...s,
			status,
			unstagedDiffs,
			stagedDiffs,
			currentBranch,
			remoteStatus,
			isLoading: false,
		}));
	} catch (e) {
		_git.update((s) => ({ ...s, isLoading: false, error: String(e) }));
	}
}

export async function refreshLog(): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	try {
		const log = await gitService.getLog(wt);
		_git.update((s) => ({ ...s, log }));
	} catch {
		// Non-fatal — repo may have no commits yet
	}
}

export async function refreshGraph(): Promise<void> {
	const path = worktree() ?? get(activeProject)?.path;
	if (!path) return;
	try {
		const graph = await gitService.getGraph(path);
		_git.update((s) => ({ ...s, graph }));
	} catch {
		// Non-fatal
	}
}

export async function stageFile(filePath: string): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await gitService.stageFile(wt, filePath);
	await refreshStatus();
}

export async function unstageFile(filePath: string): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await gitService.unstageFile(wt, filePath);
	await refreshStatus();
}

export async function stageAll(): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await gitService.stageAll(wt);
	await refreshStatus();
}

export async function unstageAll(): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await gitService.unstageAll(wt);
	await refreshStatus();
}

export async function getGitIdentity(): Promise<gitService.GitIdentity> {
	const wt = worktree();
	if (!wt) return { name: "", email: "" };
	return gitService.getIdentity(wt);
}

export async function commitChanges(
	message: string,
	options: gitService.CommitOptions = {},
): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await gitService.commit(wt, message, options);
	_git.update((s) => ({ ...s, commitMessage: "" }));
	await refreshStatus();
	await refreshLog();
}

export async function amendLastCommit(
	message: string,
	options: Pick<
		gitService.CommitOptions,
		"noVerify" | "signOff" | "authorName" | "authorEmail"
	> = {},
): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await gitService.amendCommit(wt, message, options);
	await refreshStatus();
	await refreshLog();
}

export async function pushBranch(): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	const state = get(_git);
	const hasUpstream = state.remoteStatus?.hasUpstream ?? false;
	await gitService.push(wt, !hasUpstream, state.currentBranch);
	await refreshStatus();
}

export async function pullBranch(): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await gitService.pull(wt);
	await refreshStatus();
}

export async function loadBranches(projectPath: string): Promise<void> {
	try {
		const branches = await gitService.listBranches(projectPath);
		_git.update((s) => ({ ...s, branches }));
	} catch {
		// Non-fatal
	}
}

export async function checkoutBranch(branchName: string): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await gitService.checkoutBranch(wt, branchName);
	await refreshStatus();
}

export async function createBranch(
	branchName: string,
	fromBranch: string,
): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await gitService.createBranch(wt, branchName, fromBranch);
	await refreshStatus();
}

export async function deleteBranch(branchName: string): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await gitService.deleteBranch(wt, branchName);
	await refreshStatus();
}

export function setCommitMessage(msg: string): void {
	_git.update((s) => ({ ...s, commitMessage: msg }));
}

export function resetGitStore(): void {
	_git.set(INITIAL);
}

export async function refreshStashes(): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	try {
		const stashes = await gitService.getStashList(wt);
		_git.update((s) => ({ ...s, stashes }));
	} catch {
		// Non-fatal
	}
}

export async function pushStash(
	message: string,
	includeUntracked: boolean,
	keepIndex: boolean,
): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await gitService.stashPush(wt, message, includeUntracked, keepIndex);
	await Promise.all([refreshStashes(), refreshStatus()]);
}

export async function popStash(index: number): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await gitService.stashPop(wt, index);
	await Promise.all([refreshStashes(), refreshStatus()]);
}

export async function applyStash(index: number): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await gitService.stashApply(wt, index);
	await refreshStatus();
}

export async function dropStash(index: number): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await gitService.stashDrop(wt, index);
	await refreshStashes();
}

export async function clearStashes(): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await gitService.stashClear(wt);
	await refreshStashes();
}

export async function renameStash(
	index: number,
	message: string,
): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await gitService.stashRename(wt, index, message);
	await refreshStashes();
}

export async function getStashDiff(index: number): Promise<GitFileDiff[]> {
	const wt = worktree();
	if (!wt) return [];
	return gitService.getStashShow(wt, index);
}

export async function revertCommit(commitHash: string): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await gitService.revertCommit(wt, commitHash);
	await Promise.all([refreshStatus(), refreshLog()]);
}

export async function discardFile(filePath: string): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await gitService.discardFile(wt, filePath);
	await refreshStatus();
}
