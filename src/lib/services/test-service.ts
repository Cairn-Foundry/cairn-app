// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Running a project's tests and reading back what the runner said.
// Only this layer calls invoke().

import { invoke } from "@tauri-apps/api/core";
import type { TestPersistedState } from "$lib/types/tests";

/** Whether `cargo nextest` is installed, which decides how cargo is invoked. */
export async function hasCargoNextest(worktreePath: string): Promise<boolean> {
	try {
		return await invoke<boolean>("has_cargo_nextest", { worktreePath });
	} catch {
		return false;
	}
}

/**
 * Resolves when the run is over; results arrive meanwhile as `test-output`
 * events carrying the same `runId`. `cwd` is where the command actually runs
 * (the worktree plus the runner's subdir, when it has one); `worktreePath`
 * stays the true root, so a file path the runner reports relative to its own
 * `cwd` is turned back into one relative to the worktree the editor opens
 * against.
 */
export async function runTests(
	runId: string,
	worktreePath: string,
	cwd: string,
	command: string,
	runnerId: string,
): Promise<void> {
	return invoke<void>("run_tests", {
		runId,
		worktreePath,
		cwd,
		command,
		runnerId,
	});
}

/** Kills exactly one run; a run that already ended is a no-op. */
export async function stopTests(runId: string): Promise<void> {
	return invoke<void>("stop_tests", { runId });
}

/** Null when the instance has never run its tests. */
export async function getTestState(
	projectId: string,
	instanceId: string,
): Promise<TestPersistedState | null> {
	try {
		return await invoke<TestPersistedState | null>("get_test_state", {
			projectId,
			instanceId,
		});
	} catch {
		return null;
	}
}

/** Fire and forget: a lost write only costs the restored result. */
export function saveTestState(
	projectId: string,
	instanceId: string,
	state: TestPersistedState,
): void {
	invoke("save_test_state", { projectId, instanceId, state }).catch(() => {});
}
