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
	discoverCliSession,
} from "$lib/services/cli-provider-service";
import {
	type ConversationIndex,
	type ConversationMeta,
	type ConversationScope,
	getConversationIndex,
	saveConversationIndex,
} from "$lib/services/conversation-service";
import {
	closeTerminal,
	createTerminal,
	terminalHasChildren,
} from "$lib/services/terminal-service";
import { onProjectRemoved } from "$lib/stores/project-teardown";
import { lastCli } from "$lib/stores/ui";
import {
	freshArgv,
	mintsSessionId,
	newConversationArgv,
	resumeArgv,
} from "$lib/utils/agent/cli-launch";
import { captureTitle } from "$lib/utils/agent/conversation-title";
import { IDLE_TIMEOUT_MS, isQuiet } from "$lib/utils/agent/idle-reaper";
import { persist } from "$lib/utils/persist-error";
import { dropProjectKeys, purgeProjectEntries } from "$lib/utils/project-scope";
import * as manager from "$lib/utils/terminal/terminal-manager";

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

// Scope keys already read from disk, so opening an instance twice does not reload it.
const restored = new Set<string>();
const indexTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Conversations still waiting for their first typed line, keyed by terminal id. */
const awaitingTitle = new Map<
	string,
	{ ref: ConversationRef; id: string; pending: string }
>();

const PERSIST_DELAY_MS = 250;

// A CLI that mints its own id has no session until the user has spoken, so the
// id is asked for on a backing-off schedule rather than once. These bounds mean
// roughly a minute of trying, which covers reading the banner and typing.
const SESSION_POLL_START_MS = 1_500;
const SESSION_POLL_MAX_MS = 30_000;

/** When each running conversation was last typed into, and last printed. */
const activity = new Map<string, { input: number; output: number }>();

/** How often the reaper looks; a minute's granularity on a five-minute idle. */
const REAP_EVERY_MS = 60_000;

let reaper: ReturnType<typeof setInterval> | null = null;

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
	if (!meta) return;

	selectConversation(ref.projectId, ref.instanceId, id);
	patch(ref, id, { lastOpenedAt: Date.now() });

	// Already running: showing it is all there is to do. Relaunching would throw
	// away the session the user is in the middle of.
	if (terminalOf(id)) return;

	const argv = fresh
		? (newConversationArgv(meta.cli, meta.sessionId ?? "") ??
			freshArgv(meta.cli))
		: resumeArgv(meta.cli, meta.sessionId);

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
	activity.set(id, { input: startedAt, output: startedAt });
	if (!meta.title) {
		awaitingTitle.set(terminalId, { ref, id, pending: "" });
	}
	if (!meta.sessionId && !mintsSessionId(meta.cli)) {
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
	let delay = SESSION_POLL_START_MS;
	const attempt = async () => {
		// Closed, deleted, or answered by another attempt: nothing left to do.
		if (!terminalOf(id)) return;
		const current = conversationsOf(ref).find((c) => c.id === id);
		if (!current || current.sessionId) return;

		const found = await discoverCliSession(cli, cwd, startedAt).catch(
			() => null,
		);
		if (found) {
			patch(ref, id, { sessionId: found });
			return;
		}
		delay *= 2;
		if (delay > SESSION_POLL_MAX_MS) return;
		setTimeout(attempt, delay);
	};
	setTimeout(attempt, delay);
}

/**
 * Records that something happened on a conversation's PTY, which is what keeps
 * the idle sweep from closing it. Exported so it can be driven directly rather
 * than through the terminal manager's observers.
 */
export function noteActivity(
	terminalId: string,
	kind: "input" | "output",
): void {
	const id = conversationIdOf(terminalId);
	if (!id) return;
	const seen = activity.get(id) ?? { input: 0, output: 0 };
	activity.set(id, { ...seen, [kind]: Date.now() });
}

/** The conversation a terminal belongs to, or null for any other terminal. */
function conversationIdOf(terminalId: string): string | null {
	const prefix = "conversation:";
	return terminalId.startsWith(prefix) ? terminalId.slice(prefix.length) : null;
}

/**
 * Closes the CLIs of conversations nobody is looking at any more.
 *
 * Only ever touches a conversation that is not on screen, has been quiet for
 * `IDLE_TIMEOUT_MS`, and has no child process of its own - that last check is
 * what spares a CLI waiting on a long command, which looks idle from the
 * terminal. The entry stays and reopening resumes it, so being reaped costs the
 * user nothing beyond a relaunch.
 */
async function reapIdleConversations(): Promise<void> {
	const now = Date.now();
	const shown = shownNow();

	for (const [id, terminalId] of Object.entries(get(conversationTerminals))) {
		const seen = activity.get(id) ?? { input: 0, output: 0 };
		const quiet = isQuiet(
			{
				conversationId: id,
				terminalId,
				background: !shown.has(id),
				lastInputAt: seen.input,
				lastOutputAt: seen.output,
			},
			now,
		);
		if (!quiet) continue;

		// The process table is the only thing that can tell a CLI waiting on a
		// ten-minute command from an abandoned one. It answers "busy" on any
		// doubt, so a failure here leaves the CLI running.
		const busy = await terminalHasChildren(terminalId).catch(() => true);
		if (busy) continue;

		// Re-checked: the answer above was awaited, and in that time the user may
		// have opened this conversation or it may have been closed already.
		if (get(conversationTerminals)[id] !== terminalId) continue;
		if (shownNow().has(id)) continue;

		closeConversation(id);
	}
}

/** The conversations on screen right now, re-read after an await. */
function shownNow(): Set<string> {
	return new Set(
		Object.values(get(activeConversationId)).filter(
			(id): id is string => id !== null,
		),
	);
}

/** Starts the idle sweep once; every later call is a no-op. */
export function startIdleReaper(): void {
	if (reaper !== null) return;
	reaper = setInterval(() => {
		void reapIdleConversations();
	}, REAP_EVERY_MS);
}

/** Stops the sweep, for a test or a teardown. */
export function stopIdleReaper(): void {
	if (reaper === null) return;
	clearInterval(reaper);
	reaper = null;
}

/** Kills the CLI. The entry stays: reopening it is what resume is for. */
export function closeConversation(id: string): void {
	const terminalId = terminalOf(id);
	if (!terminalId) return;
	awaitingTitle.delete(terminalId);
	activity.delete(id);
	void closeTerminal(terminalId).catch(() => {});
	manager.dispose(terminalId);
	conversationTerminals.update((m) => {
		const next = { ...m };
		delete next[id];
		return next;
	});
}

/**
 * Notes what the user typed into a conversation's PTY, to name it from its first
 * prompt. Called on the way in only: Cairn reads keystrokes, never output.
 */
export function noteTerminalInput(terminalId: string, data: string): void {
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

// Every keystroke reaching any PTY passes here; only a conversation still
// waiting for its title does anything with it.
manager.observeInput((terminalId, data) => {
	noteActivity(terminalId, "input");
	noteTerminalInput(terminalId, data);
});

// The bytes are not passed on: this only needs to know that the CLI is alive.
manager.observeOutput((terminalId) => {
	noteActivity(terminalId, "output");
});

onProjectRemoved(forgetProject);
