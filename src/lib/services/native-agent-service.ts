// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Subagent definitions written as files the external CLIs read, in the project
// or in the user's home. Only this layer calls invoke().

import { invoke } from "@tauri-apps/api/core";

import type { CliProviderId } from "$lib/services/cli-provider-service";
import type { SkillProject } from "$lib/services/skill-service";

/** Written to the user's home, or inside the project checkout. */
export type NativeAgentScope = "global" | "project";

/** One file the agent is defined in, and the providers that read it. */
export interface NativeAgentLocation {
	path: string;
	providers: CliProviderId[];
}

/**
 * One agent as read back from disk. The same agent is often written to several
 * files at once, so `path` is the canonical copy and `divergent` says the other
 * copies no longer agree with it.
 */
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

/** What a save needs; `originalPaths` are the copies to rewrite or clean up first. */
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

/** Scans the agent directories of every passed project plus the global ones. */
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

/** Deletes every listed copy: pass the agent's `locations`, not just its `path`. */
export async function deleteNativeAgent(paths: string[]): Promise<void> {
	await invoke("delete_native_agent", { paths });
}

/** Copies one file next to the original under `name`; returns the new path. */
export async function duplicateNativeAgent(
	path: string,
	name: string,
): Promise<string> {
	return await invoke("duplicate_native_agent", { path, name });
}
