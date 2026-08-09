import { describe, expect, it } from "vitest";
import {
	agentThreadTranscript,
	buildAgentPrompt,
	buildAgentResultBlock,
	conversationDelta,
} from "./agent-context";

const THREAD = [
	{ role: "user", content: "draw a sword" },
	{ role: "agent", content: "done" },
	{ role: "system", content: "Switched to OpenAI" },
	{ role: "user", content: "now a shield" },
	{ role: "agent", content: "also done" },
];

describe("conversationDelta", () => {
	it("sends the whole thread the first time", () => {
		const delta = conversationDelta(THREAD, 0);
		expect(delta).toContain("draw a sword");
		expect(delta).toContain("now a shield");
	});

	it("sends only what was said since the agent's last turn", () => {
		const delta = conversationDelta(THREAD, 3);
		expect(delta).not.toContain("draw a sword");
		expect(delta).toContain("now a shield");
	});

	it("is empty when the agent is already up to date", () => {
		expect(conversationDelta(THREAD, THREAD.length)).toBe("");
	});

	it("leaves system lines out - they were not said by anyone", () => {
		expect(conversationDelta(THREAD, 2)).not.toContain("Switched to");
	});

	it("caps a delta that grew without bound", () => {
		const long = Array.from({ length: 200 }, (_, i) => ({
			role: "user",
			content: `message ${i} `.repeat(200),
		}));
		expect(conversationDelta(long, 0).length).toBeLessThanOrEqual(6000);
	});
});

describe("agentThreadTranscript", () => {
	it("replays the agent's own prompts and answers", () => {
		const transcript = agentThreadTranscript([
			{ prompt: "draw a sword", result: "here it is" },
		]);
		expect(transcript).toBe("user: draw a sword\n\nassistant: here it is");
	});

	it("skips a run that never answered", () => {
		const transcript = agentThreadTranscript([
			{ prompt: "draw a sword", result: "" },
		]);
		expect(transcript).toBe("user: draw a sword");
	});

	it("is empty when the agent has never run here", () => {
		expect(agentThreadTranscript([])).toBe("");
	});
});

describe("buildAgentPrompt", () => {
	it("returns the message alone when there is no context to give", () => {
		expect(buildAgentPrompt("go", "", "")).toBe("go");
	});

	it("puts the agent's own work before the conversation, message last", () => {
		const prompt = buildAgentPrompt("go", "user: hello", "user: earlier");
		expect(prompt.indexOf("<your-earlier-work>")).toBeLessThan(
			prompt.indexOf("<conversation>"),
		);
		expect(prompt.endsWith("go")).toBe(true);
	});

	it("carries only the conversation when the provider has not changed", () => {
		const prompt = buildAgentPrompt("go", "user: hello", "");
		expect(prompt).not.toContain("<your-earlier-work>");
		expect(prompt).toContain("<conversation>");
	});
});

describe("buildAgentResultBlock", () => {
	it("hands the provider the answers it never saw", () => {
		const block = buildAgentResultBlock([
			{ agentName: "Leonardo", result: "sword drawn" },
		]);
		expect(block).toContain("Leonardo: sword drawn");
	});

	it("is empty when nothing was answered", () => {
		expect(buildAgentResultBlock([])).toBe("");
		expect(buildAgentResultBlock([{ agentName: "L", result: "  " }])).toBe("");
	});

	it("carries several agents at once", () => {
		const block = buildAgentResultBlock([
			{ agentName: "Leonardo", result: "sword" },
			{ agentName: "Argus", result: "reviewed" },
		]);
		expect(block).toContain("Leonardo: sword");
		expect(block).toContain("Argus: reviewed");
	});
});
