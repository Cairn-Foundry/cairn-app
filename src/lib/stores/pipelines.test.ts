// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_PIPELINE_QUERY, type Pipeline } from "$lib/types/integrations";
import { integrationKey } from "$lib/utils/integrations/instance-key";

const ciListPipelines = vi.hoisted(() => vi.fn());
const ciGetPipeline = vi.hoisted(() => vi.fn());
const ciRetryJob = vi.hoisted(() => vi.fn());
const ciPlayJob = vi.hoisted(() => vi.fn());
const ciCancelPipeline = vi.hoisted(() => vi.fn());
const ciJobLog = vi.hoisted(() => vi.fn());

vi.mock("$lib/services/integration-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	ciListPipelines,
	ciGetPipeline,
	ciRetryJob,
	ciPlayJob,
	ciCancelPipeline,
	ciJobLog,
}));

import {
	applyUpdate,
	clearPipelines,
	loadPipelines,
	pipelineStateFor,
	pipelines,
	selectPipeline,
	setPipelineQuery,
} from "./pipelines";

const KEY = integrationKey("p1", "i1");

const pipeline = (id: string, status = "success"): Pipeline =>
	({ id, status, jobs: [] }) as unknown as Pipeline;

/** The pipeline state of p1:i1 as the view reads it. */
const state = () => pipelineStateFor(get(pipelines), "p1", "i1");
const ids = () => state().pipelines.map((p) => p.id);

beforeEach(() => {
	vi.clearAllMocks();
	ciListPipelines.mockResolvedValue({ items: [], hasMore: false });
	ciGetPipeline.mockResolvedValue(null);
	clearPipelines("p1", "i1");
	clearPipelines("p1", "i2");
});

describe("pipelineStateFor", () => {
	it("answers an empty state for an instance that never loaded", () => {
		expect(pipelineStateFor({}, "p1", "i1")).toMatchObject({
			pipelines: [],
			latest: null,
		});
	});
});

describe("loadPipelines", () => {
	it("stores the pipelines of the branch", async () => {
		ciListPipelines.mockResolvedValue({
			items: [pipeline("2"), pipeline("1")],
			hasMore: false,
		});
		await loadPipelines("p1", "i1", "feat/x");
		expect(ids()).toEqual(["2", "1"]);
	});

	it("keeps the newest pipeline as the latest one", async () => {
		ciListPipelines.mockResolvedValue({
			items: [pipeline("2"), pipeline("1")],
			hasMore: false,
		});
		await loadPipelines("p1", "i1", "feat/x");
		expect(state().latest?.id).toBe("2");
	});

	it("records a failure instead of throwing", async () => {
		ciListPipelines.mockRejectedValue(new Error("403"));
		await expect(loadPipelines("p1", "i1", "feat/x")).resolves.toBeUndefined();
		expect(state().error).not.toBeNull();
	});

	it("keeps instances apart", async () => {
		ciListPipelines.mockResolvedValue({
			items: [pipeline("a")],
			hasMore: false,
		});
		await loadPipelines("p1", "i1", "feat/a");
		ciListPipelines.mockResolvedValue({
			items: [pipeline("b")],
			hasMore: false,
		});
		await loadPipelines("p1", "i2", "feat/b");
		expect(ids()).toEqual(["a"]);
		expect(
			pipelineStateFor(get(pipelines), "p1", "i2").pipelines.map((p) => p.id),
		).toEqual(["b"]);
	});

	/**
	 * Each request carries a ticket; a response whose ticket is stale is
	 * dropped, so a slow answer for an abandoned filter cannot overwrite the
	 * list the user is now looking at.
	 */
	it("drops a slow answer that a newer request replaced", async () => {
		let releaseFirst!: (v: unknown) => void;
		ciListPipelines.mockImplementationOnce(
			() =>
				new Promise((r) => {
					releaseFirst = r;
				}),
		);
		const slow = loadPipelines("p1", "i1", "feat/x");
		ciListPipelines.mockResolvedValue({
			items: [pipeline("fresh")],
			hasMore: false,
		});
		await loadPipelines("p1", "i1", "feat/x");
		releaseFirst({ items: [pipeline("stale")], hasMore: false });
		await slow;
		expect(ids()).toEqual(["fresh"]);
	});
});

describe("applyUpdate", () => {
	it("adds a pipeline nobody had seen yet", () => {
		applyUpdate(KEY, pipeline("1"));
		expect(ids()).toEqual(["1"]);
	});

	it("replaces a pipeline it already knows, keeping its position", async () => {
		ciListPipelines.mockResolvedValue({
			items: [pipeline("2"), pipeline("1")],
			hasMore: false,
		});
		await loadPipelines("p1", "i1", "feat/x");
		applyUpdate(KEY, pipeline("1", "failed"));
		expect(ids()).toEqual(["2", "1"]);
		expect(state().pipelines[1].status).toBe("failed");
	});

	it("prepends a new pipeline, since it is the most recent", async () => {
		ciListPipelines.mockResolvedValue({
			items: [pipeline("1")],
			hasMore: false,
		});
		await loadPipelines("p1", "i1", "feat/x");
		applyUpdate(KEY, pipeline("2"));
		expect(ids()).toEqual(["2", "1"]);
	});

	/**
	 * The filters are the provider's; a pushed pipeline never went through
	 * them, so it must not be inserted into a filtered list.
	 */
	it("never inserts into a list filtered by status", async () => {
		ciListPipelines.mockResolvedValue({
			items: [pipeline("1")],
			hasMore: false,
		});
		await loadPipelines("p1", "i1", "feat/x");
		await setPipelineQuery("p1", "i1", "feat/x", {
			...EMPTY_PIPELINE_QUERY,
			status: "failed",
		});
		applyUpdate(KEY, pipeline("2"));
		expect(ids()).not.toContain("2");
	});

	it("never inserts into a list filtered by text", async () => {
		ciListPipelines.mockResolvedValue({
			items: [pipeline("1")],
			hasMore: false,
		});
		await loadPipelines("p1", "i1", "feat/x");
		await setPipelineQuery("p1", "i1", "feat/x", {
			...EMPTY_PIPELINE_QUERY,
			text: "deploy",
		});
		applyUpdate(KEY, pipeline("2"));
		expect(ids()).not.toContain("2");
	});

	/**
	 * `latest` only moves for the pipeline it already names, or when nothing
	 * was known yet: a pushed event for some other pipeline never promotes
	 * itself over the one the listing established.
	 */
	it("keeps the known latest when an unrelated pipeline is pushed", async () => {
		ciListPipelines.mockResolvedValue({
			items: [pipeline("1")],
			hasMore: false,
		});
		await loadPipelines("p1", "i1", "feat/x");
		await setPipelineQuery("p1", "i1", "feat/x", {
			...EMPTY_PIPELINE_QUERY,
			status: "failed",
		});
		applyUpdate(KEY, pipeline("2"));
		expect(state().latest?.id).toBe("1");
	});

	it("adopts a pushed pipeline as the latest when none was known", () => {
		applyUpdate(KEY, pipeline("first"));
		expect(state().latest?.id).toBe("first");
	});

	it("keeps the filtered list untouched by that push", async () => {
		ciListPipelines.mockResolvedValue({
			items: [pipeline("1")],
			hasMore: false,
		});
		await loadPipelines("p1", "i1", "feat/x");
		await setPipelineQuery("p1", "i1", "feat/x", {
			...EMPTY_PIPELINE_QUERY,
			status: "failed",
		});
		applyUpdate(KEY, pipeline("2"));
		expect(ids()).toEqual(["1"]);
	});

	it("updates a known pipeline even in a filtered list", async () => {
		ciListPipelines.mockResolvedValue({
			items: [pipeline("1")],
			hasMore: false,
		});
		await loadPipelines("p1", "i1", "feat/x");
		await setPipelineQuery("p1", "i1", "feat/x", {
			...EMPTY_PIPELINE_QUERY,
			status: "failed",
		});
		applyUpdate(KEY, pipeline("1", "failed"));
		expect(state().pipelines[0].status).toBe("failed");
	});

	it("keeps the latest pointing at the same pipeline when that one updates", () => {
		applyUpdate(KEY, pipeline("1", "running"));
		applyUpdate(KEY, pipeline("1", "success"));
		expect(state().latest).toMatchObject({ id: "1", status: "success" });
	});

	it("selects the new pipeline when nothing was selected", () => {
		applyUpdate(KEY, pipeline("1"));
		expect(state().selectedPipelineId).toBe("1");
	});

	it("leaves the user's selection alone", async () => {
		ciListPipelines.mockResolvedValue({
			items: [pipeline("1")],
			hasMore: false,
		});
		await loadPipelines("p1", "i1", "feat/x");
		selectPipeline("p1", "i1", "1");
		applyUpdate(KEY, pipeline("2"));
		expect(state().selectedPipelineId).toBe("1");
	});

	it("clears a previous error", async () => {
		ciListPipelines.mockRejectedValue(new Error("403"));
		await loadPipelines("p1", "i1", "feat/x");
		applyUpdate(KEY, pipeline("1"));
		expect(state().error).toBeNull();
	});

	it("lands on its own instance even after the user switched", async () => {
		await loadPipelines("p1", "i2", "feat/b");
		applyUpdate(KEY, pipeline("for-i1"));
		expect(ids()).toEqual(["for-i1"]);
		expect(pipelineStateFor(get(pipelines), "p1", "i2").pipelines).toEqual([]);
	});
});

describe("selectPipeline", () => {
	it("records the selected pipeline", () => {
		selectPipeline("p1", "i1", "1");
		expect(state().selectedPipelineId).toBe("1");
	});
});

describe("clearPipelines", () => {
	it("forgets everything about the instance", async () => {
		ciListPipelines.mockResolvedValue({
			items: [pipeline("1")],
			hasMore: false,
		});
		await loadPipelines("p1", "i1", "feat/x");
		clearPipelines("p1", "i1");
		expect(state().pipelines).toEqual([]);
		expect(state().latest).toBeNull();
	});

	it("leaves the other instances alone", async () => {
		ciListPipelines.mockResolvedValue({
			items: [pipeline("b")],
			hasMore: false,
		});
		await loadPipelines("p1", "i2", "feat/b");
		clearPipelines("p1", "i1");
		expect(pipelineStateFor(get(pipelines), "p1", "i2").pipelines).toHaveLength(
			1,
		);
	});
});
