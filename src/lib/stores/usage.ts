/** Token usage ledger: every agent turn recorded, appended to disk in batches. */
import { get, writable } from "svelte/store";
import {
	appendUsageEntries,
	backfillUsageEntries,
	clearUsageEntries,
	getUsageEntries,
	type UsageEntry,
} from "$lib/services/usage-service";
import { reportPersistError } from "$lib/utils/persist-error";

/** The token ledger, kept sorted by timestamp. Written only through recordUsage(). */
export const usageEntries = writable<UsageEntry[]>([]);

/** False until loadUsage() has run once, so the UI can tell "empty" from "not read yet". */
export const usageLoaded = writable(false);

/**
 * Turns queued while a write is already in flight. The ledger is one file, so
 * two concurrent appends would race and one would be lost; batching also keeps
 * a burst of parallel runs to a single write.
 */
let pending: UsageEntry[] = [];
let flushing = false;

/** Drains the queue one batch at a time; re-entrant calls return immediately. */
async function flush(): Promise<void> {
	if (flushing) return;
	flushing = true;
	try {
		while (pending.length > 0) {
			const batch = pending;
			pending = [];
			await appendUsageEntries(batch);
		}
	} finally {
		flushing = false;
	}
}

/** Reads the whole ledger from disk, replacing whatever is in memory. */
export async function loadUsage(): Promise<void> {
	usageEntries.set(await getUsageEntries());
	usageLoaded.set(true);
}

/**
 * Records what a turn consumed. Called once per answer, from the one place the
 * providers report usage, so nothing else has to know the ledger exists.
 */
export function recordUsage(entry: UsageEntry): void {
	usageEntries.update((list) =>
		list.some((e) => e.id === entry.id)
			? list
			: [...list, entry].sort((a, b) => a.ts - b.ts),
	);
	pending.push(entry);
	flush().catch((e) => reportPersistError("the usage ledger", e));
}

/** Recovers the turns already on disk that the ledger never saw. */
export async function backfillUsage(): Promise<number> {
	const added = await backfillUsageEntries();
	if (added > 0) await loadUsage();
	return added;
}

/** Wipes the ledger on disk and in memory, dropping anything still queued. */
export async function clearUsage(): Promise<void> {
	await clearUsageEntries();
	pending = [];
	usageEntries.set([]);
}

/** Non-reactive count, for callers that only need a number once. */
export function usageCount(): number {
	return get(usageEntries).length;
}

export type { UsageEntry };
