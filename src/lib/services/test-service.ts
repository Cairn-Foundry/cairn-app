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
 * events carrying the same `runId`.
 */
export async function runTests(
	runId: string,
	worktreePath: string,
	command: string,
	runnerId: string,
): Promise<void> {
	return invoke<void>("run_tests", { runId, worktreePath, command, runnerId });
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
