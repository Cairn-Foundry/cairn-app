// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

import type { CliProviderId } from "$lib/services/cli-provider-service";

// MCP servers as declared in the CLI agents' own config files. Cairn reads and
// rewrites those files in place; it never keeps a registry of its own.

/** Which config file the server is declared in, hence who sees it. */
export type McpScope = "user" | "local" | "project";

/** One config file the server is declared in, and the agents that read it. */
export interface McpServerLocation {
	path: string;
	providers: CliProviderId[];
	dialect: CliProviderId;
}

/** How the agent talks to the server. */
export type McpTransport = "stdio" | "http" | "sse";

/** Trust decision recorded by the agent; empty when the agent tracks none. */
export type McpApproval = "approved" | "rejected" | "pending" | "";

/**
 * One server merged across every config file that declares it. `divergent` marks
 * files that disagree on its definition, which a save would flatten.
 */
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

/** The projects whose config files a listing should also scan. */
export interface McpProject {
	id: string;
	name: string;
	path: string;
}

/** A tool the server advertised during a probe. */
export interface McpTool {
	name: string;
	description: string;
}

/** Outcome of a live handshake. `partial` means it answered but not fully. */
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

/** Reads every agent config file, user scope plus the given projects. */
export async function listMcpServers(
	projects: McpProject[],
): Promise<McpServer[]> {
	return await invoke("list_mcp_servers", { projects });
}

/**
 * Writes the server into each of its `targets`. `original` is what it looked
 * like before, so a rename or a scope change removes the previous entry.
 */
export async function saveMcpServer(
	original: McpServer | null,
	server: McpServer,
): Promise<void> {
	await invoke("save_mcp_server", { original, server });
}

/** Removes the server from every config file that declares it. */
export async function deleteMcpServer(server: McpServer): Promise<void> {
	await invoke("delete_mcp_server", { server });
}

/** Records the trust decision in the project's own agent config. */
export async function setMcpApproval(
	projectPath: string,
	name: string,
	approved: boolean,
): Promise<void> {
	await invoke("set_mcp_approval", { projectPath, name, approved });
}

/** Parses a pasted JSON block into the targets, and resolves with the names written. */
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

/** Renders the servers as a JSON block for pasting elsewhere; writes nothing. */
export async function exportMcpServers(servers: McpServer[]): Promise<string> {
	return await invoke("export_mcp_servers", { servers });
}

/** Starts the server and handshakes with it; a failed probe resolves with `ok: false`. */
export async function testMcpServer(server: McpServer): Promise<McpProbe> {
	return await invoke("test_mcp_server", { server });
}
