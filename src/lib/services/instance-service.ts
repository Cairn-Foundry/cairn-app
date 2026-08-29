// Instances of a project and the git worktree behind each one.
// Only this layer calls invoke().

import { invoke } from "@tauri-apps/api/core";
import type {
	Instance,
	InstanceStatus,
	InstanceTicket,
} from "$lib/types/instance";

/** `linkExisting` reuses a branch that already exists instead of creating one. */
export interface CreateInstanceArgs {
	id: string;
	projectId: string;
	projectPath: string;
	ticket: InstanceTicket;
	branch?: string;
	baseBranch?: string;
	linkExisting?: boolean;
}

/** Reads instances.json for the project; no worktree is touched. */
export async function listInstances(projectId: string): Promise<Instance[]> {
	return invoke<Instance[]>("list_instances", { projectId });
}

/** Creates the branch and its worktree on disk, then records the instance. Slow: it shells out to git. */
export async function createInstance(
	args: CreateInstanceArgs,
): Promise<Instance> {
	return invoke<Instance>("create_instance", { args });
}

/** `copyWorkingChanges` carries the uncommitted diff over to the new worktree. */
export interface DuplicateInstanceArgs {
	sourceId: string;
	projectId: string;
	newId: string;
	ticket: InstanceTicket;
	copyWorkingChanges: boolean;
}

/** Branches off the source instance into a new worktree; the source is left alone. */
export async function duplicateInstance(
	args: DuplicateInstanceArgs,
): Promise<Instance> {
	return invoke<Instance>("duplicate_instance", { args });
}

/** Writes the instance back to instances.json; the worktree is untouched. */
export async function updateInstanceStatus(
	id: string,
	projectId: string,
	status: InstanceStatus,
): Promise<Instance> {
	return invoke<Instance>("update_instance_status", { id, projectId, status });
}

export async function updateInstanceBaseBranch(
	id: string,
	projectId: string,
	baseBranch: string,
): Promise<Instance> {
	return invoke<Instance>("update_instance_base_branch", {
		id,
		projectId,
		baseBranch,
	});
}

export async function updateInstanceTicket(
	id: string,
	projectId: string,
	ticket: InstanceTicket,
): Promise<Instance> {
	return invoke<Instance>("update_instance_ticket", { id, projectId, ticket });
}

/**
 * Destructive well beyond instances.json: it removes the worktree directory,
 * prunes it, deletes the local branch and drops the instance's saved state.
 * Uncommitted work in that worktree is gone.
 */
export async function deleteInstance(
	id: string,
	projectId: string,
): Promise<void> {
	return invoke<void>("delete_instance", { id, projectId });
}

/** Local branch names of the project checkout, not of a worktree. */
export async function listBranches(projectPath: string): Promise<string[]> {
	return invoke<string[]>("list_branches", { projectPath });
}

/** Local and remote branches kept apart, for pickers that offer both. */
export interface BranchList {
	local: string[];
	remote: string[];
}

/** Same listing as `listBranches`, split by local and remote. */
export async function listBranchesDetailed(
	projectPath: string,
): Promise<BranchList> {
	return invoke<BranchList>("list_branches_detailed", { projectPath });
}

/**
 * A branch this one may have been cut from. Git records no such link, so this
 * is inference: `merge` means a merge commit named it, `fork` means only the
 * topology suggests it. Always offered as a prefill, never stored on its own.
 */
export interface BaseSuggestion {
	branch: string;
	reason: "merge" | "fork";
	distance: number;
}

/** Candidate bases for an existing branch, best first; empty when nothing fits. */
export async function suggestBaseBranches(
	projectPath: string,
	branch: string,
): Promise<BaseSuggestion[]> {
	try {
		// A backend that answers with nothing must not take the form down: the
		// base is a prefill, and a missing one only means the user types it.
		const found = await invoke<BaseSuggestion[]>("suggest_base_branches", {
			projectPath,
			branch,
		});
		return Array.isArray(found) ? found : [];
	} catch {
		return [];
	}
}
