// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/** The merge request of the branch, per instance: the MR itself, its discussions, the selected one. */
import { get, writable } from "svelte/store";
import {
	forgeApprove,
	forgeCreateMergeRequest,
	forgeFindMergeRequest,
	forgeListDiscussions,
	forgeListLabels,
	forgeListMembers,
	forgeReply,
	forgeResolve,
	toIntegrationError,
} from "$lib/services/integration-service";
import { onProjectRemoved } from "$lib/stores/project-teardown";
import type {
	Actor,
	Discussion,
	IntegrationError,
	MergeRequest,
	MergeRequestDraft,
} from "$lib/types/integrations";
import { integrationKey } from "$lib/utils/integrations/instance-key";
import { dropProjectKeys } from "$lib/utils/project-scope";

export interface InstanceMergeRequestState {
	mergeRequest: MergeRequest | null;
	discussions: Discussion[];
	selectedDiscussionId: string;
	isLoaded: boolean;
	isRefreshing: boolean;
	areDiscussionsLoaded: boolean;
	error: IntegrationError | null;
}

const EMPTY: InstanceMergeRequestState = {
	mergeRequest: null,
	discussions: [],
	selectedDiscussionId: "",
	isLoaded: false,
	isRefreshing: false,
	areDiscussionsLoaded: false,
	error: null,
};

const _mergeRequests = writable<Record<string, InstanceMergeRequestState>>({});

/** Read-only outside this module; every mutation goes through the actions below. */
export const mergeRequests = { subscribe: _mergeRequests.subscribe };

export function mergeRequestStateFor(
	state: Record<string, InstanceMergeRequestState>,
	projectId: string,
	instanceId: string,
): InstanceMergeRequestState {
	return state[integrationKey(projectId, instanceId)] ?? EMPTY;
}

function patch(key: string, changes: Partial<InstanceMergeRequestState>): void {
	_mergeRequests.update((current) => ({
		...current,
		[key]: { ...(current[key] ?? EMPTY), ...changes },
	}));
}

export async function loadMergeRequest(
	projectId: string,
	instanceId: string,
	branch: string,
): Promise<void> {
	const key = integrationKey(projectId, instanceId);
	patch(key, { isRefreshing: true });
	try {
		const mergeRequest = await forgeFindMergeRequest(projectId, branch);
		patch(key, {
			mergeRequest,
			isLoaded: true,
			isRefreshing: false,
			error: null,
		});
	} catch (error) {
		patch(key, {
			isLoaded: true,
			isRefreshing: false,
			error: toIntegrationError(error),
		});
	}
}

/**
 * The MR as pushed by `integration-update`. Applied by instance key, so an
 * event that arrives after the user switched instance still lands on the
 * branch it describes.
 */
export function applyUpdate(key: string, mergeRequest: MergeRequest): void {
	patch(key, { mergeRequest, isLoaded: true, error: null });
}

export async function loadDiscussions(
	projectId: string,
	instanceId: string,
): Promise<void> {
	const key = integrationKey(projectId, instanceId);
	const mr = (get(_mergeRequests)[key] ?? EMPTY).mergeRequest;
	if (!mr) return;
	try {
		const discussions = await forgeListDiscussions(projectId, mr.id);
		const state = get(_mergeRequests)[key] ?? EMPTY;
		const selected = discussions.some(
			(d) => d.id === state.selectedDiscussionId,
		)
			? state.selectedDiscussionId
			: "";
		patch(key, {
			discussions,
			selectedDiscussionId: selected,
			areDiscussionsLoaded: true,
			error: null,
		});
	} catch (error) {
		patch(key, {
			areDiscussionsLoaded: true,
			error: toIntegrationError(error),
		});
	}
}

export function selectDiscussion(
	projectId: string,
	instanceId: string,
	discussionId: string,
): void {
	patch(integrationKey(projectId, instanceId), {
		selectedDiscussionId: discussionId,
	});
}

async function withMergeRequest(
	projectId: string,
	instanceId: string,
	action: (mr: MergeRequest) => Promise<void>,
): Promise<void> {
	const key = integrationKey(projectId, instanceId);
	const mr = (get(_mergeRequests)[key] ?? EMPTY).mergeRequest;
	if (!mr) return;
	try {
		await action(mr);
	} catch (error) {
		patch(key, { error: toIntegrationError(error) });
		throw error;
	}
}

export function replyToDiscussion(
	projectId: string,
	instanceId: string,
	discussionId: string,
	body: string,
): Promise<void> {
	return withMergeRequest(projectId, instanceId, async (mr) => {
		const comment = await forgeReply(projectId, mr.id, discussionId, body);
		_mergeRequests.update((current) => {
			const key = integrationKey(projectId, instanceId);
			const state = current[key] ?? EMPTY;
			return {
				...current,
				[key]: {
					...state,
					discussions: state.discussions.map((d) =>
						d.id === discussionId
							? { ...d, comments: [...d.comments, comment] }
							: d,
					),
				},
			};
		});
	});
}

export function setDiscussionResolved(
	projectId: string,
	instanceId: string,
	discussionId: string,
	resolved: boolean,
): Promise<void> {
	return withMergeRequest(projectId, instanceId, async (mr) => {
		await forgeResolve(projectId, mr.id, discussionId, resolved);
		_mergeRequests.update((current) => {
			const key = integrationKey(projectId, instanceId);
			const state = current[key] ?? EMPTY;
			return {
				...current,
				[key]: {
					...state,
					discussions: state.discussions.map((d) =>
						d.id === discussionId ? { ...d, resolved } : d,
					),
				},
			};
		});
	});
}

export function approveMergeRequest(
	projectId: string,
	instanceId: string,
	approve: boolean,
): Promise<void> {
	return withMergeRequest(projectId, instanceId, async (mr) => {
		const updated = await forgeApprove(projectId, mr.id, approve);
		applyUpdate(integrationKey(projectId, instanceId), updated);
	});
}

export async function createMergeRequest(
	projectId: string,
	instanceId: string,
	draft: MergeRequestDraft,
): Promise<MergeRequest> {
	const key = integrationKey(projectId, instanceId);
	try {
		const created = await forgeCreateMergeRequest(projectId, draft);
		applyUpdate(key, created);
		return created;
	} catch (error) {
		patch(key, { error: toIntegrationError(error) });
		throw error;
	}
}

export function clearMergeRequest(projectId: string, instanceId: string): void {
	_mergeRequests.update((current) => {
		const next = { ...current };
		delete next[integrationKey(projectId, instanceId)];
		return next;
	});
}

/**
 * Bumped by the `createMergeRequest` shortcut; the branch bar and the finalize
 * modal subscribe and open the creation form when the counter moves.
 */
export const mergeRequestFormRequest = writable(0);

export function requestMergeRequestForm(): void {
	mergeRequestFormRequest.update((n) => n + 1);
}

export function searchForgeMembers(
	projectId: string,
	text: string,
): Promise<Actor[]> {
	return forgeListMembers(projectId, text);
}

const labelsByProject = new Map<string, string[]>();

export async function loadForgeLabels(projectId: string): Promise<string[]> {
	const cached = labelsByProject.get(projectId);
	if (cached) return cached;
	const labels = await forgeListLabels(projectId);
	labelsByProject.set(projectId, labels);
	return labels;
}

/** Forgets the merge-request state of every instance of a removed project. */
export function forgetProject(projectId: string): void {
	_mergeRequests.update((m) => dropProjectKeys(m, projectId));
	labelsByProject.delete(projectId);
}

onProjectRemoved(forgetProject);
