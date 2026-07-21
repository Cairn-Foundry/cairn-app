import { invoke } from "@tauri-apps/api/core";

export async function getAgentActivity(): Promise<Record<string, boolean>> {
	try {
		return await invoke<Record<string, boolean>>("get_agent_activity");
	} catch {
		return {};
	}
}

export function saveAgentActivity(done: Record<string, boolean>): void {
	invoke("save_agent_activity", { done }).catch(() => {});
}
