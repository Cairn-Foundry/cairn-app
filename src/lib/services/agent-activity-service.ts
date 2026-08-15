// The "agent has finished and has not been read" markers, persisted in
// agent-activity.json. Only this layer calls invoke().

import { invoke } from "@tauri-apps/api/core";

/** Instance key to the conversation id that finished, empty when the file is missing. */
export async function getAgentActivity(): Promise<Record<string, string>> {
	try {
		return await invoke<Record<string, string>>("get_agent_activity");
	} catch {
		return {};
	}
}

/** Fire and forget: a lost marker only costs a stale dot, never a failed action. */
export function saveAgentActivity(done: Record<string, string>): void {
	invoke("save_agent_activity", { done }).catch(() => {});
}
