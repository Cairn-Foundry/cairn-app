/**
 * The registry of per-project teardowns.
 *
 * `unregisterProject` must clear every cache keyed by the project it removes,
 * but importing each store from `project.ts` would close an import cycle:
 * several of those stores already import `activeProject` from it, and the one
 * loaded first would initialize against a half-built module.
 *
 * So the dependency runs the other way. Each store calls `onProjectRemoved` at
 * module scope, and `unregisterProject` only walks the registry. A store that
 * is never imported registers nothing, which is correct: it holds no state to
 * clear.
 */
type Teardown = (projectId: string) => void | Promise<void>;

const teardowns: Teardown[] = [];

/** Registers a cache teardown, run when a project is removed. */
export function onProjectRemoved(teardown: Teardown): void {
	teardowns.push(teardown);
}

/**
 * Runs every registered teardown. They are awaited in sequence rather than in
 * parallel: closing a terminal is a backend call, and a failure in one store
 * must not leave the rest of the caches populated.
 */
export async function runProjectTeardowns(projectId: string): Promise<void> {
	for (const teardown of teardowns) await teardown(projectId);
}
