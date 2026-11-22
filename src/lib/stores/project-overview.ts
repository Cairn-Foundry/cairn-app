// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/** What the home list shows of each project beyond its name: where its repository and its first instances stand. */
import { get, writable } from "svelte/store";
import {
	getSnapshot,
	getStagedTotals,
	getUnstagedTotals,
} from "#lib/services/git-service";
import {
	BASE_INSTANCE_ID,
	isArchivedInstance,
	loadedInstances,
	loadInstances,
} from "#lib/stores/instance";
import { onProjectRemoved } from "#lib/stores/project-teardown";
import type { Instance } from "#lib/types/instance";
import type { Project } from "#lib/types/project";
import { dropProjectKeys } from "#lib/utils/project-scope";

/**
 * How many instances the home list reads the state of; the others are only
 * counted. Each one costs three git calls, so the list stops here even when its
 * row would have room for more.
 */
export const DETAILED_INSTANCES = 4;

export interface WorktreeState {
	isGitRepo: boolean;
	/** Empty on a detached HEAD. */
	branch: string;
	/** Lines added and removed in the working tree and the index together. */
	added: number;
	removed: number;
}

/** Keyed `projectId:instanceId`, the repository itself under the base instance id. */
export const worktreeStates = writable<Record<string, WorktreeState>>({});

export function worktreeKey(projectId: string, instanceId: string): string {
	return `${projectId}:${instanceId}`;
}

/** The instances still in use, in their stored order. */
export function activeInstancesOf(
	byProject: Record<string, Instance[]>,
	projectId: string,
): Instance[] {
	return (byProject[projectId] ?? []).filter((i) => !isArchivedInstance(i));
}

async function readWorktreeState(path: string): Promise<WorktreeState | null> {
	const snapshot = await getSnapshot(path, "").catch(() => null);
	if (!snapshot) return null;
	const { isGitRepo, status, changedPaths } = snapshot.status;
	const base = { isGitRepo, branch: snapshot.currentBranch };
	if (!isGitRepo) return { ...base, added: 0, removed: 0 };
	const isUntracked = (p: string) => status[p] === "untracked";
	const none = { added: 0, removed: 0 };
	const [staged, unstaged] = await Promise.all([
		getStagedTotals(path).catch(() => none),
		getUnstagedTotals(
			path,
			changedPaths.unstaged.filter((p) => !isUntracked(p)),
			changedPaths.unstaged.filter(isUntracked),
		).catch(() => none),
	]);
	return {
		...base,
		added: staged.added + unstaged.added,
		removed: staged.removed + unstaged.removed,
	};
}

async function refreshWorktree(key: string, path: string): Promise<void> {
	const state = await readWorktreeState(path);
	if (state) worktreeStates.update((map) => ({ ...map, [key]: state }));
}

/**
 * Re-read on every call: the repositories move outside Cairn. One that moved
 * or vanished simply shows nothing.
 */
export async function loadProjectOverview(project: Project): Promise<void> {
	if (!(project.id in get(loadedInstances))) {
		await loadInstances(project.id).catch(() => {});
	}
	const shown = activeInstancesOf(get(loadedInstances), project.id).slice(
		0,
		DETAILED_INSTANCES,
	);
	await Promise.all([
		refreshWorktree(worktreeKey(project.id, BASE_INSTANCE_ID), project.path),
		...shown.map((i) =>
			refreshWorktree(worktreeKey(project.id, i.id), i.worktreePath),
		),
	]);
}

onProjectRemoved((projectId) => {
	worktreeStates.update((map) => dropProjectKeys(map, projectId));
});

export interface WorktreeLine {
	key: string;
	branch: string;
	isBase: boolean;
	/** What the line stands for, shown on hover: the instance's ticket. */
	title: string;
	state: WorktreeState | null;
}

export interface WorktreeSummary {
	/** Null until the repository was read. */
	isGitRepo: boolean | null;
	/** The repository first, then the first instances. */
	lines: WorktreeLine[];
	/** Branches of the instances left out of `lines`. */
	hiddenBranches: string[];
}

/** The worktree lines the home list draws for a project, from what is loaded. */
export function summarizeWorktrees(
	project: Project,
	instances: Instance[],
	states: Record<string, WorktreeState>,
): WorktreeSummary {
	const baseKey = worktreeKey(project.id, BASE_INSTANCE_ID);
	const base = states[baseKey] ?? null;
	if (!base) return { isGitRepo: null, lines: [], hiddenBranches: [] };
	if (!base.isGitRepo)
		return { isGitRepo: false, lines: [], hiddenBranches: [] };
	const shown = instances.slice(0, DETAILED_INSTANCES);
	return {
		isGitRepo: true,
		lines: [
			{
				key: baseKey,
				branch: base.branch,
				isBase: true,
				title: "",
				state: base,
			},
			...shown.map((i) => {
				const key = worktreeKey(project.id, i.id);
				return {
					key,
					branch: i.branch,
					isBase: false,
					title: i.ticket.title,
					state: states[key] ?? null,
				};
			}),
		],
		hiddenBranches: instances.slice(DETAILED_INSTANCES).map((i) => i.branch),
	};
}
