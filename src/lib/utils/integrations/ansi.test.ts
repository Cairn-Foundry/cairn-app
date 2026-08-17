import { describe, expect, it } from "vitest";
import { ansiToLines, ansiToSpans, escapeHtml, stripAnsi } from "./ansi";

describe("ansiToSpans", () => {
	it("returns escaped plain text untouched otherwise", () => {
		expect(ansiToSpans("a < b && c > d")).toBe("a &lt; b &amp;&amp; c &gt; d");
	});

	it("wraps coloured runs in named spans and closes them on reset", () => {
		expect(ansiToSpans("\x1b[31mFAIL\x1b[0m ok")).toBe(
			'<span class="ansi-fg-red">FAIL</span> ok',
		);
	});

	it("combines bold and colour on one span", () => {
		expect(ansiToSpans("\x1b[1;32mPASS\x1b[m")).toBe(
			'<span class="ansi-fg-green ansi-bold">PASS</span>',
		);
	});

	it("carries colouring across lines with one span per line", () => {
		expect(ansiToLines("\x1b[33ma\nb\x1b[39mc")).toEqual([
			'<span class="ansi-fg-yellow">a</span>',
			'<span class="ansi-fg-yellow">b</span>c',
		]);
		expect(ansiToSpans("\x1b[33ma\nb\x1b[39mc")).toBe(
			'<span class="ansi-fg-yellow">a</span>\n<span class="ansi-fg-yellow">b</span>c',
		);
	});

	it("keeps empty lines", () => {
		expect(ansiToLines("a\n\nb")).toEqual(["a", "", "b"]);
	});

	it("renders 256-colour and truecolor as inline styles", () => {
		expect(ansiToSpans("\x1b[38;5;196mx\x1b[0m")).toBe(
			'<span style="color:rgb(255,0,0)">x</span>',
		);
		expect(ansiToSpans("\x1b[48;2;1;2;3my\x1b[0m")).toBe(
			'<span style="background:rgb(1,2,3)">y</span>',
		);
	});

	it("escapes html inside coloured runs", () => {
		expect(ansiToSpans("\x1b[31m<script>\x1b[0m")).toBe(
			'<span class="ansi-fg-red">&lt;script&gt;</span>',
		);
	});

	it("drops cursor movement and OSC sequences", () => {
		expect(ansiToSpans("a\x1b[2Kb\x1b]0;title\x07c\x1b[1Ad")).toBe("abcd");
	});

	it("handles a bright colour and an empty input", () => {
		expect(ansiToSpans("\x1b[91mred\x1b[0m")).toBe(
			'<span class="ansi-fg-bright-red">red</span>',
		);
		expect(ansiToSpans("")).toBe("");
	});
});

describe("stripAnsi", () => {
	it("removes every escape sequence", () => {
		expect(stripAnsi("\x1b[1;31mFAIL\x1b[0m done\x1b[2K")).toBe("FAIL done");
	});
});

describe("escapeHtml", () => {
	it("escapes quotes and angle brackets", () => {
		expect(escapeHtml(`<a href="x">'y'</a>`)).toBe(
			"&lt;a href=&quot;x&quot;&gt;&#39;y&#39;&lt;/a&gt;",
		);
	});
});
