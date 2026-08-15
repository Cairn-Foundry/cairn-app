// Driving an agent run: prompt, stop, and permission answers.
// Only this layer calls invoke().

import { invoke } from "@tauri-apps/api/core";

/** Per-run provider overrides; every field is optional, the provider supplies its own defaults. */
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

/**
 * Starts a run and returns as soon as it is spawned: the answer arrives as
 * `claude-output` events tagged with `runId`. `sessionId` belongs to the
 * conversation, not the worktree, and is what resumes the CLI thread.
 */
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

/** Kills exactly one run; the other conversations of the instance keep going. */
export async function stopAgent(runId: string): Promise<void> {
	await invoke("stop_agent", { runId });
}

/** Answer to a tool permission request; allowing may rewrite the tool input. */
export type PermissionResponse =
	| {
			behavior: "allow";
			updatedInput: Record<string, unknown>;
			updatedPermissions?: unknown[];
	  }
	| { behavior: "deny"; message: string };

/** Unblocks a run waiting on a tool permission; the run stays paused until this lands. */
export async function respondPermission(
	runId: string,
	requestId: string,
	response: PermissionResponse,
): Promise<void> {
	await invoke("respond_permission", { runId, requestId, response });
}
