import { invoke } from "@tauri-apps/api/core";

import type { CliProviderId } from "$lib/services/cli-provider-service";

export type McpScope = "user" | "local" | "project";

/** One config file the server is declared in, and the agents that read it. */
export interface McpServerLocation {
	path: string;
	providers: CliProviderId[];
	dialect: CliProviderId;
}

export type McpTransport = "stdio" | "http" | "sse";

export type McpApproval = "approved" | "rejected" | "pending" | "";

export interface McpServer {
	id: string;
	name: string;
	scope: McpScope;
	projectId: string;
	projectName: string;
	projectPath: string;
	transport: McpTransport;
	command: string;
	args: string[];
	env: Record<string, string>;
	url: string;
	headers: Record<string, string>;
	enabled: boolean;
	approval: McpApproval;
	/** Where a save should land. */
	targets: CliProviderId[];
	locations: McpServerLocation[];
	providers: CliProviderId[];
	divergent: boolean;
	sourcePath: string;
}

export interface McpProject {
	id: string;
	name: string;
	path: string;
}

export interface McpTool {
	name: string;
	description: string;
}

export interface McpProbe {
	ok: boolean;
	error: string;
	serverName: string;
	serverVersion: string;
	protocolVersion: string;
	tools: McpTool[];
	promptCount: number;
	resourceCount: number;
	durationMs: number;
	partial: boolean;
	logs: string;
}

export async function listMcpServers(
	projects: McpProject[],
): Promise<McpServer[]> {
	return await invoke("list_mcp_servers", { projects });
}

export async function saveMcpServer(
	original: McpServer | null,
	server: McpServer,
): Promise<void> {
	await invoke("save_mcp_server", { original, server });
}

export async function deleteMcpServer(server: McpServer): Promise<void> {
	await invoke("delete_mcp_server", { server });
}

export async function setMcpApproval(
	projectPath: string,
	name: string,
	approved: boolean,
): Promise<void> {
	await invoke("set_mcp_approval", { projectPath, name, approved });
}

export async function importMcpServers(
	scope: McpScope,
	projectId: string,
	projectPath: string,
	targets: CliProviderId[],
	raw: string,
): Promise<string[]> {
	return await invoke("import_mcp_servers", {
		scope,
		projectId,
		projectPath,
		targets,
		raw,
	});
}

export async function exportMcpServers(servers: McpServer[]): Promise<string> {
	return await invoke("export_mcp_servers", { servers });
}

export async function testMcpServer(server: McpServer): Promise<McpProbe> {
	return await invoke("test_mcp_server", { server });
}
