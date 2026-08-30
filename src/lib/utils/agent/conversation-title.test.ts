import { describe, expect, it } from "vitest";
import { captureTitle, TITLE_MAX } from "./conversation-title";

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
		expect(type("fix the parser", "\r")).toBe("fix the parser");
	});

	it("keeps only the first line of a pasted prompt", () => {
		expect(type("first line\nsecond line\n")).toBe("first line");
	});

	it("applies backspace, so the title is what the user saw themselves type", () => {
		expect(type("parsee", "\b", "r\r")).toBe("parser");
		expect(type(`lexerX${DEL}\r`)).toBe("lexer");
	});

	it("drops the escape sequences an interactive prompt sends while editing", () => {
		expect(type(`${ESC}[2Kfix it${ESC}[0m\r`)).toBe("fix it");
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
			"fix the parser",
		);
	});
});
