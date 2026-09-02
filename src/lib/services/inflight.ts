// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

const inflight = new Map<string, Promise<unknown>>();

/**
 * Shares one in-flight call between callers asking for the same thing: a tree
 * load, a save and the poll all reading the same git status at once used to
 * spawn one process each.
 */
export function dedupeInflight<T>(
	key: string,
	run: () => Promise<T>,
): Promise<T> {
	const existing = inflight.get(key);
	if (existing) return existing as Promise<T>;
	const pending = run().finally(() => inflight.delete(key));
	inflight.set(key, pending);
	return pending;
}

const settled = new Map<string, { value: unknown; at: number }>();

/**
 * Shares a call that has already finished, for a short while. `dedupeInflight`
 * only covers callers that overlap, and it drops the entry on settle - so a
 * hover prefetch that lands before the click is thrown away and the click pays
 * for the read a second time, which is the case the prefetch exists for.
 *
 * The window is meant to span a hover to its click, nothing longer: the value
 * is a snapshot of the disk, and anything stale enough to matter is caught by
 * the poll that follows.
 */
export function shareSettled<T>(
	key: string,
	ttlMs: number,
	run: () => Promise<T>,
): Promise<T> {
	const hit = settled.get(key);
	if (hit && Date.now() - hit.at < ttlMs)
		return Promise.resolve(hit.value as T);
	if (hit) settled.delete(key);
	return dedupeInflight(key, run).then((value) => {
		settled.set(key, { value, at: Date.now() });
		return value;
	});
}

/** Drops a settled entry, for a caller that knows its value is now wrong. */
export function invalidateSettled(key: string): void {
	settled.delete(key);
}
