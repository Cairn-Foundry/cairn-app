import { describe, expect, it } from "vitest";
import {
	contextWindowOf,
	prettyModelName,
} from "$lib/components/home/agents/providers-data";
import { responseStats } from "./response-stats";

const identity = (id: string) => id;

describe("responseStats", () => {
	it("keeps only the fields the user enabled, in catalogue order", () => {
		const stats = responseStats(
			{ model: "opus", durationMs: 2400, costUsd: 0.5 },
			["cost", "model"],
			identity,
		);
		expect(stats.map((s) => s.id)).toEqual(["model", "cost"]);
	});

	it("drops what the provider did not report", () => {
		const stats = responseStats({ model: "opus" }, ["model", "cost"], identity);
		expect(stats.map((s) => s.id)).toEqual(["model"]);
	});

	it("sums input and cache-read tokens", () => {
		const [tokens] = responseStats(
			{ inputTokens: 100, cacheReadTokens: 50, outputTokens: 20 },
			["tokens"],
			identity,
		);
		expect(tokens.value).toBe("150 in / 20 out");
	});

	it("names the model through the resolver", () => {
		const [model] = responseStats({ model: "opus" }, ["model"], () => "Opus");
		expect(model.value).toBe("Opus");
	});
});

describe("prettyModelName", () => {
	it("joins version digits and drops the release date", () => {
		expect(prettyModelName("claude-opus-4-5-20251101")).toBe("Claude Opus 4.5");
	});

	it("uppercases known acronyms", () => {
		expect(prettyModelName("gpt-5.1")).toBe("GPT 5.1");
	});

	it("strips the ollama and provider prefixes and suffixes", () => {
		expect(prettyModelName("models/gemini-2.5-pro")).toBe("Gemini 2.5 Pro");
		expect(prettyModelName("llama3.3:latest")).toBe("Llama3.3");
	});
});

describe("contextWindowOf", () => {
	it("matches a dated id against its family entry", () => {
		expect(contextWindowOf("anthropic", "claude-opus-4-5-20251101")).toBe(
			200000,
		);
	});

	it("returns undefined for a model it knows nothing about", () => {
		expect(contextWindowOf("anthropic", "some-new-model")).toBeUndefined();
	});
});
