// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TestPersistedState } from "#lib/types/tests";
import {
	getTestState,
	hasCargoNextest,
	runTests,
	saveTestState,
	stopTests,
} from "./test-service";

const mockInvoke = vi.mocked(invoke);

const state: TestPersistedState = {
	runnerId: "cargo",
	suites: [],
	summary: null,
	selectedCaseId: "",
	filter: "all",
	search: "",
};

beforeEach(() => {
	mockInvoke.mockReset();
});

describe("hasCargoNextest", () => {
	it("forwards the worktree and returns the answer", async () => {
		mockInvoke.mockResolvedValue(true);
		await expect(hasCargoNextest("/wt")).resolves.toBe(true);
		expect(mockInvoke).toHaveBeenCalledWith("has_cargo_nextest", {
			worktreePath: "/wt",
		});
	});

	it("is false when the probe fails", async () => {
		mockInvoke.mockRejectedValue(new Error("boom"));
		await expect(hasCargoNextest("/wt")).resolves.toBe(false);
	});
});

describe("runTests", () => {
	it("forwards every argument of the run", async () => {
		mockInvoke.mockResolvedValue(undefined);
		await runTests("run-1", "/wt", "/wt/app", "cargo test", "cargo");
		expect(mockInvoke).toHaveBeenCalledWith("run_tests", {
			runId: "run-1",
			worktreePath: "/wt",
			cwd: "/wt/app",
			command: "cargo test",
			runnerId: "cargo",
		});
	});

	it("rejects when the backend rejects", async () => {
		mockInvoke.mockRejectedValue("failed");
		await expect(runTests("r", "/w", "/w", "c", "x")).rejects.toBe("failed");
	});
});

describe("stopTests", () => {
	it("kills the run by id", async () => {
		mockInvoke.mockResolvedValue(undefined);
		await stopTests("run-1");
		expect(mockInvoke).toHaveBeenCalledWith("stop_tests", { runId: "run-1" });
	});
});

describe("getTestState", () => {
	it("returns the persisted state", async () => {
		mockInvoke.mockResolvedValue(state);
		await expect(getTestState("p", "i")).resolves.toEqual(state);
		expect(mockInvoke).toHaveBeenCalledWith("get_test_state", {
			projectId: "p",
			instanceId: "i",
		});
	});

	it("is null when the read fails", async () => {
		mockInvoke.mockRejectedValue(new Error("boom"));
		await expect(getTestState("p", "i")).resolves.toBeNull();
	});
});

describe("saveTestState", () => {
	it("forwards the state", () => {
		mockInvoke.mockResolvedValue(undefined);
		saveTestState("p", "i", state);
		expect(mockInvoke).toHaveBeenCalledWith("save_test_state", {
			projectId: "p",
			instanceId: "i",
			state,
		});
	});

	it("swallows a failed write", async () => {
		mockInvoke.mockRejectedValue(new Error("boom"));
		expect(() => saveTestState("p", "i", state)).not.toThrow();
		await Promise.resolve();
	});
});
