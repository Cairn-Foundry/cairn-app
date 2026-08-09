import { describe, expect, it } from "vitest";
import { AGENT_COLORS, agentSlug } from "./native-agents";

describe("agentSlug", () => {
	it("turns a name into what a prompt can invoke", () => {
		expect(agentSlug("Code Reviewer")).toBe("code-reviewer");
		expect(agentSlug("  Spaced  Out  ")).toBe("spaced-out");
	});

	it("collapses every run of separators into one dash", () => {
		expect(agentSlug("a // b __ c")).toBe("a-b-c");
	});

	it("never leaves a trailing dash, which would name a file oddly", () => {
		expect(agentSlug("trailing!!")).toBe("trailing");
		expect(agentSlug("!!!")).toBe("");
	});
});

describe("AGENT_COLORS", () => {
	// A colour outside this list is dropped when the definition is written,
	// since the frontmatter holds a name and not a hex.
	it("holds only the colours a definition can carry", () => {
		expect(AGENT_COLORS).toHaveLength(8);
		for (const color of AGENT_COLORS) {
			expect(color).toMatch(/^#[0-9a-f]{6}$/);
		}
	});
});
