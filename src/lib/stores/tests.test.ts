// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { listen } from "@tauri-apps/api/event";
import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runProjectTeardowns } from "#lib/stores/project-teardown";
import type { TestEvent } from "#lib/types/tests";

const getTestState = vi.hoisted(() => vi.fn());
const saveTestState = vi.hoisted(() => vi.fn());
const hasCargoNextest = vi.hoisted(() => vi.fn());
const runTestsService = vi.hoisted(() => vi.fn());
const stopTestsService = vi.hoisted(() => vi.fn());
vi.mock("#lib/services/test-service", () => ({
	getTestState,
	saveTestState,
	hasCargoNextest,
	runTests: runTestsService,
	stopTests: stopTestsService,
}));

const detectTestRunners = vi.hoisted(() => vi.fn());
vi.mock("#lib/utils/tests/test-detect", () => ({ detectTestRunners }));

import {
	disposeTests,
	forgetProject,
	initTests,
	loadTests,
	runTests,
	selectCase,
	selectRunner,
	setFilter,
	setSearch,
	stopTests,
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
		expect(runTestsService).toHaveBeenCalledWith(
			state().activeRunId,
			WORKTREE,
			WORKTREE,
			expect.any(String),
			expect.any(String),
		);
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

describe("runTests when it cannot run", () => {
	it("does nothing when the worktree offers no runner", async () => {
		detectTestRunners.mockResolvedValue([]);
		await loadTests("p1", INSTANCE, WORKTREE);

		await runTests("p1", INSTANCE, WORKTREE);

		expect(runTestsService).not.toHaveBeenCalled();
		expect(state().activeRunId).toBe("");
		expect(state().summary).toBeNull();
	});

	it("runs a runner from its own subdirectory", async () => {
		detectTestRunners.mockResolvedValue([
			{ ...runner("vitest"), subdir: "packages/web" },
		]);
		await loadTests("p1", INSTANCE, WORKTREE);

		await runTests("p1", INSTANCE, WORKTREE);

		expect(runTestsService).toHaveBeenCalledWith(
			state().activeRunId,
			WORKTREE,
			`${WORKTREE}/packages/web`,
			"run vitest",
			"vitest",
		);
	});

	it("reports a run the backend refused to start and frees the instance", async () => {
		await loadTests("p1", INSTANCE, WORKTREE);
		runTestsService.mockRejectedValue(new Error("spawn failed"));

		await runTests("p1", INSTANCE, WORKTREE);

		expect(state().activeRunId).toBe("");
		expect(state().error).toBe("Error: spawn failed");
		expect(state().pending).toEqual([]);
		expect(get(testsBusy)[KEY]).toBe(false);
	});

	it("lets the instance run again after a refused start", async () => {
		await loadTests("p1", INSTANCE, WORKTREE);
		runTestsService.mockRejectedValueOnce(new Error("spawn failed"));
		await runTests("p1", INSTANCE, WORKTREE);

		await runTests("p1", INSTANCE, WORKTREE);

		expect(runTestsService).toHaveBeenCalledTimes(2);
		expect(state().error).toBe("");
		expect(state().activeRunId).not.toBe("");
	});
});

describe("stopTests", () => {
	it("stops the run in flight by its id", async () => {
		await loadTests("p1", INSTANCE, WORKTREE);
		await runTests("p1", INSTANCE, WORKTREE);

		await stopTests("p1", INSTANCE);

		expect(stopTestsService).toHaveBeenCalledTimes(1);
		expect(stopTestsService).toHaveBeenCalledWith(state().activeRunId);
	});

	it("does nothing when no run is going", async () => {
		await loadTests("p1", INSTANCE, WORKTREE);

		await stopTests("p1", INSTANCE);

		expect(stopTestsService).not.toHaveBeenCalled();
	});
});

describe("forgetProject", () => {
	it("drops the state of every instance of the project and keeps the others", async () => {
		await loadTests("pf", "i1", WORKTREE);
		await loadTests("pf", "i2", WORKTREE);
		await loadTests("pg", "i1", WORKTREE);

		forgetProject("pf");

		const keys = Object.keys(get(tests));
		expect(keys).not.toContain("pf:i1");
		expect(keys).not.toContain("pf:i2");
		expect(keys).toContain("pg:i1");
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

	it("ignores a run start announcement", () => {
		const before = state();
		emit({ runId: activeRun(), kind: "run_start" });
		expect(state()).toEqual(before);
	});

	it("shows a file whose suite failed to load, with its message", () => {
		emit({
			runId: activeRun(),
			kind: "suite_error",
			file: "broken.test.ts",
			message: "cannot import",
		});
		expect(state().suites).toEqual([
			{
				file: "broken.test.ts",
				cases: [],
				error: "cannot import",
				status: "fail",
				durationMs: 0,
			},
		]);
	});

	it("ignores a suite error that names no file", () => {
		emit({ runId: activeRun(), kind: "suite_error", message: "orphan" });
		expect(state().suites).toEqual([]);
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

const savedSuite = (file: string) => ({
	file,
	status: "pass",
	durationMs: 0,
	cases: [],
	error: null,
});

const passingCase = (id: string, file: string) => ({
	id,
	name: id,
	ancestors: [],
	file,
	line: null,
	status: "pass" as const,
	durationMs: 1,
	failure: null,
});

async function startRunOverSavedFiles(files: string[]): Promise<string> {
	getTestState.mockResolvedValue({
		runnerId: "vitest",
		suites: files.map(savedSuite),
		summary: null,
		selectedCaseId: "",
		filter: "all",
		search: "",
	});
	await loadTests("p1", INSTANCE, WORKTREE);
	await runTests("p1", INSTANCE, WORKTREE);
	return state().activeRunId;
}

describe("run results over a restored tree", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("shows a reported case while the files not reached yet stay in the list", async () => {
		const run = await startRunOverSavedFiles(["a.test.ts", "b.test.ts"]);

		emit({
			runId: run,
			kind: "case",
			case: passingCase("a1", "a.test.ts"),
		});

		expect(state().suites.map((suite) => suite.file)).toEqual([
			"a.test.ts",
			"b.test.ts",
		]);
		expect(state().suites[0].cases.map((entry) => entry.id)).toEqual(["a1"]);
	});

	it("ignores a case event that carries no case", async () => {
		const run = await startRunOverSavedFiles(["a.test.ts"]);
		const before = state().suites;

		expect(() => emit({ runId: run, kind: "case" })).not.toThrow();

		expect(state().suites).toEqual(before);
	});

	it("drops a file the finished run never reported", async () => {
		const run = await startRunOverSavedFiles(["a.test.ts", "b.test.ts"]);
		emit({ runId: run, kind: "case", case: passingCase("a1", "a.test.ts") });

		emit({ runId: run, kind: "run_end", exitCode: 0 });

		expect(state().suites.map((suite) => suite.file)).toEqual(["a.test.ts"]);
	});

	it("keeps every file when the run was cancelled", async () => {
		const run = await startRunOverSavedFiles(["a.test.ts", "b.test.ts"]);
		emit({ runId: run, kind: "case", case: passingCase("a1", "a.test.ts") });

		emit({ runId: run, kind: "run_end", cancelled: true });

		expect(state().suites.map((suite) => suite.file)).toEqual([
			"a.test.ts",
			"b.test.ts",
		]);
		expect(state().summary?.status).toBe("cancelled");
	});

	it("records a suite error without message as an empty message", async () => {
		const run = await startRunOverSavedFiles([]);

		emit({ runId: run, kind: "suite_error", file: "broken.test.ts" });

		expect(state().suites[0]).toMatchObject({
			file: "broken.test.ts",
			error: "",
		});
	});

	it("records a run error without message as an empty message", async () => {
		const run = await startRunOverSavedFiles([]);

		emit({ runId: run, kind: "error" });

		expect(state().error).toBe("");
	});

	it("ignores a raw event without a line", async () => {
		const run = await startRunOverSavedFiles([]);

		emit({ runId: run, kind: "raw" });
		emit({ runId: run, kind: "raw", line: "" });

		expect(state().rawOutput).toEqual([]);
	});

	it("keeps the exit code null when the run ends without one", async () => {
		const run = await startRunOverSavedFiles([]);

		emit({ runId: run, kind: "run_end" });

		expect(state().summary?.exitCode).toBeNull();
	});

	it("measures the duration from the start of the run", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
		const run = await startRunOverSavedFiles([]);

		vi.setSystemTime(new Date("2026-01-01T00:00:01.500Z"));
		emit({ runId: run, kind: "run_end", exitCode: 0 });

		expect(state().summary?.durationMs).toBe(1500);
	});

	it("does not let a replaced run end the run that took over", async () => {
		const replaced = await startRunOverSavedFiles([]);
		forgetProject("p1");
		await loadTests("p1", INSTANCE, WORKTREE);
		await runTests("p1", INSTANCE, WORKTREE);
		const current = state().activeRunId;
		expect(current).not.toBe(replaced);

		emit({ runId: replaced, kind: "run_end", exitCode: 1 });

		expect(state().activeRunId).toBe(current);
		expect(state().summary?.status).toBe("running");
	});

	it("survives events of a run whose instance was forgotten", async () => {
		const run = await startRunOverSavedFiles([]);
		forgetProject("p1");

		expect(() => emit({ runId: run, kind: "raw", line: "late" })).not.toThrow();

		expect(state().rawOutput).toEqual([]);
	});

	it("creates no state for an event whose run is unknown", () => {
		emit({ runId: "", kind: "raw", line: "orphan" });

		expect(Object.keys(get(tests))).not.toContain("undefined");
	});
});

describe("persisting", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("saves the tree and its summary once a run ends", async () => {
		const run = await startRunOverSavedFiles(["a.test.ts"]);

		emit({ runId: run, kind: "run_end", exitCode: 0 });
		await vi.advanceTimersByTimeAsync(600);

		expect(saveTestState).toHaveBeenCalledWith(
			"p1",
			INSTANCE,
			expect.objectContaining({
				runnerId: "vitest",
				summary: expect.objectContaining({ status: "passed" }),
			}),
		);
	});

	it.each([
		[
			"selectRunner",
			() => selectRunner("p1", INSTANCE, "jest"),
			{ runnerId: "jest" },
		],
		[
			"selectCase",
			() => selectCase("p1", INSTANCE, "c9"),
			{ selectedCaseId: "c9" },
		],
		[
			"setSearch",
			() => setSearch("p1", INSTANCE, "needle"),
			{ search: "needle" },
		],
		[
			"setFilter",
			() => setFilter("p1", INSTANCE, "failed"),
			{ filter: "failed" },
		],
	])("%s saves the preference", async (_name, act, expected) => {
		await loadTests("p1", INSTANCE, WORKTREE);

		act();
		await vi.advanceTimersByTimeAsync(600);

		expect(saveTestState).toHaveBeenCalledWith(
			"p1",
			INSTANCE,
			expect.objectContaining(expected),
		);
	});
});

describe("loadTests restoring the runner", () => {
	it("starts without a selection while detection is still running", async () => {
		let finishDetection: (runners: unknown[]) => void = () => {};
		detectTestRunners.mockReturnValue(
			new Promise((resolve) => {
				finishDetection = resolve;
			}),
		);

		const loading = loadTests("p1", INSTANCE, WORKTREE);
		await vi.waitFor(() => expect(state().detecting).toBe(true));

		expect(state().selectedRunnerId).toBe("");
		expect(state().selectedCaseId).toBe("");
		finishDetection([]);
		await loading;
	});

	it("resolves a runner saved by its bare engine id to its package", async () => {
		detectTestRunners.mockResolvedValue([
			runner("jest"),
			{ ...runner("vitest"), subdir: "packages/web" },
		]);
		getTestState.mockResolvedValue({ runnerId: "vitest", suites: [] });

		await loadTests("p1", INSTANCE, WORKTREE);

		expect(state().selectedRunnerId).toBe("vitest:packages/web");
	});

	it("keeps the saved runner when it is not the first one detected", async () => {
		detectTestRunners.mockResolvedValue([runner("jest"), runner("vitest")]);
		getTestState.mockResolvedValue({ runnerId: "vitest", suites: [] });

		await loadTests("p1", INSTANCE, WORKTREE);

		expect(state().selectedRunnerId).toBe("vitest");
	});
});

describe("run quoting", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	const fileScope = { kind: "file" as const, file: "a.test.ts" };

	async function commandSentFor(platform: string | null): Promise<string> {
		vi.stubGlobal("navigator", platform === null ? undefined : { platform });
		await loadTests("p1", INSTANCE, WORKTREE);
		await runTests("p1", INSTANCE, WORKTREE, fileScope);
		return runTestsService.mock.calls[0][3];
	}

	it("quotes for cmd on Windows", async () => {
		expect(await commandSentFor("Win32")).toBe('run vitest "a.test.ts"');
	});

	it("quotes for a POSIX shell elsewhere", async () => {
		expect(await commandSentFor("MacIntel")).toBe("run vitest 'a.test.ts'");
	});

	it("quotes for a POSIX shell when there is no navigator", async () => {
		expect(await commandSentFor(null)).toBe("run vitest 'a.test.ts'");
	});
});

describe("project removal", () => {
	it("forgets the instances of a removed project", async () => {
		await loadTests("pz", "i1", WORKTREE);

		await runProjectTeardowns("pz");

		expect(Object.keys(get(tests))).not.toContain("pz:i1");
	});
});

describe("disposeTests", () => {
	it("detaches the listener it registered", async () => {
		const off = vi.fn();
		disposeTests();
		vi.mocked(listen).mockImplementation(
			(async () => off) as unknown as typeof listen,
		);
		initTests();
		await Promise.resolve();
		await Promise.resolve();

		disposeTests();

		expect(off).toHaveBeenCalledTimes(1);
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
