// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

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
 * Hands `text` to the Agent step, which types it into the CLI's prompt without
 * pressing Enter: the user reads it and adds what only they know before running
 * it. Cairn never submits a prompt on the user's behalf.
 */
export function requestAgentDraft(instanceId: string, text: string): void {
	set({ instanceId, text });
}

/** Consumed by the Agent step once it has taken the prompt. */
export function clearAgentDraft(): void {
	set(null);
}

export const agentDraftRequest = { subscribe };
