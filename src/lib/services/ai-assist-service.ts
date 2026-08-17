// One-shot provider runs for the AI features. The Agent step drives a
// conversation; a feature wants the answer once and keeps nothing, so this
// wraps `send_message` and resolves with the final text without ever touching
// the conversation store.

import { listen } from "@tauri-apps/api/event";
import { type RunOptions, sendMessage, stopAgent } from "./agent-service";

/** Which of the three actionable failures happened; the view words each one differently. */
export type AiAssistErrorKind =
	| "unavailable"
	| "notAuthenticated"
	| "runFailed"
	| "cancelled";

export class AiAssistError extends Error {
	readonly kind: AiAssistErrorKind;
	/** What the provider itself said, when it said anything; shown as-is. */
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

/** Providers like wrapping an answer in a fence even when told not to. */
export function stripCodeFence(text: string): string {
	const trimmed = text.trim();
	const fenced = /^```[^\n]*\n([\s\S]*?)\n?```$/.exec(trimmed);
	return (fenced ? fenced[1] : trimmed).trim();
}

/**
 * Collects the answer out of a run's events. An agent with tools narrates what
 * it is about to do before doing it - "Reading the staged diff." arrives as an
 * assistant message of its own - so keeping everything it said would make the
 * commentary the first line of the answer. A tool call therefore discards what
 * came before it, leaving only the turn that follows the last one; several text
 * blocks inside that turn are one message and are joined.
 */
export class AnswerCollector {
	private chunks: string[] = [];

	/** Feeds one event; anything but `assistant` and `tool` is ignored. */
	push(source: string, line: string): void {
		if (source === "assistant") this.chunks.push(line);
		else if (source === "tool") this.chunks.length = 0;
	}

	/** The final answer, fence stripped; empty when the agent only narrated. */
	answer(): string {
		return stripCodeFence(this.chunks.join("\n"));
	}
}

export interface OneShotOptions extends RunOptions {
	/** Aborting kills the run through `stop_agent`, so the CLI does not linger. */
	signal?: AbortSignal;
	/** Gives up after this long; 0 waits forever. */
	timeoutMs?: number;
}

let runCounter = 0;

function mintRunId(): string {
	runCounter += 1;
	return `assist-${Date.now().toString(36)}-${runCounter}`;
}

/**
 * Runs `prompt` once and answers with the assistant text, joined in the order
 * it arrived. Nothing is persisted and no conversation is created: a generated
 * commit message is not a conversation.
 */
export async function runOneShot(
	prompt: string,
	workingDir: string,
	providerId: string,
	options: OneShotOptions = {},
): Promise<string> {
	const { signal, timeoutMs = 120_000, ...runOptions } = options;
	if (!providerId) throw new AiAssistError("unavailable");
	if (signal?.aborted) throw new AiAssistError("cancelled");

	const runId = mintRunId();
	const collector = new AnswerCollector();

	return await new Promise<string>((resolve, reject) => {
		let settled = false;
		let unlisten: (() => void) | null = null;
		let timer: ReturnType<typeof setTimeout> | null = null;

		const cleanup = () => {
			if (timer !== null) clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			unlisten?.();
			unlisten = null;
		};

		const finish = (value: string) => {
			if (settled) return;
			settled = true;
			cleanup();
			resolve(value);
		};

		const fail = (error: AiAssistError) => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(error);
		};

		function onAbort() {
			void stopAgent(runId).catch(() => {});
			fail(new AiAssistError("cancelled"));
		}

		signal?.addEventListener("abort", onAbort);

		if (timeoutMs > 0) {
			timer = setTimeout(() => {
				void stopAgent(runId).catch(() => {});
				fail(new AiAssistError("runFailed"));
			}, timeoutMs);
		}

		// The listener has to be live before the run is spawned, or a fast
		// provider answers into a void and the promise never settles.
		void listen<{
			source: string;
			line: string;
			runId?: string;
			data?: Record<string, unknown>;
			agent?: string;
		}>("claude-output", (e) => {
			const payload = e.payload;
			if (payload.runId !== runId) return;
			// Text produced inside a subagent is that thread's reasoning, not the
			// answer: only what the main thread says is the result.
			if (payload.agent) return;

			if (payload.source === "assistant" || payload.source === "tool") {
				collector.push(payload.source, payload.line);
			} else if (payload.source === "error") {
				const message = String(payload.data?.message ?? "");
				fail(
					new AiAssistError(
						looksLikeAuthFailure(message) ? "notAuthenticated" : "runFailed",
						message,
					),
				);
			} else if (payload.source === "system" && payload.line === "[done]") {
				const text = collector.answer();
				if (text === "") fail(new AiAssistError("runFailed"));
				else finish(text);
			}
		})
			.then((fn) => {
				if (settled) {
					fn();
					return;
				}
				unlisten = fn;
				return sendMessage(
					prompt,
					workingDir,
					providerId,
					runId,
					null,
					{},
					runOptions,
				);
			})
			.catch((e) => {
				const message = String(e);
				fail(
					new AiAssistError(
						looksLikeAuthFailure(message) ? "notAuthenticated" : "unavailable",
						message,
					),
				);
			});
	});
}
