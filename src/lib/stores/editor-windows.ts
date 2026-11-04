// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { get, writable } from "svelte/store";
import type { TabPayload } from "#lib/utils/files/tab-transfer";

/**
 * Tabs that came back to the main window from a detached one, waiting for the
 * editor. The root page switches to their project first; the editor takes the
 * ones that belong to the scope it shows and leaves the rest queued.
 */
export const incomingTabs = writable<TabPayload[]>([]);

export function queueIncomingTabs(tabs: TabPayload[]): void {
	if (tabs.length > 0) incomingTabs.update((queue) => [...queue, ...tabs]);
}

/** Removes and returns the queued tabs `accept` takes. */
export function takeIncomingTabs(
	accept: (tab: TabPayload) => boolean,
): TabPayload[] {
	const taken = get(incomingTabs).filter(accept);
	if (taken.length > 0)
		incomingTabs.update((queue) => queue.filter((tab) => !taken.includes(tab)));
	return taken;
}
