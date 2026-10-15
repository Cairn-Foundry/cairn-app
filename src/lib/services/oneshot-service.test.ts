// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runOneshot, stopOneshot } from "./oneshot-service";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
	mockInvoke.mockReset();
	mockInvoke.mockResolvedValue(undefined);
});

describe("runOneshot", () => {
	it("sends nulls and an empty env for what was left out", async () => {
		mockInvoke.mockResolvedValue({ answer: "x" });
		const schema = { type: "object" };
		await expect(runOneshot("/w", "prompt", schema, "run-1")).resolves.toEqual({
			answer: "x",
		});
		expect(mockInvoke).toHaveBeenCalledWith("run_oneshot", {
			request: {
				workingDir: "/w",
				prompt: "prompt",
				schema,
				runId: "run-1",
				provider: null,
				model: null,
				binaryPath: null,
				env: {},
				context: "repository",
			},
		});
	});

	it("forwards the provider, model, binary and env it was given", async () => {
		await runOneshot(
			"/w",
			"prompt",
			{},
			"run-2",
			"codex",
			"gpt",
			"/bin/codex",
			{ KEY: "v" },
		);
		expect(mockInvoke).toHaveBeenCalledWith("run_oneshot", {
			request: {
				workingDir: "/w",
				prompt: "prompt",
				schema: {},
				runId: "run-2",
				provider: "codex",
				model: "gpt",
				binaryPath: "/bin/codex",
				env: { KEY: "v" },
				context: "repository",
			},
		});
	});

	/** The tier a call site asks for has to survive the trip to the command. */
	it("carries the tier the caller asked for", async () => {
		await runOneshot(
			"/w",
			"prompt",
			{},
			"run-3",
			undefined,
			undefined,
			undefined,
			{},
			"prompt",
		);
		expect(mockInvoke).toHaveBeenCalledWith(
			"run_oneshot",
			expect.objectContaining({
				request: expect.objectContaining({ context: "prompt" }),
			}),
		);
	});
});

describe("stopOneshot", () => {
	it("stops the run by its id", async () => {
		await expect(stopOneshot("run-1")).resolves.toBeUndefined();
		expect(mockInvoke).toHaveBeenCalledWith("stop_oneshot", { runId: "run-1" });
	});
});
