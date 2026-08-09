import { describe, expect, it } from "vitest";
import {
	PROVIDERS,
	providerById,
} from "$lib/components/home/agents/providers-data";
import { humanizeOption } from "./run-options";

describe("humanizeOption", () => {
	it("reads the camel case Claude Code uses", () => {
		expect(humanizeOption("acceptEdits")).toBe("Accept edits");
		expect(humanizeOption("bypassPermissions")).toBe("Bypass permissions");
	});

	it("reads the dashes the other CLIs use", () => {
		expect(humanizeOption("workspace-write")).toBe("Workspace write");
		expect(humanizeOption("danger-full-access")).toBe("Danger full access");
		expect(humanizeOption("always-proceed")).toBe("Always proceed");
	});
});

describe("the CLI provider catalogue", () => {
	const clis = PROVIDERS.filter((p) => p.kind === "cli");

	it("spells out the permission vocabulary of every agent it drives", () => {
		for (const provider of clis) {
			expect(provider.permissionModes?.length ?? 0).toBeGreaterThan(0);
		}
	});

	it("only offers reasoning levels to the agents that take them", () => {
		for (const provider of clis) {
			expect(Boolean(provider.efforts?.length)).toBe(
				Boolean(provider.supportsEffort),
			);
		}
	});

	it("says of every CLI whether it can be handed back its own session", () => {
		for (const provider of clis) {
			expect(typeof provider.keepsSession).toBe("boolean");
		}
		// Copilot answers in plain text and reports no session id.
		expect(providerById("copilot-cli")?.keepsSession).toBe(false);
	});
});
