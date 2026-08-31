// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Per-project caches are keyed three ways: by `projectId` alone, by
 * `projectId:instanceId`, and by `projectId:instanceId:commandId`. All three
 * start with the project id, so one prefix rule drops every entry a removed
 * project owns without each store inventing its own matching.
 */
export function belongsToProject(key: string, projectId: string): boolean {
	return key === projectId || key.startsWith(`${projectId}:`);
}

/** The same rule over a plain record, returning a copy without the project's entries. */
export function dropProjectKeys<T>(
	map: Record<string, T>,
	projectId: string,
): Record<string, T> {
	const next: Record<string, T> = {};
	for (const [key, value] of Object.entries(map)) {
		if (!belongsToProject(key, projectId)) next[key] = value;
	}
	return next;
}

/**
 * Drops the project's entries from a `Map` or a `Set`, in place. Timers live in
 * such maps, and a pending write must be cancelled rather than merely
 * forgotten: `write_json_atomic` recreates missing parent directories, so a
 * timer firing after the project directory was removed writes it back.
 */
export function purgeProjectEntries(
	container: Map<string, unknown> | Set<string>,
	projectId: string,
	onEntry?: (value: unknown) => void,
): void {
	for (const key of [...container.keys()]) {
		if (!belongsToProject(key, projectId)) continue;
		if (onEntry && container instanceof Map) onEntry(container.get(key));
		container.delete(key);
	}
}
