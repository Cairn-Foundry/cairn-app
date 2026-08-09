import { get, writable } from "svelte/store";
import {
	type AgentMigrationOutcome,
	listNativeAgents,
	migrateCustomAgents,
	type NativeAgent,
} from "$lib/services/native-agent-service";
import { projects } from "$lib/stores/project";

export const nativeAgents = writable<NativeAgent[]>([]);
export const nativeAgentsLoading = writable(false);
export const nativeAgentsError = writable("");

/**
 * The outcome of the one-shot migration from the agents Cairn used to keep, so
 * the section can report what moved and what it had to leave alone. Cleared
 * once the user has seen it.
 */
export const agentMigration = writable<AgentMigrationOutcome | null>(null);

export async function loadNativeAgents(): Promise<void> {
	nativeAgentsLoading.set(true);
	nativeAgentsError.set("");
	try {
		const known = get(projects).map((p) => ({
			id: p.id,
			name: p.name,
			path: p.path,
		}));
		nativeAgents.set(await listNativeAgents(known));
	} catch (e) {
		nativeAgentsError.set(String(e));
	} finally {
		nativeAgentsLoading.set(false);
	}
}

/**
 * Runs before the first listing so the migrated definitions are in the scan.
 * A failure here must not hide the agents already on disk, so it is swallowed
 * into the outcome rather than raised.
 */
export async function migrateThenLoadNativeAgents(): Promise<void> {
	try {
		const outcome = await migrateCustomAgents();
		if (outcome.ran) agentMigration.set(outcome);
	} catch {
		// A migration that cannot run leaves the legacy file where it is; the
		// definitions already on disk are still worth listing.
	}
	await loadNativeAgents();
}
