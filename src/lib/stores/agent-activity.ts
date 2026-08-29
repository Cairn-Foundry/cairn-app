/**
 * Agent activity, tracked per conversation rather than per instance: both maps go
 * from an instance key to conversation ids, and the boolean stores derive from them.
 */
import { derived, get, writable } from "svelte/store";
import {
	getAgentActivity,
	saveAgentActivity,
} from "$lib/services/agent-activity-service";
import { onProjectRemoved } from "$lib/stores/project-teardown";
import { dropProjectKeys } from "$lib/utils/project-scope";

/**
 * Running conversations per instance key, in memory only: a conversation is the
 * unit of agent activity, not the instance, so siblings can run in parallel.
 */
export const agentBusyConversations = writable<Record<string, string[]>>({});

/** Convenience view for the instance list: is anything running for this instance. */
export const agentBusy = derived(agentBusyConversations, (map) => {
	const busy: Record<string, boolean> = {};
	for (const [key, ids] of Object.entries(map)) {
		if (ids.length > 0) busy[key] = true;
	}
	return busy;
});

/** The conversation of each instance whose answer finished and has not been read yet. Persisted to agent-activity.json. */
export const agentDoneConversation = writable<Record<string, string>>({});

/** Convenience view: does this instance carry an unread finished answer. */
export const agentDone = derived(agentDoneConversation, (map) => {
	const done: Record<string, boolean> = {};
	for (const key of Object.keys(map)) done[key] = true;
	return done;
});

/** Bumped on every completion so listeners can react to a run finishing even when nothing else changed. */
export const agentCompletionPing = writable(0);

/** Restores the unread-done markers saved on disk. */
export async function loadAgentActivity(): Promise<void> {
	agentDoneConversation.set(await getAgentActivity());
}

/** The key both activity maps are indexed by. */
export function agentActivityKey(
	projectId: string,
	instanceId: string,
): string {
	return `${projectId}:${instanceId}`;
}

/** Adds or removes one conversation from the running set; the key disappears once none is left. */
export function setAgentBusy(
	projectId: string,
	instanceId: string,
	busy: boolean,
	conversationId: string,
): void {
	const key = agentActivityKey(projectId, instanceId);
	agentBusyConversations.update((m) => {
		const current = m[key] ?? [];
		const present = current.includes(conversationId);
		if (present === busy) return m;

		const next = busy
			? [...current, conversationId]
			: current.filter((id) => id !== conversationId);
		if (next.length === 0) {
			const { [key]: _removed, ...rest } = m;
			return rest;
		}
		return { ...m, [key]: next };
	});
}

/** Marks the instance as carrying an unread answer from `conversationId`, and persists only on a real change. */
export function setAgentDone(
	projectId: string,
	instanceId: string,
	done: boolean,
	conversationId = "",
): void {
	const key = agentActivityKey(projectId, instanceId);
	let changed = false;
	agentDoneConversation.update((m) => {
		const present = key in m;
		if (present === done && (!done || m[key] === conversationId)) return m;
		changed = true;
		if (!done) {
			const { [key]: _removed, ...rest } = m;
			return rest;
		}
		return { ...m, [key]: conversationId };
	});
	if (changed) saveAgentActivity(get(agentDoneConversation));
}

/** The conversation holding the unread answer, or null when there is none. */
export function doneConversationOf(
	projectId: string,
	instanceId: string,
): string | null {
	const key = agentActivityKey(projectId, instanceId);
	const map = get(agentDoneConversation);
	return key in map ? map[key] : null;
}

/** Signals that a run just finished. */
export function pingAgentCompletion(): void {
	agentCompletionPing.update((n) => n + 1);
}

/** Drops both markers for an instance, typically when it is deleted. */
export function clearProjectAgentActivity(
	projectId: string,
	instanceId: string,
): void {
	const key = agentActivityKey(projectId, instanceId);
	agentBusyConversations.update((m) => {
		const { [key]: _removed, ...rest } = m;
		return rest;
	});
	setAgentDone(projectId, instanceId, false);
}

/**
 * Forgets the activity markers of a removed project. The done markers are
 * persisted app-wide, so the file is rewritten without them.
 */
export function forgetProject(projectId: string): void {
	agentBusyConversations.update((m) => dropProjectKeys(m, projectId));
	let changed = false;
	agentDoneConversation.update((m) => {
		const next = dropProjectKeys(m, projectId);
		changed = Object.keys(next).length !== Object.keys(m).length;
		return next;
	});
	if (changed) saveAgentActivity(get(agentDoneConversation));
}

onProjectRemoved(forgetProject);
