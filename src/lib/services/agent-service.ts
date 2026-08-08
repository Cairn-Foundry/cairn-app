import { invoke } from "@tauri-apps/api/core";

export interface RunOptions {
	model?: string;
	effort?: string;
	permissionMode?: string;
	systemPrompt?: string;
	temperature?: number;
	maxTokens?: number;
	history?: { role: string; content: string }[];
	allowedTools?: string[];
	disallowedTools?: string[];
}

export async function sendMessage(
	message: string,
	workingDir: string,
	providerId: string,
	runId: string,
	sessionId: string | null,
	env: Record<string, string> = {},
	options: RunOptions = {},
): Promise<void> {
	await invoke("send_message", {
		message,
		workingDir,
		providerId,
		runId,
		sessionId,
		env,
		options,
	});
}

export async function stopAgent(runId: string): Promise<void> {
	await invoke("stop_agent", { runId });
}

export type PermissionResponse =
	| {
			behavior: "allow";
			updatedInput: Record<string, unknown>;
			updatedPermissions?: unknown[];
	  }
	| { behavior: "deny"; message: string };

export async function respondPermission(
	runId: string,
	requestId: string,
	response: PermissionResponse,
): Promise<void> {
	await invoke("respond_permission", { runId, requestId, response });
}
