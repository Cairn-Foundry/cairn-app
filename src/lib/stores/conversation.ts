/** Conversation index for both scopes: metadata in memory, transcripts read and written on demand. */
import { get, type Writable, writable } from "svelte/store";
import {
	type ConversationActivity,
	type ConversationBody,
	type ConversationMessage,
	type ConversationMeta,
	type ConversationScope,
	deleteConversationBody,
	getConversationBody,
	getConversationIndex,
	saveConversationBody,
	saveConversationIndex,
} from "$lib/services/conversation-service";
import { onProjectRemoved } from "$lib/stores/project-teardown";
import { conversationPreview } from "$lib/utils/agent/conversation-export";
import { persist, reportPersistError } from "$lib/utils/persist-error";
import { dropProjectKeys, purgeProjectEntries } from "$lib/utils/project-scope";

export type { ConversationMeta, ConversationScope };

/** Locates a conversation list: a project, plus the instance when the scope is per instance. */
export interface ConversationRef {
	projectId: string;
	instanceId: string;
	scope: ConversationScope;
}

/** Conversation metadata per instance, keyed by conversationScopeKey(). Transcripts are read on demand. */
export const instanceConversations = writable<
	Record<string, ConversationMeta[]>
>({});

/** Conversation metadata shared by every instance of a project, keyed by project id. */
export const projectConversations = writable<
	Record<string, ConversationMeta[]>
>({});

/** The conversation open in each instance; persisted in the instance index. */
export const activeConversationId = writable<Record<string, string | null>>({});

// Scope keys already read from disk, so opening an instance twice does not reload it.
const restored = new Set<string>();
const indexTimers = new Map<string, ReturnType<typeof setTimeout>>();
const bodyTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Signature of the last content written per conversation: re-syncing an unchanged
// transcript must not touch lastMessageAt, or opening a conversation would reorder the list.
const lastSync = new Map<string, string>();

const PERSIST_DELAY_MS = 250;
// A streamed answer resets the debounce on every chunk, so without a ceiling
// nothing reaches the disk until the run ends and a crash loses the whole answer.
const PERSIST_MAX_DELAY_MS = 2000;

// First scheduling of the current burst, per timer key, for the max-delay ceiling.
const bodyDeadlines = new Map<string, number>();

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
		[scopeKey]: instanceSaved?.conversations ?? [],
	}));
	if (loadProject) {
		projectConversations.update((m) => ({
			...m,
			[projectId]: projectSaved?.conversations ?? [],
		}));
	}
	activeConversationId.update((m) => ({
		...m,
		[scopeKey]: instanceSaved?.activeId ?? null,
	}));
}

/**
 * `id` is passed when a session that was only a draft on screen becomes real on
 * its first message: everything already keyed by that id - its draft, its runs,
 * its agents - has to keep pointing at the same conversation.
 */
export function createConversation(
	ref: ConversationRef,
	providerId: string,
	title: string,
	id: string = crypto.randomUUID(),
): ConversationMeta {
	const now = Date.now();
	const meta: ConversationMeta = {
		id,
		title,
		createdAt: now,
		updatedAt: now,
		lastMessageAt: now,
		providerId,
		pinned: false,
		archived: false,
		sessions: {},
		lastProviderId: "",
		messageCount: 0,
		preview: "",
	};
	updateList(ref, (list) => [meta, ...list]);
	selectConversation(ref.projectId, ref.instanceId, meta.id);
	return meta;
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

/** Patches one metadata entry and stamps updatedAt; lastMessageAt is set by the caller instead. */
function patch(
	ref: ConversationRef,
	id: string,
	fields: Partial<ConversationMeta>,
): void {
	updateList(ref, (list) =>
		list.map((c) =>
			c.id === id ? { ...c, ...fields, updatedAt: Date.now() } : c,
		),
	);
}

/** Renames a conversation. */
export function renameConversation(
	ref: ConversationRef,
	id: string,
	title: string,
): void {
	patch(ref, id, { title });
}

/** Changes the provider the next prompt will use. */
export function setConversationProvider(
	ref: ConversationRef,
	id: string,
	providerId: string,
): void {
	patch(ref, id, { providerId });
}

/** Stores the model, effort and permission mode the conversation runs with. */
export function setConversationRunOptions(
	ref: ConversationRef,
	id: string,
	fields: {
		modelId?: string | null;
		effort?: string | null;
		permissionMode?: string | null;
	},
): void {
	patch(ref, id, fields);
}

/** Remembers a provider's session id so the next prompt can resume it. */
export function setConversationSession(
	ref: ConversationRef,
	id: string,
	providerId: string,
	sessionId: string,
): void {
	const target = conversationsOf(ref).find((c) => c.id === id);
	if (!target) return;
	patch(ref, id, {
		sessions: { ...(target.sessions ?? {}), [providerId]: sessionId },
	});
}

/** The session that provider holds in this conversation, if it started one. */
export function conversationSession(
	ref: ConversationRef,
	id: string,
	providerId: string,
): string | null {
	const target = conversationsOf(ref).find((c) => c.id === id);
	return target?.sessions?.[providerId] ?? null;
}

/** Empty until something has answered here, so the first run marks no switch. */
export function lastProviderOf(ref: ConversationRef, id: string): string {
	return conversationsOf(ref).find((c) => c.id === id)?.lastProviderId ?? "";
}

/** Records which provider answered last, so a switch can be shown in the transcript. */
export function setLastProvider(
	ref: ConversationRef,
	id: string,
	providerId: string,
): void {
	if (lastProviderOf(ref, id) === providerId) return;
	patch(ref, id, { lastProviderId: providerId });
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

/** Reads a transcript from disk, dropping the streaming flags a crash may have left set. */
export async function loadConversationBody(
	ref: ConversationRef,
	id: string,
): Promise<ConversationBody> {
	const body = await getConversationBody(
		ref.projectId,
		scopedInstanceId(ref),
		id,
	).catch(() => null);

	const messages = (body?.messages ?? []).map(
		({ streaming: _drop, ...m }) => m,
	);
	return { messages, activity: body?.activity ?? [] };
}

/**
 * Mirrors the live transcript into the store and schedules a debounced write.
 * lastMessageAt only moves when the transcript actually gained something, so
 * re-syncing an unchanged conversation never reorders the list.
 *
 * `snapshot` and the metadata patch both happen inside the debounced callback:
 * this runs on every streamed chunk, and deep-cloning a long transcript - or
 * waking every subscriber of the index - each time is what makes a long answer
 * stutter.
 */
export function updateConversationContent(
	ref: ConversationRef,
	id: string,
	liveMessages: ConversationMessage[],
	liveActivity: ConversationActivity[],
	snapshot?: () => {
		messages: ConversationMessage[];
		activity: ConversationActivity[];
	},
): void {
	const timerKey = `${listKey(ref)}:${id}`;
	const preview = conversationPreview(liveMessages);
	// Usage and resolved-activity counts are part of the signature so late
	// telemetry (arriving after the text stopped changing) still gets saved.
	const usageCount = liveMessages.filter((m) => m.usage).length;
	const doneCount = liveActivity.filter((a) => a.done).length;
	const signature = `${liveMessages.length}\u001f${usageCount}\u001f${liveActivity.length}\u001f${doneCount}\u001f${preview}`;

	if (lastSync.get(timerKey) === signature) return;
	lastSync.set(timerKey, signature);

	const flush = () => {
		bodyTimers.delete(timerKey);
		bodyDeadlines.delete(timerKey);

		const { messages, activity } = snapshot
			? snapshot()
			: { messages: liveMessages, activity: liveActivity };

		const meta = conversationsOf(ref).find((c) => c.id === id);
		const answered =
			!meta ||
			meta.messageCount !== messages.length ||
			meta.preview !== preview;

		patch(ref, id, {
			messageCount: messages.length,
			preview,
			...(answered ? { lastMessageAt: Date.now() } : {}),
		});

		persist(
			"a conversation transcript",
			saveConversationBody(ref.projectId, scopedInstanceId(ref), id, {
				messages,
				activity,
			}),
		);
	};

	const existing = bodyTimers.get(timerKey);
	if (existing) clearTimeout(existing);

	const now = Date.now();
	const deadline = bodyDeadlines.get(timerKey) ?? now + PERSIST_MAX_DELAY_MS;
	bodyDeadlines.set(timerKey, deadline);

	bodyTimers.set(
		timerKey,
		setTimeout(flush, Math.max(0, Math.min(PERSIST_DELAY_MS, deadline - now))),
	);
}

/**
 * Forgets every conversation of a project being removed, cancelling the queued
 * writes first: `write_json_atomic` recreates missing parents, so a debounced
 * transcript firing after the project directory was deleted would write it back.
 */
export function forgetProject(projectId: string): void {
	const clear = (v: unknown) =>
		clearTimeout(v as ReturnType<typeof setTimeout>);
	purgeProjectEntries(indexTimers, projectId, clear);
	purgeProjectEntries(bodyTimers, projectId, clear);
	purgeProjectEntries(bodyDeadlines, projectId);
	purgeProjectEntries(lastSync, projectId);
	purgeProjectEntries(restored, projectId);
	const drop = <T>(m: Record<string, T>) => dropProjectKeys(m, projectId);
	instanceConversations.update(drop);
	projectConversations.update(drop);
	activeConversationId.update(drop);
}

/** Deletes a conversation, its transcript and any write still queued for it. */
export function deleteConversation(ref: ConversationRef, id: string): void {
	updateList(ref, (list) => list.filter((c) => c.id !== id));
	const timerKey = `${listKey(ref)}:${id}`;
	const pending = bodyTimers.get(timerKey);
	if (pending) {
		clearTimeout(pending);
		bodyTimers.delete(timerKey);
	}
	bodyDeadlines.delete(timerKey);
	lastSync.delete(timerKey);
	void deleteConversationBody(ref.projectId, scopedInstanceId(ref), id).catch(
		() => {},
	);
	const scopeKey = conversationScopeKey(ref.projectId, ref.instanceId);
	if (get(activeConversationId)[scopeKey] === id) {
		selectConversation(ref.projectId, ref.instanceId, null);
	}
}

/** Copies a conversation and its transcript; the copy starts with no provider session of its own. */
export async function duplicateConversation(
	ref: ConversationRef,
	id: string,
	title: string,
): Promise<void> {
	const source = conversationsOf(ref).find((c) => c.id === id);
	if (!source) return;
	const body = await loadConversationBody(ref, id);
	const now = Date.now();
	const copy: ConversationMeta = {
		...source,
		id: crypto.randomUUID(),
		title,
		createdAt: now,
		updatedAt: now,
		lastMessageAt: now,
		pinned: false,
		sessions: {},
		lastProviderId: "",
	};
	updateList(ref, (list) => [copy, ...list]);
	await saveConversationBody(
		ref.projectId,
		scopedInstanceId(ref),
		copy.id,
		body,
	).catch((e) => reportPersistError("the duplicated conversation", e));
}

/** Moves a conversation between the instance and project scopes, index entry and transcript together. */
export async function moveConversationToScope(
	from: ConversationRef,
	id: string,
): Promise<void> {
	const meta = conversationsOf(from).find((c) => c.id === id);
	if (!meta) return;
	const to: ConversationRef = {
		...from,
		scope: from.scope === "instance" ? "project" : "instance",
	};

	const body = await loadConversationBody(from, id);

	// The copy must land before the original is dropped: deleting after a failed
	// write would lose the transcript outright.
	try {
		await saveConversationBody(to.projectId, scopedInstanceId(to), id, body);
	} catch (e) {
		reportPersistError("a conversation being moved", e);
		return;
	}

	updateList(from, (list) => list.filter((c) => c.id !== id));
	updateList(to, (list) => [meta, ...list]);

	await deleteConversationBody(
		from.projectId,
		scopedInstanceId(from),
		id,
	).catch((e) => reportPersistError("the moved conversation's old copy", e));
}

/** Forgets an instance's conversations in memory, for an instance being deleted; the project scope is untouched. */
export function removeInstanceConversations(
	projectId: string,
	instanceId: string,
): void {
	const scopeKey = conversationScopeKey(projectId, instanceId);
	restored.delete(scopeKey);

	// Timers still armed here would rewrite the transcript of a deleted instance
	// after Rust erased it, and every per-conversation key would leak otherwise.
	const prefix = `${scopeKey}:`;
	for (const [key, timer] of bodyTimers) {
		if (!key.startsWith(prefix)) continue;
		clearTimeout(timer);
		bodyTimers.delete(key);
	}
	const indexTimer = indexTimers.get(scopeKey);
	if (indexTimer) {
		clearTimeout(indexTimer);
		indexTimers.delete(scopeKey);
	}
	for (const key of [...bodyDeadlines.keys()]) {
		if (key.startsWith(prefix)) bodyDeadlines.delete(key);
	}
	for (const key of [...lastSync.keys()]) {
		if (key.startsWith(prefix)) lastSync.delete(key);
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

onProjectRemoved(forgetProject);
