// Headless one-shot model calls: one prompt in, one JSON object out. Used by
// the review guide and the comment drafts, which need the model without a
// conversation. Only this layer calls invoke().

import { invoke } from "@tauri-apps/api/core";

/**
 * Asks the model one question in `workingDir` and returns the object it
 * answered with, shaped by `schema`. Rejects with "cancelled" when
 * `stopOneshot` killed the run.
 */
export async function runOneshot<T>(
	workingDir: string,
	prompt: string,
	schema: Record<string, unknown>,
	runId: string,
	model?: string,
	binaryPath?: string,
	env: Record<string, string> = {},
): Promise<T> {
	return invoke<T>("run_oneshot", {
		request: {
			workingDir,
			prompt,
			schema,
			runId,
			model: model ?? null,
			binaryPath: binaryPath ?? null,
			env,
		},
	});
}

/** Kills a run in flight; an unknown id is not an error. */
export async function stopOneshot(runId: string): Promise<void> {
	await invoke("stop_oneshot", { runId });
}
