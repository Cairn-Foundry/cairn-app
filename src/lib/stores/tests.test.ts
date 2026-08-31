// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { listen } from "@tauri-apps/api/event";
import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TestEvent } from "$lib/types/tests";

const getTestState = vi.hoisted(() => vi.fn());
const saveTestState = vi.hoisted(() => vi.fn());
const hasCargoNextest = vi.hoisted(() => vi.fn());
const runTestsService = vi.hoisted(() => vi.fn());
const stopTestsService = vi.hoisted(() => vi.fn());
vi.mock("$lib/services/test-service", () => ({
	getTestState,
	saveTestState,
	hasCargoNextest,
	runTests: runTestsService,
	stopTests: stopTestsService,
}));

const detectTestRunners = vi.hoisted(() => vi.fn());
vi.mock("$lib/utils/tests/test-detect", () => ({ detectTestRunners }));

import {
	disposeTests,
	initTests,
	loadTests,
	runTests,
	selectCase,
	selectRunner,
	setFilter,
	setSearch,
	testKey,
	testStateFor,
	tests,
	testsBusy,
	testsFailing,
} from "./tests";

const WORKTREE = "/worktrees/p1/i1";

// The store keeps one entry per instance for the life of the module, so each
// test works on an instance id no earlier test touched.
let nextInstance = 0;
let INSTANCE = "i1";
let KEY = testKey("p1", INSTANCE);

/** A runner as detection reports it. */
const runner = (id: string) => ({
	id,
	label: id,
	command: `run ${id}`,
	subdir: "",
	detectedFrom: "package.json",
});

/** The state of p1:i1 as the Tests step reads it. */
const state = () => testStateFor(get(tests), "p1", INSTANCE);

/** The handler the store registered on the backend event stream. */
let emit: (event: TestEvent) => void;

beforeEach(async () => {
	vi.clearAllMocks();
	getTestState.mockResolvedValue(null);
	saveTestState.mockResolvedValue(undefined);
	hasCargoNextest.mockResolvedValue(false);
	detectTestRunners.mockResolvedValue([runner("vitest")]);
	runTestsService.mockResolvedValue(undefined);
	stopTestsService.mockResolvedValue(undefined);

	disposeTests();
	vi.mocked(listen).mockImplementation((async (
		_name: string,
		handler: (e: { payload: TestEvent }) => void,
	) => {
		emit = (event) => handler({ payload: event });
		return () => {};
	}) as unknown as typeof listen);
	initTests();
	await vi.waitFor(() => expect(emit).toBeTypeOf("function"));

	INSTANCE = `i${nextInstance++}`;
	KEY = testKey("p1", INSTANCE);
});

afterEach(() => {
	disposeTests();
});

describe("testKey", () => {
	it("keys the state by project and instance", () => {
		expect(testKey("p", "i")).toBe("p:i");
	});
});

describe("loadTests", () => {
	it("detects what the worktree can run", async () => {
		await loadTests("p1", INSTANCE, WORKTREE);
		expect(state().runners.map((r) => r.id)).toEqual(["vitest"]);
		expect(state().detecting).toBe(false);
	});

	it("restores the tree of the last run", async () => {
		getTestState.mockResolvedValue({
			runnerId: "vitest",
			suites: [{ id: "s1", name: "suite", cases: [], file: "a.test.ts" }],
			summary: null,
			selectedCaseId: "c1",
			filter: "failed",
			search: "auth",
		});
		await loadTests("p1", INSTANCE, WORKTREE);
		expect(state().suites).toHaveLength(1);
		expect(state()).toMatchObject({
			selectedCaseId: "c1",
			filter: "failed",
			search: "auth",
		});
	});

	it("starts empty when nothing was saved", async () => {
		await loadTests("p1", INSTANCE, WORKTREE);
		expect(state()).toMatchObject({
			suites: [],
			summary: null,
			filter: "all",
			search: "",
		});
	});

	it("keeps the saved runner when detection still offers it", async () => {
		getTestState.mockResolvedValue({ runnerId: "vitest", suites: [] });
		await loadTests("p1", INSTANCE, WORKTREE);
		expect(state().selectedRunnerId).toBe("vitest");
	});

	it("falls back to the first runner when the saved one is gone", async () => {
		getTestState.mockResolvedValue({ runnerId: "jest", suites: [] });
		await loadTests("p1", INSTANCE, WORKTREE);
		expect(state().selectedRunnerId).toBe("vitest");
	});

	it("selects nothing when the worktree runs no tests", async () => {
		detectTestRunners.mockResolvedValue([]);
		await loadTests("p1", INSTANCE, WORKTREE);
		expect(state().selectedRunnerId).toBe("");
		expect(state().runners).toEqual([]);
	});

	it("keeps instances apart", async () => {
		await loadTests("p1", INSTANCE, WORKTREE);
		detectTestRunners.mockResolvedValue([runner("jest")]);
		await loadTests("p1", "i2", "/worktrees/p1/i2");
		expect(state().runners.map((r) => r.id)).toEqual(["vitest"]);
		expect(
			testStateFor(get(tests), "p1", "i2").runners.map((r) => r.id),
		).toEqual(["jest"]);
	});
});

describe("runTests", () => {
	beforeEach(async () => {
		await loadTests("p1", INSTANCE, WORKTREE);
	});

	it("starts a run and records it as active", async () => {
		await runTests("p1", INSTANCE, WORKTREE);
		expect(runTestsService).toHaveBeenCalled();
		expect(state().activeRunId).not.toBe("");
	});

	it("refuses a second run while one is going", async () => {
		await runTests("p1", INSTANCE, WORKTREE);
		await runTests("p1", INSTANCE, WORKTREE);
		expect(runTestsService).toHaveBeenCalledTimes(1);
	});

	it("clears the previous error when a run starts", async () => {
		await runTests("p1", INSTANCE, WORKTREE);
		emit({ runId: state().activeRunId, kind: "error", message: "boom" });
		expect(state().error).toBe("boom");
		emit({ runId: state().activeRunId, kind: "run_end", exitCode: 1 });
		await runTests("p1", INSTANCE, WORKTREE);
		expect(state().error).toBe("");
	});
});

describe("testsBusy", () => {
	it("reports an instance whose run is in flight", async () => {
		await loadTests("p1", INSTANCE, WORKTREE);
		await runTests("p1", INSTANCE, WORKTREE);
		expect(get(testsBusy)[KEY]).toBe(true);
	});

	it("stops reporting it once the run ends", async () => {
		await loadTests("p1", INSTANCE, WORKTREE);
		await runTests("p1", INSTANCE, WORKTREE);
		emit({ runId: state().activeRunId, kind: "run_end", exitCode: 0 });
		expect(get(testsBusy)[KEY]).toBe(false);
	});
});

describe("handling backend events", () => {
	beforeEach(async () => {
		await loadTests("p1", INSTANCE, WORKTREE);
		await runTests("p1", INSTANCE, WORKTREE);
	});

	const activeRun = () => state().activeRunId;

	it("collects the raw output", () => {
		emit({ runId: activeRun(), kind: "raw", line: "PASS a.test.ts" });
		expect(state().rawOutput).toEqual(["PASS a.test.ts"]);
	});

	it("appends further output in order", () => {
		emit({ runId: activeRun(), kind: "raw", line: "one" });
		emit({ runId: activeRun(), kind: "raw", line: "two" });
		expect(state().rawOutput).toEqual(["one", "two"]);
	});

	it("bounds the raw output, so a watch run cannot grow it forever", () => {
		const run = activeRun();
		for (let i = 0; i < 2100; i++) {
			emit({ runId: run, kind: "raw", line: `line ${i}` });
		}
		expect(state().rawOutput).toHaveLength(2000);
		expect(state().rawOutput.at(-1)).toBe("line 2099");
		expect(state().rawOutput[0]).toBe("line 100");
	});

	it("surfaces a run error", () => {
		emit({ runId: activeRun(), kind: "error", message: "runner crashed" });
		expect(state().error).toBe("runner crashed");
	});

	it("closes the run and writes a summary at the end", () => {
		emit({ runId: activeRun(), kind: "run_end", exitCode: 0 });
		expect(state().activeRunId).toBe("");
		expect(state().summary).not.toBeNull();
	});

	it("clears the pending files once the run is over", () => {
		emit({ runId: activeRun(), kind: "run_end", exitCode: 0 });
		expect(state().pending).toEqual([]);
	});

	it("ignores an event for a run nobody owns", () => {
		emit({ runId: "not-a-run", kind: "raw", line: "orphan" });
		expect(state().rawOutput).toEqual([]);
	});

	/**
	 * A superseded run keeps draining - stopping it is not instant - but its
	 * late results must not leak into the tree of the run that replaced it.
	 */
	it("drops the late output of a run that was replaced", async () => {
		const first = activeRun();
		emit({ runId: first, kind: "run_end", exitCode: 0 });
		await runTests("p1", INSTANCE, WORKTREE);
		emit({ runId: first, kind: "raw", line: "from the old run" });
		expect(state().rawOutput).not.toContain("from the old run");
	});

	it("still lets a replaced run report that it ended", async () => {
		const first = activeRun();
		emit({ runId: first, kind: "run_end", exitCode: 0 });
		await runTests("p1", INSTANCE, WORKTREE);
		const second = activeRun();
		emit({ runId: first, kind: "run_end", exitCode: 1 });
		expect(state().activeRunId).toBe(second);
	});
});

describe("testsFailing", () => {
	/**
	 * A non-zero exit with no suite at all is an `error`, not a `failed`: the
	 * runner never got to run anything, which is a different thing from a test
	 * that failed. Only a real failing case turns the badge on.
	 */
	it("reports an instance whose last run had a failing case", async () => {
		await loadTests("p1", INSTANCE, WORKTREE);
		await runTests("p1", INSTANCE, WORKTREE);
		const run = state().activeRunId;
		emit({
			runId: run,
			kind: "case",
			case: {
				id: "c1",
				name: "fails",
				ancestors: [],
				file: "a.test.ts",
				line: null,
				status: "fail",
				durationMs: 1,
				failure: null,
			},
		});
		emit({ runId: run, kind: "run_end", exitCode: 1 });
		expect(state().summary?.status).toBe("failed");
		expect(get(testsFailing)[KEY]).toBe(true);
	});

	it("calls a run that could not start an error, not a failure", async () => {
		await loadTests("p1", INSTANCE, WORKTREE);
		await runTests("p1", INSTANCE, WORKTREE);
		emit({ runId: state().activeRunId, kind: "run_end", exitCode: 1 });
		expect(state().summary?.status).toBe("error");
		expect(get(testsFailing)[KEY]).toBe(false);
	});

	it("says nothing about an instance that never ran", () => {
		expect(get(testsFailing)["p1:never"]).toBeUndefined();
	});
});

describe("view preferences", () => {
	beforeEach(async () => {
		await loadTests("p1", INSTANCE, WORKTREE);
	});

	it("records the selected runner", () => {
		selectRunner("p1", INSTANCE, "jest");
		expect(state().selectedRunnerId).toBe("jest");
	});

	it("records the selected case", () => {
		selectCase("p1", INSTANCE, "c1");
		expect(state().selectedCaseId).toBe("c1");
	});

	it("records the search text", () => {
		setSearch("p1", INSTANCE, "auth");
		expect(state().search).toBe("auth");
	});

	it("records the filter", () => {
		setFilter("p1", INSTANCE, "failed");
		expect(state().filter).toBe("failed");
	});

	it("persists the preferences, debounced", async () => {
		vi.useFakeTimers();
		setFilter("p1", INSTANCE, "failed");
		setSearch("p1", INSTANCE, "auth");
		expect(saveTestState).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(600);
		expect(saveTestState).toHaveBeenCalledTimes(1);
		expect(saveTestState.mock.calls[0][2]).toMatchObject({
			filter: "failed",
			search: "auth",
		});
		vi.useRealTimers();
	});
});

describe("initTests", () => {
	it("subscribes once, however often it is called", () => {
		const before = vi.mocked(listen).mock.calls.length;
		initTests();
		initTests();
		expect(vi.mocked(listen).mock.calls.length).toBe(before);
	});
});
