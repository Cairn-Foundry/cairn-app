// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	EMPTY_PIPELINE_QUERY,
	type JobLog,
	type Pipeline,
} from "#lib/types/integrations";
import { integrationKey } from "#lib/utils/integrations/instance-key";
import { instance, project } from "../../test/fixtures";
import { loadInstances } from "./instance";
import { activeProjectId, projects } from "./project";

const ciListPipelines = vi.hoisted(() => vi.fn());
const ciGetPipeline = vi.hoisted(() => vi.fn());
const ciRetryJob = vi.hoisted(() => vi.fn());
const ciPlayJob = vi.hoisted(() => vi.fn());
const ciCancelPipeline = vi.hoisted(() => vi.fn());
const ciJobLog = vi.hoisted(() => vi.fn());
const listInstances = vi.hoisted(() => vi.fn());

vi.mock("#lib/services/instance-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	listInstances,
}));

vi.mock("#lib/services/integration-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	ciListPipelines,
	ciGetPipeline,
	ciRetryJob,
	ciPlayJob,
	ciCancelPipeline,
	ciJobLog,
}));

import {
	activeCiBusy,
	activeCiFailing,
	applyUpdate,
	cancelPipeline,
	ciBusy,
	ciFailing,
	clearPipelines,
	closeJobLog,
	loadMorePipelines,
	loadPipelines,
	openJobLog,
	PIPELINE_PAGE_SIZE,
	pipelineStateFor,
	pipelines,
	playJob,
	refreshPipeline,
	retryJob,
	retryLatestPipeline,
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

describe("activeCiBusy", () => {
	it("is false while no instance is on screen", () => {
		activeProjectId.set(null);
		projects.set([]);
		applyUpdate(KEY, pipeline("1", "running"));
		applyUpdate("Elench", pipeline("2", "running"));
		expect(get(activeCiBusy)).toBe(false);
	});

	it("is true for the running pipeline of the instance on screen", async () => {
		listInstances.mockResolvedValue([
			instance("i1", "p1", { branch: "feat/x" }),
		]);
		await loadInstances("p1");
		projects.set([project("p1", { activeInstanceId: "i1" })]);
		activeProjectId.set("p1");
		applyUpdate(KEY, pipeline("1", "running"));
		expect(get(activeCiBusy)).toBe(true);
		expect(get(activeCiFailing)).toBe(false);
	});
});

describe("the latest pipeline of a filtered first load", () => {
	const filtered = { ...EMPTY_PIPELINE_QUERY, status: "running" as const };

	it("falls back to the first listed pipeline for the busy flag", async () => {
		ciListPipelines.mockResolvedValue({
			items: [pipeline("1", "running")],
			hasMore: false,
		});
		await loadPipelines("p1", "i1", "feat/x", filtered);
		expect(state().latest).toBeNull();
		expect(get(ciBusy)[KEY]).toBe(true);
	});

	it("falls back to the first listed pipeline for the failing flag", async () => {
		ciListPipelines.mockResolvedValue({
			items: [pipeline("1", "failed")],
			hasMore: false,
		});
		await loadPipelines("p1", "i1", "feat/x", filtered);
		expect(get(ciFailing)[KEY]).toBe(true);
	});
});

describe("loadPipelines on an empty answer", () => {
	it("leaves no latest pipeline and no selection", async () => {
		await loadPipelines("p1", "i1", "feat/x");
		expect(state().latest).toBeNull();
		expect(state().selectedPipelineId).toBe("");
	});
});

describe("state cleared while a request is in flight", () => {
	const pending = () => {
		let release!: (v: unknown) => void;
		ciListPipelines.mockImplementationOnce(
			() =>
				new Promise((r) => {
					release = r;
				}),
		);
		return (v: unknown) => release(v);
	};

	it("still stores the answer of a first load", async () => {
		const release = pending();
		const loading = loadPipelines("p1", "i1", "feat/x");
		clearPipelines("p1", "i1");
		release({ items: [pipeline("1")], hasMore: false });
		await loading;
		expect(ids()).toEqual(["1"]);
		expect(state().error).toBeNull();
	});

	it("still merges the answer of a further page", async () => {
		ciListPipelines.mockResolvedValue({
			items: [pipeline("1")],
			hasMore: true,
		});
		await loadPipelines("p1", "i1", "feat/x");
		const release = pending();
		const more = loadMorePipelines("p1", "i1", "feat/x");
		clearPipelines("p1", "i1");
		release({ items: [pipeline("0")], hasMore: false });
		await more;
		expect(ids()).toEqual(["0"]);
		expect(state().error).toBeNull();
	});

	it("still stores a job log", async () => {
		let release!: (v: unknown) => void;
		ciJobLog.mockImplementationOnce(
			() =>
				new Promise((r) => {
					release = r;
				}),
		);
		const opening = openJobLog("p1", "i1", "j1");
		clearPipelines("p1", "i1");
		release({ text: "x" });
		await opening;
		expect(state().error).toBeNull();
	});
});

describe("loadMorePipelines on an instance that never loaded", () => {
	it("asks for the first page of it and drops the answer", async () => {
		ciListPipelines.mockResolvedValue({
			items: [pipeline("1")],
			hasMore: false,
		});
		await expect(
			loadMorePipelines("never", "loaded", "feat/x"),
		).resolves.toBeUndefined();
		expect(ciListPipelines).toHaveBeenCalledWith(
			"never",
			"feat/x",
			EMPTY_PIPELINE_QUERY,
			20,
			1,
		);
		expect(
			pipelineStateFor(get(pipelines), "never", "loaded").pipelines,
		).toEqual([]);
	});
});

describe("applyUpdate on a filtered list", () => {
	it("keeps the error of a pipeline it does not list", async () => {
		ciListPipelines.mockResolvedValue({
			items: [pipeline("1")],
			hasMore: false,
		});
		await loadPipelines("p1", "i1", "feat/x", {
			...EMPTY_PIPELINE_QUERY,
			status: "failed",
		});
		ciGetPipeline.mockRejectedValue(new Error("403"));
		await refreshPipeline("p1", "i1", "1");
		expect(state().error).not.toBeNull();
		applyUpdate(KEY, pipeline("2"));
		expect(state().error).not.toBeNull();
	});
});

describe("loadPipelines when the answer is stale", () => {
	it("drops a failure that a newer request replaced", async () => {
		let rejectFirst!: (e: unknown) => void;
		ciListPipelines.mockImplementationOnce(
			() =>
				new Promise((_, reject) => {
					rejectFirst = reject;
				}),
		);
		const slow = loadPipelines("p1", "i1", "feat/x");
		ciListPipelines.mockResolvedValue({
			items: [pipeline("fresh")],
			hasMore: false,
		});
		await loadPipelines("p1", "i1", "feat/x");
		rejectFirst(new Error("403"));
		await slow;
		expect(ids()).toEqual(["fresh"]);
		expect(state().error).toBeNull();
	});
});

describe("loadMorePipelines", () => {
	beforeEach(async () => {
		ciListPipelines.mockResolvedValue({
			items: [pipeline("2"), pipeline("1")],
			hasMore: true,
		});
		await loadPipelines("p1", "i1", "feat/x");
		ciListPipelines.mockClear();
	});

	it("appends the next page without duplicating a known pipeline", async () => {
		ciListPipelines.mockResolvedValue({
			items: [pipeline("1"), pipeline("0")],
			hasMore: false,
		});
		await loadMorePipelines("p1", "i1", "feat/x");
		expect(ciListPipelines).toHaveBeenCalledWith(
			"p1",
			"feat/x",
			EMPTY_PIPELINE_QUERY,
			20,
			2,
		);
		expect(ids()).toEqual(["2", "1", "0"]);
		expect(state()).toMatchObject({
			hasMore: false,
			page: 2,
			isLoadingMore: false,
			error: null,
		});
	});

	it("asks nothing when there is no further page", async () => {
		ciListPipelines.mockResolvedValue({ items: [], hasMore: false });
		await loadMorePipelines("p1", "i1", "feat/x");
		ciListPipelines.mockClear();
		await loadMorePipelines("p1", "i1", "feat/x");
		expect(ciListPipelines).not.toHaveBeenCalled();
	});

	it("asks nothing while a page is already loading", async () => {
		let release!: (v: unknown) => void;
		ciListPipelines.mockImplementationOnce(
			() =>
				new Promise((r) => {
					release = r;
				}),
		);
		const first = loadMorePipelines("p1", "i1", "feat/x");
		await loadMorePipelines("p1", "i1", "feat/x");
		expect(ciListPipelines).toHaveBeenCalledTimes(1);
		release({ items: [], hasMore: false });
		await first;
	});

	it("records a failure and lowers the loading flag", async () => {
		ciListPipelines.mockRejectedValue(new Error("500"));
		await expect(
			loadMorePipelines("p1", "i1", "feat/x"),
		).resolves.toBeUndefined();
		expect(state().error?.message).toBe("Error: 500");
		expect(state().isLoadingMore).toBe(false);
		expect(state().page).toBe(1);
		expect(ids()).toEqual(["2", "1"]);
	});

	it("drops a page that a reload replaced", async () => {
		let release!: (v: unknown) => void;
		ciListPipelines.mockImplementationOnce(
			() =>
				new Promise((r) => {
					release = r;
				}),
		);
		const more = loadMorePipelines("p1", "i1", "feat/x");
		ciListPipelines.mockResolvedValue({
			items: [pipeline("fresh")],
			hasMore: true,
		});
		await loadPipelines("p1", "i1", "feat/x");
		release({ items: [pipeline("late")], hasMore: false });
		await more;
		expect(ids()).toEqual(["fresh"]);
		expect(state().page).toBe(1);
	});

	it("drops a failure that a reload replaced", async () => {
		let reject!: (e: unknown) => void;
		ciListPipelines.mockImplementationOnce(
			() =>
				new Promise((_, r) => {
					reject = r;
				}),
		);
		const more = loadMorePipelines("p1", "i1", "feat/x");
		ciListPipelines.mockResolvedValue({
			items: [pipeline("fresh")],
			hasMore: true,
		});
		await loadPipelines("p1", "i1", "feat/x");
		reject(new Error("500"));
		await more;
		expect(state().error).toBeNull();
		expect(ids()).toEqual(["fresh"]);
	});
});

describe("refreshPipeline", () => {
	it("replaces the listed pipeline with the fetched one", async () => {
		ciListPipelines.mockResolvedValue({
			items: [pipeline("1", "running")],
			hasMore: false,
		});
		await loadPipelines("p1", "i1", "feat/x");
		ciGetPipeline.mockResolvedValue(pipeline("1", "success"));
		await refreshPipeline("p1", "i1", "1");
		expect(ciGetPipeline).toHaveBeenCalledWith("p1", "1");
		expect(state().pipelines[0].status).toBe("success");
	});

	it("records a failure instead of throwing", async () => {
		ciGetPipeline.mockRejectedValue(new Error("404"));
		await expect(refreshPipeline("p1", "i1", "1")).resolves.toBeUndefined();
		expect(state().error?.message).toBe("Error: 404");
	});
});

describe("job log", () => {
	const log = (text: string) => ({ text }) as unknown as JobLog;

	it("opens the log of a job and stores it", async () => {
		ciJobLog.mockResolvedValue(log("output"));
		await openJobLog("p1", "i1", "j1");
		expect(ciJobLog).toHaveBeenCalledWith("p1", "j1");
		expect(state()).toMatchObject({
			openJobId: "j1",
			jobLog: log("output"),
			isLogLoading: false,
		});
	});

	it("shows the loading state and no log while it is fetched", async () => {
		let release!: (v: unknown) => void;
		ciJobLog.mockImplementationOnce(
			() =>
				new Promise((r) => {
					release = r;
				}),
		);
		const opening = openJobLog("p1", "i1", "j1");
		expect(state()).toMatchObject({
			openJobId: "j1",
			jobLog: null,
			isLogLoading: true,
		});
		release(log("done"));
		await opening;
	});

	it("drops a log whose job is no longer the open one", async () => {
		let release!: (v: unknown) => void;
		ciJobLog.mockImplementationOnce(
			() =>
				new Promise((r) => {
					release = r;
				}),
		);
		const first = openJobLog("p1", "i1", "j1");
		closeJobLog("p1", "i1");
		release(log("late"));
		await first;
		expect(state()).toMatchObject({
			openJobId: "",
			jobLog: null,
			isLogLoading: false,
		});
	});

	it("records a failure and stops loading", async () => {
		ciJobLog.mockRejectedValue(new Error("410"));
		await openJobLog("p1", "i1", "j1");
		expect(state().error?.message).toBe("Error: 410");
		expect(state().isLogLoading).toBe(false);
		expect(state().jobLog).toBeNull();
	});

	it("closes the log", async () => {
		ciJobLog.mockResolvedValue(log("output"));
		await openJobLog("p1", "i1", "j1");
		closeJobLog("p1", "i1");
		expect(state()).toMatchObject({
			openJobId: "",
			jobLog: null,
			isLogLoading: false,
		});
	});
});

describe("job actions", () => {
	beforeEach(() => {
		ciRetryJob.mockResolvedValue(undefined);
		ciPlayJob.mockResolvedValue(undefined);
		ciCancelPipeline.mockResolvedValue(undefined);
		ciGetPipeline.mockResolvedValue(pipeline("7", "running"));
	});

	it("retries a job then refreshes its pipeline", async () => {
		await retryJob("p1", "i1", "7", "j1");
		expect(ciRetryJob).toHaveBeenCalledWith("p1", "j1");
		expect(ciGetPipeline).toHaveBeenCalledWith("p1", "7");
		expect(ids()).toEqual(["7"]);
	});

	it("plays a job then refreshes its pipeline", async () => {
		await playJob("p1", "i1", "7", "j2");
		expect(ciPlayJob).toHaveBeenCalledWith("p1", "j2");
		expect(ciGetPipeline).toHaveBeenCalledWith("p1", "7");
	});

	it("cancels a pipeline then refreshes it", async () => {
		await cancelPipeline("p1", "i1", "7");
		expect(ciCancelPipeline).toHaveBeenCalledWith("p1", "7");
		expect(ciGetPipeline).toHaveBeenCalledWith("p1", "7");
	});

	it("records the failure and skips the refresh when the action is refused", async () => {
		ciRetryJob.mockRejectedValue(new Error("403"));
		await expect(retryJob("p1", "i1", "7", "j1")).resolves.toBeUndefined();
		expect(state().error?.message).toBe("Error: 403");
		expect(ciGetPipeline).not.toHaveBeenCalled();
	});
});

describe("tag pipelines", () => {
	const TAGS = { ...EMPTY_PIPELINE_QUERY, tags: true };

	it("keeps the branch's latest pipeline while the tags are listed", async () => {
		ciListPipelines.mockResolvedValue({
			items: [pipeline("1")],
			hasMore: false,
		});
		await loadPipelines("p1", "i1", "feat/x");
		ciListPipelines.mockResolvedValue({
			items: [pipeline("7", "failed")],
			hasMore: false,
		});
		await setPipelineQuery("p1", "i1", "feat/x", TAGS);
		expect(ids()).toEqual(["7"]);
		expect(state().latest?.id).toBe("1");
		expect(get(ciFailing)[KEY]).toBe(false);
	});

	it("never inserts a pushed branch pipeline into the tag list", async () => {
		ciListPipelines.mockResolvedValue({
			items: [pipeline("7")],
			hasMore: false,
		});
		await setPipelineQuery("p1", "i1", "feat/x", TAGS);
		applyUpdate(KEY, pipeline("8"));
		expect(ids()).toEqual(["7"]);
	});
});

describe("tag pipelines refresh", () => {
	it("never adopts a refreshed tag pipeline as the branch's latest", async () => {
		ciListPipelines.mockResolvedValue({ items: [], hasMore: false });
		await loadPipelines("p1", "i1", "feat/x");
		ciListPipelines.mockResolvedValue({
			items: [pipeline("7", "running")],
			hasMore: false,
		});
		await setPipelineQuery("p1", "i1", "feat/x", {
			...EMPTY_PIPELINE_QUERY,
			tags: true,
		});
		applyUpdate(KEY, pipeline("7", "success"));
		expect(state().latest).toBeNull();
		expect(state().pipelines[0].status).toBe("success");
	});
});

describe("tag pipelines paging", () => {
	it("fills a page the provider left short when loading more", async () => {
		ciListPipelines.mockResolvedValueOnce({
			items: Array.from({ length: PIPELINE_PAGE_SIZE }, (_, i) =>
				pipeline(`a${i}`),
			),
			hasMore: true,
		});
		await setPipelineQuery("p1", "i1", "feat/x", {
			...EMPTY_PIPELINE_QUERY,
			tags: true,
		});
		ciListPipelines
			.mockResolvedValueOnce({ items: [], hasMore: true })
			.mockResolvedValueOnce({ items: [pipeline("b")], hasMore: false });
		await loadMorePipelines("p1", "i1", "feat/x");
		expect(ids()).toContain("b");
		expect(state().page).toBe(3);
		expect(state().hasMore).toBe(false);
	});

	const TAGS = { ...EMPTY_PIPELINE_QUERY, tags: true };

	it("keeps fetching pages while the provider's filter leaves one short", async () => {
		ciListPipelines
			.mockResolvedValueOnce({ items: [], hasMore: true })
			.mockResolvedValueOnce({ items: [pipeline("7")], hasMore: true })
			.mockResolvedValueOnce({ items: [pipeline("5")], hasMore: false });
		await setPipelineQuery("p1", "i1", "feat/x", TAGS);
		expect(ids()).toEqual(["7", "5"]);
		expect(ciListPipelines.mock.calls.map((c) => c[4])).toEqual([1, 2, 3]);
		expect(state().page).toBe(3);
		expect(state().hasMore).toBe(false);
	});

	it("stops at the page cap", async () => {
		ciListPipelines.mockResolvedValue({ items: [], hasMore: true });
		await setPipelineQuery("p1", "i1", "feat/x", TAGS);
		expect(ciListPipelines).toHaveBeenCalledTimes(10);
		expect(state().isRefreshing).toBe(false);
	});
});

describe("tag pipelines state", () => {
	const TAGS = { ...EMPTY_PIPELINE_QUERY, tags: true };

	it("forgets the latest pipeline of another branch when switching branch in tag mode", async () => {
		ciListPipelines.mockResolvedValue({
			items: [pipeline("1", "failed")],
			hasMore: false,
		});
		await loadPipelines("p1", "i1", "feat/a");
		ciListPipelines.mockResolvedValue({
			items: [pipeline("7")],
			hasMore: false,
		});
		await setPipelineQuery("p1", "i1", "feat/a", TAGS);
		await loadPipelines("p1", "i1", "feat/b");
		expect(state().latest).toBeNull();
		applyUpdate(KEY, pipeline("2", "success"));
		expect(state().latest?.id).toBe("2");
		expect(get(ciFailing)[KEY]).toBe(false);
	});

	it("lowers the loading flag when a reload replaces a load more", async () => {
		ciListPipelines.mockResolvedValue({
			items: [pipeline("2")],
			hasMore: true,
		});
		await loadPipelines("p1", "i1", "feat/x");
		let release!: (v: unknown) => void;
		ciListPipelines.mockImplementationOnce(
			() =>
				new Promise((r) => {
					release = r;
				}),
		);
		const more = loadMorePipelines("p1", "i1", "feat/x");
		ciListPipelines.mockResolvedValue({
			items: [pipeline("7")],
			hasMore: true,
		});
		await setPipelineQuery("p1", "i1", "feat/x", TAGS);
		release({ items: [pipeline("late")], hasMore: false });
		await more;
		expect(state().isLoadingMore).toBe(false);
		ciListPipelines.mockClear();
		await loadMorePipelines("p1", "i1", "feat/x");
		expect(ciListPipelines).toHaveBeenCalled();
	});
});

describe("retryLatestPipeline", () => {
	const job = (id: string, status: string, canRetry: boolean) => ({
		id,
		status,
		canRetry,
	});
	const withJobs = (id: string, jobs: ReturnType<typeof job>[]): Pipeline =>
		({
			id,
			status: "failed",
			stages: [{ jobs: jobs.slice(0, 2) }, { jobs: jobs.slice(2) }],
		}) as unknown as Pipeline;

	beforeEach(() => {
		ciRetryJob.mockResolvedValue(undefined);
		ciGetPipeline.mockResolvedValue(pipeline("9", "running"));
	});

	it("retries only the failed and retryable jobs of every stage, then refreshes", async () => {
		ciListPipelines.mockResolvedValue({
			items: [
				withJobs("9", [
					job("a", "failed", true),
					job("b", "success", true),
					job("c", "failed", false),
					job("d", "failed", true),
				]),
				withJobs("8", [job("old", "failed", true)]),
			],
			hasMore: false,
		});
		await loadPipelines("p1", "i1", "feat/x");
		await retryLatestPipeline("p1", "i1");
		expect(ciRetryJob.mock.calls).toEqual([
			["p1", "a"],
			["p1", "d"],
		]);
		expect(ciGetPipeline).toHaveBeenCalledWith("p1", "9");
	});

	it("never retries a tag pipeline while the branch's latest is unknown", async () => {
		ciListPipelines.mockResolvedValue({
			items: [withJobs("7", [job("deploy", "failed", true)])],
			hasMore: false,
		});
		await setPipelineQuery("p1", "i1", "feat/x", {
			...EMPTY_PIPELINE_QUERY,
			tags: true,
		});
		await retryLatestPipeline("p1", "i1");
		expect(ciRetryJob).not.toHaveBeenCalled();
	});

	it("does nothing when the instance has no pipeline", async () => {
		await retryLatestPipeline("p1", "i1");
		expect(ciRetryJob).not.toHaveBeenCalled();
		expect(ciGetPipeline).not.toHaveBeenCalled();
	});
});
