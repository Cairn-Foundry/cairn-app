import { describe, expect, it } from "vitest";
import type { AgentBlock } from "$lib/services/conversation-service";
import { closeDelegation, closeToolBlock, openDelegation } from "./delegation";

const START = {
	toolUseId: "toolu_1",
	name: "greeter",
	color: "#3b82f6",
	agentRunId: "run:task_1",
};

/** The sequence a real delegating turn produces, in order. */
function turn(): AgentBlock[] {
	return [
		{ kind: "text", text: "I'll launch the greeter subagent." },
		{ kind: "tool", text: "Agent: Say hello", toolId: "toolu_1", done: false },
	];
}

describe("openDelegation", () => {
	it("rewrites the tool line the provider drew instead of adding a second", () => {
		const blocks = turn();

		openDelegation(blocks, START);

		expect(blocks).toHaveLength(2);
		expect(blocks[1]).toMatchObject({
			kind: "agent",
			phase: "start",
			text: "greeter",
			agentRunId: "run:task_1",
			color: "#3b82f6",
			done: false,
		});
	});

	it("still records the delegation when no tool line was drawn for it", () => {
		const blocks: AgentBlock[] = [{ kind: "text", text: "working" }];

		openDelegation(blocks, START);

		expect(blocks[1]).toMatchObject({ kind: "agent", text: "greeter" });
	});

	it("keeps one entry per delegation when two run in the same turn", () => {
		const blocks = turn();
		blocks.push({ kind: "tool", text: "Agent: b", toolId: "toolu_2" });

		openDelegation(blocks, START);
		openDelegation(blocks, {
			...START,
			toolUseId: "toolu_2",
			name: "auditor",
			agentRunId: "run:task_2",
		});

		const agents = blocks.filter((b) => b.kind === "agent");
		expect(agents.map((b) => b.text)).toEqual(["greeter", "auditor"]);
	});
});

describe("closeDelegation", () => {
	it("lands after what the provider wrote while waiting, not before it", () => {
		const blocks = turn();
		openDelegation(blocks, START);
		// Written while the subagent worked: the answer cannot predate it.
		blocks.push({ kind: "text", text: "I've asked it, it is working on it." });

		closeDelegation(blocks, "run:task_1", {
			result: "HELLO FROM SUBAGENT",
			failed: false,
		});
		blocks.push({ kind: "text", text: "The greeter said hello." });

		expect(
			blocks.map((b) => `${b.kind}${b.phase ? `:${b.phase}` : ""}`),
		).toEqual(["text", "agent:start", "text", "agent:end", "text"]);
		expect(blocks[3]).toMatchObject({
			text: "greeter",
			color: "#3b82f6",
			done: true,
			failed: false,
			result: "HELLO FROM SUBAGENT",
		});
	});

	it("stops the starting entry from waiting once its end is recorded", () => {
		const blocks = turn();
		openDelegation(blocks, START);

		closeDelegation(blocks, "run:task_1", { result: "hi", failed: false });

		expect(blocks[1]).toMatchObject({ phase: "start", done: true });
	});

	it("never turns the answer into a message of its own", () => {
		const blocks = turn();
		openDelegation(blocks, START);

		closeDelegation(blocks, "run:task_1", { result: "hi", failed: false });

		// A message here is what put the answer above the reply discussing it,
		// and lost that reply on reload.
		expect(blocks.filter((b) => b.kind === "text")).toHaveLength(1);
	});

	it("marks a delegation that failed rather than dropping it", () => {
		const blocks = turn();
		openDelegation(blocks, START);

		closeDelegation(blocks, "run:task_1", { result: "", failed: true });

		expect(blocks.at(-1)).toMatchObject({
			phase: "end",
			done: true,
			failed: true,
		});
	});

	it("reports when the delegation it should close is gone", () => {
		expect(
			closeDelegation(turn(), "run:missing", { result: "", failed: false }),
		).toBe(false);
	});
});

describe("closeToolBlock", () => {
	it("closes the call the result names, not whatever is still open", () => {
		const blocks: AgentBlock[] = [
			{
				kind: "tool",
				text: "Agent: Say hello",
				toolId: "toolu_1",
				done: false,
			},
			{ kind: "tool", text: "Read: a.ts", toolId: "toolu_2", done: false },
		];

		closeToolBlock(blocks, false, "toolu_1");

		expect(blocks[0].done).toBe(true);
		expect(blocks[1].done).toBe(false);
	});

	it("falls back to the last open call when the provider named none", () => {
		const blocks: AgentBlock[] = [
			{ kind: "tool", text: "Read: a.ts", done: true },
			{ kind: "tool", text: "Read: b.ts", done: false },
		];

		closeToolBlock(blocks, true);

		expect(blocks[1]).toMatchObject({ done: true, failed: true });
	});
});
