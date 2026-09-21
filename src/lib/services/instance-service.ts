// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

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

/** A linked worktree of the project that no instance stands for. */
export interface UnclaimedWorktree {
	/** The name git registered, which is the directory name, not the branch. */
	name: string;
	path: string;
	/** Absent on a detached HEAD, which cannot become an instance. */
	branch?: string;
}

/**
 * The worktrees of the project no instance claims: the ones made by hand
 * outside Cairn, and the ones it created but lost track of. The project
 * checkout itself is not one - it is already the base instance.
 */
export async function listUnclaimedWorktrees(
	projectId: string,
	projectPath: string,
): Promise<UnclaimedWorktree[]> {
	return invoke<UnclaimedWorktree[]>("list_unclaimed_worktrees", {
		projectId,
		projectPath,
	});
}

/** `path` is stored as it stands: an adopted worktree is not moved. */
export interface AdoptWorktreeArgs {
	id: string;
	projectId: string;
	projectPath: string;
	path: string;
	ticket: InstanceTicket;
	baseBranch?: string;
}

/**
 * Records an instance for a worktree that already exists, leaving the directory
 * where it is. Nothing is created on disk, so this one is cheap.
 */
export async function adoptWorktree(
	args: AdoptWorktreeArgs,
): Promise<Instance> {
	return invoke<Instance>("adopt_worktree", { args });
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
 * Drops the instance and its saved state. With `removeWorktree` it also removes
 * the worktree directory, prunes it and deletes the local branch - uncommitted
 * work in there is then gone. Left undefined, the backend removes the worktree
 * of an instance it created and keeps the one it merely adopted.
 */
export async function deleteInstance(
	id: string,
	projectId: string,
	removeWorktree?: boolean,
): Promise<void> {
	return invoke<void>("delete_instance", { id, projectId, removeWorktree });
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
