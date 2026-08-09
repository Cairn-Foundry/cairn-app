import { invoke } from "@tauri-apps/api/core";

import type { CliProviderId } from "$lib/services/cli-provider-service";
import type { SkillProject } from "$lib/services/skill-service";

export type NativeAgentScope = "global" | "project";

/** One file the agent is defined in, and the providers that read it. */
export interface NativeAgentLocation {
	path: string;
	providers: CliProviderId[];
}

export interface NativeAgent {
	id: string;
	name: string;
	description: string;
	model: string;
	effort: string;
	permissionMode: string;
	/** What the agent remembers between runs, as the CLI spells it. */
	memory: string;
	/** Skills it loads on top of the ones the session already has. */
	skills: string[];
	color: string;
	tools: string[];
	extraFrontmatter: string;
	systemPrompt: string;
	scope: NativeAgentScope;
	projectId: string;
	projectName: string;
	path: string;
	locations: NativeAgentLocation[];
	providers: CliProviderId[];
	divergent: boolean;
}

export interface NativeAgentInput {
	originalPaths: string[];
	targets: CliProviderId[];
	scope: NativeAgentScope;
	projectId: string;
	projectPath: string;
	name: string;
	description: string;
	model: string;
	effort: string;
	permissionMode: string;
	memory: string;
	skills: string[];
	color: string;
	tools: string[];
	extraFrontmatter: string;
	systemPrompt: string;
}

export interface AgentMigrationOutcome {
	ran: boolean;
	written: string[];
	skipped: string[];
	droppedParams: boolean;
}

export async function listNativeAgents(
	projects: SkillProject[],
): Promise<NativeAgent[]> {
	return await invoke("list_native_agents", { projects });
}

/** Returns the path of every copy written, first one canonical. */
export async function saveNativeAgent(
	input: NativeAgentInput,
): Promise<string[]> {
	return await invoke("save_native_agent", { input });
}

export async function deleteNativeAgent(paths: string[]): Promise<void> {
	await invoke("delete_native_agent", { paths });
}

export async function duplicateNativeAgent(
	path: string,
	name: string,
): Promise<string> {
	return await invoke("duplicate_native_agent", { path, name });
}

/** The providers that have a subagent roster at all. */
export async function agentCapableProviders(): Promise<CliProviderId[]> {
	return await invoke("agent_capable_providers");
}

/**
 * Writes the agents Cairn used to keep of its own out as definitions, once.
 * Answers `ran: false` on every launch after that.
 */
export async function migrateCustomAgents(): Promise<AgentMigrationOutcome> {
	return await invoke("migrate_custom_agents");
}
