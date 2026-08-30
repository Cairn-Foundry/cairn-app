/** The list of agent CLI providers available to instances. */
import { derived, get, writable } from "svelte/store";
import {
	CLAUDE_CODE,
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
 * Whether the headless assists can run at all: the CLI they use is installed
 * and the user has not turned AI off. An assist offered without either only
 * fails at the click, so every assist reads this before offering itself.
 */
export const assistCliInstalled = derived(
	[cliProviders, aiEnabled],
	([$providers, $ai]) =>
		$ai && $providers.some((p) => p.id === CLAUDE_CODE && p.installed),
);

/** Display label of a provider, falling back to the raw id for a provider no longer known. */
export function cliProviderLabel(
	id: CliProviderId,
	known: CliProviderDef[],
): string {
	return known.find((p) => p.id === id)?.label ?? id;
}
