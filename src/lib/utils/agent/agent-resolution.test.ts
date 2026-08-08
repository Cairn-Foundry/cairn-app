import { describe, expect, it } from "vitest";
import type { CustomAgent } from "$lib/services/ai-provider-service";
import { agentProviderIds, resolveAgentRun, rowFor } from "./agent-resolution";

function agent(rows: CustomAgent["rows"]): CustomAgent {
	return {
		id: "a",
		name: "reviewer",
		description: "",
		color: "#fff",
		icon: "",
		systemPrompt: "You review.",
		rows,
		allowedTools: [],
		disallowedTools: [],
		overrideParams: false,
		temperature: 1,
		maxTokens: 8192,
	};
}

const CONV = { modelId: "conv-model", effort: "low", permissionMode: "auto" };
const EMPTY_CONV = { modelId: "", effort: "", permissionMode: "" };

describe("rowFor", () => {
	it("finds the row of that provider", () => {
		const a = agent([
			{
				providerId: "openai",
				model: "gpt-5.1",
				effort: "",
				permissionMode: "",
			},
		]);
		expect(rowFor(a, "openai")?.model).toBe("gpt-5.1");
	});

	it("returns nothing for a provider the agent says nothing about", () => {
		expect(rowFor(agent([]), "openai")).toBeUndefined();
		expect(rowFor(undefined, "openai")).toBeUndefined();
	});
});

describe("resolveAgentRun", () => {
	it("lets a row override what the conversation picked", () => {
		const a = agent([
			{
				providerId: "openai",
				model: "gpt-5.1",
				effort: "high",
				permissionMode: "plan",
			},
		]);
		expect(resolveAgentRun(a, "openai", CONV)).toEqual({
			model: "gpt-5.1",
			effort: "high",
			permissionMode: "plan",
		});
	});

	it("falls back to the conversation for each field the row leaves empty", () => {
		const a = agent([
			{ providerId: "openai", model: "", effort: "high", permissionMode: "" },
		]);
		expect(resolveAgentRun(a, "openai", CONV)).toEqual({
			model: "conv-model",
			effort: "high",
			permissionMode: "auto",
		});
	});

	it("changes nothing when the agent has no row for this provider", () => {
		const a = agent([
			{
				providerId: "openai",
				model: "gpt-5.1",
				effort: "",
				permissionMode: "",
			},
		]);
		expect(resolveAgentRun(a, "claude-code-cli", CONV)).toEqual({
			model: "conv-model",
			effort: "low",
			permissionMode: "auto",
		});
	});

	it("resolves to nothing when neither side has an opinion", () => {
		expect(resolveAgentRun(undefined, "openai", EMPTY_CONV)).toEqual({
			model: "",
			effort: "",
			permissionMode: "",
		});
	});

	it("keeps the conversation's own settings when no agent was mentioned", () => {
		expect(resolveAgentRun(undefined, "openai", CONV)).toEqual({
			model: "conv-model",
			effort: "low",
			permissionMode: "auto",
		});
	});
});

describe("agentProviderIds", () => {
	it("lists the providers in the order they were added", () => {
		const a = agent([
			{ providerId: "openai", model: "", effort: "", permissionMode: "" },
			{ providerId: "anthropic", model: "", effort: "", permissionMode: "" },
		]);
		expect(agentProviderIds(a)).toEqual(["openai", "anthropic"]);
	});

	it("skips a row whose provider was never chosen", () => {
		const a = agent([
			{ providerId: "", model: "", effort: "", permissionMode: "" },
		]);
		expect(agentProviderIds(a)).toEqual([]);
	});
});
