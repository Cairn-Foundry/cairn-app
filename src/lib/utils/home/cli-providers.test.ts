import { describe, expect, it } from "vitest";
import { impliedProviders, sortProviders } from "./cli-providers";

describe("sortProviders", () => {
	it("orders agents the same way whatever order they arrive in", () => {
		expect(sortProviders(["vibe", "claude-code", "codex"])).toEqual([
			"claude-code",
			"codex",
			"vibe",
		]);
	});

	it("lists an agent once even when two paths reach it", () => {
		// A repeated id is a duplicate key in a keyed list, which throws.
		expect(
			sortProviders(["vibe", "copilot", "vibe", "claude-code", "copilot"]),
		).toEqual(["claude-code", "copilot", "vibe"]);
	});
});

describe("impliedProviders", () => {
	it("names the agents a shared file hands the entry to unasked", () => {
		// Picking Claude for a project's .mcp.json also serves Copilot.
		expect(
			impliedProviders(["claude-code"], ["claude-code", "copilot"]),
		).toEqual(["copilot"]);
	});

	it("says nothing when every agent reached was asked for", () => {
		expect(impliedProviders(["claude-code"], ["claude-code"])).toEqual([]);
	});
});
