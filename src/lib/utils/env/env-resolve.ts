import type { EnvScope, EnvVariable } from "$lib/services/env-service";
import { isValidEnvKey } from "./env-file";

export interface ResolvedEnvEntry {
	key: string;
	value: string;
	scope: EnvScope;
	variableId: string;
	secret: boolean;
}

export interface EnvResolutionInput {
	global: EnvVariable[];
	project: EnvVariable[];
	instance: EnvVariable[];
	/** Values of the `perInstance` variables, keyed by variable id. */
	overrides: Record<string, string>;
	interpolate?: (value: string) => string;
}

const SCOPE_ORDER: EnvScope[] = ["global", "project", "instance"];

/**
 * Global, then project, then instance: the last scope declaring a key wins. A
 * `perInstance` variable without an override is left out entirely rather than
 * exported empty, so a missing value fails loudly in the program that reads it.
 */
export function resolveEnv(input: EnvResolutionInput): ResolvedEnvEntry[] {
	const interpolate = input.interpolate ?? ((value: string) => value);
	const byKey = new Map<string, ResolvedEnvEntry>();

	for (const scope of SCOPE_ORDER) {
		for (const variable of input[scope]) {
			if (!variable.enabled) continue;
			if (!isValidEnvKey(variable.key)) continue;

			const usesOverride = scope !== "instance" && variable.perInstance;
			const raw = usesOverride ? input.overrides[variable.id] : variable.value;
			if (raw === undefined) continue;

			byKey.set(variable.key, {
				key: variable.key,
				value: interpolate(raw),
				scope,
				variableId: variable.id,
				secret: variable.secret,
			});
		}
	}

	return [...byKey.values()];
}

export function toEnvRecord(
	entries: ResolvedEnvEntry[],
): Record<string, string> {
	return Object.fromEntries(entries.map((entry) => [entry.key, entry.value]));
}
