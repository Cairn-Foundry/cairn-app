// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	AiAssistError,
	ANSWER_SCHEMA,
	runOneShot,
	runOneShotShaped,
} from "./ai-assist-service";

const mockInvoke = vi.mocked(invoke);

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const SCHEMA = { type: "object" };

/** The error a run rejects with, or the test fails. */
async function failureOf(run: Promise<unknown>): Promise<AiAssistError> {
	try {
		await run;
	} catch (e) {
		return e as AiAssistError;
	}
	throw new Error("the run did not fail");
}

beforeEach(() => {
	mockInvoke.mockReset();
	mockInvoke.mockResolvedValue(undefined);
	vi.spyOn(crypto, "randomUUID").mockReturnValue(RUN_ID);
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("AiAssistError", () => {
	it("uses the detail as its message when there is one", () => {
		const error = new AiAssistError("runFailed", "the CLI said no");
		expect(error.message).toBe("the CLI said no");
		expect(error.detail).toBe("the CLI said no");
		expect(error.kind).toBe("runFailed");
		expect(error.name).toBe("AiAssistError");
	});

	it("falls back to its kind as the message and keeps an empty detail", () => {
		const error = new AiAssistError("cancelled");
		expect(error.message).toBe("cancelled");
		expect(error.detail).toBe("");
	});
});

describe("runOneShotShaped", () => {
	it("hands the whole request to run_oneshot and answers with the result", async () => {
		mockInvoke.mockResolvedValue({ title: "feat" });
		const result = await runOneShotShaped<{ title: string }>(
			"write it",
			"/w",
			"claude-code",
			SCHEMA,
			{ model: "opus" },
		);
		expect(result).toEqual({ title: "feat" });
		expect(mockInvoke).toHaveBeenCalledTimes(1);
		expect(mockInvoke).toHaveBeenCalledWith("run_oneshot", {
			request: {
				workingDir: "/w",
				prompt: "write it",
				schema: SCHEMA,
				runId: RUN_ID,
				provider: "claude-code",
				model: "opus",
				binaryPath: null,
				context: "repository",
				env: {},
			},
		});
	});

	it("sends a null model when none was asked for", async () => {
		mockInvoke.mockResolvedValue({ a: 1 });
		await runOneShotShaped("p", "/w", "codex", SCHEMA);
		const request = (
			mockInvoke.mock.calls[0][1] as { request: { model: unknown } }
		).request;
		expect(request.model).toBeNull();
	});

	it("refuses to run without a provider", async () => {
		const error = await failureOf(runOneShotShaped("p", "/w", "", SCHEMA));
		expect(error.kind).toBe("unavailable");
		expect(mockInvoke).not.toHaveBeenCalled();
	});

	it("refuses to run when already aborted", async () => {
		const controller = new AbortController();
		controller.abort();
		const error = await failureOf(
			runOneShotShaped("p", "/w", "codex", SCHEMA, {
				signal: controller.signal,
			}),
		);
		expect(error.kind).toBe("cancelled");
		expect(mockInvoke).not.toHaveBeenCalled();
	});

	it.each([null, undefined])("fails the run on a %s answer", async (value) => {
		mockInvoke.mockResolvedValue(value);
		const error = await failureOf(runOneShotShaped("p", "/w", "codex", SCHEMA));
		expect(error.kind).toBe("runFailed");
		expect(error.detail).toBe("");
	});

	it("accepts a falsy but present answer", async () => {
		mockInvoke.mockResolvedValue(0);
		await expect(runOneShotShaped("p", "/w", "codex", SCHEMA)).resolves.toBe(0);
	});

	it("reports a missing binary as unavailable, keeping what was said", async () => {
		mockInvoke.mockRejectedValue(new Error("claude: Command Not Found"));
		const error = await failureOf(
			runOneShotShaped("p", "/w", "claude-code", SCHEMA),
		);
		expect(error.kind).toBe("unavailable");
		expect(error.detail).toBe("claude: Command Not Found");
	});

	it.each([
		"you are not logged in",
		"please log in first",
		"login required",
		"authentication failed",
		"Unauthorized",
		"invalid API key",
		"missing credentials",
		"session expired",
	])("reports %j as not authenticated", async (message) => {
		mockInvoke.mockRejectedValue(new Error(message));
		const error = await failureOf(runOneShotShaped("p", "/w", "codex", SCHEMA));
		expect(error.kind).toBe("notAuthenticated");
		expect(error.detail).toBe(message);
	});

	it("reports any other failure as a failed run with the CLI's words", async () => {
		mockInvoke.mockRejectedValue(new Error("segfault"));
		const error = await failureOf(runOneShotShaped("p", "/w", "codex", SCHEMA));
		expect(error.kind).toBe("runFailed");
		expect(error.detail).toBe("segfault");
	});

	it("reads a rejection that is not an Error as text", async () => {
		mockInvoke.mockRejectedValue("plain text failure");
		const error = await failureOf(runOneShotShaped("p", "/w", "codex", SCHEMA));
		expect(error.kind).toBe("runFailed");
		expect(error.detail).toBe("plain text failure");
	});

	it("kills the CLI and reports a cancellation when the signal aborts", async () => {
		let rejectRun!: (reason: unknown) => void;
		mockInvoke.mockImplementation((cmd: string) =>
			cmd === "run_oneshot"
				? new Promise((_, reject) => {
						rejectRun = reject;
					})
				: Promise.resolve(undefined),
		);
		const controller = new AbortController();
		const run = runOneShotShaped("p", "/w", "codex", SCHEMA, {
			signal: controller.signal,
		});
		controller.abort();
		expect(mockInvoke).toHaveBeenCalledWith("stop_oneshot", { runId: RUN_ID });
		rejectRun(new Error("killed"));
		const error = await failureOf(run);
		expect(error.kind).toBe("cancelled");
		expect(error.detail).toBe("");
	});

	it("ignores a stop_oneshot that itself fails", async () => {
		let rejectRun!: (reason: unknown) => void;
		mockInvoke.mockImplementation((cmd: string) =>
			cmd === "run_oneshot"
				? new Promise((_, reject) => {
						rejectRun = reject;
					})
				: Promise.reject(new Error("no such run")),
		);
		const controller = new AbortController();
		const run = runOneShotShaped("p", "/w", "codex", SCHEMA, {
			signal: controller.signal,
		});
		controller.abort();
		await Promise.resolve();
		rejectRun(new Error("killed"));
		expect((await failureOf(run)).kind).toBe("cancelled");
	});

	it("stops listening to the signal once the run is over", async () => {
		mockInvoke.mockResolvedValue({ ok: true });
		const controller = new AbortController();
		await runOneShotShaped("p", "/w", "codex", SCHEMA, {
			signal: controller.signal,
		});
		controller.abort();
		expect(mockInvoke).toHaveBeenCalledTimes(1);
	});

	describe("timeout", () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});

		it("kills the CLI after two minutes by default and reports a failed run", async () => {
			let rejectRun!: (reason: unknown) => void;
			mockInvoke.mockImplementation((cmd: string) =>
				cmd === "run_oneshot"
					? new Promise((_, reject) => {
							rejectRun = reject;
						})
					: Promise.resolve(undefined),
			);
			const run = runOneShotShaped("p", "/w", "codex", SCHEMA);
			vi.advanceTimersByTime(119_999);
			expect(mockInvoke).not.toHaveBeenCalledWith("stop_oneshot", {
				runId: RUN_ID,
			});
			vi.advanceTimersByTime(1);
			expect(mockInvoke).toHaveBeenCalledWith("stop_oneshot", {
				runId: RUN_ID,
			});
			rejectRun(new Error("killed"));
			const error = await failureOf(run);
			expect(error.kind).toBe("runFailed");
			expect(error.detail).toBe("");
		});

		it("honours a custom timeout", async () => {
			mockInvoke.mockImplementation((cmd: string) =>
				cmd === "run_oneshot"
					? new Promise(() => {})
					: Promise.resolve(undefined),
			);
			void runOneShotShaped("p", "/w", "codex", SCHEMA, { timeoutMs: 500 });
			vi.advanceTimersByTime(500);
			expect(mockInvoke).toHaveBeenCalledWith("stop_oneshot", {
				runId: RUN_ID,
			});
		});

		it("arms the timer for the smallest positive timeout", async () => {
			mockInvoke.mockImplementation((cmd: string) =>
				cmd === "run_oneshot"
					? new Promise(() => {})
					: Promise.resolve(undefined),
			);
			void runOneShotShaped("p", "/w", "codex", SCHEMA, { timeoutMs: 1 });
			vi.advanceTimersByTime(1);
			expect(mockInvoke).toHaveBeenCalledWith("stop_oneshot", {
				runId: RUN_ID,
			});
		});

		it("waits forever when the timeout is 0", async () => {
			mockInvoke.mockImplementation(() => new Promise(() => {}));
			void runOneShotShaped("p", "/w", "codex", SCHEMA, { timeoutMs: 0 });
			expect(vi.getTimerCount()).toBe(0);
		});

		it("clears its timer once the run is over", async () => {
			mockInvoke.mockResolvedValue({ ok: true });
			await runOneShotShaped("p", "/w", "codex", SCHEMA);
			expect(vi.getTimerCount()).toBe(0);
		});
	});
});

describe("runOneShot", () => {
	it("asks for the answer schema and returns the trimmed answer", async () => {
		mockInvoke.mockResolvedValue({ answer: "  hello\n" });
		await expect(
			runOneShot("say hi", "/w", "claude-code", { model: "sonnet" }),
		).resolves.toBe("hello");
		expect(mockInvoke).toHaveBeenCalledWith("run_oneshot", {
			request: {
				workingDir: "/w",
				prompt: "say hi",
				schema: ANSWER_SCHEMA,
				runId: RUN_ID,
				provider: "claude-code",
				model: "sonnet",
				binaryPath: null,
				context: "repository",
				env: {},
			},
		});
	});

	it.each([
		["blank", { answer: "  \n " }],
		["missing", {}],
	])("fails the run on a %s answer", async (_label, result) => {
		mockInvoke.mockResolvedValue(result);
		const error = await failureOf(runOneShot("p", "/w", "codex"));
		expect(error.kind).toBe("runFailed");
		expect(error.detail).toBe("");
	});

	it("lets the underlying failure through unchanged", async () => {
		const error = await failureOf(runOneShot("p", "/w", ""));
		expect(error.kind).toBe("unavailable");
		expect(mockInvoke).not.toHaveBeenCalled();
	});
});
