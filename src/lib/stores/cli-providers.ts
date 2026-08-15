/** The list of agent CLI providers available to instances. */
import { get, writable } from "svelte/store";
import {
	type CliProviderDef,
	type CliProviderId,
	listCliProviders,
} from "$lib/services/cli-provider-service";

/** The agent CLIs the backend knows how to drive. Static for the lifetime of the app. */
export const cliProviders = writable<CliProviderDef[]>([]);

/** Loads the provider list once; later calls are no-ops. */
export async function loadCliProviders(): Promise<void> {
	if (get(cliProviders).length > 0) return;
	cliProviders.set(await listCliProviders());
}

/** Display label of a provider, falling back to the raw id for a provider no longer known. */
export function cliProviderLabel(
	id: CliProviderId,
	known: CliProviderDef[],
): string {
	return known.find((p) => p.id === id)?.label ?? id;
}
