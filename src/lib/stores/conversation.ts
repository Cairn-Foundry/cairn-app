import { get, type Writable, writable } from "svelte/store";
import {
	type AgentThread,
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
import { conversationPreview } from "$lib/utils/agent/conversation-export";

export type { ConversationMeta, ConversationScope };

export interface ConversationRef {
	projectId: string;
	instanceId: string;
	scope: ConversationScope;
}

export const instanceConversations = writable<
	Record<string, ConversationMeta[]>
>({});

export const projectConversations = writable<
	Record<string, ConversationMeta[]>
>({});

export const activeConversationId = writable<Record<string, string | null>>({});

const restored = new Set<string>();
const indexTimers = new Map<string, ReturnType<typeof setTimeout>>();
const bodyTimers = new Map<string, ReturnType<typeof setTimeout>>();

const lastSync = new Map<string, string>();

const PERSIST_DELAY_MS = 250;

export function conversationScopeKey(
	projectId: string,
	instanceId: string,
): string {
	return `${projectId}:${instanceId}`;
}

function listKey(ref: ConversationRef): string {
	return ref.scope === "instance"
		? conversationScopeKey(ref.projectId, ref.instanceId)
		: ref.projectId;
}

function scopedInstanceId(ref: ConversationRef): string | null {
	return ref.scope === "instance" ? ref.instanceId : null;
}

function listStore(
	scope: ConversationScope,
): Writable<Record<string, ConversationMeta[]>> {
	return scope === "instance" ? instanceConversations : projectConversations;
}

export function conversationsOf(ref: ConversationRef): ConversationMeta[] {
	return get(listStore(ref.scope))[listKey(ref)] ?? [];
}

function updateList(
	ref: ConversationRef,
	fn: (list: ConversationMeta[]) => ConversationMeta[],
): void {
	const key = listKey(ref);
	listStore(ref.scope).update((m) => ({ ...m, [key]: fn(m[key] ?? []) }));
	persistIndex(ref);
}

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
			void saveConversationIndex(ref.projectId, scopedInstanceId(ref), {
				conversations: conversationsOf(ref),
				activeId,
			}).catch(() => {});
		}, PERSIST_DELAY_MS),
	);
}

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
		agentThreads: {},
		messageCount: 0,
		preview: "",
	};
	updateList(ref, (list) => [meta, ...list]);
	selectConversation(ref.projectId, ref.instanceId, meta.id);
	return meta;
}

export function selectConversation(
	projectId: string,
	instanceId: string,
	id: string | null,
): void {
	const scopeKey = conversationScopeKey(projectId, instanceId);
	activeConversationId.update((m) => ({ ...m, [scopeKey]: id }));
	persistIndex({ projectId, instanceId, scope: "instance" });
}

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

export function renameConversation(
	ref: ConversationRef,
	id: string,
	title: string,
): void {
	patch(ref, id, { title });
}

export function setConversationProvider(
	ref: ConversationRef,
	id: string,
	providerId: string,
): void {
	patch(ref, id, { providerId });
}

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

/** What that agent already knows of this conversation, if it ran here before. */
export function agentThreadOf(
	ref: ConversationRef,
	id: string,
	agentId: string,
): AgentThread | null {
	const target = conversationsOf(ref).find((c) => c.id === id);
	return target?.agentThreads?.[agentId] ?? null;
}

export function updateAgentThread(
	ref: ConversationRef,
	id: string,
	agentId: string,
	fields: Partial<AgentThread>,
): void {
	const target = conversationsOf(ref).find((c) => c.id === id);
	if (!target) return;
	const threads = target.agentThreads ?? {};
	const thread = threads[agentId] ?? {
		sessions: {},
		lastProviderId: "",
		syncedMessages: 0,
		lastRunId: "",
		contextResetAt: 0,
	};
	patch(ref, id, {
		agentThreads: { ...threads, [agentId]: { ...thread, ...fields } },
	});
}

/** Forgets that agent entirely here: its sessions, its counters, everything. */
export function removeAgentThread(
	ref: ConversationRef,
	id: string,
	agentId: string,
): void {
	const target = conversationsOf(ref).find((c) => c.id === id);
	if (!target?.agentThreads?.[agentId]) return;
	const { [agentId]: _gone, ...rest } = target.agentThreads;
	patch(ref, id, { agentThreads: rest });
}

/** The session that agent holds here on that provider, if it started one. */
export function agentThreadSession(
	ref: ConversationRef,
	id: string,
	agentId: string,
	providerId: string,
): string | null {
	return agentThreadOf(ref, id, agentId)?.sessions?.[providerId] ?? null;
}

export function setAgentThreadSession(
	ref: ConversationRef,
	id: string,
	agentId: string,
	providerId: string,
	sessionId: string,
): void {
	const thread = agentThreadOf(ref, id, agentId);
	updateAgentThread(ref, id, agentId, {
		sessions: { ...(thread?.sessions ?? {}), [providerId]: sessionId },
	});
}

export function setLastProvider(
	ref: ConversationRef,
	id: string,
	providerId: string,
): void {
	if (lastProviderOf(ref, id) === providerId) return;
	patch(ref, id, { lastProviderId: providerId });
}

export function togglePinned(ref: ConversationRef, id: string): void {
	const target = conversationsOf(ref).find((c) => c.id === id);
	if (!target) return;
	patch(ref, id, { pinned: !target.pinned });
}

export function toggleArchived(ref: ConversationRef, id: string): void {
	const target = conversationsOf(ref).find((c) => c.id === id);
	if (!target) return;
	patch(ref, id, { archived: !target.archived });
}

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

export function updateConversationContent(
	ref: ConversationRef,
	id: string,
	messages: ConversationMessage[],
	activity: ConversationActivity[],
): void {
	const timerKey = `${listKey(ref)}:${id}`;
	const preview = conversationPreview(messages);
	// Usage and resolved-activity counts are part of the signature so late
	// telemetry (arriving after the text stopped changing) still gets saved.
	const usageCount = messages.filter((m) => m.usage).length;
	const doneCount = activity.filter((a) => a.done).length;
	const signature = `${messages.length}\u001f${usageCount}\u001f${activity.length}\u001f${doneCount}\u001f${preview}`;

	if (lastSync.get(timerKey) === signature) return;
	lastSync.set(timerKey, signature);

	const meta = conversationsOf(ref).find((c) => c.id === id);
	const answered =
		!meta || meta.messageCount !== messages.length || meta.preview !== preview;

	patch(ref, id, {
		messageCount: messages.length,
		preview,
		...(answered ? { lastMessageAt: Date.now() } : {}),
	});

	const existing = bodyTimers.get(timerKey);
	if (existing) clearTimeout(existing);
	bodyTimers.set(
		timerKey,
		setTimeout(() => {
			bodyTimers.delete(timerKey);
			void saveConversationBody(ref.projectId, scopedInstanceId(ref), id, {
				messages,
				activity,
			}).catch(() => {});
		}, PERSIST_DELAY_MS),
	);
}

export function deleteConversation(ref: ConversationRef, id: string): void {
	updateList(ref, (list) => list.filter((c) => c.id !== id));
	const timerKey = `${listKey(ref)}:${id}`;
	const pending = bodyTimers.get(timerKey);
	if (pending) {
		clearTimeout(pending);
		bodyTimers.delete(timerKey);
	}
	lastSync.delete(timerKey);
	void deleteConversationBody(ref.projectId, scopedInstanceId(ref), id).catch(
		() => {},
	);
	const scopeKey = conversationScopeKey(ref.projectId, ref.instanceId);
	if (get(activeConversationId)[scopeKey] === id) {
		selectConversation(ref.projectId, ref.instanceId, null);
	}
}

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
		agentThreads: {},
	};
	updateList(ref, (list) => [copy, ...list]);
	await saveConversationBody(
		ref.projectId,
		scopedInstanceId(ref),
		copy.id,
		body,
	).catch(() => {});
}

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
	updateList(from, (list) => list.filter((c) => c.id !== id));
	updateList(to, (list) => [meta, ...list]);

	await saveConversationBody(
		to.projectId,
		scopedInstanceId(to),
		id,
		body,
	).catch(() => {});
	await deleteConversationBody(
		from.projectId,
		scopedInstanceId(from),
		id,
	).catch(() => {});
}

export function removeInstanceConversations(
	projectId: string,
	instanceId: string,
): void {
	const scopeKey = conversationScopeKey(projectId, instanceId);
	restored.delete(scopeKey);
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
