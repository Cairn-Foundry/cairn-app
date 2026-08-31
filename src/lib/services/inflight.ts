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
