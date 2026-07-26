import { derived, get, writable } from "svelte/store";
import type {
	GitCommit,
	GitError,
	GitFileDiff,
	GitFileStatus,
	GitGraphCommit,
	GitOperationState,
	GitOpResult,
	GitStash,
	RemoteStatus,
} from "$lib/services/git-service";
import * as gitService from "$lib/services/git-service";
import { listBranchesDetailed } from "$lib/services/instance-service";
import type { GitErrorAction } from "$lib/utils/git/git-error";
import { activeInstance } from "./instance";
import { activeProject } from "./project";

type GitState = {
	status: GitFileStatus;
	unstagedDiffs: GitFileDiff[];
	stagedDiffs: GitFileDiff[];
	currentBranch: string;
	branches: string[];
	remoteBranches: string[];
	log: GitCommit[];
	graph: GitGraphCommit[];
	stashes: GitStash[];
	remoteStatus: RemoteStatus | null;
	operationState: GitOperationState | null;
	commitMessage: string;
	commitBody: string;
	logHasMore: boolean;
	graphHasMore: boolean;
	isLoading: boolean;
	isGitRepo: boolean;
	error: GitError | null;
};

const LOG_PAGE = 50;
const GRAPH_PAGE = 200;

const INITIAL: GitState = {
	status: {},
	unstagedDiffs: [],
	stagedDiffs: [],
	currentBranch: "",
	branches: [],
	remoteBranches: [],
	log: [],
	graph: [],
	stashes: [],
	remoteStatus: null,
	operationState: null,
	commitMessage: "",
	commitBody: "",
	logHasMore: false,
	graphHasMore: false,
	isLoading: false,
	isGitRepo: true,
	error: null,
};

const _git = writable<GitState>(INITIAL);

export const git = { subscribe: _git.subscribe };

export const gitFileCounts = derived(git, ($g) => {
	const staged = new Set($g.stagedDiffs.map((f) => f.filePath));
	const unstaged = new Set($g.unstagedDiffs.map((f) => f.filePath));
	for (const [p, s] of Object.entries($g.status)) {
		if (s === "untracked") unstaged.add(p);
	}
	const all = new Set([...staged, ...unstaged]);
	return { staged: staged.size, unstaged: unstaged.size, total: all.size };
});

export const gitHasConflicts = derived(
	git,
	($g) =>
		($g.status && Object.values($g.status).some((s) => s === "conflicted")) ||
		($g.operationState?.conflictedFiles.length ?? 0) > 0,
);

export function clearGitError(): void {
	_git.update((s) => (s.error ? { ...s, error: null } : s));
}

async function mutate<T>(op: () => Promise<T>): Promise<T> {
	try {
		const result = await op();
		clearGitError();
		return result;
	} catch (e) {
		_git.update((s) => ({ ...s, error: gitService.toGitError(e) }));
		throw e;
	}
}

function worktree(): string | null {
	return get(activeInstance)?.worktreePath ?? null;
}

export async function refreshStatus(silent = false): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	if (!silent) _git.update((s) => ({ ...s, isLoading: true, error: null }));
	try {
		const isRepo = await gitService.isGitRepo(wt);
		if (!isRepo) {
			_git.update((s) => ({
				...s,
				status: {},
				unstagedDiffs: [],
				stagedDiffs: [],
				currentBranch: "",
				remoteStatus: null,
				operationState: null,
				log: [],
				graph: [],
				stashes: [],
				isGitRepo: false,
				isLoading: false,
				error: null,
			}));
			return;
		}
		const [
			status,
			unstagedDiffs,
			stagedDiffs,
			currentBranch,
			remoteStatus,
			operationState,
		] = await Promise.all([
			gitService.getStatus(wt),
			gitService.getDiffUnstaged(wt),
			gitService.getDiffStaged(wt),
			gitService.getCurrentBranch(wt),
			gitService.getRemoteStatus(wt).catch(() => null),
			gitService.getOperationState(wt).catch(() => null),
		]);
		_git.update((s) => ({
			...s,
			status,
			unstagedDiffs,
			stagedDiffs,
			currentBranch,
			remoteStatus,
			operationState,
			isGitRepo: true,
			isLoading: false,
		}));
	} catch (e) {
		_git.update((s) => ({
			...s,
			isLoading: false,
			error: gitService.toGitError(e),
		}));
	}
}

export async function refreshLog(): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	try {
		const log = await gitService.getLog(wt, LOG_PAGE, 0);
		_git.update((s) => ({ ...s, log, logHasMore: log.length === LOG_PAGE }));
	} catch {
		// Non-fatal - repo may have no commits yet
	}
}

export async function loadMoreLog(): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	const state = get(_git);
	if (!state.logHasMore) return;
	try {
		const more = await gitService.getLog(wt, LOG_PAGE, state.log.length);
		_git.update((s) => {
			const seen = new Set(s.log.map((c) => c.hash));
			const merged = [...s.log, ...more.filter((c) => !seen.has(c.hash))];
			return { ...s, log: merged, logHasMore: more.length === LOG_PAGE };
		});
	} catch {
		// Non-fatal
	}
}

export async function refreshGraph(): Promise<void> {
	const path = worktree() ?? get(activeProject)?.path;
	if (!path) return;
	try {
		const graph = await gitService.getGraph(path, GRAPH_PAGE, 0);
		_git.update((s) => ({
			...s,
			graph,
			graphHasMore: graph.length === GRAPH_PAGE,
		}));
	} catch {
		// Non-fatal
	}
}

export async function loadMoreGraph(): Promise<void> {
	const path = worktree() ?? get(activeProject)?.path;
	if (!path) return;
	const state = get(_git);
	if (!state.graphHasMore) return;
	try {
		const more = await gitService.getGraph(
			path,
			GRAPH_PAGE,
			state.graph.length,
		);
		_git.update((s) => {
			const seen = new Set(s.graph.map((c) => c.hash));
			const merged = [...s.graph, ...more.filter((c) => !seen.has(c.hash))];
			return { ...s, graph: merged, graphHasMore: more.length === GRAPH_PAGE };
		});
	} catch {
		// Non-fatal
	}
}

export async function loadAllLog(): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	try {
		const log = await gitService.getLog(wt, 1_000_000, 0);
		_git.update((s) => ({ ...s, log, logHasMore: false }));
	} catch {
		// Non-fatal
	}
}

export async function loadAllGraph(): Promise<void> {
	const path = worktree() ?? get(activeProject)?.path;
	if (!path) return;
	try {
		const graph = await gitService.getGraph(path, 1_000_000, 0);
		_git.update((s) => ({ ...s, graph, graphHasMore: false }));
	} catch {
		// Non-fatal
	}
}

export async function getHeadCommitMessage(): Promise<string> {
	const wt = worktree();
	if (!wt) return "";
	return gitService.getHeadMessage(wt).catch(() => "");
}

export async function stageFile(filePath: string): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await mutate(() => gitService.stageFile(wt, filePath));
	await refreshStatus();
}

export async function unstageFile(filePath: string): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await mutate(() => gitService.unstageFile(wt, filePath));
	await refreshStatus();
}

export async function stageAll(): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await mutate(() => gitService.stageAll(wt));
	await refreshStatus();
}

export async function unstageAll(): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await mutate(() => gitService.unstageAll(wt));
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
	await mutate(() => gitService.commit(wt, message, options));
	_git.update((s) => ({ ...s, commitMessage: "", commitBody: "" }));
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
	await mutate(() => gitService.amendCommit(wt, message, options));
	await refreshStatus();
	await refreshLog();
}

export async function pushBranch(forceSetUpstream = false): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	const state = get(_git);
	const hasUpstream = state.remoteStatus?.hasUpstream ?? false;
	const setUpstream = forceSetUpstream || !hasUpstream;
	await mutate(() => gitService.push(wt, setUpstream, state.currentBranch));
	await refreshStatus();
}

export async function pullBranch(): Promise<GitOpResult | null> {
	const wt = worktree();
	if (!wt) return null;
	const result = await mutate(() => gitService.pull(wt));
	await refreshStatus();
	return result;
}

/**
 * Recovery offered next to a git error banner. Each action is the fix for the
 * error code that surfaced it; the operation reports its own failure through
 * `mutate`, so a failed recovery simply replaces the banner.
 */
export async function recoverFromGitError(
	action: GitErrorAction,
): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	if (action === "setUpstream") {
		await pushBranch(true);
		return;
	}
	if (action === "pullThenPush") {
		const result = await pullBranch();
		if (result?.ok) await pushBranch();
		return;
	}
	await mutate(() => gitService.removeIndexLock(wt));
	await refreshStatus();
}

export async function fetchRemote(): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await mutate(() => gitService.fetch(wt));
	await refreshStatus();
}

export async function mergeBranch(branch: string): Promise<GitOpResult | null> {
	const wt = worktree();
	if (!wt) return null;
	const result = await mutate(() => gitService.merge(wt, branch));
	await refreshStatus();
	return result;
}

export async function rebaseOnto(onto: string): Promise<GitOpResult | null> {
	const wt = worktree();
	if (!wt) return null;
	const result = await mutate(() => gitService.rebase(wt, onto));
	await refreshStatus();
	return result;
}

export async function continueRebase(): Promise<GitOpResult | null> {
	const wt = worktree();
	if (!wt) return null;
	const result = await mutate(() => gitService.rebaseContinue(wt));
	await refreshStatus();
	return result;
}

export async function skipRebase(): Promise<GitOpResult | null> {
	const wt = worktree();
	if (!wt) return null;
	const result = await mutate(() => gitService.rebaseSkip(wt));
	await refreshStatus();
	return result;
}

export async function abortRebase(): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await mutate(() => gitService.rebaseAbort(wt));
	await refreshStatus();
}

export async function removeFile(filePath: string): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await mutate(() => gitService.rmFile(wt, filePath));
	await refreshStatus();
}

export async function continueMerge(): Promise<GitOpResult | null> {
	const wt = worktree();
	if (!wt) return null;
	const result = await mutate(() => gitService.mergeContinue(wt));
	await refreshStatus();
	return result;
}

export async function abortMerge(): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await mutate(() => gitService.mergeAbort(wt));
	await refreshStatus();
}

export async function loadBranches(projectPath: string): Promise<void> {
	try {
		const { local, remote } = await listBranchesDetailed(projectPath);
		_git.update((s) => ({ ...s, branches: local, remoteBranches: remote }));
	} catch {
		// Non-fatal
	}
}

export async function checkoutBranch(branchName: string): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await mutate(() => gitService.checkoutBranch(wt, branchName));
	await refreshStatus();
}

export async function createBranch(
	branchName: string,
	fromBranch: string,
): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await mutate(() => gitService.createBranch(wt, branchName, fromBranch));
	await refreshStatus();
}

export async function deleteBranch(branchName: string): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await mutate(() => gitService.deleteBranch(wt, branchName));
	await refreshStatus();
}

export function setCommitMessage(msg: string): void {
	_git.update((s) => ({ ...s, commitMessage: msg }));
}

export function setCommitBody(body: string): void {
	_git.update((s) => ({ ...s, commitBody: body }));
}

export function resetGitStore(): void {
	_git.set(INITIAL);
}

export function clearGitData(): void {
	_git.update((s) => ({
		...s,
		status: {},
		unstagedDiffs: [],
		stagedDiffs: [],
		currentBranch: "",
		remoteStatus: null,
		operationState: null,
		branches: [],
		remoteBranches: [],
		log: [],
		graph: [],
		stashes: [],
		logHasMore: false,
		graphHasMore: false,
		isGitRepo: true,
		isLoading: false,
		error: null,
	}));
}

let lastClearedWorktree: string | null | undefined;
activeInstance.subscribe((inst) => {
	const wt = inst?.worktreePath ?? null;
	if (lastClearedWorktree === undefined) {
		lastClearedWorktree = wt;
		return;
	}
	if (wt !== lastClearedWorktree) {
		lastClearedWorktree = wt;
		clearGitData();
	}
});

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
	paths: string[] = [],
): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await mutate(() =>
		gitService.stashPush(wt, message, includeUntracked, keepIndex, paths),
	);
	await Promise.all([refreshStashes(), refreshStatus()]);
}

export async function stageFiles(filePaths: string[]): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await mutate(async () => {
		for (const filePath of filePaths) {
			await gitService.stageFile(wt, filePath);
		}
	});
	await refreshStatus();
}

export async function unstageFiles(filePaths: string[]): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await mutate(async () => {
		for (const filePath of filePaths) {
			await gitService.unstageFile(wt, filePath);
		}
	});
	await refreshStatus();
}

export async function discardFiles(filePaths: string[]): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await mutate(async () => {
		for (const filePath of filePaths) {
			await gitService.discardFile(wt, filePath);
		}
	});
	await refreshStatus();
}

export async function popStash(index: number): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await mutate(() => gitService.stashPop(wt, index));
	await Promise.all([refreshStashes(), refreshStatus()]);
}

export async function applyStash(index: number): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await mutate(() => gitService.stashApply(wt, index));
	await refreshStatus();
}

export async function dropStash(index: number): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await mutate(() => gitService.stashDrop(wt, index));
	await refreshStashes();
}

export async function clearStashes(): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await mutate(() => gitService.stashClear(wt));
	await refreshStashes();
}

export async function renameStash(
	index: number,
	message: string,
): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await mutate(() => gitService.stashRename(wt, index, message));
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
	await mutate(() => gitService.revertCommit(wt, commitHash));
	await Promise.all([refreshStatus(), refreshLog()]);
}

export async function discardFile(filePath: string): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await mutate(() => gitService.discardFile(wt, filePath));
	await refreshStatus();
}
