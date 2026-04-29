import { invoke } from "@tauri-apps/api/core";
import type { Instance } from "$lib/types/instance";

export interface CreateInstanceArgs {
	id: string;
	projectId: string;
	projectPath: string;
	ticket: { id: string; title: string };
	useGit: boolean;
	branch?: string;
	baseBranch?: string;
}

export async function listInstances(projectId: string): Promise<Instance[]> {
	return invoke<Instance[]>("list_instances", { projectId });
}

export async function createInstance(
	args: CreateInstanceArgs,
): Promise<Instance> {
	return invoke<Instance>("create_instance", { args });
}

export async function deleteInstance(
	id: string,
	projectId: string,
): Promise<void> {
	return invoke<void>("delete_instance", { id, projectId });
}

export async function listBranches(projectPath: string): Promise<string[]> {
	return invoke<string[]>("list_branches", { projectPath });
}
