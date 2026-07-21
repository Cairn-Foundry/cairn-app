import { get, writable } from "svelte/store";
import {
	getAgentActivity,
	saveAgentActivity,
} from "$lib/services/agent-activity-service";

export const agentBusy = writable<Record<string, boolean>>({});

export const agentDone = writable<Record<string, boolean>>({});

export const agentCompletionPing = writable(0);

export async function loadAgentActivity(): Promise<void> {
	const done = await getAgentActivity();
	agentDone.set(done);
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
): void {
	const key = agentActivityKey(projectId, instanceId);
	agentBusy.update((m) => {
		if (!!m[key] === busy) return m;
		if (!busy) {
			const { [key]: _removed, ...rest } = m;
			return rest;
		}
		return { ...m, [key]: true };
	});
}

export function setAgentDone(
	projectId: string,
	instanceId: string,
	done: boolean,
): void {
	const key = agentActivityKey(projectId, instanceId);
	let changed = false;
	agentDone.update((m) => {
		if (!!m[key] === done) return m;
		changed = true;
		if (!done) {
			const { [key]: _removed, ...rest } = m;
			return rest;
		}
		return { ...m, [key]: true };
	});
	if (changed) saveAgentActivity(get(agentDone));
}

export function pingAgentCompletion(): void {
	agentCompletionPing.update((n) => n + 1);
}

export function clearProjectAgentActivity(
	projectId: string,
	instanceId: string,
): void {
	setAgentBusy(projectId, instanceId, false);
	setAgentDone(projectId, instanceId, false);
}
