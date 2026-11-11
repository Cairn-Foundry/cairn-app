// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Conversations in their two scopes: per instance and shared across a project.
 *
 * A conversation is not a transcript Cairn keeps - it is a CLI running in a PTY.
 * This store owns the index (what exists, its title, how to resume it) and the
 * map from a conversation to the terminal its CLI runs in. Opening a past
 * conversation means relaunching the CLI with its resume argv; Cairn never reads
 * a byte of what the CLI prints.
 */
import { get, type Writable, writable } from "svelte/store";
import {
	type CliProviderId,
	cliSessionExists,
	discoverCliSession,
} from "#lib/services/cli-provider-service";
import {
	type ConversationIndex,
	type ConversationMeta,
	type ConversationScope,
	getConversationIndex,
	saveConversationIndex,
} from "#lib/services/conversation-service";
import { openCliInTerminal } from "#lib/services/file-service";
import { closeTerminal, createTerminal } from "#lib/services/terminal-service";
import { onProjectRemoved } from "#lib/stores/project-teardown";
import { lastCli } from "#lib/stores/ui";
import {
	freshArgv,
	mintsSessionId,
	newConversationArgv,
	resumeArgv,
} from "#lib/utils/agent/cli-launch";
import { captureTitle } from "#lib/utils/agent/conversation-title";
import { isTerminalReply } from "#lib/utils/agent/terminal-reply";
import { persist } from "#lib/utils/persist-error";
import { dropProjectKeys, purgeProjectEntries } from "#lib/utils/project-scope";
import * as manager from "#lib/utils/terminal/terminal-manager";

export type { ConversationMeta, ConversationScope };

/** Locates a conversation list: a project, plus the instance when the scope is per instance. */
export interface ConversationRef {
	projectId: string;
	instanceId: string;
	scope: ConversationScope;
}

/** Conversation metadata per instance, keyed by conversationScopeKey(). */
export const instanceConversations = writable<
	Record<string, ConversationMeta[]>
>({});

/** Conversation metadata shared by every instance of a project, keyed by project id. */
export const projectConversations = writable<
	Record<string, ConversationMeta[]>
>({});

/** The conversation open in each instance; persisted in the instance index. */
export const activeConversationId = writable<Record<string, string | null>>({});

/**
 * The PTY each conversation runs in, keyed by conversation id.
 *
 * A conversation's terminal is a resource of the Agent step, not a terminal of
 * the Terminal tool: it never reaches `terminal-state.json` and never shows up
 * in the terminal list. Its presence here is also what "this conversation is
 * live" means - the status dot reads this map, because Cairn no longer parses
 * the output and cannot tell an answer from a prompt.
 */
export const conversationTerminals = writable<Record<string, string>>({});

/**
 * How many times each conversation's CLI has been launched.
 *
 * A conversation's terminal id is derived from its own id, so it is the same
 * across a relaunch and cannot tell one run from the next. Anything that spans
 * an await and then acts on the terminal compares this first, so a decision
 * taken about one run is not applied to the one that replaced it.
 */
export const conversationRuns = writable<Record<string, number>>({});

/** Conversations being handed to the system terminal: nothing may relaunch them meanwhile. */
export const detachingConversations = writable<Record<string, true>>({});

function setDetaching(id: string, isDetaching: boolean): void {
	detachingConversations.update((m) => {
		const next = { ...m };
		if (isDetaching) next[id] = true;
		else delete next[id];
		return next;
	});
}

/** The run a conversation is on, 0 when its CLI has never been launched. */
export function runOf(conversationId: string): number {
	return get(conversationRuns)[conversationId] ?? 0;
}

// Scope keys already read from disk, so opening an instance twice does not reload it.
const restored = new Set<string>();
const indexTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Conversations still waiting for their first typed line, keyed by terminal id. */
const awaitingTitle = new Map<
	string,
	{ ref: ConversationRef; id: string; pending: string }
>();

/**
 * Conversations whose CLI is running but has not been written to yet, keyed by
 * terminal id. The first byte the user sends is what makes the CLI create its
 * session on disk, so that is when the conversation becomes resumable.
 */
const awaitingFirstInput = new Map<
	string,
	{ ref: ConversationRef; id: string; startedAt: number }
>();

/** One session poll per conversation: a newer one supersedes the running one. */
const sessionPolls = new Map<string, number>();

/**
 * Unsubscribers of the resume watchers, keyed by terminal id. A conversation the
 * app closes itself gets no exit event - the backend stays silent for a session
 * it was asked to close - so the watcher would never remove itself, and every
 * resume of the session would leave one more listener registered for good.
 */
const resumeWatchers = new Map<string, () => void>();

/**
 * Live conversations by terminal id, with when their activity was last written.
 * The scope is resolved at write time: a conversation can change scope while
 * its CLI keeps running.
 */
const activityTrackers = new Map<
	string,
	{ projectId: string; instanceId: string; id: string; writtenAt: number }
>();

// Every keystroke would otherwise rewrite the index; a minute is finer than any
// "last activity" a person reads.
const ACTIVITY_WRITE_INTERVAL_MS = 60_000;

function noteActivity(terminalId: string, data: string): void {
	if (isTerminalReply(data)) return;
	const tracker = activityTrackers.get(terminalId);
	if (!tracker) return;
	const now = Date.now();
	if (now - tracker.writtenAt < ACTIVITY_WRITE_INTERVAL_MS) return;
	const found = findConversation(
		tracker.projectId,
		tracker.instanceId,
		tracker.id,
	);
	if (!found) return;
	tracker.writtenAt = now;
	patch(found.ref, tracker.id, { lastActiveAt: now });
}

/**
 * Records that the CLI of this terminal now has a session worth resuming, and
 * asks for its id again from this moment: the poll started at launch has
 * usually given up by the time a user who read the banner first says something.
 */
function markSessionStarted(terminalId: string): void {
	const pending = awaitingFirstInput.get(terminalId);
	if (!pending) return;
	awaitingFirstInput.delete(terminalId);
	const { ref, id, startedAt } = pending;
	patch(ref, id, { sessionStarted: true });
	const meta = conversationsOf(ref).find((c) => c.id === id);
	if (meta && !meta.sessionConfirmed) {
		captureSessionId(ref, id, meta.cli, meta.cwd, startedAt);
	}
}

const PERSIST_DELAY_MS = 250;

// A CLI that mints its own id has no session until the user has spoken, so the
// id is asked for on a backing-off schedule rather than once. These bounds mean
// roughly a minute of trying, which covers reading the banner and typing.
const SESSION_POLL_START_MS = 1_500;
const SESSION_POLL_MAX_MS = 30_000;

/** The terminal id a conversation's PTY is registered under. */
export function conversationTerminalId(conversationId: string): string {
	return `conversation:${conversationId}`;
}

/** The key instance-scoped maps are indexed by. */
export function conversationScopeKey(
	projectId: string,
	instanceId: string,
): string {
	return `${projectId}:${instanceId}`;
}

/** The map key for a ref: the scope key for an instance, the project id otherwise. */
function listKey(ref: ConversationRef): string {
	return ref.scope === "instance"
		? conversationScopeKey(ref.projectId, ref.instanceId)
		: ref.projectId;
}

/** The instance id the service expects: null marks the project scope. */
function scopedInstanceId(ref: ConversationRef): string | null {
	return ref.scope === "instance" ? ref.instanceId : null;
}

/** The writable backing a scope. */
function listStore(
	scope: ConversationScope,
): Writable<Record<string, ConversationMeta[]>> {
	return scope === "instance" ? instanceConversations : projectConversations;
}

/** Non-reactive read of a scope's conversations. */
export function conversationsOf(ref: ConversationRef): ConversationMeta[] {
	return get(listStore(ref.scope))[listKey(ref)] ?? [];
}

/** The single write path for a scope; every change is persisted from here. */
function updateList(
	ref: ConversationRef,
	fn: (list: ConversationMeta[]) => ConversationMeta[],
): void {
	const key = listKey(ref);
	listStore(ref.scope).update((m) => ({ ...m, [key]: fn(m[key] ?? []) }));
	persistIndex(ref);
}

/** Debounced write of index.json for a scope. */
function persistIndex(ref: ConversationRef): void {
	const key = listKey(ref);
	const existing = indexTimers.get(key);
	if (existing) clearTimeout(existing);
	indexTimers.set(
		key,
		setTimeout(() => {
			indexTimers.delete(key);
			const activeId =
				ref.scope === "instance"
					? (get(activeConversationId)[key] ?? null)
					: null;
			persist(
				"the conversation index",
				saveConversationIndex(ref.projectId, scopedInstanceId(ref), {
					conversations: conversationsOf(ref),
					activeId,
				}),
			);
		}, PERSIST_DELAY_MS),
	);
}

/**
 * An index written before conversations became CLI-backed carries no `cli`, so
 * nothing can relaunch its entries. They are dropped rather than migrated: the
 * transcripts they stood for went with the old model.
 */
function usable(index: ConversationIndex | null): ConversationMeta[] {
	return (index?.conversations ?? []).filter((c) => !!c.cli);
}

/** Reads both scopes for an instance, once each; the project index is shared by its instances. */
export async function restoreConversations(
	projectId: string,
	instanceId: string,
): Promise<void> {
	const scopeKey = conversationScopeKey(projectId, instanceId);
	if (restored.has(scopeKey)) return;
	restored.add(scopeKey);

	const loadProject = !restored.has(projectId);
	restored.add(projectId);

	const [instanceSaved, projectSaved] = await Promise.all([
		getConversationIndex(projectId, instanceId).catch(() => null),
		loadProject
			? getConversationIndex(projectId, null).catch(() => null)
			: null,
	]);

	instanceConversations.update((m) => ({
		...m,
		[scopeKey]: usable(instanceSaved),
	}));
	if (loadProject) {
		projectConversations.update((m) => ({
			...m,
			[projectId]: usable(projectSaved),
		}));
	}
	activeConversationId.update((m) => ({
		...m,
		[scopeKey]: instanceSaved?.activeId ?? null,
	}));
}

/** Opens a conversation in an instance, or closes it with null. */
export function selectConversation(
	projectId: string,
	instanceId: string,
	id: string | null,
): void {
	const scopeKey = conversationScopeKey(projectId, instanceId);
	activeConversationId.update((m) => ({ ...m, [scopeKey]: id }));
	persistIndex({ projectId, instanceId, scope: "instance" });
}

/** Locates a conversation by id across both scopes, returning the ref needed to act on it. */
export function findConversation(
	projectId: string,
	instanceId: string,
	id: string,
): { meta: ConversationMeta; ref: ConversationRef } | null {
	for (const scope of ["instance", "project"] as const) {
		const ref: ConversationRef = { projectId, instanceId, scope };
		const meta = conversationsOf(ref).find((c) => c.id === id);
		if (meta) return { meta, ref };
	}
	return null;
}

/** Patches one metadata entry. */
function patch(
	ref: ConversationRef,
	id: string,
	fields: Partial<ConversationMeta>,
): void {
	updateList(ref, (list) =>
		list.map((c) => (c.id === id ? { ...c, ...fields } : c)),
	);
}

/** Renames a conversation, and stops the first typed line from renaming it after. */
export function renameConversation(
	ref: ConversationRef,
	id: string,
	title: string,
): void {
	patch(ref, id, { title });
	for (const [terminalId, waiting] of awaitingTitle) {
		if (waiting.id === id) awaitingTitle.delete(terminalId);
	}
}

/** Pinned conversations sort to the top of their group. */
export function togglePinned(ref: ConversationRef, id: string): void {
	const target = conversationsOf(ref).find((c) => c.id === id);
	if (!target) return;
	patch(ref, id, { pinned: !target.pinned });
}

/** Archiving filters a conversation out of the Active list; it is not a third group. */
export function toggleArchived(ref: ConversationRef, id: string): void {
	const target = conversationsOf(ref).find((c) => c.id === id);
	if (!target) return;
	patch(ref, id, { archived: !target.archived });
}

/** The terminal a conversation runs in, or null when its CLI is not running. */
export function terminalOf(conversationId: string): string | null {
	return get(conversationTerminals)[conversationId] ?? null;
}

/**
 * Starts a conversation with `cli` and opens it.
 *
 * The session id is minted here when the CLI accepts one imposed at launch, so
 * the first launch already knows what a later resume will name. For the others
 * it stays null and reopening falls back to the CLI's own "last session here".
 */
export async function startConversation(
	ref: ConversationRef,
	cli: CliProviderId,
	cwd: string,
	title = "",
): Promise<ConversationMeta> {
	const now = Date.now();
	const meta: ConversationMeta = {
		id: crypto.randomUUID(),
		title,
		cli,
		sessionId: mintsSessionId(cli) ? crypto.randomUUID() : null,
		cwd,
		createdAt: now,
		lastOpenedAt: now,
		lastActiveAt: now,
		pinned: false,
		archived: false,
	};
	updateList(ref, (list) => [meta, ...list]);
	lastCli.set(cli);
	await openConversation(ref, meta.id, { fresh: true });
	return meta;
}

/**
 * Shows a conversation, launching its CLI if it is not already running.
 *
 * `fresh` starts a new session instead of resuming one, which is what a
 * conversation created a moment ago needs: there is nothing to resume yet, and
 * a resume flag would send the CLI looking for a session that does not exist.
 */
export async function openConversation(
	ref: ConversationRef,
	id: string,
	{ fresh = false }: { fresh?: boolean } = {},
): Promise<void> {
	const meta = conversationsOf(ref).find((c) => c.id === id);
	if (!meta || get(detachingConversations)[id]) return;

	selectConversation(ref.projectId, ref.instanceId, id);

	// Already running: showing it is all there is to do. Relaunching would throw
	// away the session the user is in the middle of.
	if (terminalOf(id)) return;

	// Only a launch moves the conversation in the list. Merely showing one -
	// which is also what restoring the view does on every entry into the Agent
	// step - must leave the order alone.
	patch(ref, id, { lastOpenedAt: Date.now() });

	// `--session-id` creates a session, where `--resume` demands one that already
	// exists and exits when it does not. `sessionConfirmed` only says the discovery poll saw the session, not that
	// there is none: a minted id is taken the moment the CLI starts, so a
	// conversation stopped before that poll landed would be created again under
	// an id the CLI already owns - which it refuses outright. Ask about the id
	// itself before treating it as free.
	const taken =
		!fresh && !meta.sessionConfirmed && meta.sessionId
			? await cliSessionExists(meta.cli, meta.sessionId).catch(() => false)
			: false;
	if (taken) patch(ref, id, { sessionStarted: true, sessionConfirmed: true });

	const resuming = !fresh && (meta.sessionConfirmed === true || taken);
	const argv = resuming
		? resumeArgv(meta.cli, meta.sessionId)
		: (newConversationArgv(meta.cli, meta.sessionId ?? "") ??
			freshArgv(meta.cli));

	const startedAt = Date.now();
	const terminalId = conversationTerminalId(id);
	manager.create(terminalId);
	const { cols, rows } = manager.size(terminalId);
	try {
		await createTerminal(terminalId, meta.cwd, cols, rows, null, null, argv);
	} catch (e) {
		manager.dispose(terminalId);
		throw e;
	}
	conversationTerminals.update((m) => ({ ...m, [id]: terminalId }));
	conversationRuns.update((m) => ({ ...m, [id]: (m[id] ?? 0) + 1 }));
	const run = runOf(id);
	if (resuming) watchResumeFailure(ref, id, run, terminalId, startedAt);
	if (!meta.sessionStarted) {
		awaitingFirstInput.set(terminalId, { ref, id, startedAt });
	}
	activityTrackers.set(terminalId, {
		projectId: ref.projectId,
		instanceId: ref.instanceId,
		id,
		writtenAt: 0,
	});
	if (!meta.title) {
		awaitingTitle.set(terminalId, { ref, id, pending: "" });
	}
	// Polled for every CLI, not only those that mint their own id: an id Cairn
	// chose is a request, not a fact, until the CLI has written a session under
	// it. Confirming it is what keeps a later `--resume` from failing.
	if (!meta.sessionConfirmed) {
		captureSessionId(ref, id, meta.cli, meta.cwd, startedAt);
	}
}

/**
 * Learns the id of a conversation whose CLI minted its own, so it can be
 * reopened later.
 *
 * The CLI has no session until the user has actually said something, so this
 * asks a few times over the first minutes rather than once, and stops as soon
 * as it has an answer or the conversation is closed. Nothing here reads the
 * terminal: the CLI is asked through its own interface.
 */
function captureSessionId(
	ref: ConversationRef,
	id: string,
	cli: CliProviderId,
	cwd: string,
	startedAt: number,
): void {
	const poll = (sessionPolls.get(id) ?? 0) + 1;
	sessionPolls.set(id, poll);
	let delay = SESSION_POLL_START_MS;
	const attempt = async () => {
		// Closed, deleted, superseded, or answered by another attempt: nothing left to do.
		if (!terminalOf(id) || sessionPolls.get(id) !== poll) return;
		const current = conversationsOf(ref).find((c) => c.id === id);
		if (!current || current.sessionConfirmed) return;

		const found = await discoverCliSession(cli, cwd, startedAt).catch(
			() => null,
		);
		if (found) {
			// Discovery reads the CLI's own session list, so an id found there is
			// one it has already written: this conversation is resumable. For a
			// CLI Cairn minted an id for, this is also where a divergence is
			// caught - the CLI is free to have used an id of its own, and its is
			// the one `--resume` will accept.
			patch(ref, id, {
				sessionId: found,
				sessionStarted: true,
				sessionConfirmed: true,
			});
			return;
		}
		delay *= 2;
		if (delay > SESSION_POLL_MAX_MS) return;
		setTimeout(attempt, delay);
	};
	setTimeout(attempt, delay);
}

/**
 * How long a resumed CLI has to stay up before its session is taken as good.
 *
 * A refused `--resume` fails immediately - the CLI reads its store, finds
 * nothing and exits - while a session that opened and was closed by the user is
 * seconds away at the very least.
 */
const RESUME_FAILURE_MS = 4_000;

/**
 * Falls back to a fresh session when a resume is refused.
 *
 * A confirmed session can still be gone: the CLI prunes its store, the home
 * directory is cleared, the worktree moves. `--resume` then exits non-zero
 * within a moment, which used to leave the conversation on a dead terminal with
 * its only explanation scrolled into the buffer. The id is dropped and the CLI
 * relaunched fresh, so the conversation opens - without its history, which is
 * the part that no longer exists anywhere.
 *
 * Only an early failure counts. A session the user worked in and quit is an
 * ordinary exit and must not be relaunched behind their back.
 */
function watchResumeFailure(
	ref: ConversationRef,
	id: string,
	run: number,
	terminalId: string,
	startedAt: number,
): void {
	const stop = manager.onTerminalExit(({ id: exited, exitCode }) => {
		if (exited !== terminalId) return;
		stop();
		resumeWatchers.delete(terminalId);
		if (!exitCode || Date.now() - startedAt > RESUME_FAILURE_MS) return;
		// The PTY of a killed run reports its exit after the next one started, so
		// the run is what says whether this exit is still the one being watched.
		if (runOf(id) !== run || terminalOf(id) !== terminalId) return;
		patch(ref, id, {
			sessionId: null,
			sessionStarted: false,
			sessionConfirmed: false,
		});
		closeConversation(id);
		void openConversation(ref, id, { fresh: true }).catch(() => {});
	});
	resumeWatchers.get(terminalId)?.();
	resumeWatchers.set(terminalId, stop);
}

/**
 * Drops the session a conversation was resuming and reopens it on a new one, in
 * the same worktree and under the same title.
 *
 * For a session its CLI never wrote to disk, `sessionStarted` claims there is
 * something to resume, the CLI answers that there is not, and a restart resumes
 * the same missing session again. Nothing else clears that flag, so the entry
 * would otherwise only be archivable.
 *
 * This is the way out the automatic fallback cannot cover: it only catches a
 * `--resume` the CLI refuses outright, not a CLI that comes up on a session
 * with nothing in it.
 */
export async function startFreshSession(
	ref: ConversationRef,
	id: string,
): Promise<void> {
	const meta = conversationsOf(ref).find((c) => c.id === id);
	if (!meta) return;
	closeConversation(id);
	patch(ref, id, {
		sessionId: mintsSessionId(meta.cli) ? crypto.randomUUID() : null,
		sessionStarted: false,
		sessionConfirmed: false,
	});
	await openConversation(ref, id, { fresh: true });
}

/** Kills the CLI. The entry stays: reopening it is what resume is for. */
export function closeConversation(id: string): void {
	const terminalId = terminalOf(id);
	if (!terminalId) return;
	awaitingTitle.delete(terminalId);
	awaitingFirstInput.delete(terminalId);
	resumeWatchers.get(terminalId)?.();
	resumeWatchers.delete(terminalId);
	activityTrackers.delete(terminalId);
	void closeTerminal(terminalId).catch(() => {});
	manager.dispose(terminalId);
	conversationTerminals.update((m) => {
		const next = { ...m };
		delete next[id];
		return next;
	});
}

/**
 * Continues the conversation in the system terminal. The embedded CLI goes first
 * - two CLIs on one session would write over each other - and the same session
 * is resumed outside. Only a session the CLI has written can be picked up, so a
 * conversation without one is left alone. When no terminal takes it, the CLI
 * stopped for nothing is resumed back in the app.
 */
export async function detachConversation(
	ref: ConversationRef,
	id: string,
): Promise<void> {
	const meta = conversationsOf(ref).find((c) => c.id === id);
	if (!meta?.sessionConfirmed) return;
	const wasRunning = terminalOf(id) !== null;
	setDetaching(id, true);
	closeConversation(id);
	try {
		await openCliInTerminal(meta.cwd, resumeArgv(meta.cli, meta.sessionId));
	} catch (e) {
		setDetaching(id, false);
		if (wasRunning) await openConversation(ref, id).catch(() => {});
		throw e;
	} finally {
		setDetaching(id, false);
	}
}

/**
 * Notes what the user typed into a conversation's PTY, to name it from its first
 * prompt. Called on the way in only: Cairn reads keystrokes, never output.
 */
export function noteTerminalInput(terminalId: string, data: string): void {
	markSessionStarted(terminalId);
	noteActivity(terminalId, data);
	const waiting = awaitingTitle.get(terminalId);
	if (!waiting) return;
	const { title, pending } = captureTitle(waiting.pending, data);
	if (title === null) {
		awaitingTitle.set(terminalId, { ...waiting, pending });
		return;
	}
	awaitingTitle.delete(terminalId);
	patch(waiting.ref, waiting.id, { title });
}

/** Deletes a conversation, killing its CLI first. */
export function deleteConversation(ref: ConversationRef, id: string): void {
	closeConversation(id);
	updateList(ref, (list) => list.filter((c) => c.id !== id));
	const scopeKey = conversationScopeKey(ref.projectId, ref.instanceId);
	if (get(activeConversationId)[scopeKey] === id) {
		selectConversation(ref.projectId, ref.instanceId, null);
	}
}

/**
 * Moves a conversation between the instance and project scopes. The CLI keeps
 * running: which list the entry sits in changes, not where it runs.
 */
export function moveConversationToScope(
	from: ConversationRef,
	id: string,
): void {
	const meta = conversationsOf(from).find((c) => c.id === id);
	if (!meta) return;
	const to: ConversationRef = {
		...from,
		scope: from.scope === "instance" ? "project" : "instance",
	};
	updateList(from, (list) => list.filter((c) => c.id !== id));
	updateList(to, (list) => [meta, ...list]);
}

/**
 * Forgets every conversation of a project being removed, cancelling the queued
 * writes first: `write_json_atomic` recreates missing parents, so a debounced
 * index firing after the project directory was deleted would write it back.
 */
export function forgetProject(projectId: string): void {
	for (const meta of get(projectConversations)[projectId] ?? []) {
		closeConversation(meta.id);
	}
	for (const [key, list] of Object.entries(get(instanceConversations))) {
		if (key.startsWith(`${projectId}:`)) {
			for (const meta of list) closeConversation(meta.id);
		}
	}
	purgeProjectEntries(indexTimers, projectId, (v) =>
		clearTimeout(v as ReturnType<typeof setTimeout>),
	);
	purgeProjectEntries(restored, projectId);
	const drop = <T>(m: Record<string, T>) => dropProjectKeys(m, projectId);
	instanceConversations.update(drop);
	projectConversations.update(drop);
	activeConversationId.update(drop);
}

/** Forgets an instance's conversations in memory; the project scope is untouched. */
export function removeInstanceConversations(
	projectId: string,
	instanceId: string,
): void {
	const scopeKey = conversationScopeKey(projectId, instanceId);
	restored.delete(scopeKey);

	for (const meta of get(instanceConversations)[scopeKey] ?? []) {
		closeConversation(meta.id);
	}

	const indexTimer = indexTimers.get(scopeKey);
	if (indexTimer) {
		clearTimeout(indexTimer);
		indexTimers.delete(scopeKey);
	}

	instanceConversations.update((m) => {
		const next = { ...m };
		delete next[scopeKey];
		return next;
	});
	activeConversationId.update((m) => {
		const next = { ...m };
		delete next[scopeKey];
		return next;
	});
}

// Every keystroke reaching any PTY passes here; only conversation terminals
// do anything with it.
manager.observeInput((terminalId, data) => {
	noteTerminalInput(terminalId, data);
});

onProjectRemoved(forgetProject);
