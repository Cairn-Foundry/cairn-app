// A prompt another step composed for the Agent step. Tests and Agent are
// siblings under Workspace, so the request travels through a store rather than
// a prop: it has to survive the step switch that carries the user there.

import { writable } from "svelte/store";

export interface AgentDraftRequest {
	/** Scopes the request, so it never lands in another instance's prompt box. */
	instanceId: string;
	text: string;
}

const { subscribe, set } = writable<AgentDraftRequest | null>(null);

/**
 * Hands `text` to the Agent step. It fills the draft and never sends: the user
 * reads the prompt and adds what only they know before running it.
 */
export function requestAgentDraft(instanceId: string, text: string): void {
	set({ instanceId, text });
}

/** Consumed by the Agent step once it has taken the prompt. */
export function clearAgentDraft(): void {
	set(null);
}

export const agentDraftRequest = { subscribe };
