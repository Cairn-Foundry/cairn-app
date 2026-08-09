import { get, writable } from "svelte/store";
import { listMcpServers, type McpServer } from "$lib/services/mcp-service";
import { projects } from "$lib/stores/project";

export const mcpServers = writable<McpServer[]>([]);
export const mcpLoading = writable(false);
export const mcpError = writable("");

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
