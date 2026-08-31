// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { EnvScope, EnvVariable } from "$lib/services/env-service";
import { isValidEnvKey } from "./env-file";

// Flattening the three variable scopes into the environment a command runs
// with, then expanding the references variables make to each other.

/** One exported variable, with the scope it ended up coming from. */
export interface ResolvedEnvEntry {
	key: string;
	value: string;
	scope: EnvScope;
	variableId: string;
	secret: boolean;
}

/** The three scopes plus the per-instance answers to resolve them against. */
interface EnvResolutionInput {
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
			const raw = usesOverride
				? (input.overrides[variable.id] ?? (variable.defaultValue || undefined))
				: variable.value;
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

	return expandReferences([...byKey.values()]);
}

const REFERENCE = /\$?\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * Expands `{OTHER}` / `${OTHER}` references between variables, so a value can
 * be written as `http://localhost:{APP_PORT}`. Resolution is recursive and
 * memoized; a reference that cycles, or that names a key no scope defines, is
 * left as written rather than silently emptied.
 */
export function expandReferences(
	entries: ResolvedEnvEntry[],
): ResolvedEnvEntry[] {
	const raw = new Map(entries.map((entry) => [entry.key, entry.value]));
	const done = new Map<string, string>();

	function expand(key: string, seen: Set<string>): string {
		const cached = done.get(key);
		if (cached !== undefined) return cached;

		const value = raw.get(key) ?? "";
		const next = value.replace(REFERENCE, (match, name: string) => {
			if (!raw.has(name) || seen.has(name)) return match;
			return expand(name, new Set([...seen, name]));
		});
		done.set(key, next);
		return next;
	}

	return entries.map((entry) => ({
		...entry,
		value: expand(entry.key, new Set([entry.key])),
	}));
}

/** The resolved entries as the plain key/value map a process expects. */
export function toEnvRecord(
	entries: ResolvedEnvEntry[],
): Record<string, string> {
	return Object.fromEntries(entries.map((entry) => [entry.key, entry.value]));
}
