// Opening a file normalizes its line endings, saving it puts them back. The
// round trip has to be exact: a file the user never edited must reach the disk
// byte for byte as it was read, whatever it contains.

import { describe, expect, it } from "vitest";
import {
	convertToSpaces,
	convertToTabs,
	denormalizeLineEndings,
	detectIndentStyle,
	detectLineEndings,
	detectSpaceSize,
	normalizeLineEndings,
} from "./files-indent";

/** What the editor does on open, then on save, with nothing edited between. */
function roundTrip(text: string): string {
	const le = detectLineEndings(text);
	return denormalizeLineEndings(normalizeLineEndings(text, le), le);
}

describe("line ending round trip", () => {
	it("leaves an LF file untouched", () => {
		const text = "one\ntwo\nthree\n";
		expect(roundTrip(text)).toBe(text);
	});

	it("leaves a CRLF file untouched", () => {
		const text = "one\r\ntwo\r\nthree\r\n";
		expect(roundTrip(text)).toBe(text);
	});

	it("leaves a file with no line ending at all untouched", () => {
		expect(roundTrip("single line")).toBe("single line");
	});

	it("leaves an empty file untouched", () => {
		expect(roundTrip("")).toBe("");
	});

	it("leaves a file that is only blank lines untouched", () => {
		expect(roundTrip("\n\n\n")).toBe("\n\n\n");
		expect(roundTrip("\r\n\r\n")).toBe("\r\n\r\n");
	});

	it("keeps a trailing newline, and keeps its absence", () => {
		expect(roundTrip("a\nb\n")).toBe("a\nb\n");
		expect(roundTrip("a\nb")).toBe("a\nb");
	});

	it("keeps accents, non-latin scripts and emoji-free unicode", () => {
		const text = "café\nété\n日本語\nمرحبا\n";
		expect(roundTrip(text)).toBe(text);
	});

	it("keeps a tab and a run of trailing spaces", () => {
		const text = "\tindented   \nnext\n";
		expect(roundTrip(text)).toBe(text);
	});

	it("survives a large file", () => {
		const text = `${Array.from({ length: 20_000 }, (_, i) => `line ${i}`).join("\n")}\n`;
		expect(roundTrip(text)).toBe(text);
	});

	it("survives a large CRLF file", () => {
		const text = `${Array.from({ length: 10_000 }, (_, i) => `line ${i}`).join("\r\n")}\r\n`;
		expect(roundTrip(text)).toBe(text);
	});

	/**
	 * A file that mixes both endings is detected as CRLF and normalized whole,
	 * so the round trip makes it uniform rather than preserving the mixture.
	 * Documented because it is a real, deliberate change to the file.
	 */
	it("makes a file that mixes both endings uniform", () => {
		const mixed = "a\r\nb\nc\r\n";
		expect(detectLineEndings(mixed)).toBe("CRLF");
		expect(roundTrip(mixed)).toBe("a\r\nb\r\nc\r\n");
	});

	it("never leaves a stray carriage return in the normalized text", () => {
		for (const text of ["a\r\nb", "a\nb", "a\r\nb\nc\r\n"]) {
			expect(normalizeLineEndings(text, detectLineEndings(text))).not.toContain(
				"\r",
			);
		}
	});
});

describe("detectLineEndings", () => {
	it("calls a file with no ending LF, which is what a new file gets", () => {
		expect(detectLineEndings("")).toBe("LF");
		expect(detectLineEndings("single line")).toBe("LF");
	});

	it("detects CRLF from a single occurrence", () => {
		expect(detectLineEndings("a\r\nb\nc\nd\n")).toBe("CRLF");
	});

	it("ignores a lone carriage return with no newline after it", () => {
		expect(detectLineEndings("a\rb")).toBe("LF");
	});
});

describe("indent conversion round trip", () => {
	it("takes tabs to spaces and back", () => {
		const text = "\tone\n\t\ttwo\n";
		expect(convertToTabs(convertToSpaces(text, 4), 4)).toBe(text);
	});

	it("takes spaces to tabs and back", () => {
		const text = "    one\n        two\n";
		expect(convertToSpaces(convertToTabs(text, 4), 4)).toBe(text);
	});

	it("leaves a file with no indentation alone", () => {
		const text = "one\ntwo\n";
		expect(convertToSpaces(text, 4)).toBe(text);
		expect(convertToTabs(text, 4)).toBe(text);
	});

	it("leaves an empty file alone", () => {
		expect(convertToSpaces("", 4)).toBe("");
		expect(convertToTabs("", 4)).toBe("");
	});

	it("touches only the leading indentation, not the rest of the line", () => {
		const text = "\tconst s = 'a\tb';\n";
		expect(convertToSpaces(text, 4)).toBe("    const s = 'a\tb';\n");
	});

	it("survives a large file", () => {
		const text = `${Array.from({ length: 10_000 }, () => "\tline").join("\n")}\n`;
		expect(convertToTabs(convertToSpaces(text, 2), 2)).toBe(text);
	});
});

describe("detectIndentStyle", () => {
	it("says nothing about a file with no indentation", () => {
		expect(detectIndentStyle("one\ntwo\n")).toBeNull();
		expect(detectIndentStyle("")).toBeNull();
	});

	it("detects tabs and spaces", () => {
		expect(detectIndentStyle("\tone\n")).toBe("tabs");
		expect(detectIndentStyle("    one\n")).toBe("spaces");
	});

	it("keeps its answer on a large file", () => {
		const tabs = Array.from({ length: 5_000 }, () => "\tline").join("\n");
		expect(detectIndentStyle(tabs)).toBe("tabs");
	});
});

describe("detectSpaceSize", () => {
	it("reads the width the file indents by", () => {
		expect(detectSpaceSize("  one\n    two\n")).toBe(2);
		expect(detectSpaceSize("    one\n        two\n")).toBe(4);
	});

	it("answers a usable width for a file that never indents", () => {
		expect(detectSpaceSize("one\ntwo\n")).toBeGreaterThan(0);
		expect(detectSpaceSize("")).toBeGreaterThan(0);
	});
});
