// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { get, writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InstancePipelineState } from "$lib/stores/pipelines";
import type { Pipeline, PipelineJob } from "$lib/types/integrations";

const openUrl = vi.fn(async (..._a: unknown[]) => {});
vi.mock("@tauri-apps/plugin-opener", () => ({
	openUrl: (...a: unknown[]) => openUrl(...a),
}));

const pipelinesState = writable<Record<string, InstancePipelineState>>({});
const loadPipelines = vi.fn(async (..._a: unknown[]) => {});
const loadMorePipelines = vi.fn(async (..._a: unknown[]) => {});
const selectPipeline = vi.fn((..._a: unknown[]) => undefined);
const setPipelineQuery = vi.fn(async (..._a: unknown[]) => {});
const openJobLog = vi.fn(async (..._a: unknown[]) => {});
const closeJobLog = vi.fn((..._a: unknown[]) => undefined);
const retryJob = vi.fn(async (..._a: unknown[]) => {});
const playJob = vi.fn(async (..._a: unknown[]) => {});
const cancelPipeline = vi.fn(async (..._a: unknown[]) => {});
vi.mock("$lib/stores/pipelines", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	pipelines: { subscribe: pipelinesState.subscribe },
	loadPipelines: (...a: unknown[]) => loadPipelines(...a),
	loadMorePipelines: (...a: unknown[]) => loadMorePipelines(...a),
	selectPipeline: (...a: unknown[]) => selectPipeline(...a),
	setPipelineQuery: (...a: unknown[]) => setPipelineQuery(...a),
	openJobLog: (...a: unknown[]) => openJobLog(...a),
	closeJobLog: (...a: unknown[]) => closeJobLog(...a),
	retryJob: (...a: unknown[]) => retryJob(...a),
	playJob: (...a: unknown[]) => playJob(...a),
	cancelPipeline: (...a: unknown[]) => cancelPipeline(...a),
}));

const capabilities = writable<Record<string, unknown>>({});
const hasCi = writable(true);
vi.mock("$lib/stores/integrations", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	capabilities: { subscribe: capabilities.subscribe },
	hasCi: { subscribe: hasCi.subscribe },
}));

const activeInstance = writable<unknown>(null);
vi.mock("$lib/stores/instance", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	activeInstance: { subscribe: activeInstance.subscribe },
}));

const gitState = writable({ currentBranch: "" });
vi.mock("$lib/stores/git", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	git: { subscribe: gitState.subscribe },
}));

const requestAgentDraft = vi.fn((..._a: unknown[]) => undefined);
vi.mock("$lib/stores/agent-draft", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	requestAgentDraft: (...a: unknown[]) => requestAgentDraft(...a),
}));

const { EMPTY_PIPELINE_QUERY } = await import("$lib/types/integrations");
const { activeProjectId } = await import("$lib/stores/project");
const { activeStep } = await import("$lib/stores/ui");
const { default: CiCdView } = await import(
	"$lib/components/cicd/CiCdView.svelte"
);

function job(overrides: Partial<PipelineJob> = {}): PipelineJob {
	return {
		id: "j1",
		name: "build",
		status: "success",
		durationMs: 5000,
		startedAt: "2026-01-01T10:00:00Z",
		canRetry: false,
		canCancel: false,
		isManual: false,
		url: "https://forge/job/1",
		...overrides,
	};
}

function pipeline(overrides: Partial<Pipeline> = {}): Pipeline {
	return {
		id: "p-1",
		number: "#1",
		status: "success",
		ref: "feature",
		sha: "abcdef1234567890",
		title: "a commit",
		source: "push",
		stages: [{ name: "build", status: "success", jobs: [job()] }],
		startedAt: "2026-01-01T10:00:00Z",
		finishedAt: "2026-01-01T10:05:00Z",
		durationMs: 300000,
		url: "https://forge/pipeline/1",
		failedJobId: null,
		...overrides,
	};
}

function state(
	overrides: Partial<InstancePipelineState> = {},
): InstancePipelineState {
	return {
		pipelines: [pipeline()],
		latest: null,
		query: EMPTY_PIPELINE_QUERY,
		selectedPipelineId: "p-1",
		openJobId: "",
		jobLog: null,
		isLoaded: true,
		isRefreshing: false,
		isLoadingMore: false,
		isLogLoading: false,
		hasMore: false,
		page: 1,
		error: null,
		...overrides,
	};
}

function setState(overrides: Partial<InstancePipelineState> = {}) {
	pipelinesState.set({ "p1:i1": state(overrides) });
}

function mount() {
	const onGoIntegrations = vi.fn((..._a: unknown[]) => undefined);
	render(CiCdView, {
		props: {},
		events: { goIntegrations: () => onGoIntegrations() },
	});
	return { onGoIntegrations };
}

const cards = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".pipeline"));
const jobButtons = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".stage-job.job-btn"));
const chipByText = (re: RegExp) =>
	Array.from(document.querySelectorAll<HTMLElement>(".filter-chip")).find((c) =>
		re.test(c.textContent ?? ""),
	) as HTMLElement;
const buttonBy = (re: RegExp) =>
	Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
		re.test(b.textContent ?? ""),
	) as HTMLButtonElement;
const actionIn = (root: ParentNode, label: RegExp) =>
	Array.from(root.querySelectorAll<HTMLButtonElement>(".job-action")).find(
		(b) => label.test(b.getAttribute("aria-label") ?? ""),
	) as HTMLButtonElement;
const logLines = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".log-body .line"));
const failureLines = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".log-body .line.failure"));
const searchField = () =>
	document.querySelector(".ci-search") as HTMLInputElement;

async function settle() {
	await tick();
	await tick();
}

/** Types into the search box without letting the debounce fire mid-word. */
async function typeSearch(text: string) {
	const input = searchField();
	input.focus();
	for (const char of text) {
		input.value += char;
		input.dispatchEvent(new Event("input", { bubbles: true }));
	}
	await settle();
}

beforeEach(() => {
	vi.useRealTimers();
	openUrl.mockClear();
	loadPipelines.mockClear();
	loadMorePipelines.mockClear();
	selectPipeline.mockClear();
	setPipelineQuery.mockClear();
	openJobLog.mockClear();
	closeJobLog.mockClear();
	retryJob.mockClear();
	playJob.mockClear();
	cancelPipeline.mockClear();
	requestAgentDraft.mockClear();
	hasCi.set(true);
	capabilities.set({
		ci: { label: "GitLab CI" },
		forge: { webUrl: "https://forge/repo", kind: "gitlab" },
	});
	gitState.set({ currentBranch: "" });
	activeProjectId.set("p1");
	activeInstance.set({ id: "i1", branch: "feature" });
	activeStep.set("cicd");
	setState();
});

describe("CiCdView", () => {
	describe("without a CI bound", () => {
		it("points at the integrations rather than an empty list", async () => {
			hasCi.set(false);
			const { onGoIntegrations } = mount();
			await userEvent.click(document.querySelector(".btn") as HTMLElement);
			expect(onGoIntegrations).toHaveBeenCalled();
			expect(cards()).toHaveLength(0);
		});

		it("loads nothing", async () => {
			hasCi.set(false);
			mount();
			await settle();
			expect(loadPipelines).not.toHaveBeenCalled();
		});
	});

	describe("loading the branch's pipelines", () => {
		it("loads the pipelines of the instance's branch", async () => {
			mount();
			await settle();
			expect(loadPipelines).toHaveBeenCalledWith("p1", "i1", "feature");
		});

		/**
		 * The base pseudo-instance has no branch of its own, so the checked out
		 * one is what its pipelines hang off.
		 */
		it("falls back to the checked out branch for an instance with none", async () => {
			activeInstance.set({ id: "i1", branch: "" });
			gitState.set({ currentBranch: "main" });
			mount();
			await settle();
			expect(loadPipelines).toHaveBeenCalledWith("p1", "i1", "main");
		});

		it("loads nothing with no branch at all", async () => {
			activeInstance.set({ id: "i1", branch: "" });
			mount();
			await settle();
			expect(loadPipelines).not.toHaveBeenCalled();
		});

		it("loads once for the same branch", async () => {
			mount();
			await settle();
			activeInstance.set({ id: "i1", branch: "feature" });
			await settle();
			expect(loadPipelines).toHaveBeenCalledTimes(1);
		});

		it("loads again when the branch changes", async () => {
			mount();
			await settle();
			activeInstance.set({ id: "i1", branch: "other" });
			await settle();
			expect(loadPipelines).toHaveBeenCalledTimes(2);
		});

		it("reloads on request", async () => {
			mount();
			await settle();
			loadPipelines.mockClear();
			await userEvent.click(buttonBy(/refresh|actualiser/i));
			expect(loadPipelines).toHaveBeenCalledWith("p1", "i1", "feature");
		});

		it("shows what the provider refused", () => {
			setState({ error: { code: "forbidden", message: "" } as never });
			mount();
			expect(document.querySelector(".error-banner")).not.toBeNull();
		});

		it("says the branch has no pipeline yet", () => {
			setState({ pipelines: [] });
			mount();
			expect(document.querySelector(".empty-state")).not.toBeNull();
		});
	});

	describe("the pipeline list", () => {
		it("lists every pipeline", () => {
			setState({
				pipelines: [pipeline({ id: "a" }), pipeline({ id: "b" })],
			});
			mount();
			expect(cards()).toHaveLength(2);
		});

		it("shows the commit by its short sha", () => {
			mount();
			expect(document.querySelector(".commit .selectable")?.textContent).toBe(
				"abcdef1",
			);
		});

		/** Only the selected pipeline is expanded; the rest are dimmed. */
		it("expands the selected pipeline alone", () => {
			setState({
				pipelines: [pipeline({ id: "a" }), pipeline({ id: "b" })],
				selectedPipelineId: "b",
			});
			mount();
			expect(cards()[0].classList.contains("dimmed")).toBe(true);
			expect(cards()[1].classList.contains("dimmed")).toBe(false);
		});

		/** With nothing selected yet the newest pipeline stands in. */
		it("expands the first pipeline when none is selected", () => {
			setState({
				pipelines: [pipeline({ id: "a" }), pipeline({ id: "b" })],
				selectedPipelineId: "",
			});
			mount();
			expect(cards()[0].classList.contains("dimmed")).toBe(false);
		});

		it("selects a dimmed pipeline when its head is used", async () => {
			setState({
				pipelines: [pipeline({ id: "a" }), pipeline({ id: "b" })],
				selectedPipelineId: "a",
			});
			mount();
			await userEvent.click(
				cards()[1].querySelector(".pipeline-head") as HTMLElement,
			);
			expect(selectPipeline).toHaveBeenCalledWith("p1", "i1", "b");
		});

		it("does not reselect the pipeline already expanded", async () => {
			mount();
			await userEvent.click(
				cards()[0].querySelector(".pipeline-head") as HTMLElement,
			);
			expect(selectPipeline).not.toHaveBeenCalled();
		});

		/** Reaching the end of the list asks the provider for the next page. */
		it("asks for more when the list is scrolled to its end", async () => {
			setState({ hasMore: true });
			mount();
			const list = document.querySelector(".pipeline-list") as HTMLElement;
			Object.defineProperty(list, "scrollHeight", { value: 1000 });
			Object.defineProperty(list, "clientHeight", { value: 500 });
			list.scrollTop = 400;
			list.dispatchEvent(new Event("scroll", { bubbles: true }));
			await settle();
			expect(loadMorePipelines).toHaveBeenCalledWith("p1", "i1", "feature");
		});

		it("asks for nothing while still far from the end", async () => {
			setState({ hasMore: true });
			mount();
			const list = document.querySelector(".pipeline-list") as HTMLElement;
			Object.defineProperty(list, "scrollHeight", { value: 1000 });
			Object.defineProperty(list, "clientHeight", { value: 500 });
			list.scrollTop = 100;
			list.dispatchEvent(new Event("scroll", { bubbles: true }));
			await settle();
			expect(loadMorePipelines).not.toHaveBeenCalled();
		});

		it("asks for nothing once there is no more to load", async () => {
			setState({ hasMore: false });
			mount();
			const list = document.querySelector(".pipeline-list") as HTMLElement;
			Object.defineProperty(list, "scrollHeight", { value: 1000 });
			Object.defineProperty(list, "clientHeight", { value: 500 });
			list.scrollTop = 400;
			list.dispatchEvent(new Event("scroll", { bubbles: true }));
			await settle();
			expect(loadMorePipelines).not.toHaveBeenCalled();
		});
	});

	describe("filtering", () => {
		it("narrows the whole history to one status", async () => {
			mount();
			await userEvent.click(chipByText(/^failed$/i));
			expect(setPipelineQuery).toHaveBeenCalledWith("p1", "i1", "feature", {
				...EMPTY_PIPELINE_QUERY,
				status: "failed",
				text: "",
			});
		});

		/** Clicking the active status chip again clears it. */
		it("clears the status when its chip is used again", async () => {
			mount();
			await userEvent.click(chipByText(/^failed$/i));
			await userEvent.click(chipByText(/^failed$/i));
			expect(setPipelineQuery.mock.calls[1][3]).toMatchObject({ status: null });
		});

		it("clears the status with the all-statuses chip", async () => {
			mount();
			await userEvent.click(chipByText(/^failed$/i));
			await userEvent.click(chipByText(/^all$/i));
			expect(setPipelineQuery.mock.calls[1][3]).toMatchObject({ status: null });
		});

		/** The search is debounced, so a whole word is one query, not five. */
		it("searches once the typing has settled", async () => {
			vi.useFakeTimers();
			mount();
			await typeSearch("build");
			expect(setPipelineQuery).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(300);
			expect(setPipelineQuery).toHaveBeenCalledTimes(1);
			expect(setPipelineQuery.mock.calls[0][3]).toMatchObject({
				text: "build",
			});
		});

		it("trims the search before sending it", async () => {
			vi.useFakeTimers();
			mount();
			await typeSearch("  build  ");
			await vi.advanceTimersByTimeAsync(300);
			expect(setPipelineQuery.mock.calls[0][3]).toMatchObject({
				text: "build",
			});
		});

		it("says nothing matched rather than nothing exists", async () => {
			vi.useFakeTimers();
			setState({ pipelines: [] });
			mount();
			await typeSearch("zzz");
			await vi.advanceTimersByTimeAsync(300);
			await settle();
			expect(document.body.textContent).toMatch(/no.*match|aucun/i);
		});
	});

	describe("the jobs", () => {
		it("opens the log of the job that was clicked", async () => {
			mount();
			await userEvent.click(jobButtons()[0]);
			expect(openJobLog).toHaveBeenCalledWith("p1", "i1", "j1");
		});

		it("closes it when the same job is clicked again", async () => {
			setState({ openJobId: "j1" });
			mount();
			await userEvent.click(jobButtons()[0]);
			expect(closeJobLog).toHaveBeenCalledWith("p1", "i1");
			expect(openJobLog).not.toHaveBeenCalled();
		});

		/** Opening a job of a dimmed pipeline expands that pipeline too. */
		it("selects the pipeline of the job that was opened", async () => {
			setState({
				pipelines: [pipeline({ id: "a" }), pipeline({ id: "b" })],
				selectedPipelineId: "a",
			});
			mount();
			await userEvent.click(
				cards()[1].querySelector(".stage-job.job-btn") as HTMLElement,
			);
			expect(selectPipeline).toHaveBeenCalledWith("p1", "i1", "b");
		});

		it("retries the job that was asked for", async () => {
			setState({
				pipelines: [
					pipeline({
						stages: [
							{
								name: "build",
								status: "failed",
								jobs: [job({ status: "failed", canRetry: true })],
							},
						],
					}),
				],
			});
			mount();
			await userEvent.click(actionIn(document, /retry|relancer|réessayer/i));
			expect(retryJob).toHaveBeenCalledWith("p1", "i1", "p-1", "j1");
		});

		it("plays a manual job", async () => {
			setState({
				pipelines: [
					pipeline({
						stages: [
							{
								name: "deploy",
								status: "pending",
								jobs: [job({ status: "pending", isManual: true })],
							},
						],
					}),
				],
			});
			mount();
			await userEvent.click(actionIn(document, /^run$/i));
			expect(playJob).toHaveBeenCalledWith("p1", "i1", "p-1", "j1");
		});

		it("cancels a running job", async () => {
			setState({
				pipelines: [
					pipeline({
						status: "running",
						stages: [
							{
								name: "build",
								status: "running",
								jobs: [job({ status: "running", canCancel: true })],
							},
						],
					}),
				],
			});
			mount();
			await userEvent.click(actionIn(document, /cancel|annuler/i));
			expect(cancelPipeline).toHaveBeenCalledWith("p1", "i1", "p-1");
		});

		/** A job action must not double as opening its log. */
		it("does not open the log when a job action is used", async () => {
			setState({
				pipelines: [
					pipeline({
						stages: [
							{
								name: "build",
								status: "failed",
								jobs: [job({ status: "failed", canRetry: true })],
							},
						],
					}),
				],
			});
			mount();
			await userEvent.click(actionIn(document, /retry|relancer|réessayer/i));
			expect(openJobLog).not.toHaveBeenCalled();
		});

		it("offers no action for a job that allows none", () => {
			mount();
			expect(document.querySelector(".job-action")).toBeNull();
		});
	});

	describe("the job log", () => {
		const withLog = {
			openJobId: "j1",
			jobLog: {
				jobId: "j1",
				text: "one\ntwo\nboom here\nfour",
				truncated: false,
				failureExcerpt: null,
			},
		};

		it("shows the log line by line", () => {
			setState(withLog);
			mount();
			expect(logLines()).toHaveLength(4);
		});

		it("says when the log was cut short", () => {
			setState({
				...withLog,
				jobLog: { ...withLog.jobLog, truncated: true },
			});
			mount();
			expect(document.querySelector(".log-truncated")).not.toBeNull();
		});

		/** The failing lines are marked so the eye finds them. */
		it("marks the lines the failure covers", () => {
			setState({
				...withLog,
				pipelines: [
					pipeline({
						status: "failed",
						failedJobId: "j1",
						stages: [
							{
								name: "build",
								status: "failed",
								jobs: [job({ status: "failed" })],
							},
						],
					}),
				],
				jobLog: { ...withLog.jobLog, failureExcerpt: "boom here" },
			});
			mount();
			expect(failureLines().map((l) => l.getAttribute("data-line"))).toEqual([
				"2",
			]);
		});

		it("marks every line of a multi-line excerpt", () => {
			setState({
				...withLog,
				pipelines: [
					pipeline({
						status: "failed",
						failedJobId: "j1",
						stages: [
							{
								name: "build",
								status: "failed",
								jobs: [job({ status: "failed" })],
							},
						],
					}),
				],
				jobLog: { ...withLog.jobLog, failureExcerpt: "boom here\nfour" },
			});
			mount();
			expect(failureLines().map((l) => l.getAttribute("data-line"))).toEqual([
				"2",
				"3",
			]);
		});

		it("marks nothing for a passing job", () => {
			setState({
				...withLog,
				jobLog: { ...withLog.jobLog, failureExcerpt: "boom here" },
			});
			mount();
			expect(failureLines()).toHaveLength(0);
		});

		it("marks nothing when the excerpt is not in the log", () => {
			setState({
				...withLog,
				pipelines: [
					pipeline({
						status: "failed",
						failedJobId: "j1",
						stages: [
							{
								name: "build",
								status: "failed",
								jobs: [job({ status: "failed" })],
							},
						],
					}),
				],
				jobLog: { ...withLog.jobLog, failureExcerpt: "nowhere in there" },
			});
			mount();
			expect(failureLines()).toHaveLength(0);
		});

		it("closes the log on request", async () => {
			setState(withLog);
			mount();
			await userEvent.click(
				document.querySelector(
					'.log-head button[aria-label="Close"]',
				) as HTMLElement,
			);
			expect(closeJobLog).toHaveBeenCalledWith("p1", "i1");
		});

		it("opens the job on the forge", async () => {
			setState(withLog);
			mount();
			await userEvent.click(buttonBy(/open job|ouvrir le job/i));
			expect(openUrl).toHaveBeenCalledWith("https://forge/job/1");
		});
	});

	describe("the failure banner", () => {
		const failed = {
			pipelines: [
				pipeline({
					status: "failed",
					failedJobId: "j2",
					stages: [
						{
							name: "build",
							status: "failed",
							jobs: [
								job({ id: "j1", status: "success" }),
								job({ id: "j2", name: "test", status: "failed" }),
							],
						},
					],
				}),
			],
		};

		it("names the job the pipeline failed on", () => {
			setState(failed);
			mount();
			expect(
				document.querySelector(".pipeline-log-link .msg")?.textContent,
			).toContain("test");
		});

		/** Without an explicit failed job the first failing one stands in. */
		it("falls back to the first failing job", () => {
			setState({
				pipelines: [
					pipeline({
						status: "failed",
						failedJobId: null,
						stages: [
							{
								name: "build",
								status: "failed",
								jobs: [
									job({ id: "j1", status: "success" }),
									job({ id: "j2", name: "test", status: "failed" }),
								],
							},
						],
					}),
				],
			});
			mount();
			expect(
				document.querySelector(".pipeline-log-link .msg")?.textContent,
			).toContain("test");
		});

		it("shows no banner for a passing pipeline", () => {
			mount();
			expect(document.querySelector(".pipeline-log-link")).toBeNull();
		});

		/** The prompt needs the log, so it is fetched before the draft is built. */
		it("fetches the log before drafting the prompt", async () => {
			setState(failed);
			mount();
			await userEvent.click(
				document.querySelector(".fix-with-agent") as HTMLElement,
			);
			await settle();
			expect(openJobLog).toHaveBeenCalledWith("p1", "i1", "j2");
			expect(requestAgentDraft).toHaveBeenCalledTimes(1);
			expect(requestAgentDraft.mock.calls[0][0]).toBe("i1");
			expect(requestAgentDraft.mock.calls[0][1]).toContain("test");
			expect(get(activeStep)).toBe("agent");
		});

		it("does not refetch a log it already has", async () => {
			setState({
				...failed,
				openJobId: "j2",
				jobLog: {
					jobId: "j2",
					text: "boom",
					truncated: false,
					failureExcerpt: "boom",
				},
			});
			mount();
			await userEvent.click(
				document.querySelector(".fix-with-agent") as HTMLElement,
			);
			await settle();
			expect(openJobLog).not.toHaveBeenCalled();
			expect(requestAgentDraft.mock.calls[0][1]).toContain("boom");
		});
	});

	describe("the forge link", () => {
		/** The header link mirrors what the step shows: the branch's history. */
		it("opens the branch's pipelines, not the whole repository", async () => {
			mount();
			await userEvent.click(buttonBy(/open on|ouvrir sur/i));
			expect(openUrl).toHaveBeenCalledWith(
				"https://forge/repo/-/pipelines?ref=feature",
			);
		});

		it("opens nothing when the forge is unknown", async () => {
			capabilities.set({ ci: { label: "x" }, forge: null });
			mount();
			await userEvent.click(buttonBy(/open on|ouvrir sur/i));
			expect(openUrl).not.toHaveBeenCalled();
		});
	});
});
