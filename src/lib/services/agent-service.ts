import { invoke } from "@tauri-apps/api/core";

export async function sendMessage(
	message: string,
	workingDir: string,
	providerId: string,
	runId: string,
	sessionId: string | null,
	env: Record<string, string> = {},
): Promise<void> {
	await invoke("send_message", {
		message,
		workingDir,
		providerId,
		runId,
		sessionId,
		env,
	});
}

export async function stopAgent(runId: string): Promise<void> {
	await invoke("stop_agent", { runId });
}
