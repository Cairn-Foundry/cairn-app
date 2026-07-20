import { writable } from "svelte/store";

export const agentBusy = writable<Record<string, boolean>>({});

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

export function clearProjectAgentActivity(
	projectId: string,
	instanceId: string,
): void {
	setAgentBusy(projectId, instanceId, false);
}
