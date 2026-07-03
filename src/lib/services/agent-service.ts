import { invoke } from "@tauri-apps/api/core";

export async function sendMessage(
	message: string,
	workingDir: string,
	providerId: string,
): Promise<void> {
	await invoke("send_message", { message, workingDir, providerId });
}

export async function stopAgent(
	providerId: string,
	workingDir: string,
): Promise<void> {
	await invoke("stop_agent", { providerId, workingDir });
}

export async function resetAgentSession(
	providerId: string,
	workingDir: string,
): Promise<void> {
	await invoke("reset_agent_session", { providerId, workingDir });
}
