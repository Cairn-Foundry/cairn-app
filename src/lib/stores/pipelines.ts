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
import type {
	IntegrationError,
	JobLog,
	Pipeline,
	PipelineStatus,
} from "$lib/types/integrations";
import { integrationKey } from "$lib/utils/integrations/instance-key";
import { activeInstance } from "./instance";

export const PIPELINE_LIMIT = 5;

const RUNNING: PipelineStatus[] = ["pending", "running"];

export interface InstancePipelineState {
	pipelines: Pipeline[];
	selectedPipelineId: string;
	openJobId: string;
	jobLog: JobLog | null;
	isLoaded: boolean;
	isRefreshing: boolean;
	isLogLoading: boolean;
	error: IntegrationError | null;
}

const EMPTY: InstancePipelineState = {
	pipelines: [],
	selectedPipelineId: "",
	openJobId: "",
	jobLog: null,
	isLoaded: false,
	isRefreshing: false,
	isLogLoading: false,
	error: null,
};

const _pipelines = writable<Record<string, InstancePipelineState>>({});

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
		const latest = state.pipelines[0];
		busy[key] = latest !== undefined && RUNNING.includes(latest.status);
	}
	return busy;
});

/** True when the latest pipeline of that instance's branch failed. */
export const ciFailing = derived(_pipelines, ($pipelines) => {
	const failing: Record<string, boolean> = {};
	for (const [key, state] of Object.entries($pipelines)) {
		failing[key] = state.pipelines[0]?.status === "failed";
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

/** Newest first, capped, the selection kept when its pipeline is still listed. */
function merge(
	state: InstancePipelineState,
	incoming: Pipeline[],
): Partial<InstancePipelineState> {
	const list = incoming.slice(0, PIPELINE_LIMIT);
	const selected = list.some((p) => p.id === state.selectedPipelineId)
		? state.selectedPipelineId
		: (list[0]?.id ?? "");
	return { pipelines: list, selectedPipelineId: selected };
}

export async function loadPipelines(
	projectId: string,
	instanceId: string,
	ref: string,
	limit = PIPELINE_LIMIT,
): Promise<void> {
	const key = integrationKey(projectId, instanceId);
	patch(key, { isRefreshing: true });
	try {
		const list = await ciListPipelines(projectId, ref, limit);
		const state = get(_pipelines)[key] ?? EMPTY;
		patch(key, {
			...merge(state, list),
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
 */
export function applyUpdate(key: string, pipeline: Pipeline): void {
	_pipelines.update((current) => {
		const state = current[key] ?? EMPTY;
		const known = state.pipelines.some((p) => p.id === pipeline.id);
		const list = known
			? state.pipelines.map((p) => (p.id === pipeline.id ? pipeline : p))
			: [pipeline, ...state.pipelines];
		return {
			...current,
			[key]: { ...state, ...merge(state, list), isLoaded: true, error: null },
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
