import { invoke } from "@tauri-apps/api/core";

/** The coding CLIs Cairn can configure skills and MCP servers for. */
export type CliProviderId =
	| "claude-code"
	| "codex"
	| "copilot"
	| "antigravity"
	| "vibe";

export interface CliProviderDef {
	id: CliProviderId;
	label: string;
	/** Only Claude Code keeps a per-project private MCP list. */
	hasLocalScope: boolean;
	/**
	 * Whether this machine actually has the agent. Writing for an agent that is
	 * not installed only leaves files nothing reads, so it cannot be picked -
	 * though an entry already written for it can still be taken back out.
	 */
	installed: boolean;
}

export async function listCliProviders(): Promise<CliProviderDef[]> {
	return await invoke("list_cli_providers");
}

/**
 * The agents that would end up reading an entry written for `targets` - not the
 * same list, because a write location is often read by agents that were never
 * asked for. Answered by the registry rather than mirrored here, so the two
 * never drift apart.
 */
export async function reachedProviders(
	kind: "skill" | "mcp",
	scope: string,
	projectPath: string,
	targets: CliProviderId[],
): Promise<CliProviderId[]> {
	return await invoke("reached_providers", {
		kind,
		scope,
		projectPath,
		targets,
	});
}
