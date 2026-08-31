// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/** MCP servers discovered across the registered projects, read-only: discovered by scanning every project path. */
import { get, writable } from "svelte/store";
import { listMcpServers, type McpServer } from "$lib/services/mcp-service";
import { projects } from "$lib/stores/project";

export const mcpServers = writable<McpServer[]>([]);
export const mcpLoading = writable(false);
export const mcpError = writable("");

/** Rescans every registered project; errors land in the error store rather than throwing. */
export async function loadMcpServers(): Promise<void> {
	mcpLoading.set(true);
	mcpError.set("");
	try {
		const known = get(projects).map((p) => ({
			id: p.id,
			name: p.name,
			path: p.path,
		}));
		mcpServers.set(await listMcpServers(known));
	} catch (e) {
		mcpError.set(String(e));
	} finally {
		mcpLoading.set(false);
	}
}
