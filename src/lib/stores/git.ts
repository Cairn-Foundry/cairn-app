import { derived, get, writable } from "svelte/store";
import type {
	GitCommit,
	GitFileDiff,
	GitFileStatus,
	RemoteStatus,
} from "$lib/services/git-service";
import * as gitService from "$lib/services/git-service";
import { activeInstance } from "./instance";

type GitState = {
	status: GitFileStatus;
	unstagedDiffs: GitFileDiff[];
	stagedDiffs: GitFileDiff[];
	currentBranch: string;
	branches: string[];
	log: GitCommit[];
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
	if (!wt) return { name: '', email: '' };
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
	options: Pick<gitService.CommitOptions, 'noVerify' | 'signOff' | 'authorName' | 'authorEmail'> = {},
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
