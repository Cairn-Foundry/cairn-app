import { describe, expect, it } from "vitest";
import type { CustomAgent } from "$lib/services/ai-provider-service";
import { isInheriting, resolveAgentRun } from "./agent-resolution";

function agent(binding: Partial<CustomAgent>): CustomAgent {
	return {
		id: "a",
		name: "reviewer",
		description: "",
		color: "#fff",
		icon: "",
		systemPrompt: "You review.",
		providerId: "",
		model: "",
		effort: "",
		permissionMode: "",
		allowedTools: [],
		disallowedTools: [],
		overrideParams: false,
		temperature: 1,
		maxTokens: 8192,
		...binding,
	};
}

const CONV = {
	providerId: "claude-code-cli",
	modelId: "conv-model",
	effort: "low",
	permissionMode: "auto",
};

describe("isInheriting", () => {
	it("is true for an agent bound to no provider", () => {
		expect(isInheriting(agent({}))).toBe(true);
		expect(isInheriting(undefined)).toBe(true);
	});

	it("is false once a provider is chosen", () => {
		expect(isInheriting(agent({ providerId: "openai" }))).toBe(false);
	});
});

describe("resolveAgentRun", () => {
	it("takes everything from the conversation when it inherits", () => {
		expect(resolveAgentRun(agent({}), CONV)).toEqual({
			providerId: "claude-code-cli",
			model: "conv-model",
			effort: "low",
			permissionMode: "auto",
		});
	});

	it("follows the conversation to its new provider", () => {
		const moved = { ...CONV, providerId: "openai", modelId: "gpt-5.1" };
		expect(resolveAgentRun(agent({}), moved).providerId).toBe("openai");
		expect(resolveAgentRun(agent({}), moved).model).toBe("gpt-5.1");
	});

	it("uses its own settings when it is pinned", () => {
		const a = agent({
			providerId: "openai",
			model: "gpt-5.1",
			effort: "high",
			permissionMode: "plan",
		});
		expect(resolveAgentRun(a, CONV)).toEqual({
			providerId: "openai",
			model: "gpt-5.1",
			effort: "high",
			permissionMode: "plan",
		});
	});

	it("never borrows the conversation's model for another provider", () => {
		const a = agent({ providerId: "openai" });
		expect(resolveAgentRun(a, CONV)).toEqual({
			providerId: "openai",
			model: "",
			effort: "",
			permissionMode: "",
		});
	});

	it("resolves to the conversation when no agent was mentioned", () => {
		expect(resolveAgentRun(undefined, CONV)).toEqual({
			providerId: "claude-code-cli",
			model: "conv-model",
			effort: "low",
			permissionMode: "auto",
		});
	});
});
