import { describe, expect, it } from "vitest";
import {
	effortsOf,
	permissionModesOf,
} from "$lib/components/home/agents/cli-options";
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

describe("the CLI option vocabularies", () => {
	it("gives every CLI Cairn drives a permission vocabulary of its own", () => {
		// Claude Code states an approval mode, Codex a sandbox, Copilot whether
		// tools run at all: a CLI listed with none would silently be offered
		// another one's words.
		for (const cli of [
			"claude-code",
			"codex",
			"copilot",
			"antigravity",
			"vibe",
		]) {
			expect(permissionModesOf(cli).length).toBeGreaterThan(0);
		}
	});

	it("offers reasoning levels only to the CLIs that take them", () => {
		expect(effortsOf("claude-code").length).toBeGreaterThan(0);
		expect(effortsOf("codex").length).toBeGreaterThan(0);
		// OpenCode and Copilot expose no effort flag; an empty list keeps the
		// field out of the picker without a special case.
		expect(effortsOf("opencode")).toEqual([]);
		expect(effortsOf("copilot")).toEqual([]);
	});
});
