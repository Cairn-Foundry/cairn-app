/** Git state of the active worktree: status, diffs, log, graph, stashes, and every write that changes them. */
import { derived, get, writable } from "svelte/store";
import type {
	BranchDivergence,
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
import {
	GIT_REFRESH_IDLE_INTERVAL_MS,
	GIT_REFRESH_INTERVAL_MS,
} from "$lib/utils/timing";
import { activeInstance } from "./instance";
import { activeProject } from "./project";
import { activeScreen } from "./ui";

/** Everything the Git view renders for the active worktree, in one object. */
type GitState = {
	status: GitFileStatus;
	/** Worktree `status` was read from, so a consumer can tell it apart from a stale one. */
	statusWorktree: string | null;
	/**
	 * Bumped once per git write, when the status that follows it lands. A
	 * partial stage leaves the file "modified"
	 * before and after, so a consumer that diffs against the index cannot tell
	 * from the status alone that its base is stale - it watches this instead.
	 */
	indexVersion: number;
	unstagedDiffs: GitFileDiff[];
	stagedDiffs: GitFileDiff[];
	/** Badge counts, kept fresh by the background poll even when the diffs are not read. */
	changedPaths: gitService.GitChangedPaths;
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

/** Page sizes of the log and graph lists; both load more on scroll. */
const LOG_PAGE = 50;
const GRAPH_PAGE = 200;

/** The state a worktree starts from; isGitRepo is optimistic until the first read says otherwise. */
const INITIAL: GitState = {
	status: {},
	statusWorktree: null,
	indexVersion: 0,
	unstagedDiffs: [],
	stagedDiffs: [],
	changedPaths: { staged: [], unstaged: [] },
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

/** Git state of the active worktree, read-only: every write goes through the functions below. */
export const git = { subscribe: _git.subscribe };

/** Badge counts; a file staged and modified counts once in `total`, and untracked files count as unstaged. */
export const gitFileCounts = derived(git, ($g) => {
	const staged = new Set($g.changedPaths.staged);
	const unstaged = new Set($g.changedPaths.unstaged);
	for (const [p, s] of Object.entries($g.status)) {
		if (s === "untracked") unstaged.add(p);
	}
	const all = new Set([...staged, ...unstaged]);
	return { staged: staged.size, unstaged: unstaged.size, total: all.size };
});

/** Whether the worktree needs resolving, from the status or from an interrupted merge or rebase. */
export const gitHasConflicts = derived(
	git,
	($g) =>
		($g.status && Object.values($g.status).some((s) => s === "conflicted")) ||
		($g.operationState?.conflictedFiles.length ?? 0) > 0,
);

/** Dismisses the error banner. */
export function clearGitError(): void {
	_git.update((s) => (s.error ? { ...s, error: null } : s));
}

/**
 * Set by every git write, consumed by the next successful status read, which
 * publishes the new status and the new `indexVersion` in one update so a
 * consumer refreshes once rather than twice.
 */
let indexDirty = false;

/** Wraps a git write: marks the index dirty on success, publishes the error and rethrows on failure. */
async function mutate<T>(op: () => Promise<T>): Promise<T> {
	try {
		const result = await op();
		indexDirty = true;
		clearGitError();
		return result;
	} catch (e) {
		_git.update((s) => ({ ...s, error: gitService.toGitError(e) }));
		throw e;
	}
}

/** Path every command runs in: the active instance worktree, null when there is none. */
function worktree(): string | null {
	return get(activeInstance)?.worktreePath ?? null;
}

let running: Promise<void> | null = null;
let queued: Promise<void> | null = null;

/**
 * A worktree change is watched by the file tree, the git view and the workflow
 * badges alike, so the same refresh is asked for several times at once - six git
 * processes each. Requests that arrive during a flight collapse into a single
 * follow-up run instead. That run starts once the current one has settled rather
 * than joining it: a caller refreshing right after staging a file must see the
 * repository as it is now, not as it was read a moment before the change.
 */
export function refreshStatus(silent = false): Promise<void> {
	if (!worktree()) return Promise.resolve();
	if (!running) {
		running = runRefreshStatus(silent).finally(() => {
			running = null;
		});
		return running;
	}
	if (!queued) {
		queued = running.then(() => {
			queued = null;
			return refreshStatus(silent);
		});
	}
	return queued;
}

/**
 * Whether anything on screen needs the full diffs. The background poll only
 * feeds the badges, and reading both diffs is by far the largest recurring
 * payload of the app, so it is skipped while the git view is closed.
 */
let diffsWanted = false;

/** Called by the git view as it opens and closes. */
export function setDiffsWanted(wanted: boolean): void {
	diffsWanted = wanted;
	if (!wanted) {
		_git.update((s) => ({ ...s, unstagedDiffs: [], stagedDiffs: [] }));
	}
}

/** The actual read: status, badge counts, branch, remote and operation state, in parallel. */
async function runRefreshStatus(silent: boolean): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	if (!silent) _git.update((s) => ({ ...s, isLoading: true, error: null }));
	try {
		// Everything starts at once; the repo check now rides along with the
		// status instead of gating the rest behind its own git process.
		const fullPromise = gitService.getStatusFull(wt);
		const diffsPromise = diffsWanted
			? Promise.all([
					gitService.getDiffUnstaged(wt),
					gitService.getDiffStaged(wt),
				])
			: Promise.resolve(null);
		const branchPromise = gitService.getCurrentBranch(wt);
		// Awaited only when the path is a repository; keep the rejection handled
		// so the early return below never leaves an unhandled one behind.
		branchPromise.catch(() => {});
		diffsPromise.catch(() => {});
		const remotePromise = gitService.getRemoteStatus(wt).catch(() => null);
		const operationPromise = gitService.getOperationState(wt).catch(() => null);

		const full = await fullPromise;
		if (!full.isGitRepo) {
			_git.update((s) => ({
				...s,
				status: {},
				statusWorktree: wt,
				unstagedDiffs: [],
				stagedDiffs: [],
				changedPaths: { staged: [], unstaged: [] },
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
		const { status, changedPaths } = full;
		const [diffs, currentBranch, remoteStatus, operationState] =
			await Promise.all([
				diffsPromise,
				branchPromise,
				remotePromise,
				operationPromise,
			]);
		const bump = indexDirty ? 1 : 0;
		indexDirty = false;
		_git.update((s) => ({
			...s,
			status,
			statusWorktree: wt,
			indexVersion: s.indexVersion + bump,
			changedPaths,
			unstagedDiffs: diffs ? diffs[0] : s.unstagedDiffs,
			stagedDiffs: diffs ? diffs[1] : s.stagedDiffs,
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

/** Reloads the first page of the log. */
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

/** Appends the next page, skipping hashes already listed in case a commit landed meanwhile. */
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

/** Reloads the first page of the graph; falls back to the project path when no instance is active. */
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

/** Appends the next graph page, skipping duplicates. */
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

/** Loads the whole history at once, for a search that must cover everything. */
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

/** Same as loadAllLog(), for the graph. */
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

/** Message of HEAD, to prefill the amend form. */
export async function getHeadCommitMessage(): Promise<string> {
	const wt = worktree();
	if (!wt) return "";
	return gitService.getHeadMessage(wt).catch(() => "");
}

/** Stages one file. */
export async function stageFile(filePath: string): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await mutate(() => gitService.stageFile(wt, filePath));
	await refreshStatus();
}

/** Unstages one file. */
export async function unstageFile(filePath: string): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await mutate(() => gitService.unstageFile(wt, filePath));
	await refreshStatus();
}

/** Stages everything, untracked files included. */
export async function stageAll(): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await mutate(() => gitService.stageAll(wt));
	await refreshStatus();
}

/** Empties the index without touching the worktree. */
export async function unstageAll(): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await mutate(() => gitService.unstageAll(wt));
	await refreshStatus();
}

/** The identity commits would be attributed to in this worktree. */
export async function getGitIdentity(): Promise<gitService.GitIdentity> {
	const wt = worktree();
	if (!wt) return { name: "", email: "" };
	return gitService.getIdentity(wt);
}

/** Commits the index and clears the message fields. */
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

/** Rewrites HEAD with the index as it stands; refuse it once the commit is pushed. */
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

/** Pushes, setting the upstream when the branch has none. */
export async function pushBranch(
	forceSetUpstream = false,
	force = false,
): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	const state = get(_git);
	const hasUpstream = state.remoteStatus?.hasUpstream ?? false;
	const setUpstream = forceSetUpstream || !hasUpstream;
	await mutate(() =>
		gitService.push(wt, setUpstream, state.currentBranch, force),
	);
	await refreshStatus();
}

/** Pulls; the result says whether it left conflicts behind. */
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

/** Fetches without touching the worktree, to refresh the ahead and behind counts. */
export async function fetchRemote(): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await mutate(() => gitService.fetch(wt));
	await refreshStatus();
}

/** Merges a branch in; the result reports the conflicts if any. */
export async function mergeBranch(branch: string): Promise<GitOpResult | null> {
	const wt = worktree();
	if (!wt) return null;
	const result = await mutate(() => gitService.merge(wt, branch));
	await refreshStatus();
	return result;
}

/** Rebases the current branch onto another. */
export async function rebaseOnto(onto: string): Promise<GitOpResult | null> {
	const wt = worktree();
	if (!wt) return null;
	const result = await mutate(() => gitService.rebase(wt, onto));
	await refreshStatus();
	return result;
}

/** Resumes a rebase once its conflicts are resolved and staged. */
export async function continueRebase(): Promise<GitOpResult | null> {
	const wt = worktree();
	if (!wt) return null;
	const result = await mutate(() => gitService.rebaseContinue(wt));
	await refreshStatus();
	return result;
}

/** Drops the commit a rebase is stuck on and moves to the next. */
export async function skipRebase(): Promise<GitOpResult | null> {
	const wt = worktree();
	if (!wt) return null;
	const result = await mutate(() => gitService.rebaseSkip(wt));
	await refreshStatus();
	return result;
}

/** Puts the branch back where the rebase started. */
export async function abortRebase(): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await mutate(() => gitService.rebaseAbort(wt));
	await refreshStatus();
}

/** git rm: deletes the file and stages the deletion. */
export async function removeFile(filePath: string): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await mutate(() => gitService.rmFile(wt, filePath));
	await refreshStatus();
}

/** Concludes a merge once its conflicts are resolved and staged. */
export async function continueMerge(): Promise<GitOpResult | null> {
	const wt = worktree();
	if (!wt) return null;
	const result = await mutate(() => gitService.mergeContinue(wt));
	await refreshStatus();
	return result;
}

/** Puts the worktree back where the merge started. */
export async function abortMerge(): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await mutate(() => gitService.mergeAbort(wt));
	await refreshStatus();
}

/** URL of the origin remote, empty when there is none. */
export async function getRemoteUrl(): Promise<string> {
	const wt = worktree();
	if (!wt) return "";
	return gitService.getRemoteUrl(wt).catch(() => "");
}

/** Ahead and behind counts against a base branch. */
export async function getBranchDivergence(
	base: string,
): Promise<BranchDivergence | null> {
	const wt = worktree();
	if (!wt || !base) return null;
	return gitService.getBranchDivergence(wt, base).catch(() => null);
}

/** Loads the branch lists from the project path rather than a worktree, so every branch shows. */
export async function loadBranches(projectPath: string): Promise<void> {
	try {
		const { local, remote } = await listBranchesDetailed(projectPath);
		_git.update((s) => ({ ...s, branches: local, remoteBranches: remote }));
	} catch {
		// Non-fatal
	}
}

/** Switches the worktree to an existing branch. */
export async function checkoutBranch(branchName: string): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await mutate(() => gitService.checkoutBranch(wt, branchName));
	await refreshStatus();
}

/** Creates a branch off another and checks it out. */
export async function createBranch(
	branchName: string,
	fromBranch: string,
): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await mutate(() => gitService.createBranch(wt, branchName, fromBranch));
	await refreshStatus();
}

/** Deletes a local branch. */
export async function deleteBranch(branchName: string): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await mutate(() => gitService.deleteBranch(wt, branchName));
	await refreshStatus();
}

/** Commit subject being typed; kept in the store so it survives leaving the view. */
export function setCommitMessage(msg: string): void {
	_git.update((s) => ({ ...s, commitMessage: msg }));
}

/** Commit body being typed. */
export function setCommitBody(body: string): void {
	_git.update((s) => ({ ...s, commitBody: body }));
}

/** Back to the initial state, message fields included. */
export function resetGitStore(): void {
	_git.set(INITIAL);
}

/** Drops everything read from a worktree, keeping what the user typed. */
export function clearGitData(): void {
	_git.update((s) => ({
		...s,
		status: {},
		statusWorktree: null,
		unstagedDiffs: [],
		stagedDiffs: [],
		changedPaths: { staged: [], unstaged: [] },
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

/**
 * The single owner of the background status refresh. Every view reads the store
 * instead of polling on its own, and the timer only fires while the workspace is
 * the screen on display and the window has the focus - a git process spawned for
 * a window nobody is looking at buys nothing.
 */
export function startGitPolling(): () => void {
	let visible = get(activeScreen) === "workspace";
	let focused = typeof document === "undefined" || document.hasFocus();

	let lastRun = 0;

	const tick = () => {
		if (!visible || !focused) return;
		lastRun = Date.now();
		void refreshStatus(true);
	};
	// The timer keeps the fast cadence and a tick is skipped when the git view
	// is closed and the slower interval has not elapsed yet, so reopening the
	// view goes back to full speed without restarting anything.
	const timer = setInterval(() => {
		const due = diffsWanted
			? GIT_REFRESH_INTERVAL_MS
			: GIT_REFRESH_IDLE_INTERVAL_MS;
		// Half-interval tolerance: setInterval drifts by a few ms, and an exact
		// comparison would skip a whole cycle every time it fires early.
		if (Date.now() - lastRun < due - GIT_REFRESH_INTERVAL_MS / 2) return;
		tick();
	}, GIT_REFRESH_INTERVAL_MS);

	const unsubscribe = activeScreen.subscribe((screen) => {
		const wasVisible = visible;
		visible = screen === "workspace";
		if (visible && !wasVisible) tick();
	});

	const onFocus = () => {
		focused = true;
		tick();
	};
	const onBlur = () => {
		focused = false;
	};
	window.addEventListener("focus", onFocus);
	window.addEventListener("blur", onBlur);

	return () => {
		clearInterval(timer);
		unsubscribe();
		window.removeEventListener("focus", onFocus);
		window.removeEventListener("blur", onBlur);
	};
}

// Changing worktree wipes the data at once, so no view renders another instance's
// status for a frame. `undefined` marks the initial call, which must not clear anything.
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

/** Reads the repository-local ignore file of the active worktree. */
export async function readExclude(): Promise<string> {
	const wt = worktree();
	if (!wt) return "";
	return gitService.readExclude(wt);
}

/** Saves the repository-local ignore file, then refreshes what it hides. */
export async function writeExclude(content: string): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await mutate(() => gitService.writeExclude(wt, content));
	await refreshStatus();
}

/** Reloads the stash list. */
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

/** Stashes the changes, optionally limited to `paths`. */
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

/** Stages a selection, one file at a time so a single failure names the file. */
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

/** Unstages a selection. */
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

/** Throws away the worktree changes of a selection; not undoable. */
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

/** Applies a stash and drops it. */
export async function popStash(index: number): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await mutate(() => gitService.stashPop(wt, index));
	await Promise.all([refreshStashes(), refreshStatus()]);
}

/** Applies a stash and keeps it in the list. */
export async function applyStash(index: number): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await mutate(() => gitService.stashApply(wt, index));
	await refreshStatus();
}

/** Deletes a stash without applying it. */
export async function dropStash(index: number): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await mutate(() => gitService.stashDrop(wt, index));
	await refreshStashes();
}

/** Deletes every stash. */
export async function clearStashes(): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await mutate(() => gitService.stashClear(wt));
	await refreshStashes();
}

/** Changes a stash message, by rewriting it in place. */
export async function renameStash(
	index: number,
	message: string,
): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await mutate(() => gitService.stashRename(wt, index, message));
	await refreshStashes();
}

/** Diff a stash holds, for the preview; nothing is applied. */
export async function getStashDiff(index: number): Promise<GitFileDiff[]> {
	const wt = worktree();
	if (!wt) return [];
	return gitService.getStashShow(wt, index);
}

/** Adds a commit undoing another, rather than rewriting history. */
export async function revertCommit(commitHash: string): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await mutate(() => gitService.revertCommit(wt, commitHash));
	await Promise.all([refreshStatus(), refreshLog()]);
}

/** Throws away the worktree changes of one file; not undoable. */
export async function discardFile(filePath: string): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await mutate(() => gitService.discardFile(wt, filePath));
	await refreshStatus();
}
