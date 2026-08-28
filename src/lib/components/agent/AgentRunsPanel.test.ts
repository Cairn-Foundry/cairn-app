import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	AgentRun,
	AgentRunStatus,
} from "$lib/services/agent-runs-service";
import { agentPermissionRequests } from "$lib/stores/agent-runs";
import AgentRunsPanel from "./AgentRunsPanel.svelte";

const NOW = 1_700_000_000_000;

function run(id: string, overrides: Partial<AgentRun> = {}): AgentRun {
	return {
		id,
		agentId: "argus",
		agentName: "argus",
		color: "#8ab",
		icon: "sparkles",
		instanceId: "i1",
		instanceName: "i1",
		conversationId: "c1",
		conversationTitle: "c1",
		scope: "instance",
		providerId: "claude",
		model: "opus",
		workingDir: "/repo",
		prompt: "run the tests",
		startedAt: NOW,
		endedAt: NOW,
		status: "done" as AgentRunStatus,
		result: "",
		thinking: "",
		blocks: [],
		usage: null,
		error: "",
		...overrides,
	};
}

function thread(agentId: string, runs: AgentRun[]) {
	return { agentId, latest: runs[runs.length - 1], runs };
}

function mount(props: Record<string, unknown> = {}) {
	const onOpen = vi.fn();
	const onDelete = vi.fn();
	const result = render(AgentRunsPanel, {
		threads: [],
		openAgentId: "",
		onOpen,
		onDelete,
		...props,
	});
	return { ...result, onOpen, onDelete };
}

const rows = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".ap-item"));
const rowNamed = (name: string) =>
	rows().find(
		(r) => r.querySelector(".ap-name")?.textContent === name,
	) as HTMLElement;
const badge = () => document.querySelector(".la-badge")?.textContent?.trim();
const timeOf = (name: string) =>
	rowNamed(name).querySelector(".ap-time")?.textContent;

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	agentPermissionRequests.set({});
});

afterEach(() => {
	vi.useRealTimers();
});

describe("AgentRunsPanel", () => {
	describe("the list", () => {
		it("says so when no agent has been called", () => {
			mount();
			expect(document.querySelector(".ap-empty")).not.toBeNull();
			expect(rows()).toHaveLength(0);
		});

		it("shows no count when there is nothing to count", () => {
			mount();
			expect(badge()).toBeUndefined();
		});

		/** One row per agent, not one per run: an agent called twice stays one row. */
		it("shows one row per agent, whatever its number of runs", () => {
			mount({
				threads: [
					thread("argus", [run("r1"), run("r2"), run("r3")]),
					thread("hermes", [run("r4", { agentName: "hermes" })]),
				],
			});
			expect(rows()).toHaveLength(2);
		});

		it("describes each agent by its latest run", () => {
			mount({
				threads: [
					thread("argus", [
						run("old", { prompt: "the old one" }),
						run("new", { prompt: "the latest one" }),
					]),
				],
			});
			expect(rowNamed("argus").querySelector(".ap-prompt")?.textContent).toBe(
				"the latest one",
			);
		});

		it("marks the agent whose thread is open", () => {
			mount({
				threads: [
					thread("argus", [run("r1")]),
					thread("hermes", [
						run("r2", { agentId: "hermes", agentName: "hermes" }),
					]),
				],
				openAgentId: "hermes",
			});
			expect(rowNamed("argus").classList.contains("active")).toBe(false);
			expect(rowNamed("hermes").classList.contains("active")).toBe(true);
		});
	});

	describe("the count of what is running", () => {
		it("counts only the threads, when none is running", () => {
			mount({
				threads: [thread("argus", [run("r1")]), thread("hermes", [run("r2")])],
			});
			expect(badge()).toBe("2");
		});

		it("counts the running ones against the total", () => {
			mount({
				threads: [
					thread("argus", [run("r1", { status: "running" })]),
					thread("hermes", [run("r2")]),
				],
			});
			expect(badge()).toBe("1/2");
		});

		/** Waiting on a permission is still being in flight. */
		it("counts an agent waiting for a permission as running", () => {
			mount({
				threads: [
					thread("argus", [run("r1", { status: "awaiting-permission" })]),
				],
			});
			expect(badge()).toBe("1/1");
		});

		it("does not count a stopped, failed or interrupted agent", () => {
			for (const status of ["stopped", "error", "interrupted"] as const) {
				const { unmount } = mount({
					threads: [thread("argus", [run("r1", { status })])],
				});
				expect(badge(), status).toBe("1");
				unmount();
			}
		});

		it("judges by the latest run, not by an older one still marked running", () => {
			mount({
				threads: [
					thread("argus", [
						run("old", { status: "running" }),
						run("new", { status: "done" }),
					]),
				],
			});
			expect(badge()).toBe("1");
		});
	});

	describe("what each row signals", () => {
		it("spins while the agent is working", () => {
			mount({ threads: [thread("argus", [run("r1", { status: "running" })])] });
			const side = rowNamed("argus").querySelector(".ap-side") as HTMLElement;
			expect(side.querySelector(".spinner")).not.toBeNull();
			expect(side.querySelector(".ic-shield")).toBeNull();
		});

		it("shows neither mark once the agent has finished", () => {
			mount({ threads: [thread("argus", [run("r1", { status: "done" })])] });
			const side = rowNamed("argus").querySelector(".ap-side") as HTMLElement;
			expect(side.querySelector(".spinner")).toBeNull();
			expect(side.querySelector(".ic-shield")).toBeNull();
		});

		/**
		 * A permission request outranks the spinner: the run is not merely slow,
		 * it is stopped waiting for the user.
		 */
		it("shows the permission mark rather than the spinner when one is pending", () => {
			agentPermissionRequests.set({
				r1: {
					runId: "r1",
					requestId: "q1",
					toolName: "Bash",
					input: {},
				},
			});
			mount({
				threads: [
					thread("argus", [run("r1", { status: "awaiting-permission" })]),
				],
			});
			const side = rowNamed("argus").querySelector(".ap-side") as HTMLElement;
			expect(side.querySelector(".ic-shield")).not.toBeNull();
			expect(side.querySelector(".spinner")).toBeNull();
		});

		/** The request may belong to an earlier run of the same thread. */
		it("notices a request raised by any run of the thread", () => {
			agentPermissionRequests.set({
				old: {
					runId: "old",
					requestId: "q1",
					toolName: "Bash",
					input: {},
				},
			});
			mount({ threads: [thread("argus", [run("old"), run("new")])] });
			expect(
				rowNamed("argus").querySelector(".ap-side .ic-shield"),
			).not.toBeNull();
		});
	});

	describe("how long a run took", () => {
		it("counts in seconds under a minute", () => {
			mount({
				threads: [
					thread("argus", [
						run("r1", { startedAt: NOW - 42_000, endedAt: NOW }),
					]),
				],
			});
			expect(timeOf("argus")).toBe("42s");
		});

		it("counts in minutes past a minute", () => {
			mount({
				threads: [
					thread("argus", [
						run("r1", { startedAt: NOW - 5 * 60_000, endedAt: NOW }),
					]),
				],
			});
			expect(timeOf("argus")).toBe("5m");
		});

		it("counts in hours past an hour", () => {
			mount({
				threads: [
					thread("argus", [
						run("r1", { startedAt: NOW - 3 * 3_600_000, endedAt: NOW }),
					]),
				],
			});
			expect(timeOf("argus")).toBe("3h");
		});

		/** A run still in flight is counted against now, not left blank. */
		it("counts an unfinished run against the present moment", () => {
			mount({
				threads: [
					thread("argus", [
						run("r1", {
							startedAt: NOW - 10_000,
							endedAt: null,
							status: "running",
						}),
					]),
				],
			});
			expect(timeOf("argus")).toBe("10s");
		});

		it("never shows a negative duration", () => {
			mount({
				threads: [
					thread("argus", [
						run("r1", { startedAt: NOW + 5_000, endedAt: NOW }),
					]),
				],
			});
			expect(timeOf("argus")).toBe("0s");
		});
	});

	describe("acting on a thread", () => {
		it("opens the agent that was clicked", async () => {
			const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
			const { onOpen } = mount({
				threads: [thread("argus", [run("r1")])],
			});
			await user.click(rowNamed("argus"));
			expect(onOpen).toHaveBeenCalledWith("argus");
		});

		it("deletes the thread it was asked to", async () => {
			const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
			const { onDelete } = mount({
				threads: [thread("argus", [run("r1")])],
			});
			await user.click(document.querySelector(".ap-delete") as HTMLElement);
			expect(onDelete).toHaveBeenCalledWith("argus");
		});

		/** Deleting a thread is not opening it. */
		it("does not open the thread when it is deleted", async () => {
			const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
			const { onOpen } = mount({
				threads: [thread("argus", [run("r1")])],
			});
			await user.click(document.querySelector(".ap-delete") as HTMLElement);
			expect(onOpen).not.toHaveBeenCalled();
		});

		it("names the delete button for a screen reader", () => {
			mount({ threads: [thread("argus", [run("r1")])] });
			expect(
				(document.querySelector(".ap-delete") as HTMLElement).getAttribute(
					"aria-label",
				),
			).toBeTruthy();
		});
	});
});
