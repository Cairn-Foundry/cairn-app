import { get, writable } from "svelte/store";
import {
	appendUsageEntries,
	backfillUsageEntries,
	clearUsageEntries,
	getUsageEntries,
	type UsageEntry,
} from "$lib/services/usage-service";

export const usageEntries = writable<UsageEntry[]>([]);
export const usageLoaded = writable(false);

/**
 * Turns queued while a write is already in flight. The ledger is one file, so
 * two concurrent appends would race and one would be lost; batching also keeps
 * a burst of parallel runs to a single write.
 */
let pending: UsageEntry[] = [];
let flushing = false;

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
	void flush();
}

/** Recovers the turns already on disk that the ledger never saw. */
export async function backfillUsage(): Promise<number> {
	const added = await backfillUsageEntries();
	if (added > 0) await loadUsage();
	return added;
}

export async function clearUsage(): Promise<void> {
	await clearUsageEntries();
	pending = [];
	usageEntries.set([]);
}

export function usageCount(): number {
	return get(usageEntries).length;
}

export type { UsageEntry };
