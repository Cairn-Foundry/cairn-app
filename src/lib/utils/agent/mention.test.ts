import { describe, expect, it } from "vitest";
import { mentionToken } from "./mention";

describe("mentionToken", () => {
	it("leaves a single word alone", () => {
		expect(mentionToken("reviewer")).toBe("reviewer");
	});

	it("joins words with a dash", () => {
		expect(mentionToken("Code Reviewer")).toBe("Code-Reviewer");
	});

	it("collapses a run of whitespace into one dash", () => {
		expect(mentionToken("Code   Reviewer")).toBe("Code-Reviewer");
		expect(mentionToken("a\tb")).toBe("a-b");
		expect(mentionToken("a\nb")).toBe("a-b");
	});

	it("trims the edges before joining", () => {
		expect(mentionToken("  Code Reviewer  ")).toBe("Code-Reviewer");
	});

	it("gives a spaced and a dashed name the same token, which is the collision the form warns about", () => {
		expect(mentionToken("Code Reviewer")).toBe(mentionToken("Code-Reviewer"));
	});

	it("keeps the case, so the token reads as the agent was named", () => {
		expect(mentionToken("CodeReviewer")).toBe("CodeReviewer");
	});

	it("handles an empty or blank name", () => {
		expect(mentionToken("")).toBe("");
		expect(mentionToken("   ")).toBe("");
	});

	it("leaves accents and non-latin scripts intact", () => {
		expect(mentionToken("Revue de código")).toBe("Revue-de-código");
		expect(mentionToken("エージェント")).toBe("エージェント");
	});

	it("does not collapse dashes the name already carries", () => {
		expect(mentionToken("a--b")).toBe("a--b");
	});
});
