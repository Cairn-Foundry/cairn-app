import { invoke } from "@tauri-apps/api/core";
import type { Instance } from "$lib/types/instance";

export interface CreateInstanceArgs {
	id: string;
	projectId: string;
	projectPath: string;
	ticket: { id: string; title: string };
	branch?: string;
	baseBranch?: string;
	linkExisting?: boolean;
}

export async function listInstances(projectId: string): Promise<Instance[]> {
	return invoke<Instance[]>("list_instances", { projectId });
}

export async function createInstance(
	args: CreateInstanceArgs,
): Promise<Instance> {
	return invoke<Instance>("create_instance", { args });
}

export interface DuplicateInstanceArgs {
	sourceId: string;
	projectId: string;
	newId: string;
	ticket: { id: string; title: string };
	copyWorkingChanges: boolean;
}

export async function duplicateInstance(
	args: DuplicateInstanceArgs,
): Promise<Instance> {
	return invoke<Instance>("duplicate_instance", { args });
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

export interface BranchList {
	local: string[];
	remote: string[];
}

export async function listBranchesDetailed(
	projectPath: string,
): Promise<BranchList> {
	return invoke<BranchList>("list_branches_detailed", { projectPath });
}
