// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/** The list of agent CLI providers available to instances. */
import { derived, get, writable } from "svelte/store";
import {
	type CliProviderDef,
	type CliProviderId,
	listCliProviders,
} from "$lib/services/cli-provider-service";
import { aiEnabled } from "$lib/stores/settings";

/** The agent CLIs the backend knows how to drive. Static for the lifetime of the app. */
export const cliProviders = writable<CliProviderDef[]>([]);

/** Loads the provider list once; later calls are no-ops. */
export async function loadCliProviders(): Promise<void> {
	if (get(cliProviders).length > 0) return;
	// A failed detection leaves the list empty rather than undefined: every
	// reader of this store treats "no CLI found" as a normal state, and a next
	// call will try again.
	cliProviders.set((await listCliProviders().catch(() => [])) ?? []);
}

/**
 * Whether one assist CLI can be run: it is installed and the user has not
 * turned AI off. A lookup rather than a boolean because a feature may be
 * assigned any of the CLIs the assists support, and each answers for itself.
 *
 * An assist offered without either only fails at the click, so every assist
 * reads this before offering itself.
 */
export const isAssistCliInstalled = derived(
	[cliProviders, aiEnabled],
	([$providers, $ai]) =>
		(id: string): boolean =>
			$ai && $providers.some((p) => p.id === id && p.installed),
);

/**
 * Whether a CLI is one the assists can be served by. Spelled out here rather
 * than imported from `ai-features`, which would drag the feature registry into
 * every consumer of this store; `ASSIST_CLIS` is the list the UI offers and the
 * two are asserted equal in `ai-features.test.ts`.
 */
function isAssistCli(id: string): boolean {
	return id === "claude-code" || id === "codex";
}

/** Whether any assist CLI at all is usable, for the "nothing works" empty state. */
export const anyAssistCliInstalled = derived(
	[cliProviders, aiEnabled],
	([$providers, $ai]) =>
		$ai && $providers.some((p) => p.installed && isAssistCli(p.id)),
);

/** Display label of a provider, falling back to the raw id for a provider no longer known. */
export function cliProviderLabel(
	id: CliProviderId,
	known: CliProviderDef[],
): string {
	return known.find((p) => p.id === id)?.label ?? id;
}
