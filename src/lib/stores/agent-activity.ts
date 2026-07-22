import { derived, get, writable } from "svelte/store";
import {
	getAgentActivity,
	saveAgentActivity,
} from "$lib/services/agent-activity-service";

export const agentBusyConversations = writable<Record<string, string[]>>({});

export const agentBusy = derived(agentBusyConversations, (map) => {
	const busy: Record<string, boolean> = {};
	for (const [key, ids] of Object.entries(map)) {
		if (ids.length > 0) busy[key] = true;
	}
	return busy;
});

export const agentDoneConversation = writable<Record<string, string>>({});

export const agentDone = derived(agentDoneConversation, (map) => {
	const done: Record<string, boolean> = {};
	for (const key of Object.keys(map)) done[key] = true;
	return done;
});

export const agentCompletionPing = writable(0);

export async function loadAgentActivity(): Promise<void> {
	agentDoneConversation.set(await getAgentActivity());
}

export function agentActivityKey(
	projectId: string,
	instanceId: string,
): string {
	return `${projectId}:${instanceId}`;
}

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

export function doneConversationOf(
	projectId: string,
	instanceId: string,
): string | null {
	const key = agentActivityKey(projectId, instanceId);
	const map = get(agentDoneConversation);
	return key in map ? map[key] : null;
}

export function pingAgentCompletion(): void {
	agentCompletionPing.update((n) => n + 1);
}

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
