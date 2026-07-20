import { writable } from "svelte/store";

export const agentBusy = writable<Record<string, boolean>>({});

export const agentDone = writable<Record<string, boolean>>({});

export const agentCompletionPing = writable(0);

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
	agentDone.update((m) => {
		if (!!m[key] === done) return m;
		if (!done) {
			const { [key]: _removed, ...rest } = m;
			return rest;
		}
		return { ...m, [key]: true };
	});
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
