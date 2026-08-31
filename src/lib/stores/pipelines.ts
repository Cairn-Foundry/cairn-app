// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/** Pipelines of the branch, per instance: the list, the selected one, the open job log. */
import { derived, get, writable } from "svelte/store";
import {
	ciCancelPipeline,
	ciGetPipeline,
	ciJobLog,
	ciListPipelines,
	ciPlayJob,
	ciRetryJob,
	toIntegrationError,
} from "$lib/services/integration-service";
import { onProjectRemoved } from "$lib/stores/project-teardown";
import {
	EMPTY_PIPELINE_QUERY,
	type IntegrationError,
	type JobLog,
	PIPELINE_PAGE_SIZE,
	type Pipeline,
	type PipelineQuery,
	type PipelineStatus,
} from "$lib/types/integrations";
import { integrationKey } from "$lib/utils/integrations/instance-key";
import { dropProjectKeys } from "$lib/utils/project-scope";
import { activeInstance } from "./instance";

export { PIPELINE_PAGE_SIZE };

const RUNNING: PipelineStatus[] = ["pending", "running"];

export interface InstancePipelineState {
	pipelines: Pipeline[];
	/**
	 * The newest pipeline of the branch, as pushed by the watcher. Kept apart
	 * from `pipelines`, which the filters narrow: the sidebar badge must reflect
	 * the branch, not whatever the current filter left at the top of the list.
	 */
	latest: Pipeline | null;
	query: PipelineQuery;
	selectedPipelineId: string;
	openJobId: string;
	jobLog: JobLog | null;
	isLoaded: boolean;
	isRefreshing: boolean;
	isLoadingMore: boolean;
	isLogLoading: boolean;
	hasMore: boolean;
	page: number;
	error: IntegrationError | null;
}

const EMPTY: InstancePipelineState = {
	pipelines: [],
	latest: null,
	query: EMPTY_PIPELINE_QUERY,
	selectedPipelineId: "",
	openJobId: "",
	jobLog: null,
	isLoaded: false,
	isRefreshing: false,
	isLoadingMore: false,
	isLogLoading: false,
	hasMore: true,
	page: 0,
	error: null,
};

const _pipelines = writable<Record<string, InstancePipelineState>>({});

/**
 * One ticket per instance, bumped on every new list request. A response whose
 * ticket is stale is dropped, so a slow answer for an abandoned filter never
 * overwrites the list of the filter now on screen.
 */
const requestTickets: Record<string, number> = {};

function nextTicket(key: string): number {
	requestTickets[key] = (requestTickets[key] ?? 0) + 1;
	return requestTickets[key];
}

/** Read-only outside this module; every mutation goes through the actions below. */
export const pipelines = { subscribe: _pipelines.subscribe };

export function pipelineStateFor(
	state: Record<string, InstancePipelineState>,
	projectId: string,
	instanceId: string,
): InstancePipelineState {
	return state[integrationKey(projectId, instanceId)] ?? EMPTY;
}

function patch(key: string, changes: Partial<InstancePipelineState>): void {
	_pipelines.update((current) => ({
		...current,
		[key]: { ...(current[key] ?? EMPTY), ...changes },
	}));
}

/** True while the latest pipeline of that instance's branch is still running. */
export const ciBusy = derived(_pipelines, ($pipelines) => {
	const busy: Record<string, boolean> = {};
	for (const [key, state] of Object.entries($pipelines)) {
		const latest = state.latest ?? state.pipelines[0];
		busy[key] = latest !== undefined && RUNNING.includes(latest.status);
	}
	return busy;
});

/** True when the latest pipeline of that instance's branch failed. */
export const ciFailing = derived(_pipelines, ($pipelines) => {
	const failing: Record<string, boolean> = {};
	for (const [key, state] of Object.entries($pipelines)) {
		failing[key] = (state.latest ?? state.pipelines[0])?.status === "failed";
	}
	return failing;
});

function activeKey(instance: { projectId: string; id: string } | null) {
	return instance ? integrationKey(instance.projectId, instance.id) : "";
}

/** The two flags above, resolved for the instance on screen. */
export const activeCiBusy = derived(
	[ciBusy, activeInstance],
	([$busy, $instance]) => $busy[activeKey($instance)] === true,
);
export const activeCiFailing = derived(
	[ciFailing, activeInstance],
	([$failing, $instance]) => $failing[activeKey($instance)] === true,
);

function selectId(list: Pipeline[], current: string): string {
	return list.some((p) => p.id === current) ? current : (list[0]?.id ?? "");
}

export async function loadPipelines(
	projectId: string,
	instanceId: string,
	ref: string,
	query?: PipelineQuery,
): Promise<void> {
	const key = integrationKey(projectId, instanceId);
	const active = query ?? (get(_pipelines)[key] ?? EMPTY).query;
	const ticket = nextTicket(key);
	patch(key, { isRefreshing: true, query: active });
	try {
		const { items, hasMore } = await ciListPipelines(
			projectId,
			ref,
			active,
			PIPELINE_PAGE_SIZE,
			1,
		);
		if (requestTickets[key] !== ticket) return;
		const state = get(_pipelines)[key] ?? EMPTY;
		const isFiltered = active.status !== null || active.text !== "";
		patch(key, {
			pipelines: items,
			latest: isFiltered ? state.latest : (items[0] ?? null),
			selectedPipelineId: selectId(items, state.selectedPipelineId),
			isLoaded: true,
			isRefreshing: false,
			hasMore,
			page: 1,
			error: null,
		});
	} catch (error) {
		if (requestTickets[key] !== ticket) return;
		patch(key, {
			isLoaded: true,
			isRefreshing: false,
			error: toIntegrationError(error),
		});
	}
}

/**
 * Replaces the filters and reloads from page 1. The provider applies them on
 * the whole branch history, so this is the only way to narrow the list - never
 * a filter over `state.pipelines`, which only holds the pages already fetched.
 */
export function setPipelineQuery(
	projectId: string,
	instanceId: string,
	ref: string,
	query: PipelineQuery,
): Promise<void> {
	return loadPipelines(projectId, instanceId, ref, query);
}

export async function loadMorePipelines(
	projectId: string,
	instanceId: string,
	ref: string,
): Promise<void> {
	const key = integrationKey(projectId, instanceId);
	const state = get(_pipelines)[key] ?? EMPTY;
	if (state.isLoadingMore || !state.hasMore) return;
	const nextPage = state.page + 1;
	const ticket = requestTickets[key] ?? 0;
	patch(key, { isLoadingMore: true });
	try {
		const { items, hasMore } = await ciListPipelines(
			projectId,
			ref,
			state.query,
			PIPELINE_PAGE_SIZE,
			nextPage,
		);
		if (requestTickets[key] !== ticket) return;
		const current = get(_pipelines)[key] ?? EMPTY;
		const known = new Set(current.pipelines.map((p) => p.id));
		const merged = [
			...current.pipelines,
			...items.filter((p) => !known.has(p.id)),
		];
		patch(key, {
			pipelines: merged,
			selectedPipelineId: selectId(merged, current.selectedPipelineId),
			isLoadingMore: false,
			hasMore,
			page: nextPage,
			error: null,
		});
	} catch (error) {
		if (requestTickets[key] !== ticket) return;
		patch(key, {
			isLoadingMore: false,
			error: toIntegrationError(error),
		});
	}
}

export async function refreshPipeline(
	projectId: string,
	instanceId: string,
	pipelineId: string,
): Promise<void> {
	try {
		const pipeline = await ciGetPipeline(projectId, pipelineId);
		applyUpdate(integrationKey(projectId, instanceId), pipeline);
	} catch (error) {
		patch(integrationKey(projectId, instanceId), {
			error: toIntegrationError(error),
		});
	}
}

/**
 * One pipeline as pushed by `integration-update` or fetched alone: replaces
 * its listed version, or is prepended when it is new. Applied by instance key,
 * so a late event lands on the instance that owns it, never on the one on
 * screen.
 *
 * It carries a single pipeline, so it must never claim the list itself is
 * loaded: the watcher starts with the instance, long before the CI step is
 * opened, and marking it loaded would leave the view showing that one pipeline
 * and skipping its own fetch. It also never prepends into a filtered list - the
 * filters are the provider's, and a pushed pipeline has not been through them.
 */
export function applyUpdate(key: string, pipeline: Pipeline): void {
	_pipelines.update((current) => {
		const state = current[key] ?? EMPTY;
		const known = state.pipelines.some((p) => p.id === pipeline.id);
		const latest =
			state.latest === null || state.latest.id === pipeline.id
				? pipeline
				: state.latest;
		if (!known && !state.query.status && !state.query.text) {
			const list = [pipeline, ...state.pipelines];
			return {
				...current,
				[key]: {
					...state,
					pipelines: list,
					latest,
					selectedPipelineId: selectId(list, state.selectedPipelineId),
					error: null,
				},
			};
		}
		if (!known) return { ...current, [key]: { ...state, latest } };
		return {
			...current,
			[key]: {
				...state,
				pipelines: state.pipelines.map((p) =>
					p.id === pipeline.id ? pipeline : p,
				),
				latest,
				error: null,
			},
		};
	});
}

export function selectPipeline(
	projectId: string,
	instanceId: string,
	pipelineId: string,
): void {
	patch(integrationKey(projectId, instanceId), {
		selectedPipelineId: pipelineId,
	});
}

export async function openJobLog(
	projectId: string,
	instanceId: string,
	jobId: string,
): Promise<void> {
	const key = integrationKey(projectId, instanceId);
	patch(key, { openJobId: jobId, jobLog: null, isLogLoading: true });
	try {
		const log = await ciJobLog(projectId, jobId);
		if ((get(_pipelines)[key] ?? EMPTY).openJobId !== jobId) return;
		patch(key, { jobLog: log, isLogLoading: false });
	} catch (error) {
		patch(key, { isLogLoading: false, error: toIntegrationError(error) });
	}
}

export function closeJobLog(projectId: string, instanceId: string): void {
	patch(integrationKey(projectId, instanceId), {
		openJobId: "",
		jobLog: null,
		isLogLoading: false,
	});
}

async function jobAction(
	projectId: string,
	instanceId: string,
	pipelineId: string,
	action: () => Promise<void>,
): Promise<void> {
	try {
		await action();
		await refreshPipeline(projectId, instanceId, pipelineId);
	} catch (error) {
		patch(integrationKey(projectId, instanceId), {
			error: toIntegrationError(error),
		});
	}
}

export function retryJob(
	projectId: string,
	instanceId: string,
	pipelineId: string,
	jobId: string,
): Promise<void> {
	return jobAction(projectId, instanceId, pipelineId, () =>
		ciRetryJob(projectId, jobId),
	);
}

export function playJob(
	projectId: string,
	instanceId: string,
	pipelineId: string,
	jobId: string,
): Promise<void> {
	return jobAction(projectId, instanceId, pipelineId, () =>
		ciPlayJob(projectId, jobId),
	);
}

export function cancelPipeline(
	projectId: string,
	instanceId: string,
	pipelineId: string,
): Promise<void> {
	return jobAction(projectId, instanceId, pipelineId, () =>
		ciCancelPipeline(projectId, pipelineId),
	);
}

/** Retries every failed job of the latest pipeline of the instance's branch. */
export async function retryLatestPipeline(
	projectId: string,
	instanceId: string,
): Promise<void> {
	const key = integrationKey(projectId, instanceId);
	const latest = (get(_pipelines)[key] ?? EMPTY).pipelines[0];
	if (!latest) return;
	const failed = latest.stages
		.flatMap((s) => s.jobs)
		.filter((j) => j.status === "failed" && j.canRetry);
	for (const job of failed) await ciRetryJob(projectId, job.id);
	await refreshPipeline(projectId, instanceId, latest.id);
}

export function clearPipelines(projectId: string, instanceId: string): void {
	_pipelines.update((current) => {
		const next = { ...current };
		delete next[integrationKey(projectId, instanceId)];
		return next;
	});
}

/** Forgets the pipeline state of every instance of a removed project. */
export function forgetProject(projectId: string): void {
	_pipelines.update((m) => dropProjectKeys(m, projectId));
}

onProjectRemoved(forgetProject);
