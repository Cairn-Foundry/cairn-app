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

/** Models like wrapping an answer in a fence even when told not to. */
export function stripCodeFence(text: string): string {
	const trimmed = text.trim();
	const fenced = trimmed.match(/^```[a-zA-Z]*\n([\s\S]*?)\n?```$/);
	return (fenced ? fenced[1] : trimmed).trim();
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

/** The only shape asked of the model: one field holding the whole answer. */
const ANSWER_SCHEMA = {
	type: "object",
	properties: { answer: { type: "string" } },
	required: ["answer"],
} as const;

/**
 * Runs `prompt` once in `workingDir` and answers with the text the model
 * produced. Nothing is persisted and no conversation is created: a generated
 * commit message is not a conversation.
 */
export async function runOneShot(
	prompt: string,
	workingDir: string,
	providerId: string,
	options: OneShotOptions = {},
): Promise<string> {
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
		const result = await invoke<{ answer?: string }>("run_oneshot", {
			request: {
				workingDir,
				prompt,
				schema: ANSWER_SCHEMA,
				runId,
				model: model || null,
				binaryPath: null,
				env: {},
			},
		});
		const answer = stripCodeFence(result?.answer ?? "");
		if (!answer) throw new AiAssistError("runFailed");
		return answer;
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
