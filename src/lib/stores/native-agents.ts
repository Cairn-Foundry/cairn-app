// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/** Claude Code subagents discovered across the registered projects, read-only: discovered by scanning every project path. */
import { get, writable } from "svelte/store";
import {
	listNativeAgents,
	type NativeAgent,
} from "$lib/services/native-agent-service";
import { projects } from "$lib/stores/project";

export const nativeAgents = writable<NativeAgent[]>([]);
export const nativeAgentsLoading = writable(false);
export const nativeAgentsError = writable("");

/** Rescans every registered project; errors land in the error store rather than throwing. */
export async function loadNativeAgents(): Promise<void> {
	nativeAgentsLoading.set(true);
	nativeAgentsError.set("");
	try {
		const known = get(projects).map((p) => ({
			id: p.id,
			name: p.name,
			path: p.path,
		}));
		nativeAgents.set(await listNativeAgents(known));
	} catch (e) {
		nativeAgentsError.set(String(e));
	} finally {
		nativeAgentsLoading.set(false);
	}
}
