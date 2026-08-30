import { describe, expect, it } from "vitest";
import { captureTitle, TITLE_MAX, titleFromPrompt } from "./conversation-title";

const ESC = String.fromCharCode(27);
const DEL = String.fromCharCode(127);

/** Feeds a sequence of typed chunks, returning the title it produced. */
function type(...chunks: string[]): string | null {
	let pending = "";
	for (const chunk of chunks) {
		const result = captureTitle(pending, chunk);
		if (result.title !== null) return result.title;
		pending = result.pending;
	}
	return null;
}

describe("captureTitle", () => {
	it("waits for Enter before naming anything", () => {
		expect(type("fix the parser")).toBeNull();
		expect(type("fix the parser", "\r")).toBe("Fix the parser");
	});

	it("keeps only the first line of a pasted prompt", () => {
		expect(type("first line\nsecond line\n")).toBe("First line");
	});

	it("applies backspace, so the title is what the user saw themselves type", () => {
		expect(type("parsee", "\b", "r\r")).toBe("Parser");
		expect(type(`lexerX${DEL}\r`)).toBe("Lexer");
	});

	it("drops the escape sequences an interactive prompt sends while editing", () => {
		expect(type(`${ESC}[2Kfix it${ESC}[0m\r`)).toBe("Fix it");
	});

	it("treats an empty Enter as no title rather than an empty one", () => {
		expect(type("\r")).toBeNull();
		expect(type("   \r")).toBeNull();
	});

	it("elides a prompt longer than a row can show", () => {
		const long = "a".repeat(TITLE_MAX + 40);
		expect(type(`${long}\r`)).toHaveLength(TITLE_MAX);
	});

	it("carries an unfinished line across chunks", () => {
		const first = captureTitle("", "fix the ");
		expect(first.title).toBeNull();
		expect(captureTitle(first.pending, "parser\r").title).toBe(
			"Fix the parser",
		);
	});
});

describe("titleFromPrompt", () => {
	it("drops politeness and the can-you framing", () => {
		expect(titleFromPrompt("please can you fix the parser?")).toBe(
			"Fix the parser",
		);
		expect(titleFromPrompt("peux-tu corriger le parseur")).toBe(
			"Corriger le parseur",
		);
		expect(titleFromPrompt("I want you to add a test")).toBe("Add a test");
	});

	it("keeps the first sentence only", () => {
		expect(titleFromPrompt("Fix the parser. It crashes on empty input.")).toBe(
			"Fix the parser",
		);
	});

	it("cuts a long prompt on a word boundary", () => {
		const long = `${"word ".repeat(30)}end`;
		const title = titleFromPrompt(long);
		expect(title.length).toBeLessThanOrEqual(TITLE_MAX);
		expect(title.endsWith("word")).toBe(true);
	});

	it("is empty for a prompt that is only filler", () => {
		expect(titleFromPrompt("  please,  ")).toBe("");
	});
});
