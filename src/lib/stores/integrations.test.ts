// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	getProjectCapabilities,
	getProjectIntegrations,
	integrationKinds,
	listIntegrationConnections,
	saveProjectIntegrations as saveProjectIntegrationsService,
} from "#lib/services/integration-service";
import type {
	IntegrationConnection,
	IntegrationKindDescriptor,
	MergeRequest,
	Pipeline,
	ProjectIntegrations,
	ResolvedCapabilities,
} from "#lib/types/integrations";
import { integrationKey } from "#lib/utils/integrations/instance-key";
import { instance, project } from "../../test/fixtures";
import { activeProjectId, projects } from "./project";
import { runProjectTeardowns } from "./project-teardown";

const listeners = vi.hoisted(() => ({
	handler: null as null | ((u: unknown) => void),
	off: vi.fn(),
	registrations: 0,
}));
const ciListPipelines = vi.hoisted(() => vi.fn());
const forgeFindMergeRequest = vi.hoisted(() => vi.fn());

const listInstances = vi.hoisted(() => vi.fn());
vi.mock("#lib/services/instance-service", () => ({
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

vi.mock("#lib/services/integration-service", () => ({
	onIntegrationUpdate: (handler: (u: unknown) => void) => {
		listeners.handler = handler;
		listeners.registrations += 1;
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
import {
	bindingsByProject,
	capabilities,
	capabilitiesOf,
	connections,
	connectionsError,
	dispose,
	EMPTY_BINDINGS,
	forgeIdentity,
	forgeTerms,
	forgetProject,
	hasCi,
	hasForge,
	hasTracker,
	init,
	kindDescriptors,
	loadConnections,
	loadKinds,
	loadProjectIntegrations,
	NO_CAPABILITIES,
	projectBindings,
	reduceIntegrationUpdate,
	saveProjectIntegrations,
} from "./integrations";
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

const A = integrationKey("p1", "i1");
const B = integrationKey("p1", "i2");

beforeEach(() => {
	dispose();
	clearPipelines("p1", "i1");
	clearPipelines("p1", "i2");
	listeners.handler = null;
	listeners.registrations = 0;
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
			instance("i1", "p1", { branch: "feat/x" }),
			instance("i2", "p1", { branch: "feat/x" }),
		]);
		await loadInstances("p1");
		projects.set([project("p1", { activeInstanceId: "i2" })]);
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

	it("ignores an update of a kind it does not own", () => {
		reduceIntegrationUpdate({
			projectId: "p1",
			instanceId: "i3",
			kind: "discussion",
			data: mergeRequest("14", "stray"),
		} as never);
		expect(
			mergeRequestStateFor(get(mergeRequests), "p1", "i3").mergeRequest,
		).toBeNull();
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
		expect(listeners.registrations).toBe(1);
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

describe("loadKinds", () => {
	const kinds = [{ id: "gitlab" }] as unknown as IntegrationKindDescriptor[];

	beforeEach(() => {
		kindDescriptors.set([]);
		vi.mocked(integrationKinds).mockReset();
	});

	it("stores the descriptors the backend lists", async () => {
		vi.mocked(integrationKinds).mockResolvedValue(kinds);
		await loadKinds();
		expect(get(kindDescriptors)).toEqual(kinds);
	});

	it("stores an empty list when the backend answers nothing", async () => {
		vi.mocked(integrationKinds).mockResolvedValue(
			undefined as unknown as IntegrationKindDescriptor[],
		);
		await loadKinds();
		expect(get(kindDescriptors)).toEqual([]);
	});

	it("does not ask again once descriptors are loaded", async () => {
		kindDescriptors.set(kinds);
		await loadKinds();
		expect(integrationKinds).not.toHaveBeenCalled();
		expect(get(kindDescriptors)).toEqual(kinds);
	});
});

describe("loadConnections", () => {
	const list = [{ id: "c1" }] as unknown as IntegrationConnection[];

	beforeEach(() => {
		connections.set([]);
		connectionsError.set(null);
		vi.mocked(listIntegrationConnections).mockReset();
	});

	it("stores the connections and clears a previous error", async () => {
		connectionsError.set({
			code: "provider",
			message: "old",
			retryAfterMs: null,
		});
		vi.mocked(listIntegrationConnections).mockResolvedValue(list);
		await loadConnections();
		expect(get(connections)).toEqual(list);
		expect(get(connectionsError)).toBeNull();
	});

	it("stores an empty list when the backend answers nothing", async () => {
		connections.set(list);
		vi.mocked(listIntegrationConnections).mockResolvedValue(
			undefined as unknown as IntegrationConnection[],
		);
		await loadConnections();
		expect(get(connections)).toEqual([]);
	});

	it("records the failure and keeps the connections it had", async () => {
		connections.set(list);
		vi.mocked(listIntegrationConnections).mockRejectedValue(new Error("down"));
		await expect(loadConnections()).resolves.toBeUndefined();
		expect(get(connectionsError)).toEqual({
			code: "provider",
			message: "Error: down",
			retryAfterMs: null,
		});
		expect(get(connections)).toEqual(list);
	});
});

describe("project bindings and capabilities", () => {
	const bindings = {
		...EMPTY_BINDINGS,
		forge: { connectionId: "c1" },
	} as unknown as ProjectIntegrations;
	const resolved = {
		...NO_CAPABILITIES,
		ci: { kind: "gitlab" },
	} as unknown as ResolvedCapabilities;

	beforeEach(() => {
		forgetProject("px");
		vi.mocked(getProjectIntegrations).mockReset();
		vi.mocked(getProjectCapabilities).mockReset();
		vi.mocked(saveProjectIntegrationsService).mockReset();
	});

	it("answers no capabilities for a project that never loaded", () => {
		expect(capabilitiesOf("px")).toBe(NO_CAPABILITIES);
	});

	it("answers the capabilities loaded for the project, not another one", async () => {
		vi.mocked(getProjectIntegrations).mockResolvedValue(bindings);
		vi.mocked(getProjectCapabilities).mockResolvedValue(resolved);
		await loadProjectIntegrations("px");
		expect(capabilitiesOf("px")).toBe(resolved);
		expect(capabilitiesOf("py")).toBe(NO_CAPABILITIES);
		expect(get(bindingsByProject).px).toBe(bindings);
	});

	it("falls back to empty bindings and capabilities when the backend answers nothing", async () => {
		vi.mocked(getProjectIntegrations).mockResolvedValue(
			undefined as unknown as ProjectIntegrations,
		);
		vi.mocked(getProjectCapabilities).mockResolvedValue(
			undefined as unknown as ResolvedCapabilities,
		);
		await loadProjectIntegrations("px");
		expect(get(bindingsByProject).px).toBe(EMPTY_BINDINGS);
		expect(capabilitiesOf("px")).toBe(NO_CAPABILITIES);
	});

	it("saves the bindings, keeps them and refreshes the capabilities", async () => {
		vi.mocked(saveProjectIntegrationsService).mockResolvedValue(bindings);
		vi.mocked(getProjectCapabilities).mockResolvedValue(resolved);
		await saveProjectIntegrations("px", bindings);
		expect(saveProjectIntegrationsService).toHaveBeenCalledWith("px", bindings);
		expect(getProjectCapabilities).toHaveBeenCalledWith("px");
		expect(get(bindingsByProject).px).toBe(bindings);
		expect(capabilitiesOf("px")).toBe(resolved);
	});

	it("falls back to no capabilities when the refresh answers nothing", async () => {
		vi.mocked(saveProjectIntegrationsService).mockResolvedValue(bindings);
		vi.mocked(getProjectCapabilities).mockResolvedValue(
			undefined as unknown as ResolvedCapabilities,
		);
		await saveProjectIntegrations("px", bindings);
		expect(capabilitiesOf("px")).toBe(NO_CAPABILITIES);
	});

	it("keeps the old bindings when the save is refused", async () => {
		vi.mocked(saveProjectIntegrationsService).mockRejectedValue(
			new Error("403"),
		);
		await expect(saveProjectIntegrations("px", bindings)).rejects.toThrow(
			"403",
		);
		expect(get(bindingsByProject).px).toBeUndefined();
		expect(getProjectCapabilities).not.toHaveBeenCalled();
	});

	it("forgets a removed project", async () => {
		vi.mocked(getProjectIntegrations).mockResolvedValue(bindings);
		vi.mocked(getProjectCapabilities).mockResolvedValue(resolved);
		await loadProjectIntegrations("px");
		forgetProject("px");
		expect(get(bindingsByProject).px).toBeUndefined();
		expect(capabilitiesOf("px")).toBe(NO_CAPABILITIES);
	});
});

describe("active project views", () => {
	const connection = (id: string, identity: string | null) =>
		({ id, identity }) as unknown as IntegrationConnection;
	const forgeCapability = (mergeRequest: "mr" | "pr") =>
		({
			...NO_CAPABILITIES,
			forge: { kind: "github", label: "GitHub", terms: { mergeRequest } },
		}) as unknown as ResolvedCapabilities;

	beforeEach(() => {
		forgetProject("pv");
		activeProjectId.set("pv");
		connections.set([]);
		vi.mocked(getProjectIntegrations).mockReset();
		vi.mocked(getProjectCapabilities).mockReset();
	});

	it("falls back to the empty bindings and capabilities while the project is unloaded", () => {
		expect(get(projectBindings)).toBe(EMPTY_BINDINGS);
		expect(get(capabilities)).toBe(NO_CAPABILITIES);
	});

	it("falls back to the empty ones when no project is active", () => {
		activeProjectId.set(null);
		expect(get(projectBindings)).toBe(EMPTY_BINDINGS);
		expect(get(capabilities)).toBe(NO_CAPABILITIES);
	});

	it("exposes the bindings and capabilities of the active project", async () => {
		const bindings = {
			...EMPTY_BINDINGS,
			ci: { connectionId: "c1" },
		} as unknown as ProjectIntegrations;
		const resolved = forgeCapability("pr");
		vi.mocked(getProjectIntegrations).mockResolvedValue(bindings);
		vi.mocked(getProjectCapabilities).mockResolvedValue(resolved);
		await loadProjectIntegrations("pv");
		expect(get(projectBindings)).toBe(bindings);
		expect(get(capabilities)).toBe(resolved);
	});

	it("reports which capabilities are present as booleans", async () => {
		expect(get(hasTracker)).toBe(false);
		expect(get(hasForge)).toBe(false);
		expect(get(hasCi)).toBe(false);
		vi.mocked(getProjectIntegrations).mockResolvedValue(EMPTY_BINDINGS);
		vi.mocked(getProjectCapabilities).mockResolvedValue({
			tracker: { kind: "jira", label: "Jira" },
			forge: null,
			ci: { kind: "gitlab", label: "GitLab" },
		} as unknown as ResolvedCapabilities);
		await loadProjectIntegrations("pv");
		expect(get(hasTracker)).toBe(true);
		expect(get(hasForge)).toBe(false);
		expect(get(hasCi)).toBe(true);
	});

	it("speaks merge request by default and follows the forge's own term", async () => {
		expect(get(forgeTerms)).toBe("mr");
		vi.mocked(getProjectIntegrations).mockResolvedValue(EMPTY_BINDINGS);
		vi.mocked(getProjectCapabilities).mockResolvedValue(forgeCapability("pr"));
		await loadProjectIntegrations("pv");
		expect(get(forgeTerms)).toBe("pr");
	});

	it("answers the identity of the bound forge connection", async () => {
		connections.set([connection("c1", "ada"), connection("c2", "bob")]);
		expect(get(forgeIdentity)).toBeNull();
		vi.mocked(getProjectIntegrations).mockResolvedValue({
			...EMPTY_BINDINGS,
			forge: { connectionId: "c2" },
		} as unknown as ProjectIntegrations);
		vi.mocked(getProjectCapabilities).mockResolvedValue(NO_CAPABILITIES);
		await loadProjectIntegrations("pv");
		expect(get(forgeIdentity)).toBe("bob");
	});

	it("answers null when the bound connection is unknown", async () => {
		connections.set([connection("c1", "ada")]);
		vi.mocked(getProjectIntegrations).mockResolvedValue({
			...EMPTY_BINDINGS,
			forge: { connectionId: "gone" },
		} as unknown as ProjectIntegrations);
		vi.mocked(getProjectCapabilities).mockResolvedValue(NO_CAPABILITIES);
		await loadProjectIntegrations("pv");
		expect(get(forgeIdentity)).toBeNull();
	});

	it("is cleared by the project teardown registry", async () => {
		vi.mocked(getProjectIntegrations).mockResolvedValue(EMPTY_BINDINGS);
		vi.mocked(getProjectCapabilities).mockResolvedValue(forgeCapability("mr"));
		await loadProjectIntegrations("pv");
		await runProjectTeardowns("pv");
		expect(get(bindingsByProject).pv).toBeUndefined();
		expect(capabilitiesOf("pv")).toBe(NO_CAPABILITIES);
	});
});
