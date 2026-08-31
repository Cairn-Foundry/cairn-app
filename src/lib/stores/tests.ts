// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/** Test runs, per instance: what was detected, what is running, what came back. */
import { listen } from "@tauri-apps/api/event";
import { derived, get, writable } from "svelte/store";
import {
	getTestState,
	hasCargoNextest,
	runTests as runTestsService,
	saveTestState,
	stopTests as stopTestsService,
} from "$lib/services/test-service";
import { onProjectRemoved } from "$lib/stores/project-teardown";
import type {
	TestEvent,
	TestPersistedState,
	TestRunner,
	TestRunSummary,
	TestSuite,
} from "$lib/types/tests";
import { runnerKey } from "$lib/types/tests";
import { dropProjectKeys } from "$lib/utils/project-scope";
import { detectTestRunners } from "$lib/utils/tests/test-detect";
import {
	buildTree,
	observeCase,
	observeSuiteError,
	pendingFiles,
	type RunProgress,
	startRun,
} from "$lib/utils/tests/test-run";
import { type RunScope, scopedCommand } from "$lib/utils/tests/test-scope";
import type { TestFilter } from "$lib/utils/tests/test-search";
import { countCases, resolveRunStatus } from "$lib/utils/tests/test-tree";

export { countCases };

/** Quoting differs between cmd and a POSIX shell; the runner is spawned by the
 * OS Cairn is running on. */
function isWindows(): boolean {
	return (
		typeof navigator !== "undefined" && /Win/.test(navigator.platform ?? "")
	);
}

/** How long the tree may sit unwritten after a run changed it. */
const PERSIST_DEBOUNCE_MS = 500;

export type { TestFilter } from "$lib/utils/tests/test-search";

/** Everything the Tests step shows for one instance. */
export interface InstanceTestState {
	runners: TestRunner[];
	selectedRunnerId: string;
	detecting: boolean;
	suites: TestSuite[];
	summary: TestRunSummary | null;
	activeRunId: string;
	selectedCaseId: string;
	filter: TestFilter;
	search: string;
	/** Files the run in flight has not reported yet; they are still working. */
	pending: string[];
	rawOutput: string[];
	error: string;
}

const EMPTY: InstanceTestState = {
	runners: [],
	selectedRunnerId: "",
	detecting: false,
	suites: [],
	summary: null,
	activeRunId: "",
	selectedCaseId: "",
	filter: "all",
	search: "",
	pending: [],
	rawOutput: [],
	error: "",
};

/** Keeps the raw output bounded: a watch run would grow it without end. */
const RAW_MAX_LINES = 2000;

const _tests = writable<Record<string, InstanceTestState>>({});

/** Read-only outside this module; every mutation goes through the actions below. */
export const tests = { subscribe: _tests.subscribe };

/** The key one instance's state is stored under. */
export function testKey(projectId: string, instanceId: string): string {
	return `${projectId}:${instanceId}`;
}

/** Which instance a run belongs to, since events only carry the run id. */
const runOwners = new Map<string, string>();

/** Where a run should be written back to once it settles. */
const runTargets = new Map<string, { projectId: string; instanceId: string }>();

/** What each run has observed so far; the tree is derived from it. */
const runProgress = new Map<string, RunProgress>();

/** The tree each run started from, so it can be rebuilt on every result. */
const previousTrees = new Map<string, TestSuite[]>();

/** Drops everything a finished run was keeping. */
function forgetRun(runId: string): void {
	runOwners.delete(runId);
	runTargets.delete(runId);
	runProgress.delete(runId);
	previousTrees.delete(runId);
}

export function testStateFor(
	state: Record<string, InstanceTestState>,
	projectId: string,
	instanceId: string,
): InstanceTestState {
	return state[testKey(projectId, instanceId)] ?? EMPTY;
}

function patch(key: string, changes: Partial<InstanceTestState>): void {
	_tests.update((current) => ({
		...current,
		[key]: { ...(current[key] ?? EMPTY), ...changes },
	}));
}

/** True while any run of that instance is in flight. */
export const testsBusy = derived(_tests, ($tests) => {
	const busy: Record<string, boolean> = {};
	for (const [key, state] of Object.entries($tests)) {
		busy[key] = state.activeRunId !== "";
	}
	return busy;
});

/** True when the last finished run of that instance had a failure. */
export const testsFailing = derived(_tests, ($tests) => {
	const failing: Record<string, boolean> = {};
	for (const [key, state] of Object.entries($tests)) {
		failing[key] = state.summary?.status === "failed";
	}
	return failing;
});

const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Debounced, because a run touches the tree once per test. */
function schedulePersist(projectId: string, instanceId: string): void {
	const key = testKey(projectId, instanceId);
	clearTimeout(persistTimers.get(key));
	persistTimers.set(
		key,
		setTimeout(() => {
			persistTimers.delete(key);
			const state = testStateFor(get(_tests), projectId, instanceId);
			const persisted: TestPersistedState = {
				runnerId: state.selectedRunnerId,
				suites: state.suites,
				summary: state.summary,
				selectedCaseId: state.selectedCaseId,
				filter: state.filter,
				search: state.search,
			};
			saveTestState(projectId, instanceId, persisted);
		}, PERSIST_DEBOUNCE_MS),
	);
}

function handleEvent(payload: TestEvent): void {
	const key = runOwners.get(payload.runId);
	if (!key) return;

	const current = get(_tests)[key] ?? EMPTY;
	// Results belong to the run that owns the tree. A superseded run keeps
	// draining - stopping it is not instant - but its late results must not leak
	// into the tree of the run that replaced it.
	const owns = current.activeRunId === payload.runId;
	if (!owns && payload.kind !== "run_end") return;

	const run = runProgress.get(payload.runId);

	switch (payload.kind) {
		case "case":
			if (payload.case && run) {
				observeCase(run, payload.case);
				patch(key, {
					suites: buildTree(previousTrees.get(payload.runId) ?? [], run),
				});
			}
			break;
		case "suite_error":
			if (payload.file && run) {
				observeSuiteError(run, payload.file, payload.message ?? "");
				patch(key, {
					suites: buildTree(previousTrees.get(payload.runId) ?? [], run),
				});
			}
			break;
		case "raw":
			if (payload.line) {
				const raw = [...current.rawOutput, payload.line];
				patch(key, {
					rawOutput:
						raw.length > RAW_MAX_LINES ? raw.slice(-RAW_MAX_LINES) : raw,
				});
			}
			break;
		case "error":
			patch(key, { error: payload.message ?? "" });
			break;
		case "run_end": {
			// Pruning happens here and only here: while the run is going, a silent
			// file may simply not have been reached yet. A cancelled run prunes
			// nothing, since its silence proves nothing.
			const previous = previousTrees.get(payload.runId) ?? current.suites;
			const suites = run
				? buildTree(previous, run, payload.cancelled !== true)
				: current.suites;
			const counts = countCases(suites);
			const summary: TestRunSummary | null = current.summary && {
				...current.summary,
				finishedAt: new Date().toISOString(),
				status: resolveRunStatus(
					counts,
					payload.exitCode ?? null,
					payload.cancelled === true,
					suites.length,
				),
				counts,
				exitCode: payload.exitCode ?? null,
				durationMs: Date.now() - Date.parse(current.summary.startedAt),
			};
			if (owns) {
				patch(key, { summary, activeRunId: "", suites, pending: [] });
				const target = runTargets.get(payload.runId);
				if (target) schedulePersist(target.projectId, target.instanceId);
			}
			forgetRun(payload.runId);
			break;
		}
		default:
			break;
	}
}

let unlisten: (() => void)[] = [];

/** Subscribes to the backend test events, once; call disposeTests() to unsubscribe. */
export function initTests(): void {
	if (unlisten.length > 0) return;
	void listen<TestEvent>("test-output", ({ payload }) =>
		handleEvent(payload),
	).then((off) => unlisten.push(off));
}

/** Detaches the event listeners. */
export function disposeTests(): void {
	for (const off of unlisten) off();
	unlisten = [];
}

/** Restores the last run of an instance, then detects what it can run. */
export async function loadTests(
	projectId: string,
	instanceId: string,
	worktreePath: string,
): Promise<void> {
	const key = testKey(projectId, instanceId);
	const saved = await getTestState(projectId, instanceId);
	patch(key, {
		suites: saved?.suites ?? [],
		summary: saved?.summary ?? null,
		selectedCaseId: saved?.selectedCaseId ?? "",
		filter: (saved?.filter as TestFilter) ?? "all",
		search: saved?.search ?? "",
		selectedRunnerId: saved?.runnerId ?? "",
		detecting: true,
		error: "",
	});

	const nextest = await hasCargoNextest(worktreePath);
	const runners = await detectTestRunners(worktreePath, nextest);
	const current = testStateFor(get(_tests), projectId, instanceId);
	// A state saved before runners were keyed by directory holds a bare engine
	// id; it still resolves, to the first package exposing that engine.
	const savedId = current.selectedRunnerId;
	const restored =
		runners.find((runner) => runnerKey(runner) === savedId) ??
		runners.find((runner) => runner.id === savedId);
	patch(key, {
		runners,
		detecting: false,
		selectedRunnerId: restored
			? runnerKey(restored)
			: runners[0]
				? runnerKey(runners[0])
				: "",
	});
}

export function selectRunner(
	projectId: string,
	instanceId: string,
	runnerId: string,
): void {
	patch(testKey(projectId, instanceId), { selectedRunnerId: runnerId });
	schedulePersist(projectId, instanceId);
}

export function selectCase(
	projectId: string,
	instanceId: string,
	caseId: string,
): void {
	patch(testKey(projectId, instanceId), { selectedCaseId: caseId });
	schedulePersist(projectId, instanceId);
}

export function setSearch(
	projectId: string,
	instanceId: string,
	search: string,
): void {
	patch(testKey(projectId, instanceId), { search });
	schedulePersist(projectId, instanceId);
}

export function setFilter(
	projectId: string,
	instanceId: string,
	filter: TestFilter,
): void {
	patch(testKey(projectId, instanceId), { filter });
	schedulePersist(projectId, instanceId);
}

/** Starts a run over the whole worktree. Refuses while one is already going. */
export async function runTests(
	projectId: string,
	instanceId: string,
	worktreePath: string,
	scope: RunScope = { kind: "all" },
): Promise<void> {
	const key = testKey(projectId, instanceId);
	const current = testStateFor(get(_tests), projectId, instanceId);
	if (current.activeRunId) return;

	const runner = current.runners.find(
		(entry) => runnerKey(entry) === current.selectedRunnerId,
	);
	if (!runner) return;

	const runId = crypto.randomUUID();
	runOwners.set(runId, key);
	runTargets.set(runId, { projectId, instanceId });
	runProgress.set(runId, startRun(scope));
	// The tree the run started from: it stays on screen, so a file still working
	// shows as pending instead of the list blanking out, and each file gives way
	// as it reports.
	previousTrees.set(runId, current.suites);

	patch(key, {
		activeRunId: runId,
		suites: current.suites,
		pending: [...pendingFiles(current.suites, startRun(scope))],
		rawOutput: [],
		error: "",
		summary: {
			runId,
			runnerId: runner.id,
			startedAt: new Date().toISOString(),
			finishedAt: null,
			status: "running",
			counts: { pass: 0, fail: 0, skip: 0, todo: 0, total: 0 },
			durationMs: null,
			exitCode: null,
		},
	});

	const cwd = runner.subdir ? `${worktreePath}/${runner.subdir}` : worktreePath;
	try {
		const command = scopedCommand(
			runner.command,
			runner.id,
			scope,
			isWindows(),
		);
		await runTestsService(runId, worktreePath, cwd, command, runner.id);
	} catch (error) {
		patch(key, { activeRunId: "", error: String(error), pending: [] });
		forgetRun(runId);
	}
}

/** Stops the run in flight; the backend answers with a cancelled `run_end`. */
export async function stopTests(
	projectId: string,
	instanceId: string,
): Promise<void> {
	const current = testStateFor(get(_tests), projectId, instanceId);
	if (!current.activeRunId) return;
	await stopTestsService(current.activeRunId);
}

/** Forgets the test state of every instance of a removed project. */
export function forgetProject(projectId: string): void {
	_tests.update((m) => dropProjectKeys(m, projectId));
}

onProjectRemoved(forgetProject);
