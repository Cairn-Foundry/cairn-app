import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MergeRequest, Pipeline } from "$lib/types/integrations";
import type { Project } from "$lib/types/project";
import { integrationKey } from "$lib/utils/integrations/instance-key";
import { activeProjectId, projects } from "./project";

const listeners = vi.hoisted(() => ({
	handler: null as null | ((u: unknown) => void),
	off: vi.fn(),
}));
const ciListPipelines = vi.hoisted(() => vi.fn());
const forgeFindMergeRequest = vi.hoisted(() => vi.fn());

const listInstances = vi.hoisted(() => vi.fn());
vi.mock("$lib/services/instance-service", () => ({
	listInstances,
	listBranchesDetailed: vi.fn(),
	createInstance: vi.fn(),
	deleteInstance: vi.fn(),
	duplicateInstance: vi.fn(),
	updateInstanceStatus: vi.fn(),
}));

vi.mock("./terminal", () => ({
	removeInstanceTerminals: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("$lib/services/integration-service", () => ({
	onIntegrationUpdate: (handler: (u: unknown) => void) => {
		listeners.handler = handler;
		return Promise.resolve(listeners.off);
	},
	integrationKinds: vi.fn(),
	listIntegrationConnections: vi.fn(),
	getProjectIntegrations: vi.fn(),
	getProjectCapabilities: vi.fn(),
	saveProjectIntegrations: vi.fn(),
	integrationWatch: vi.fn(),
	integrationUnwatch: vi.fn(),
	ciListPipelines,
	ciGetPipeline: vi.fn(),
	ciJobLog: vi.fn(),
	ciRetryJob: vi.fn(),
	ciCancelPipeline: vi.fn(),
	ciPlayJob: vi.fn(),
	forgeFindMergeRequest,
	forgeCreateMergeRequest: vi.fn(),
	forgeListDiscussions: vi.fn(),
	forgeReply: vi.fn(),
	forgeResolve: vi.fn(),
	forgeApprove: vi.fn(),
	toIntegrationError: (value: unknown) => ({
		code: "provider",
		message: String(value),
		retryAfterMs: null,
	}),
}));

import { loadInstances } from "./instance";
import { dispose, init, reduceIntegrationUpdate } from "./integrations";
import { mergeRequestStateFor, mergeRequests } from "./merge-request";
import {
	activeCiBusy,
	activeCiFailing,
	ciBusy,
	ciFailing,
	clearPipelines,
	loadMorePipelines,
	loadPipelines,
	pipelineStateFor,
	pipelines,
	selectPipeline,
	setPipelineQuery,
} from "./pipelines";

function pipeline(id: string, status: Pipeline["status"]): Pipeline {
	return {
		id,
		number: `#${id}`,
		status,
		ref: "feat/x",
		sha: "abc",
		title: "commit",
		source: "push",
		stages: [],
		startedAt: null,
		finishedAt: null,
		durationMs: null,
		url: `https://forge/pipelines/${id}`,
		failedJobId: null,
	};
}

function mergeRequest(id: string, title: string): MergeRequest {
	return {
		id,
		number: `!${id}`,
		title,
		description: "",
		state: "open",
		isDraft: false,
		sourceBranch: "feat/x",
		targetBranch: "main",
		author: { login: "ada", displayName: "Ada", avatarUrl: null },
		reviewers: [],
		assignees: [],
		labels: [],
		approvals: { approved: 0, required: null, approvedByMe: false },
		mergeable: "unknown",
		hasConflicts: false,
		headSha: "abc",
		pipelineStatus: null,
		url: `https://forge/mr/${id}`,
		createdAt: "",
		updatedAt: "",
	};
}

function project(id: string, activeInstanceId: string): Project {
	return {
		id,
		name: id,
		path: `/repo/${id}`,
		activeInstanceId,
	} as unknown as Project;
}

function instance(projectId: string, id: string) {
	return {
		id,
		projectId,
		ticket: { id: "", title: "" },
		branch: "feat/x",
		worktreePath: `/repo/${projectId}/${id}`,
		status: "idle",
		createdAt: 0,
		baseBranch: "main",
	};
}

const A = integrationKey("p1", "i1");
const B = integrationKey("p1", "i2");

beforeEach(() => {
	dispose();
	clearPipelines("p1", "i1");
	clearPipelines("p1", "i2");
	listeners.handler = null;
	listeners.off.mockClear();
});

describe("integration-update reduction", () => {
	it("routes a pipeline update to the instance that owns it, not the other one", () => {
		reduceIntegrationUpdate({
			projectId: "p1",
			instanceId: "i1",
			kind: "pipeline",
			data: pipeline("1", "running"),
		});
		reduceIntegrationUpdate({
			projectId: "p1",
			instanceId: "i2",
			kind: "pipeline",
			data: pipeline("2", "failed"),
		});
		const state = get(pipelines);
		expect(
			pipelineStateFor(state, "p1", "i1").pipelines.map((p) => p.id),
		).toEqual(["1"]);
		expect(
			pipelineStateFor(state, "p1", "i2").pipelines.map((p) => p.id),
		).toEqual(["2"]);
		expect(get(ciBusy)[A]).toBe(true);
		expect(get(ciFailing)[A]).toBe(false);
		expect(get(ciBusy)[B]).toBe(false);
		expect(get(ciFailing)[B]).toBe(true);
	});

	it("replaces a known pipeline in place and keeps the selection", () => {
		reduceIntegrationUpdate({
			projectId: "p1",
			instanceId: "i1",
			kind: "pipeline",
			data: pipeline("1", "running"),
		});
		reduceIntegrationUpdate({
			projectId: "p1",
			instanceId: "i1",
			kind: "pipeline",
			data: pipeline("3", "running"),
		});
		selectPipeline("p1", "i1", "1");
		reduceIntegrationUpdate({
			projectId: "p1",
			instanceId: "i1",
			kind: "pipeline",
			data: pipeline("1", "success"),
		});
		const state = pipelineStateFor(get(pipelines), "p1", "i1");
		expect(state.pipelines.map((p) => `${p.id}:${p.status}`)).toEqual([
			"3:running",
			"1:success",
		]);
		expect(state.selectedPipelineId).toBe("1");
	});

	it("lands a late event on its instance after the user switched to another", async () => {
		listInstances.mockResolvedValue([
			instance("p1", "i1"),
			instance("p1", "i2"),
		]);
		await loadInstances("p1");
		projects.set([project("p1", "i2")]);
		activeProjectId.set("p1");
		ciListPipelines.mockResolvedValue({
			items: [pipeline("9", "running")],
			hasMore: false,
		});
		await loadPipelines("p1", "i1", "feat/x");
		expect(get(activeCiBusy)).toBe(false);

		reduceIntegrationUpdate({
			projectId: "p1",
			instanceId: "i1",
			kind: "pipeline",
			data: pipeline("9", "failed"),
		});
		expect(get(ciFailing)[A]).toBe(true);
		expect(get(activeCiFailing)).toBe(false);

		reduceIntegrationUpdate({
			projectId: "p1",
			instanceId: "i2",
			kind: "pipeline",
			data: pipeline("10", "failed"),
		});
		expect(get(activeCiFailing)).toBe(true);
	});

	it("routes a merge request update by instance", () => {
		reduceIntegrationUpdate({
			projectId: "p1",
			instanceId: "i1",
			kind: "merge_request",
			data: mergeRequest("12", "first"),
		});
		reduceIntegrationUpdate({
			projectId: "p1",
			instanceId: "i2",
			kind: "merge_request",
			data: mergeRequest("13", "second"),
		});
		reduceIntegrationUpdate({
			projectId: "p1",
			instanceId: "i1",
			kind: "merge_request",
			data: mergeRequest("12", "renamed"),
		});
		const state = get(mergeRequests);
		expect(mergeRequestStateFor(state, "p1", "i1").mergeRequest?.title).toBe(
			"renamed",
		);
		expect(mergeRequestStateFor(state, "p1", "i2").mergeRequest?.title).toBe(
			"second",
		);
	});

	it("still fetches the full list after the watcher pushed the latest pipeline", async () => {
		reduceIntegrationUpdate({
			projectId: "p1",
			instanceId: "i1",
			kind: "pipeline",
			data: pipeline("1237", "failed"),
		});
		const watched = pipelineStateFor(get(pipelines), "p1", "i1");
		expect(watched.pipelines).toHaveLength(1);
		expect(watched.isLoaded).toBe(false);

		ciListPipelines.mockResolvedValue({
			items: [
				pipeline("1237", "failed"),
				pipeline("1236", "failed"),
				pipeline("1235", "failed"),
			],
			hasMore: false,
		});
		await loadPipelines("p1", "i1", "v0-17");

		const state = pipelineStateFor(get(pipelines), "p1", "i1");
		expect(state.pipelines.map((p) => p.id)).toEqual(["1237", "1236", "1235"]);
	});

	it("keeps a filtered list intact when the watcher pushes an unrelated pipeline", async () => {
		ciListPipelines.mockResolvedValue({
			items: [pipeline("1235", "success")],
			hasMore: false,
		});
		await setPipelineQuery("p1", "i1", "v0-17", {
			status: "success",
			text: "",
			username: null,
			source: null,
		});

		reduceIntegrationUpdate({
			projectId: "p1",
			instanceId: "i1",
			kind: "pipeline",
			data: pipeline("1240", "running"),
		});

		const state = pipelineStateFor(get(pipelines), "p1", "i1");
		expect(state.pipelines.map((p) => p.id)).toEqual(["1235"]);
		expect(get(ciBusy)[A]).toBe(true);
	});

	it("hands the filters to the provider instead of narrowing the loaded page", async () => {
		ciListPipelines.mockResolvedValue({
			items: [pipeline("9", "failed")],
			hasMore: true,
		});
		await setPipelineQuery("p1", "i1", "feat/x", {
			status: "failed",
			text: "flaky",
			username: null,
			source: null,
		});

		expect(ciListPipelines).toHaveBeenLastCalledWith(
			"p1",
			"feat/x",
			expect.objectContaining({ status: "failed", text: "flaky" }),
			20,
			1,
		);
		const state = pipelineStateFor(get(pipelines), "p1", "i1");
		expect(state.pipelines.map((p) => p.id)).toEqual(["9"]);
		expect(state.hasMore).toBe(true);
	});

	it("keeps the active filters when paginating, and never duplicates a pipeline", async () => {
		ciListPipelines.mockResolvedValue({
			items: [pipeline("9", "failed")],
			hasMore: true,
		});
		await setPipelineQuery("p1", "i1", "feat/x", {
			status: "failed",
			text: "",
			username: null,
			source: null,
		});

		ciListPipelines.mockResolvedValue({
			items: [pipeline("9", "failed"), pipeline("8", "failed")],
			hasMore: false,
		});
		await loadMorePipelines("p1", "i1", "feat/x");

		expect(ciListPipelines).toHaveBeenLastCalledWith(
			"p1",
			"feat/x",
			expect.objectContaining({ status: "failed" }),
			20,
			2,
		);
		const state = pipelineStateFor(get(pipelines), "p1", "i1");
		expect(state.pipelines.map((p) => p.id)).toEqual(["9", "8"]);
		expect(state.hasMore).toBe(false);
	});

	it("drops a slow answer whose filter is no longer the one on screen", async () => {
		let releaseStale: (value: unknown) => void = () => {};
		ciListPipelines.mockReturnValueOnce(
			new Promise((resolve) => {
				releaseStale = resolve;
			}),
		);
		const stale = setPipelineQuery("p1", "i1", "feat/x", {
			status: "success",
			text: "",
			username: null,
			source: null,
		});

		ciListPipelines.mockResolvedValue({
			items: [pipeline("7", "failed")],
			hasMore: false,
		});
		await setPipelineQuery("p1", "i1", "feat/x", {
			status: "failed",
			text: "",
			username: null,
			source: null,
		});

		releaseStale({ items: [pipeline("1", "success")], hasMore: true });
		await stale;

		const state = pipelineStateFor(get(pipelines), "p1", "i1");
		expect(state.pipelines.map((p) => p.id)).toEqual(["7"]);
		expect(state.hasMore).toBe(false);
	});

	it("owns a single listener and detaches it on dispose", async () => {
		init();
		init();
		await Promise.resolve();
		expect(listeners.handler).not.toBeNull();
		listeners.handler?.({
			projectId: "p1",
			instanceId: "i2",
			kind: "pipeline",
			data: pipeline("4", "success"),
		});
		expect(
			pipelineStateFor(get(pipelines), "p1", "i2").pipelines.some(
				(p) => p.id === "4",
			),
		).toBe(true);
		dispose();
		expect(listeners.off).toHaveBeenCalledTimes(1);
	});
});
