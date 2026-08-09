import { beforeEach, describe, expect, it } from "vitest";
import type { AgentRun } from "$lib/services/agent-runs-service";
import { agentRuns, agentThreadRuns, agentThreadsOf } from "./agent-runs";

function run(id: string, agentId: string, conversationId: string): AgentRun {
	return {
		id,
		agentId,
		agentName: agentId,
		color: "#fff",
		icon: "",
		instanceId: "i1",
		instanceName: "Instance",
		conversationId,
		conversationTitle: "Thread",
		scope: "instance",
		providerId: "claude-code-cli",
		model: "",
		workingDir: "/wt",
		prompt: id,
		startedAt: 0,
		endedAt: null,
		status: "done",
		result: id,
		thinking: "",
		blocks: [],
		usage: null,
		error: "",
	};
}

// The store holds runs newest first, the way the app writes them.
beforeEach(() => {
	agentRuns.set({
		p1: [
			run("leo-2", "leonardo", "c1"),
			run("argus-1", "argus", "c1"),
			run("leo-1", "leonardo", "c1"),
			run("leo-other", "leonardo", "c2"),
		],
	});
});

describe("agentThreadsOf", () => {
	it("gives one entry per agent, not one per run", () => {
		const threads = agentThreadsOf("p1", "c1");
		expect(threads.map((th) => th.agentId)).toEqual(["leonardo", "argus"]);
	});

	it("gathers every run of that agent in the thread, oldest first", () => {
		const leonardo = agentThreadsOf("p1", "c1")[0];
		expect(leonardo.runs.map((r) => r.id)).toEqual(["leo-1", "leo-2"]);
	});

	it("shows the most recent run as what the agent is doing now", () => {
		expect(agentThreadsOf("p1", "c1")[0].latest.id).toBe("leo-2");
	});

	it("leaves out the agents of another conversation", () => {
		const ids = agentThreadsOf("p1", "c1").flatMap((th) =>
			th.runs.map((r) => r.id),
		);
		expect(ids).not.toContain("leo-other");
	});

	it("is empty for a conversation that never called an agent", () => {
		expect(agentThreadsOf("p1", "c3")).toEqual([]);
	});
});

describe("agentThreadRuns", () => {
	it("is the agent's thread in that conversation, oldest first", () => {
		expect(agentThreadRuns("p1", "c1", "leonardo").map((r) => r.id)).toEqual([
			"leo-1",
			"leo-2",
		]);
	});

	it("keeps the same agent's threads apart across conversations", () => {
		expect(agentThreadRuns("p1", "c2", "leonardo").map((r) => r.id)).toEqual([
			"leo-other",
		]);
	});
});
