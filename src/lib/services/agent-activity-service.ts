import { invoke } from "@tauri-apps/api/core";

export async function getAgentActivity(): Promise<Record<string, string>> {
	try {
		return await invoke<Record<string, string>>("get_agent_activity");
	} catch {
		return {};
	}
}

export function saveAgentActivity(done: Record<string, string>): void {
	invoke("save_agent_activity", { done }).catch(() => {});
}
