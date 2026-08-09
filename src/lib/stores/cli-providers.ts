import { get, writable } from "svelte/store";
import {
	type CliProviderDef,
	type CliProviderId,
	listCliProviders,
} from "$lib/services/cli-provider-service";

export const cliProviders = writable<CliProviderDef[]>([]);

export async function loadCliProviders(): Promise<void> {
	if (get(cliProviders).length > 0) return;
	cliProviders.set(await listCliProviders());
}

export function cliProviderLabel(
	id: CliProviderId,
	known: CliProviderDef[],
): string {
	return known.find((p) => p.id === id)?.label ?? id;
}
