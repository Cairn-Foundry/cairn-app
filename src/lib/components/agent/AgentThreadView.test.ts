import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	AgentRun,
	AgentRunStatus,
} from "$lib/services/agent-runs-service";

const respondPermission = vi.fn();
const stopAgent = vi.fn();
// `settings.save` round-trips the whole object through the backend; under the
// global invoke mock the promise never resolves and the value silently reverts.
vi.mock("$lib/services/settings-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	updateSettings: vi.fn(async (next: unknown) => next),
}));

vi.mock("$lib/services/agent-service", () => ({
	respondPermission: (...a: unknown[]) => respondPermission(...a),
	stopAgent: (...a: unknown[]) => stopAgent(...a),
}));

const patchAgentRun = vi.fn();
const clearAgentPermission = vi.fn();
vi.mock("$lib/stores/agent-runs", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return {
		...actual,
		patchAgentRun: (...a: unknown[]) => patchAgentRun(...a),
		clearAgentPermission: (...a: unknown[]) => clearAgentPermission(...a),
	};
});

const { agentPermissionRequests } = await import("$lib/stores/agent-runs");
const { settings } = await import("$lib/stores/settings");
const { default: AgentThreadView } = await import("./AgentThreadView.svelte");

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
		prompt: `prompt ${id}`,
		startedAt: 0,
		endedAt: 0,
		status: "done" as AgentRunStatus,
		result: "the answer",
		thinking: "",
		blocks: [],
		usage: null,
		error: "",
		...overrides,
	};
}

function mount(props: Record<string, unknown> = {}) {
	const onBack = vi.fn();
	const onDelete = vi.fn();
	const result = render(AgentThreadView, {
		runs: [run("r1")],
		projectId: "p1",
		onBack,
		onDelete,
		renderMarkdown: (source: string) => source,
		...props,
	});
	return { ...result, onBack, onDelete };
}

const prompts = () =>
	Array.from(document.querySelectorAll(".user-bubble")).map(
		(b) => b.textContent,
	);
const status = () =>
	document.querySelector(".thread-status")?.textContent?.trim();
const agentName = () => document.querySelector(".thread-name")?.textContent;
const permissionCard = () => document.querySelector(".permission-card");
/** The bar's two actions, in the order the component lays them out. */
const threadAction = (which: "delete" | "close") =>
	Array.from(document.querySelectorAll<HTMLElement>(".thread-actions .btn"))[
		which === "delete" ? 0 : 1
	];

beforeEach(() => {
	respondPermission.mockReset().mockResolvedValue(undefined);
	stopAgent.mockReset().mockResolvedValue(undefined);
	patchAgentRun.mockReset();
	clearAgentPermission.mockReset();
	agentPermissionRequests.set({});
	settings.save({
		agentShowThinking: true,
		agentShowResponseStats: false,
	});
});

describe("AgentThreadView", () => {
	describe("the thread", () => {
		it("shows every run of the agent, oldest first", () => {
			mount({ runs: [run("r1"), run("r2")] });
			expect(prompts()).toEqual(["prompt r1", "prompt r2"]);
		});

		it("names the agent by its latest run", () => {
			mount({
				runs: [run("r1"), run("r2", { agentName: "hermes" })],
			});
			expect(agentName()).toBe("hermes");
		});

		it("shows the error a run ended with", () => {
			mount({ runs: [run("r1", { error: "it blew up" })] });
			expect(document.querySelector(".thread-error")?.textContent).toBe(
				"it blew up",
			);
		});

		it("shows the model a run answered with", () => {
			mount({
				runs: [run("r1", { usage: { model: "opus" } as AgentRun["usage"] })],
			});
			expect(document.querySelector(".msg-model")?.textContent).toContain(
				"opus",
			);
		});

		/** A run still working shows an animation, never a word. */
		it("spins on a run that has not answered yet", () => {
			mount({
				runs: [run("r1", { result: "", status: "running" })],
			});
			expect(document.querySelector(".thread-pending")).not.toBeNull();
			expect(document.body.textContent?.toLowerCase()).not.toContain("loading");
		});

		it("shows no spinner once the run has answered", () => {
			mount({ runs: [run("r1")] });
			expect(document.querySelector(".thread-pending")).toBeNull();
		});
	});

	describe("the status", () => {
		/** A finished agent needs no label: its answer is right there. */
		it("says nothing about an agent that finished", () => {
			mount({ runs: [run("r1", { status: "done" })] });
			expect(document.querySelector(".thread-status")).toBeNull();
		});

		it("names every other state", () => {
			for (const state of [
				"running",
				"awaiting-permission",
				"stopped",
				"error",
				"interrupted",
			] as const) {
				const { unmount } = mount({ runs: [run("r1", { status: state })] });
				expect(status(), state).toBeTruthy();
				unmount();
			}
		});

		it("spins only while the agent is actually working", () => {
			const { unmount } = mount({
				runs: [run("r1", { status: "running" })],
			});
			expect(document.querySelector(".thread-status .spinner")).not.toBeNull();
			unmount();

			mount({ runs: [run("r1", { status: "stopped" })] });
			expect(document.querySelector(".thread-status .spinner")).toBeNull();
		});

		it("marks a failure apart from the other states", () => {
			mount({ runs: [run("r1", { status: "error" })] });
			expect(
				document.querySelector(".thread-status")?.classList.contains("warn"),
			).toBe(true);
		});
	});

	describe("permission prompts", () => {
		const pending = {
			runId: "r1",
			requestId: "q1",
			toolName: "Bash",
			input: { command: "rm -rf build" },
		};

		it("shows the prompt the latest run is waiting on", () => {
			agentPermissionRequests.set({ r1: pending });
			mount({ runs: [run("r1", { status: "awaiting-permission" })] });
			expect(permissionCard()).not.toBeNull();
		});

		/** A prompt belonging to an older run is not the one being waited on. */
		it("shows no prompt for a run that is not the latest", () => {
			agentPermissionRequests.set({ old: pending });
			mount({ runs: [run("old"), run("r1")] });
			expect(permissionCard()).toBeNull();
		});

		it("sends the decision back to the agent", async () => {
			agentPermissionRequests.set({ r1: pending });
			mount({ runs: [run("r1", { status: "awaiting-permission" })] });
			await userEvent.click(
				screen.getByRole("button", { name: /^allow|autoriser/i }),
			);
			expect(respondPermission).toHaveBeenCalledWith(
				"r1",
				"q1",
				expect.anything(),
			);
		});

		/** Answering moves the run out of its wait rather than leaving it stuck. */
		it("clears the wait and sets the run running again", async () => {
			agentPermissionRequests.set({ r1: pending });
			mount({ runs: [run("r1", { status: "awaiting-permission" })] });
			await userEvent.click(
				screen.getByRole("button", { name: /^allow|autoriser/i }),
			);
			expect(clearAgentPermission).toHaveBeenCalledWith("r1");
			expect(patchAgentRun).toHaveBeenCalledWith("p1", "r1", {
				status: "running",
			});
		});

		it("records a failure to answer on the run itself", async () => {
			respondPermission.mockRejectedValue(new Error("channel closed"));
			agentPermissionRequests.set({ r1: pending });
			mount({ runs: [run("r1", { status: "awaiting-permission" })] });
			await userEvent.click(
				screen.getByRole("button", { name: /^allow|autoriser/i }),
			);
			expect(patchAgentRun).toHaveBeenLastCalledWith("p1", "r1", {
				error: "Error: channel closed",
			});
		});

		it("names the agent on the prompt", () => {
			agentPermissionRequests.set({ r1: pending });
			mount({ runs: [run("r1", { agentName: "mythos" })] });
			expect(document.querySelector(".permission-who")?.textContent).toBe(
				"mythos",
			);
		});
	});

	describe("the response figures", () => {
		const withUsage = run("r1", {
			usage: {
				model: "opus",
				inputTokens: 100,
				outputTokens: 50,
			} as AgentRun["usage"],
		});

		it("shows no figures while the setting is off", async () => {
			await settings.save({ agentShowResponseStats: false });
			mount({ runs: [withUsage] });
			expect(document.querySelector(".usage-line")).toBeNull();
		});

		it("shows them once the setting is on", async () => {
			await settings.save({ agentShowResponseStats: true });
			mount({ runs: [withUsage] });
			expect(document.querySelector(".usage-line")).not.toBeNull();
		});

		/** A run with nothing measured has no figures to show. */
		it("shows nothing for a run without usage", async () => {
			await settings.save({ agentShowResponseStats: true });
			mount({ runs: [run("r1", { usage: null })] });
			expect(document.querySelector(".usage-line")).toBeNull();
		});
	});

	describe("leaving and deleting", () => {
		it("goes back on request", async () => {
			const { onBack } = mount();
			await userEvent.click(threadAction("close"));
			expect(onBack).toHaveBeenCalled();
		});

		/** Deleting a thread is irreversible, so it asks first. */
		it("asks before deleting the thread", async () => {
			const { onDelete } = mount();
			await userEvent.click(threadAction("delete"));
			expect(onDelete).not.toHaveBeenCalled();
			expect(document.querySelector(".modal, [role='dialog']")).not.toBeNull();
		});
	});
});
