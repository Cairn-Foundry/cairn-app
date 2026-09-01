// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/** The review guide, per instance: the reading, the remarks, the pending comments. */
import { get, writable } from "svelte/store";
import { getLocale } from "$lib/i18n";
import { forgeSubmitReview } from "$lib/services/integration-service";
import { runOneshot, stopOneshot } from "$lib/services/oneshot-service";
import {
	getDiffHunks,
	getDiffUnified,
	loadReviewState,
	saveReviewState,
} from "$lib/services/review-service";
import type { AiFeatureAssignment } from "$lib/services/settings-service";
import { onProjectRemoved } from "$lib/stores/project-teardown";
import type {
	GuideRemark,
	ReviewComment,
	ReviewHunk,
	ReviewState,
	ReviewVerdict,
} from "$lib/types/review";
import { emptyReviewState } from "$lib/types/review";
import {
	buildReviewCommentPrompt,
	buildReviewGuidePrompt,
	REVIEW_GUIDE_SCHEMA,
} from "$lib/utils/integrations/prompts";
import { dropProjectKeys, purgeProjectEntries } from "$lib/utils/project-scope";
import {
	guideProgress,
	type RawGuide,
	reconcileWithDiff,
	resolveGuide,
	reviewAsMarkdown,
} from "$lib/utils/review/review-guide";

/** How long a change may sit unwritten before it reaches the disk. */
const PERSIST_DEBOUNCE_MS = 500;

export interface ReviewScope {
	projectId: string;
	instanceId: string;
	worktreePath: string;
}

function keyOf(scope: ReviewScope): string {
	return `${scope.projectId}:${scope.instanceId}`;
}

const _states = writable<Record<string, ReviewState>>({});
export const reviewStates = { subscribe: _states.subscribe };

/** The hunks of the branch as last read, per instance. */
const _hunks = writable<Record<string, ReviewHunk[]>>({});
export const reviewHunks = { subscribe: _hunks.subscribe };

/** The run id of a generation in flight, per instance; empty when idle. */
const _generating = writable<Record<string, string>>({});
export const guideGenerating = { subscribe: _generating.subscribe };

/** The run id of a comment draft in flight, per instance; empty when idle. */
const _drafting = writable<Record<string, string>>({});
export const commentDrafting = { subscribe: _drafting.subscribe };

const _errors = writable<Record<string, string>>({});
export const reviewErrors = { subscribe: _errors.subscribe };

const timers = new Map<string, ReturnType<typeof setTimeout>>();

export function stateFor(scope: ReviewScope): ReviewState {
	return get(_states)[keyOf(scope)] ?? emptyReviewState();
}

export function hunksFor(scope: ReviewScope): ReviewHunk[] {
	return get(_hunks)[keyOf(scope)] ?? [];
}

export function progressFor(scope: ReviewScope) {
	return guideProgress(stateFor(scope), hunksFor(scope));
}

/** The comments not yet on the forge: what "Submit review" would push. */
export function pendingComments(scope: ReviewScope): ReviewComment[] {
	return stateFor(scope).comments.filter((comment) => !comment.publishedAs);
}

function persist(scope: ReviewScope): void {
	const key = keyOf(scope);
	const existing = timers.get(key);
	if (existing) clearTimeout(existing);
	timers.set(
		key,
		setTimeout(() => {
			timers.delete(key);
			saveReviewState(scope.projectId, scope.instanceId, stateFor(scope));
		}, PERSIST_DEBOUNCE_MS),
	);
}

function update(
	scope: ReviewScope,
	change: (state: ReviewState) => ReviewState,
): void {
	const key = keyOf(scope);
	_states.update((map) => ({
		...map,
		[key]: change(map[key] ?? emptyReviewState()),
	}));
	persist(scope);
}

/**
 * Loads the state from disk and realigns it on the diff as it is now, so a
 * chapter whose code the author rewrote comes back unread. Called on every
 * opening of the step.
 */
/**
 * Reads the stored state into memory, without needing a diff.
 *
 * The reading state - which file, which panel, which mode - has to be in place
 * as soon as the step knows its instance: `openReview` waits on a base branch
 * and a resolvable head, so relying on it alone leaves the view showing its
 * defaults until then, and showing them for ever on a branch with no base.
 */
export async function loadReview(scope: ReviewScope): Promise<void> {
	const key = keyOf(scope);
	if (get(_states)[key]) return;
	const stored = await loadReviewState(scope.projectId, scope.instanceId);
	// A concurrent load may have filled it while this one was awaiting.
	if (!stored || get(_states)[key]) return;
	_states.update((map) => (map[key] ? map : { ...map, [key]: stored }));
}

export async function openReview(
	scope: ReviewScope,
	base: string,
	head: string,
): Promise<void> {
	const key = keyOf(scope);
	const stored =
		(await loadReviewState(scope.projectId, scope.instanceId)) ??
		emptyReviewState();
	let hunks: ReviewHunk[] = [];
	try {
		hunks = (await getDiffHunks(scope.worktreePath, base, head)) ?? [];
	} catch {
		// Without a diff there is nothing to reconcile against; the stored state
		// is shown as it is rather than being wiped by a transient git failure.
		_states.update((map) => ({ ...map, [key]: stored }));
		return;
	}
	_hunks.update((map) => ({ ...map, [key]: hunks }));
	const reconciled = reconcileWithDiff(stored, hunks);
	_states.update((map) => ({ ...map, [key]: reconciled }));
	persist(scope);
}

export interface GenerateGuideOptions {
	base: string;
	head: string;
	baseSha: string;
	headSha: string;
	mrTitle?: string;
	mrDescription?: string;
	ticket?: { key: string; title: string } | null;
	assignments?: Record<string, AiFeatureAssignment>;
	/** Which assist CLI answers; empty falls back to the default. */
	provider?: string;
	model?: string;
	binaryPath?: string;
	/**
	 * Forgets which hunks were read. Only a deliberate regeneration asks for it:
	 * a first generation must leave alone what the diff view already marked.
	 */
	resetProgress?: boolean;
}

/**
 * Reads the branch diff, asks the model for the guide, and attaches what it
 * answered to the real hunks. The guide replaces the previous one whole: the
 * reading state is on hunk hashes, so what was read and did not change stays
 * read across a regeneration, unless `resetProgress` asks for a clean slate.
 */
export async function generateGuide(
	scope: ReviewScope,
	options: GenerateGuideOptions,
): Promise<void> {
	const key = keyOf(scope);
	const runId = `guide-${key}-${Date.now()}`;
	_generating.update((map) => ({ ...map, [key]: runId }));
	_errors.update((map) => ({ ...map, [key]: "" }));
	try {
		const [diff, rawHunks] = await Promise.all([
			getDiffUnified(scope.worktreePath, options.base, options.head),
			getDiffHunks(scope.worktreePath, options.base, options.head),
		]);
		const hunks = rawHunks ?? [];
		_hunks.update((map) => ({ ...map, [key]: hunks }));
		const prompt = buildReviewGuidePrompt(
			{
				base: options.base,
				head: options.head,
				diff: diff.text,
				truncated: diff.truncated,
				omitted: diff.omitted ?? [],
				mrTitle: options.mrTitle,
				mrDescription: options.mrDescription,
				ticket: options.ticket,
				language: getLocale(),
			},
			options.assignments,
		);
		const raw = await runOneshot<RawGuide>(
			scope.worktreePath,
			prompt,
			REVIEW_GUIDE_SCHEMA as unknown as Record<string, unknown>,
			runId,
			options.provider,
			options.model,
			options.binaryPath,
		);
		const guide = resolveGuide(
			raw,
			hunks,
			options.baseSha,
			options.headSha,
			new Date().toISOString(),
		);
		update(scope, (state) => ({
			...state,
			guide,
			// Empty rather than the first chapter: a fresh guide opens on its
			// overview, which explains the branch before its code means anything.
			currentChapterId: "",
			currentExcerptIndex: 0,
			...(options.resetProgress ? { seenHunks: [] } : {}),
		}));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		// Cancelling is the user's own doing, not a failure to report back.
		if (message !== "cancelled")
			_errors.update((map) => ({ ...map, [key]: message }));
	} finally {
		_generating.update((map) => ({ ...map, [key]: "" }));
	}
}

/** Kills the generation in flight; the previous guide, if any, stays. */
export async function cancelGuide(scope: ReviewScope): Promise<void> {
	const runId = get(_generating)[keyOf(scope)];
	if (runId) await stopOneshot(runId);
}

export function markChapterSeen(
	scope: ReviewScope,
	chapterId: string,
	isSeen = true,
): void {
	update(scope, (state) => {
		if (!state.guide) return state;
		const chapter = state.guide.chapters.find((c) => c.id === chapterId);
		if (!chapter) return state;
		// Marking the chapter marks what it covers: they are the same reading.
		const hashes = new Set(state.seenHunks);
		for (const excerpt of chapter.excerpts) {
			if (isSeen) hashes.add(excerpt.hunkHash);
			else hashes.delete(excerpt.hunkHash);
		}
		return {
			...state,
			seenHunks: [...hashes],
			guide: {
				...state.guide,
				chapters: state.guide.chapters.map((c) =>
					c.id === chapterId ? { ...c, isSeen } : c,
				),
			},
		};
	});
}

export function markHunkSeen(
	scope: ReviewScope,
	hunkHash: string,
	isSeen = true,
): void {
	update(scope, (state) => {
		const hashes = new Set(state.seenHunks);
		if (isSeen) hashes.add(hunkHash);
		else hashes.delete(hunkHash);
		const seenHunks = [...hashes];
		if (!state.guide) return { ...state, seenHunks };
		// A chapter is read exactly when every hunk it covers is.
		return {
			...state,
			seenHunks,
			guide: {
				...state.guide,
				chapters: state.guide.chapters.map((chapter) => ({
					...chapter,
					isSeen: chapter.excerpts.every((excerpt) =>
						hashes.has(excerpt.hunkHash),
					),
				})),
			},
		};
	});
}

function withRemark(
	state: ReviewState,
	remarkId: string,
	change: (remark: GuideRemark) => GuideRemark,
): ReviewState {
	if (!state.guide) return state;
	return {
		...state,
		guide: {
			...state.guide,
			chapters: state.guide.chapters.map((chapter) => ({
				...chapter,
				remarks: chapter.remarks.map((remark) =>
					remark.id === remarkId ? change(remark) : remark,
				),
			})),
		},
	};
}

export function dismissRemark(scope: ReviewScope, remarkId: string): void {
	update(scope, (state) =>
		withRemark(state, remarkId, (remark) => ({
			...remark,
			status: remark.status === "dismissed" ? "open" : "dismissed",
		})),
	);
}

export function findRemark(
	scope: ReviewScope,
	remarkId: string,
): GuideRemark | null {
	const chapters = stateFor(scope).guide?.chapters ?? [];
	for (const chapter of chapters) {
		const remark = chapter.remarks.find((r) => r.id === remarkId);
		if (remark) return remark;
	}
	return null;
}

export interface NewComment {
	path: string;
	side: "old" | "new";
	line: number;
	startLine?: number;
	body: string;
	remarkId?: string;
}

/** Adds a local comment; nothing leaves the machine until the review is submitted. */
export function addComment(scope: ReviewScope, comment: NewComment): string {
	const id = `rc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	update(scope, (state) => {
		const next: ReviewState = {
			...state,
			comments: [
				...state.comments,
				{ ...comment, id, createdAt: new Date().toISOString() },
			],
		};
		return comment.remarkId
			? withRemark(next, comment.remarkId, (remark) => ({
					...remark,
					status: "commented",
					commentId: id,
				}))
			: next;
	});
	return id;
}

export function editComment(
	scope: ReviewScope,
	commentId: string,
	body: string,
): void {
	update(scope, (state) => ({
		...state,
		comments: state.comments.map((comment) =>
			comment.id === commentId ? { ...comment, body } : comment,
		),
	}));
}

/** Deleting a comment hands its remark back to the reviewer, still open. */
export function deleteComment(scope: ReviewScope, commentId: string): void {
	update(scope, (state) => {
		const removed = state.comments.find((comment) => comment.id === commentId);
		const next: ReviewState = {
			...state,
			comments: state.comments.filter((comment) => comment.id !== commentId),
		};
		return removed?.remarkId
			? withRemark(next, removed.remarkId, (remark) => ({
					...remark,
					status: "open",
					commentId: undefined,
				}))
			: next;
	});
}

/**
 * The comment the model would leave for this remark. Returned rather than
 * stored: the reviewer edits it before it becomes a comment of theirs.
 */
export async function draftCommentFor(
	scope: ReviewScope,
	remark: GuideRemark,
	excerpt: string,
	options: {
		assignments?: Record<string, AiFeatureAssignment>;
		provider?: string;
		model?: string;
		binaryPath?: string;
	} = {},
): Promise<string> {
	const key = keyOf(scope);
	const runId = `draft-${key}-${Date.now()}`;
	_drafting.update((map) => ({ ...map, [key]: runId }));
	const prompt = buildReviewCommentPrompt(
		{
			path: remark.path,
			line: remark.line,
			excerpt,
			title: remark.title,
			body: remark.body,
			language: getLocale(),
		},
		options.assignments,
	);
	try {
		const answer = await runOneshot<{ comment?: unknown }>(
			scope.worktreePath,
			prompt,
			{
				type: "object",
				required: ["comment"],
				properties: { comment: { type: "string" } },
			},
			runId,
			options.provider,
			options.model,
			options.binaryPath,
		);
		return typeof answer.comment === "string" ? answer.comment : "";
	} finally {
		_drafting.update((map) => ({ ...map, [key]: "" }));
	}
}

/** Kills the draft in flight; whatever was in the box stays. */
export async function cancelCommentDraft(scope: ReviewScope): Promise<void> {
	const runId = get(_drafting)[keyOf(scope)];
	if (runId) await stopOneshot(runId);
}

export function setCurrentPosition(
	scope: ReviewScope,
	chapterId: string,
	excerptIndex: number,
): void {
	update(scope, (state) => ({
		...state,
		currentChapterId: chapterId,
		currentExcerptIndex: excerptIndex,
	}));
}

export function setDiffMode(scope: ReviewScope, isDiffMode: boolean): void {
	update(scope, (state) => ({ ...state, isDiffMode }));
}

/** Remembers which threads the discussion panel was filtered to. */
export function setDiscussionFilter(
	scope: ReviewScope,
	discussionFilter: string,
): void {
	update(scope, (state) => ({ ...state, discussionFilter }));
}

/** Remembers the file being read, so the step reopens on it. */
export function setSelectedPath(
	scope: ReviewScope,
	selectedPath: string,
): void {
	update(scope, (state) => ({ ...state, selectedPath }));
}

export function setDiscussionsOpen(
	scope: ReviewScope,
	isDiscussionsOpen: boolean,
): void {
	update(scope, (state) => ({ ...state, isDiscussionsOpen }));
}

/**
 * Sends the review to the forge in one go, then marks what landed. A comment
 * already carrying a `publishedAs` is never sent again, so retrying after a
 * partial failure posts only what is missing.
 */
export async function publishReview(
	scope: ReviewScope,
	verdict: ReviewVerdict,
	body: string,
): Promise<{ published: number; failed: number }> {
	const mrId = get(_mergeRequestIds)[keyOf(scope)] ?? "";
	if (!mrId) throw new Error("No merge request to submit this review to.");
	const pending = pendingComments(scope);
	if (pending.length === 0 && body.trim() === "" && verdict === "comment")
		return { published: 0, failed: 0 };
	const outcome = await forgeSubmitReview(
		scope.projectId,
		mrId,
		pending.map((comment) => ({
			id: comment.id,
			path: comment.path,
			line: comment.line,
			startLine: comment.startLine,
			side: comment.side,
			body: comment.body,
		})),
		verdict,
		body,
	);
	markPublished(scope, outcome.published);
	return {
		published: Object.keys(outcome.published).length,
		failed: outcome.failed.length,
	};
}

/** The merge request each instance's review submits to, set by the view. */
const _mergeRequestIds = writable<Record<string, string>>({});

export function setMergeRequestId(scope: ReviewScope, mrId: string): void {
	_mergeRequestIds.update((map) => ({ ...map, [keyOf(scope)]: mrId }));
}

/** Marks what a submission actually pushed, so a retry never duplicates it. */
export function markPublished(
	scope: ReviewScope,
	published: Record<string, string>,
): void {
	update(scope, (state) => ({
		...state,
		comments: state.comments.map((comment) =>
			published[comment.id]
				? { ...comment, publishedAs: published[comment.id] }
				: comment,
		),
	}));
}

export function reviewMarkdown(
	scope: ReviewScope,
	verdict: ReviewVerdict,
	body: string,
): string {
	return reviewAsMarkdown(stateFor(scope), verdict, body);
}

function forgetProject(projectId: string): void {
	purgeProjectEntries(timers, projectId, (timer) =>
		clearTimeout(timer as ReturnType<typeof setTimeout>),
	);
	_states.update((map) => dropProjectKeys(map, projectId));
	_hunks.update((map) => dropProjectKeys(map, projectId));
	_generating.update((map) => dropProjectKeys(map, projectId));
	_drafting.update((map) => dropProjectKeys(map, projectId));
	_mergeRequestIds.update((map) => dropProjectKeys(map, projectId));
	_errors.update((map) => dropProjectKeys(map, projectId));
}

onProjectRemoved(forgetProject);

/**
 * A review shortcut the workspace claimed the key for. The guide lives behind a
 * lazy view, so the request travels through the store rather than a method
 * call, the way an agent draft does.
 */
const _actions = writable<{ id: string; at: number } | null>(null);
export const reviewAction = { subscribe: _actions.subscribe };

export function requestReviewAction(id: string): void {
	_actions.set({ id, at: Date.now() });
}
