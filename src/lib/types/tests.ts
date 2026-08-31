// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/** The Tests step domain: a runner, what it produced, and how a single case failed. */

export type TestStatus =
	| "pass"
	| "fail"
	| "skip"
	| "todo"
	| "running"
	| "pending";

/** The test frameworks Cairn knows how to launch and parse. */
export type TestRunnerId =
	| "vitest"
	| "jest"
	| "cargo"
	| "nextest"
	| "pytest"
	| "go";

/** One way to run tests in a worktree, as offered by the detection. */
export interface TestRunner {
	id: TestRunnerId;
	label: string;
	/** The shell command, already composed for the detected package manager. */
	command: string;
	/** Relative to the worktree, empty at its root. */
	subdir: string;
	/** What made the detection pick this runner, shown to explain the choice. */
	detectedFrom: string;
}

/**
 * What identifies a runner in the UI and in the persisted state. A monorepo can
 * expose the same engine in several packages, so the engine id alone would make
 * two Vitest packages indistinguishable - the directory is part of the identity.
 */
export function runnerKey(runner: Pick<TestRunner, "id" | "subdir">): string {
	return runner.subdir ? `${runner.id}:${runner.subdir}` : runner.id;
}

/** A frame of a failure's stack; frames outside the project are collapsed. */
export interface StackFrame {
	file: string;
	line: number;
	column: number;
	inProject: boolean;
}

/** Why a case failed, as much as the runner was willing to say. */
export interface TestFailure {
	message: string;
	expected: string | null;
	received: string | null;
	stack: StackFrame[];
	location: { file: string; line: number; column: number } | null;
}

/**
 * `id` is `file::ancestors>name` and must stay stable across runs: it is what
 * keeps the selection and the tree's collapse state when a run is replayed.
 */
export interface TestCase {
	id: string;
	name: string;
	ancestors: string[];
	file: string;
	line: number | null;
	status: TestStatus;
	durationMs: number | null;
	failure: TestFailure | null;
}

/** Every case of one file, plus the collect error when the file never loaded. */
export interface TestSuite {
	file: string;
	status: TestStatus;
	durationMs: number | null;
	cases: TestCase[];
	error: string | null;
}

/** How a whole run went; `status` stays `running` until the process exits. */
export interface TestRunSummary {
	runId: string;
	runnerId: TestRunnerId;
	startedAt: string;
	finishedAt: string | null;
	status: "running" | "passed" | "failed" | "cancelled" | "error";
	counts: {
		pass: number;
		fail: number;
		skip: number;
		todo: number;
		total: number;
	};
	durationMs: number | null;
	exitCode: number | null;
}

/** The kinds of `test-output` event the Rust side streams during a run. */
export type TestEventKind =
	| "run_start"
	| "case"
	| "suite_error"
	| "run_end"
	| "error"
	| "raw";

/** One `test-output` payload; `runId` is what routes it to the right instance. */
export interface TestEvent {
	runId: string;
	kind: TestEventKind;
	case?: TestCase;
	file?: string;
	message?: string;
	line?: string;
	exitCode?: number | null;
	cancelled?: boolean;
}

/** What the Tests step reopens on, persisted per instance. */
export interface TestPersistedState {
	runnerId: string;
	suites: TestSuite[];
	summary: TestRunSummary | null;
	selectedCaseId: string;
	filter: string;
	search: string;
}
