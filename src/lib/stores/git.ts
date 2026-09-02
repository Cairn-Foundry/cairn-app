// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

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
	GitTag,
	PullMode,
	PushMode,
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
	/** Hash of the last snapshot read, handed back so an unchanged poll answers with nothing. */
	snapshotVersion: string;
	diffVersion: string;
	unstagedDiffs: GitFileDiff[];
	stagedDiffs: GitFileDiff[];
	/** Badge counts, kept fresh by the background poll even when the diffs are not read. */
	changedPaths: gitService.GitChangedPaths;
	currentBranch: string;
	branches: string[];
	remoteBranches: string[];
	isLoadingBranches: boolean;
	log: GitCommit[];
	graph: GitGraphCommit[];
	stashes: GitStash[];
	tags: GitTag[];
	remoteStatus: RemoteStatus | null;
	operationState: GitOperationState | null;
	logHasMore: boolean;
	graphHasMore: boolean;
	isLoading: boolean;
	isGitRepo: boolean;
	error: GitError | null;
};

/** Page sizes of the log and graph lists; both load more on scroll. */
const LOG_PAGE = 50;
/**
 * Smaller than the log's page: a graph row carries its rails, its ref chips and
 * its lane layout, so a page costs more to lay out and more to keep in the DOM.
 */
const GRAPH_PAGE = 20;

/** The state a worktree starts from; isGitRepo is optimistic until the first read says otherwise. */
const INITIAL: GitState = {
	status: {},
	statusWorktree: null,
	indexVersion: 0,
	snapshotVersion: "",
	diffVersion: "",
	unstagedDiffs: [],
	stagedDiffs: [],
	changedPaths: { staged: [], unstaged: [] },
	currentBranch: "",
	branches: [],
	remoteBranches: [],
	isLoadingBranches: false,
	log: [],
	graph: [],
	stashes: [],
	tags: [],
	remoteStatus: null,
	operationState: null,
	logHasMore: false,
	graphHasMore: false,
	isLoading: false,
	isGitRepo: true,
	error: null,
};

/**
 * The commit fields live outside `GitState` on purpose: they change on every
 * keystroke, and while they sat in the monolith each one woke the ~48 reactive
 * statements of GitView - the diff lists and their reduces included.
 */
export const commitDraft = writable<{ message: string; body: string }>({
	message: "",
	body: "",
});

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

/**
 * The actual read: one snapshot round trip for status, branch, remote and
 * operation state, plus the diffs when the git view shows them. A poll that
 * finds nothing changed does not touch the store, so nobody re-renders.
 */
async function runRefreshStatus(silent: boolean): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	if (!silent) _git.update((s) => ({ ...s, isLoading: true, error: null }));
	try {
		const before = get(_git);
		const sameWorktree = before.statusWorktree === wt;
		const known = sameWorktree ? before.snapshotVersion : "";
		const snapshotPromise = gitService.getSnapshot(wt, known);
		const diffsPromise = diffsWanted
			? gitService.getDiffs(wt, sameWorktree ? before.diffVersion : "")
			: Promise.resolve(null);
		diffsPromise.catch(() => {});

		const snap = await snapshotPromise;
		if (snap && !snap.status.isGitRepo) {
			_git.update((s) => ({
				...s,
				status: {},
				statusWorktree: wt,
				snapshotVersion: snap.version,
				unstagedDiffs: [],
				stagedDiffs: [],
				diffVersion: "",
				changedPaths: { staged: [], unstaged: [] },
				currentBranch: "",
				remoteStatus: null,
				operationState: null,
				log: [],
				graph: [],
				stashes: [],
				tags: [],
				isGitRepo: false,
				isLoading: false,
				error: null,
			}));
			return;
		}
		const diffs = await diffsPromise;
		const bump = indexDirty ? 1 : 0;
		indexDirty = false;
		const current = get(_git);
		if (!snap && !diffs && !bump && !current.isLoading) return;
		_git.update((s) => ({
			...s,
			...(snap
				? {
						status: snap.status.status,
						statusWorktree: wt,
						snapshotVersion: snap.version,
						changedPaths: snap.status.changedPaths,
						currentBranch: snap.currentBranch,
						remoteStatus: snap.remoteStatus,
						operationState: snap.operationState,
						isGitRepo: true,
					}
				: {}),
			indexVersion: s.indexVersion + bump,
			unstagedDiffs: diffs ? diffs.unstaged : s.unstagedDiffs,
			stagedDiffs: diffs ? diffs.staged : s.stagedDiffs,
			diffVersion: diffs ? diffs.version : s.diffVersion,
			isLoading: false,
		}));
		// A new snapshot version means the repository moved - a commit or a push
		// from a terminal as much as one from the interface - so the graph on
		// screen is stale. It costs nothing when the poll finds nothing changed,
		// since no snapshot comes back then.
		if (snap) void syncGraph();
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

/**
 * Whether the graph has been read for the worktree in place. A repository with
 * no commits reads as an empty graph, which is not the same thing as a graph
 * nobody asked for: the first tells `syncGraph` to keep it up to date, the
 * second tells it to stay out.
 */
let graphRead = false;

/** Reloads the first page of the graph; falls back to the project path when no instance is active. */
export async function refreshGraph(): Promise<void> {
	const path = worktree() ?? get(activeProject)?.path;
	if (!path) return;
	graphRead = true;
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
	graphRead = true;
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
	graphRead = true;
	try {
		const graph = await gitService.getGraph(path, 1_000_000, 0);
		_git.update((s) => ({ ...s, graph, graphHasMore: false }));
	} catch {
		// Non-fatal
	}
}

/**
 * Reloads the graph after a ref moved - a commit, a push, a pull, a branch or a
 * tag operation, or a change the status poll noticed. It keeps the rows already
 * loaded instead of collapsing back to the first page, and does nothing until
 * the graph has been read once, so a write only pays for the graph when a view
 * shows it.
 */
export function syncGraph(): Promise<void> {
	// A write refreshes the status and the graph at once, and the status read
	// asks for the graph again when it finds the repository moved, so the same
	// reload is asked for twice. They collapse the way the status ones do: a
	// request landing mid-flight gets a follow-up rather than joining a read
	// that may have run before the write that prompted it.
	if (!graphSync) {
		graphSync = runSyncGraph().finally(() => {
			graphSync = null;
		});
		return graphSync;
	}
	if (!graphQueued) {
		graphQueued = graphSync.then(() => {
			graphQueued = null;
			return syncGraph();
		});
	}
	return graphQueued;
}

let graphSync: Promise<void> | null = null;
let graphQueued: Promise<void> | null = null;

async function runSyncGraph(): Promise<void> {
	const path = worktree() ?? get(activeProject)?.path;
	if (!path || !graphRead) return;
	const loaded = get(_git).graph.length;
	try {
		const graph = await gitService.getGraph(
			path,
			Math.max(loaded, GRAPH_PAGE),
			0,
		);
		_git.update((s) => ({
			...s,
			graph,
			// Whatever was behind the loaded rows is still behind them, so the
			// flag stands - unless the graph was empty, in which case this read
			// is the first page and says on its own whether more follows.
			graphHasMore: loaded === 0 ? graph.length === GRAPH_PAGE : s.graphHasMore,
		}));
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

/** Commits the index and clears the message fields. */
export async function commitChanges(
	message: string,
	options: gitService.CommitOptions = {},
): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await mutate(() => gitService.commit(wt, message, options));
	commitDraft.set({ message: "", body: "" });
	await refreshStatus();
	await refreshLog();
	await syncGraph();
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
	await syncGraph();
}

/** Pushes, setting the upstream when the branch has none. */
export async function pushBranch(
	forceSetUpstream = false,
	force = false,
	mode: PushMode = "normal",
): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	const state = get(_git);
	const hasUpstream = state.remoteStatus?.hasUpstream ?? false;
	const setUpstream = forceSetUpstream || !hasUpstream;
	await mutate(() =>
		gitService.push(wt, setUpstream, state.currentBranch, force, mode),
	);
	await Promise.all([refreshStatus(), syncGraph()]);
}

/** Pulls; the result says whether it left conflicts behind. */
export async function pullBranch(
	mode: PullMode = "rebase",
): Promise<GitOpResult | null> {
	const wt = worktree();
	if (!wt) return null;
	const result = await mutate(() => gitService.pull(wt, mode));
	await Promise.all([refreshStatus(), refreshLog(), syncGraph()]);
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
	await Promise.all([refreshStatus(), syncGraph()]);
}

/** Merges a branch in; the result reports the conflicts if any. */
export async function mergeBranch(branch: string): Promise<GitOpResult | null> {
	const wt = worktree();
	if (!wt) return null;
	const result = await mutate(() => gitService.merge(wt, branch));
	await Promise.all([refreshStatus(), refreshLog(), syncGraph()]);
	return result;
}

/** Rebases the current branch onto another. */
export async function rebaseOnto(onto: string): Promise<GitOpResult | null> {
	const wt = worktree();
	if (!wt) return null;
	const result = await mutate(() => gitService.rebase(wt, onto));
	await Promise.all([refreshStatus(), refreshLog(), syncGraph()]);
	return result;
}

/** Resumes a rebase once its conflicts are resolved and staged. */
export async function continueRebase(): Promise<GitOpResult | null> {
	const wt = worktree();
	if (!wt) return null;
	const result = await mutate(() => gitService.rebaseContinue(wt));
	await Promise.all([refreshStatus(), refreshLog(), syncGraph()]);
	return result;
}

/** Drops the commit a rebase is stuck on and moves to the next. */
export async function skipRebase(): Promise<GitOpResult | null> {
	const wt = worktree();
	if (!wt) return null;
	const result = await mutate(() => gitService.rebaseSkip(wt));
	await Promise.all([refreshStatus(), refreshLog(), syncGraph()]);
	return result;
}

/** Puts the branch back where the rebase started. */
export async function abortRebase(): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await mutate(() => gitService.rebaseAbort(wt));
	await Promise.all([refreshStatus(), refreshLog(), syncGraph()]);
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
	await Promise.all([refreshStatus(), refreshLog(), syncGraph()]);
	return result;
}

/** Puts the worktree back where the merge started. */
export async function abortMerge(): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await mutate(() => gitService.mergeAbort(wt));
	await Promise.all([refreshStatus(), refreshLog(), syncGraph()]);
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

/**
 * Loads the branch lists from the project path rather than a worktree, so every
 * branch shows. Fetches first: remote branches are read from local refs, so a
 * branch pushed from elsewhere is invisible until the refs are refreshed. The
 * fetch is best-effort - offline, the stale refs are still worth listing.
 */
export async function loadBranches(
	projectPath: string,
	{ fetch = true } = {},
): Promise<void> {
	_git.update((s) => ({ ...s, isLoadingBranches: true }));
	try {
		if (fetch) await gitService.fetch(projectPath).catch(() => {});
		const { local, remote } = await listBranchesDetailed(projectPath);
		_git.update((s) => ({ ...s, branches: local, remoteBranches: remote }));
	} catch {
		// Non-fatal
	} finally {
		_git.update((s) => ({ ...s, isLoadingBranches: false }));
	}
}

/** Switches the worktree to an existing branch. */
export async function checkoutBranch(branchName: string): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await mutate(() => gitService.checkoutBranch(wt, branchName));
	await Promise.all([refreshStatus(), refreshLog(), syncGraph()]);
}

/** Creates a branch off another and checks it out. */
export async function createBranch(
	branchName: string,
	fromBranch: string,
): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await mutate(() => gitService.createBranch(wt, branchName, fromBranch));
	await Promise.all([refreshStatus(), refreshLog(), syncGraph()]);
}

/** Deletes a local branch. */
export async function deleteBranch(branchName: string): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await mutate(() => gitService.deleteBranch(wt, branchName));
	await Promise.all([refreshStatus(), syncGraph()]);
}

/** Commit subject being typed; kept in the store so it survives leaving the view. */
export function setCommitMessage(msg: string): void {
	commitDraft.update((d) => ({ ...d, message: msg }));
}

/** Commit body being typed. */
export function setCommitBody(body: string): void {
	commitDraft.update((d) => ({ ...d, body }));
}

/** Back to the initial state, message fields included. */
export function resetGitStore(): void {
	commitDraft.set({ message: "", body: "" });
	graphRead = false;
	_git.set(INITIAL);
}

/** The fields a worktree owns; everything else in `GitState` is view bookkeeping. */
const WORKTREE_FIELDS = [
	"status",
	"statusWorktree",
	"snapshotVersion",
	"diffVersion",
	"unstagedDiffs",
	"stagedDiffs",
	"changedPaths",
	"currentBranch",
	"branches",
	"remoteBranches",
	"log",
	"graph",
	"stashes",
	"tags",
	"remoteStatus",
	"operationState",
	"logHasMore",
	"graphHasMore",
	"isGitRepo",
] as const;

type WorktreeData = Pick<GitState, (typeof WORKTREE_FIELDS)[number]>;

/** The data of a worktree as it is emptied, so a clear is a restore of nothing. */
const EMPTY: WorktreeData = {
	status: {},
	statusWorktree: null,
	snapshotVersion: "",
	diffVersion: "",
	unstagedDiffs: [],
	stagedDiffs: [],
	changedPaths: { staged: [], unstaged: [] },
	currentBranch: "",
	branches: [],
	remoteBranches: [],
	log: [],
	graph: [],
	stashes: [],
	tags: [],
	remoteStatus: null,
	operationState: null,
	logHasMore: false,
	graphHasMore: false,
	isGitRepo: true,
};

/**
 * What each worktree was last read as, keyed by its path - the same shape the
 * language server store uses for its servers. Switching project used to empty
 * the store and read everything back from git; the views now get the data the
 * target worktree already had, and the refresh that follows only publishes what
 * actually changed.
 *
 * Holding the versions matters as much as holding the data: `snapshotVersion`
 * and `diffVersion` are what let the backend answer "nothing changed" and hand
 * back nothing. Zeroing them made every return switch re-read, re-serialize and
 * re-parse a repository that had not moved.
 */
const byWorktree = new Map<string, WorktreeData>();

/**
 * A cached worktree holds its diffs, its log page and its graph page, so the
 * bound is what keeps a session moving between many instances from pinning all
 * of them. The least recently left goes first; a project removed while its
 * entries are still cached simply falls out on its own.
 */
const WORKTREE_CACHE_MAX = 8;

/** The worktree fields of a state, for the cache. */
function extract(s: GitState): WorktreeData {
	return Object.fromEntries(
		WORKTREE_FIELDS.map((k) => [k, s[k]]),
	) as WorktreeData;
}

/**
 * Remembers what is on screen for `path`. Only a state actually read from that
 * worktree is worth keeping: `statusWorktree` is set by the first successful
 * read, and storing anything else would cache another worktree's data under
 * this key.
 */
function remember(path: string): void {
	const s = get(_git);
	if (s.statusWorktree !== path) return;
	byWorktree.delete(path);
	byWorktree.set(path, extract(s));
	for (const oldest of byWorktree.keys()) {
		if (byWorktree.size <= WORKTREE_CACHE_MAX) break;
		byWorktree.delete(oldest);
	}
}

/**
 * Swaps the store onto `next`, saving what `prev` was showing. The data of a
 * worktree never leaks into another: an unknown target lands on `EMPTY`, which
 * is what the wipe used to produce.
 */
function switchWorktree(prev: string | null, next: string | null): void {
	if (prev) remember(prev);
	const data = (next && byWorktree.get(next)) || EMPTY;
	// The flag belongs to the worktree in place, like the data it describes:
	// restored rows are a graph that was read, an empty cache entry is not.
	graphRead = data.graph.length > 0;
	_git.update((s) => ({
		...s,
		...data,
		isLoading: false,
		error: null,
	}));
}

/** Drops everything read from a worktree, keeping what the user typed. */
export function clearGitData(): void {
	const path = get(_git).statusWorktree;
	if (path) byWorktree.delete(path);
	graphRead = false;
	_git.update((s) => ({
		...s,
		...EMPTY,
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
/** Safety-net cadence while a filesystem watcher reports changes itself. */
const GIT_REFRESH_WATCHED_INTERVAL_MS = 60_000;
let watched = false;

/** Told by the files view whether the active worktree has a live watcher. */
export function setGitWatched(active: boolean): void {
	watched = active;
}

export function startGitPolling(): () => void {
	let visible = get(activeScreen) === "workspace";
	let focused = typeof document === "undefined" || document.hasFocus();

	let lastRun = 0;

	const tick = () => {
		if (!visible || !focused) return;
		lastRun = Date.now();
		void refreshStatus(true);
	};
	const timer = setInterval(() => {
		const due = watched
			? GIT_REFRESH_WATCHED_INTERVAL_MS
			: diffsWanted
				? GIT_REFRESH_INTERVAL_MS
				: GIT_REFRESH_IDLE_INTERVAL_MS;
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

let lastWorktree: string | null | undefined;
activeInstance.subscribe((inst) => {
	const wt = inst?.worktreePath ?? null;
	if (lastWorktree === undefined) {
		lastWorktree = wt;
		return;
	}
	if (wt !== lastWorktree) {
		const prev = lastWorktree;
		lastWorktree = wt;
		switchWorktree(prev, wt);
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

/** Reloads the tag list. */
export async function refreshTags(): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	try {
		const tags = await gitService.getTagList(wt);
		_git.update((s) => ({ ...s, tags }));
	} catch {
		// Non-fatal
	}
}

/** Creates a tag on `commitHash`, or on HEAD when it is empty. */
export async function createTag(
	name: string,
	message: string,
	commitHash = "",
): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await mutate(() => gitService.tagCreate(wt, name, message, commitHash));
	await Promise.all([refreshTags(), syncGraph()]);
}

/** Deletes a tag locally. */
export async function deleteTag(name: string): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await mutate(() => gitService.tagDelete(wt, name));
	await Promise.all([refreshTags(), syncGraph()]);
}

/** Pushes one tag to the remote. */
export async function pushTag(name: string, remote = "origin"): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await mutate(() => gitService.tagPush(wt, remote, name));
}

/** Deletes a tag on the remote, leaving the local one in place. */
export async function deleteRemoteTag(
	name: string,
	remote = "origin",
): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await mutate(() => gitService.tagDeleteRemote(wt, remote, name));
	await refreshTags();
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
	await Promise.all([refreshStatus(), refreshLog(), syncGraph()]);
}

/** Throws away the worktree changes of one file; not undoable. */
export async function discardFile(filePath: string): Promise<void> {
	const wt = worktree();
	if (!wt) return;
	await mutate(() => gitService.discardFile(wt, filePath));
	await refreshStatus();
}
