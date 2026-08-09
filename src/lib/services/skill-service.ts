import { invoke } from "@tauri-apps/api/core";

import type { CliProviderId } from "$lib/services/cli-provider-service";

export type SkillScope = "global" | "project" | "plugin";

/** One directory the skill lives in, and the agents that read it. */
export interface SkillLocation {
	path: string;
	providers: CliProviderId[];
	readOnly: boolean;
}

export interface SkillResource {
	name: string;
	path: string;
	size: number;
}

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
	divergent: boolean;
	readOnly: boolean;
	resources: SkillResource[];
}

export interface SkillProject {
	id: string;
	name: string;
	path: string;
}

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

export async function listSkills(projects: SkillProject[]): Promise<Skill[]> {
	return await invoke("list_skills", { projects });
}

export async function saveSkill(input: SkillInput): Promise<string[]> {
	return await invoke("save_skill", { input });
}

export async function deleteSkill(paths: string[]): Promise<void> {
	await invoke("delete_skill", { paths });
}

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
