import { describe, expect, it } from "vitest";
import { PROVIDERS } from "$lib/components/home/agents/providers-data";
import type { AiProvidersConfig } from "$lib/services/ai-provider-service";
import {
	AI_FEATURES,
	assignableProviders,
	isAssignableProvider,
	readOnlyPermissionMode,
	readOnlyTools,
	resolveAiFeature,
} from "./ai-features";

function config(overrides: Partial<AiProvidersConfig> = {}): AiProvidersConfig {
	return {
		providers: {},
		defaultProviderId: "claude-code-cli",
		...overrides,
	};
}

describe("isAssignableProvider", () => {
	it("accepts a CLI provider", () => {
		expect(isAssignableProvider("claude-code-cli")).toBe(true);
	});

	it("rejects an unknown provider", () => {
		expect(isAssignableProvider("nope")).toBe(false);
	});
});

describe("assignableProviders", () => {
	it("offers only CLI providers", () => {
		const offered = assignableProviders(config());
		expect(offered.length).toBeGreaterThan(0);
		for (const provider of offered) {
			expect(isAssignableProvider(provider.id)).toBe(true);
		}
	});

	it("offers every released CLI before the Providers page was ever opened", () => {
		// `enabled` defaults to false for all but Claude Code, so filtering on it
		// would leave a single entry for a user who never configured anything.
		expect(assignableProviders(config()).length).toBeGreaterThan(1);
	});

	it("offers the same list whether or not a config was loaded", () => {
		expect(assignableProviders(null).map((p) => p.id)).toEqual(
			assignableProviders(config()).map((p) => p.id),
		);
	});

	it("never offers an unreleased provider", () => {
		const offered = new Set(assignableProviders(config()).map((p) => p.id));
		for (const p of PROVIDERS) {
			if (p.status === "coming-soon") expect(offered.has(p.id)).toBe(false);
		}
	});
});

describe("readOnlyPermissionMode", () => {
	it("speaks each CLI's own vocabulary", () => {
		expect(readOnlyPermissionMode("claude-code-cli")).toBe("dontAsk");
		expect(readOnlyPermissionMode("codex-cli")).toBe("read-only");
	});

	it("answers a mode the CLI actually accepts, never another one's", () => {
		// Codex passes the mode straight to --sandbox, which would reject
		// Claude Code's wording.
		expect(readOnlyPermissionMode("codex-cli")).not.toBe("dontAsk");
	});

	it("leaves an unknown CLI on its own default", () => {
		expect(readOnlyPermissionMode("antigravity-cli")).toBe("");
		expect(readOnlyPermissionMode("whatever")).toBe("");
	});
});

describe("readOnlyTools", () => {
	it("confines Claude Code to reads and git inspection", () => {
		const tools = readOnlyTools("claude-code-cli");
		expect(tools).toContain("Read");
		expect(tools.some((tool) => tool.startsWith("Bash(git diff"))).toBe(true);
		expect(tools.some((tool) => /write|edit/i.test(tool))).toBe(false);
	});

	it("grants nothing to a CLI whose grants are coarser than the default", () => {
		// Naming a whole tool would widen access rather than narrow it.
		expect(readOnlyTools("copilot-cli")).toEqual([]);
		expect(readOnlyTools("codex-cli")).toEqual([]);
	});
});

describe("resolveAiFeature", () => {
	it("falls back to the default provider with no assignment", () => {
		const resolved = resolveAiFeature("commitMessage", {}, config());
		expect(resolved.providerId).toBe("claude-code-cli");
		expect(resolved.unavailable).toBe(false);
	});

	it("honours an assignment to another CLI", () => {
		const other = assignableProviders(config()).find(
			(p) => p.id !== "claude-code-cli",
		);
		if (!other) return;
		const resolved = resolveAiFeature(
			"commitMessage",
			{
				commitMessage: { providerId: other.id, model: "x", promptTemplate: "" },
			},
			config(),
		);
		expect(resolved.providerId).toBe(other.id);
		expect(resolved.model).toBe("x");
	});

	it("degrades to the default when the assigned provider is not a usable CLI", () => {
		const resolved = resolveAiFeature(
			"commitMessage",
			{ commitMessage: { providerId: "gone", model: "x", promptTemplate: "" } },
			config(),
		);
		expect(resolved.providerId).toBe("claude-code-cli");
		// The model belonged to the provider that is gone, so it is dropped too.
		expect(resolved.model).not.toBe("x");
	});

	it("still resolves with no configuration at all", () => {
		const resolved = resolveAiFeature("commitMessage", undefined, null);
		expect(resolved.unavailable).toBe(false);
		expect(resolved.providerId).not.toBe("");
	});

	it("falls back to the feature's default template", () => {
		const def = AI_FEATURES.find((f) => f.id === "commitMessage");
		const resolved = resolveAiFeature("commitMessage", {}, config());
		expect(resolved.promptTemplate).toBe(def?.defaultPromptTemplate);
	});

	it("keeps a template the user wrote", () => {
		const resolved = resolveAiFeature(
			"commitMessage",
			{ commitMessage: { providerId: "", model: "", promptTemplate: "mine" } },
			config(),
		);
		expect(resolved.promptTemplate).toBe("mine");
	});
});
