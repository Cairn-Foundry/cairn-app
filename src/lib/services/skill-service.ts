// Agent skills as they exist on disk: the same skill can be written into
// several provider directories at once, which is what most of this handles.

import { invoke } from "@tauri-apps/api/core";

import type { CliProviderId } from "$lib/services/cli-provider-service";

/** Where a skill is stored; `plugin` ones ship with a plugin and are read-only. */
export type SkillScope = "global" | "project" | "plugin";

/** One directory the skill lives in, and the agents that read it. */
export interface SkillLocation {
	path: string;
	providers: CliProviderId[];
	readOnly: boolean;
}

/** A file sitting next to the skill manifest, offered to the agent alongside it. */
export interface SkillResource {
	name: string;
	path: string;
	size: number;
}

/** One skill, collapsed from every copy of it found on disk. */
export interface Skill {
	id: string;
	name: string;
	description: string;
	whenToUse: string;
	allowedTools: string[];
	paths: string;
	model: string;
	license: string;
	disableModelInvocation: boolean;
	extraFrontmatter: string;
	body: string;
	scope: SkillScope;
	projectId: string;
	projectName: string;
	plugin: string;
	path: string;
	locations: SkillLocation[];
	providers: CliProviderId[];
	/** The copies on disk are not identical, so editing one has to pick a winner. */
	divergent: boolean;
	readOnly: boolean;
	resources: SkillResource[];
}

/** A project to search for project-scoped skills; passed in because Rust does not read the project list. */
export interface SkillProject {
	id: string;
	name: string;
	path: string;
}

/** A skill as submitted for writing; `originalPaths` are the copies it currently occupies. */
export interface SkillInput {
	originalPaths: string[];
	targets: CliProviderId[];
	scope: SkillScope;
	projectId: string;
	projectPath: string;
	name: string;
	description: string;
	whenToUse: string;
	allowedTools: string[];
	paths: string;
	model: string;
	license: string;
	disableModelInvocation: boolean;
	extraFrontmatter: string;
	body: string;
}

/** Scans every scope on disk and collapses duplicates into one entry per skill. */
export async function listSkills(projects: SkillProject[]): Promise<Skill[]> {
	return await invoke("list_skills", { projects });
}

/**
 * Writes the skill into one directory per target and answers with the paths
 * kept. Copies at `originalPaths` that are no longer targeted are removed.
 */
export async function saveSkill(input: SkillInput): Promise<string[]> {
	return await invoke("save_skill", { input });
}

/** Deletes the skill directories outright, resources included. */
export async function deleteSkill(paths: string[]): Promise<void> {
	await invoke("delete_skill", { paths });
}

/** Copies a skill next to the original under a new name; answers with its path. */
export async function duplicateSkill(
	path: string,
	name: string,
): Promise<string> {
	return await invoke("duplicate_skill", { path, name });
}

export async function addSkillResources(
	path: string,
	sources: string[],
): Promise<void> {
	await invoke("add_skill_resources", { path, sources });
}

export async function deleteSkillResource(
	skillPath: string,
	path: string,
): Promise<void> {
	await invoke("delete_skill_resource", { skillPath, path });
}
