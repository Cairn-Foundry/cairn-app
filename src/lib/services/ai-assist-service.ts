// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// One-shot model calls for the AI features: a drafted commit message, a merge
// request description. One prompt in, one answer out, nothing persisted.
//
// This is not the Agent step. That step runs a CLI interactively in a PTY and
// reads none of its output; here Cairn asks a single headless question and needs
// the answer back, so it goes through `run_oneshot` instead.

import { invoke } from "@tauri-apps/api/core";

/** Which of the actionable failures happened; the view words each one differently. */
export type AiAssistErrorKind =
	| "unavailable"
	| "notAuthenticated"
	| "runFailed"
	| "cancelled";

export class AiAssistError extends Error {
	readonly kind: AiAssistErrorKind;
	/** What the CLI itself said, when it said anything; shown as-is. */
	readonly detail: string;

	constructor(kind: AiAssistErrorKind, detail = "") {
		super(detail || kind);
		this.name = "AiAssistError";
		this.kind = kind;
		this.detail = detail;
	}
}

/**
 * A CLI reports a missing login on its error channel, in its own words. Cairn
 * cannot ask it, so the wording is matched: getting this wrong only picks a
 * less precise message, never a wrong outcome.
 */
function looksLikeAuthFailure(message: string): boolean {
	return /\b(not )?(logged in|log in|login|authenticat|unauthorized|api key|credentials|session expired)/i.test(
		message,
	);
}

/** Per-run overrides; everything is optional. */
export interface OneShotOptions {
	/** Model id to pass to the CLI, its own default when absent. */
	model?: string;
	/** Aborts the run: the CLI process is killed, not just ignored. */
	signal?: AbortSignal;
	/** Gives up after this long; 0 waits forever. */
	timeoutMs?: number;
}

/**
 * The shape for an assist whose answer really is one block of prose. A feature
 * with fields of its own passes its own schema instead.
 */
export const ANSWER_SCHEMA = {
	type: "object",
	properties: { answer: { type: "string" } },
	required: ["answer"],
	additionalProperties: false,
} as const;

/**
 * Runs `prompt` once in `workingDir` and answers with the object the CLI was
 * forced to produce. Nothing is persisted and no conversation is created: a
 * generated commit message is not a conversation.
 *
 * The shape is enforced by the CLI through its schema flag, so the answer needs
 * no parsing: a CLI that cannot honour the schema fails the run instead of
 * returning prose to be picked apart.
 */
export async function runOneShotShaped<T>(
	prompt: string,
	workingDir: string,
	providerId: string,
	schema: Record<string, unknown>,
	options: OneShotOptions = {},
): Promise<T> {
	const { signal, timeoutMs = 120_000, model } = options;
	if (!providerId) throw new AiAssistError("unavailable");
	if (signal?.aborted) throw new AiAssistError("cancelled");

	const runId = crypto.randomUUID();
	let cancelled = false;

	/** Kills the CLI rather than leaving it running for an answer nobody reads. */
	const cancel = () => {
		cancelled = true;
		void invoke("stop_oneshot", { runId }).catch(() => {});
	};

	signal?.addEventListener("abort", cancel);
	const timer = timeoutMs > 0 ? setTimeout(cancel, timeoutMs) : null;

	try {
		const result = await invoke<T>("run_oneshot", {
			request: {
				workingDir,
				prompt,
				schema,
				runId,
				provider: providerId,
				model: model || null,
				binaryPath: null,
				env: {},
			},
		});
		if (result === null || result === undefined)
			throw new AiAssistError("runFailed");
		return result;
	} catch (e) {
		if (e instanceof AiAssistError) throw e;
		if (cancelled) {
			// A timeout and an abort both cancel the run; only the abort is the
			// user saying no, and the caller stays quiet for that one.
			throw new AiAssistError(signal?.aborted ? "cancelled" : "runFailed");
		}
		const detail = String((e as Error)?.message ?? e);
		if (/not found/i.test(detail))
			throw new AiAssistError("unavailable", detail);
		if (looksLikeAuthFailure(detail)) {
			throw new AiAssistError("notAuthenticated", detail);
		}
		throw new AiAssistError("runFailed", detail);
	} finally {
		if (timer !== null) clearTimeout(timer);
		signal?.removeEventListener("abort", cancel);
	}
}

/**
 * The prose assists: one field, guaranteed present by the schema. Kept as a
 * wrapper so a call site that genuinely wants one block of markdown does not
 * repeat the schema.
 */
export async function runOneShot(
	prompt: string,
	workingDir: string,
	providerId: string,
	options: OneShotOptions = {},
): Promise<string> {
	const result = await runOneShotShaped<{ answer?: string }>(
		prompt,
		workingDir,
		providerId,
		ANSWER_SCHEMA as unknown as Record<string, unknown>,
		options,
	);
	const answer = (result.answer ?? "").trim();
	if (!answer) throw new AiAssistError("runFailed");
	return answer;
}
