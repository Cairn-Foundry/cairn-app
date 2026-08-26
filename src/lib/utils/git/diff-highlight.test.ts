import { describe, expect, it } from "vitest";
import {
	defaultSyntaxTokens,
	type SyntaxTokens,
} from "$lib/utils/editor/syntax-tokens";
import { highlightLineInline } from "./diff-highlight-core";
import { highlightLineToHtml } from "./diff-syntax-highlight";

const TOKENS: SyntaxTokens = defaultSyntaxTokens("default");

/** The source line the rendered HTML stands for: spans dropped, entities decoded. */
const textOf = (html: string) => {
	const el = document.createElement("div");
	el.innerHTML = html;
	return el.textContent ?? "";
};

describe("highlightLineInline", () => {
	it("wraps the tokens of a line in colour spans", async () => {
		const html = await highlightLineInline(
			"const x = 1;",
			"typescript" as never,
			TOKENS,
		);
		expect(html).toContain("<span");
		expect(textOf(html)).toBe("const x = 1;");
	});

	it("keeps the source text intact, whatever it highlighted", async () => {
		for (const line of [
			"function f() {}",
			"  indented = true",
			"a && b || c",
			'const s = "quoted";',
		]) {
			const html = await highlightLineInline(
				line,
				"typescript" as never,
				TOKENS,
			);
			expect(textOf(html), line).toBe(line);
		}
	});

	it("returns plain text for a line with no language", async () => {
		const html = await highlightLineInline(
			"just text",
			"text" as never,
			TOKENS,
		);
		expect(html).toBe("just text");
	});

	it("returns an empty line unchanged", async () => {
		expect(await highlightLineInline("", "typescript" as never, TOKENS)).toBe(
			"",
		);
	});

	it("escapes markup rather than injecting it", async () => {
		const html = await highlightLineInline(
			"<script>alert(1)</script>",
			"text" as never,
			TOKENS,
		);
		expect(html).not.toContain("<script>");
		expect(html).toContain("&lt;script&gt;");
	});

	it("escapes markup inside a highlighted language too", async () => {
		const html = await highlightLineInline(
			'const s = "<img onerror=x>";',
			"typescript" as never,
			TOKENS,
		);
		expect(html).not.toContain("<img");
		expect(html).toContain("&lt;img");
	});

	it("escapes an ampersand once, not twice", async () => {
		const html = await highlightLineInline("a & b", "text" as never, TOKENS);
		expect(html).toBe("a &amp; b");
	});

	it("paints a token with the colour the palette gives it", async () => {
		const custom: SyntaxTokens = {
			...TOKENS,
			kw: { color: "#ff0000" },
		};
		const html = await highlightLineInline(
			"const x = 1;",
			"typescript" as never,
			custom,
		);
		expect(html).toContain("#ff0000");
	});

	it("carries the italic and bold flags of a token into the style", async () => {
		const custom: SyntaxTokens = {
			...TOKENS,
			cmt: { color: "#888888", italic: true, bold: true },
		};
		const html = await highlightLineInline(
			"// a comment",
			"typescript" as never,
			custom,
		);
		expect(html).toContain("font-style:italic");
		expect(html).toContain("font-weight:600");
	});

	it("keeps accents and non-latin scripts byte for byte", async () => {
		for (const line of [
			'const s = "café été";',
			'const s = "日本語";',
			'const s = "مرحبا";',
		]) {
			const html = await highlightLineInline(
				line,
				"typescript" as never,
				TOKENS,
			);
			expect(textOf(html), line).toBe(line);
		}
	});

	it("keeps a tab and a run of spaces", async () => {
		const line = "\tif (x)   return;";
		const html = await highlightLineInline(line, "typescript" as never, TOKENS);
		expect(textOf(html)).toBe(line);
	});

	it("survives a line that is not valid source", async () => {
		const line = "const const const {{{";
		const html = await highlightLineInline(line, "typescript" as never, TOKENS);
		expect(textOf(html)).toBe(line);
	});

	it("handles a very long line without truncating it", async () => {
		const line = `const x = "${"a".repeat(20_000)}";`;
		const html = await highlightLineInline(line, "typescript" as never, TOKENS);
		expect(textOf(html)).toHaveLength(line.length);
	});

	it("falls back to plain text for a language it has no parser for", async () => {
		const html = await highlightLineInline(
			"some line",
			"no-such-language" as never,
			TOKENS,
		);
		expect(textOf(html)).toBe("some line");
	});
});

describe("highlightLineToHtml", () => {
	/**
	 * A Worker cannot be built under jsdom, so the module falls back to running
	 * the same code inline. The result must be identical either way.
	 */
	it("answers the same as the inline path it falls back to", async () => {
		const line = "const x = 1;";
		expect(await highlightLineToHtml(line, "typescript" as never, TOKENS)).toBe(
			await highlightLineInline(line, "typescript" as never, TOKENS),
		);
	});

	it("renders several lines independently", async () => {
		const [a, b] = await Promise.all([
			highlightLineToHtml("const a = 1;", "typescript" as never, TOKENS),
			highlightLineToHtml("const b = 2;", "typescript" as never, TOKENS),
		]);
		expect(textOf(a)).toBe("const a = 1;");
		expect(textOf(b)).toBe("const b = 2;");
	});

	it("escapes markup on the fallback path too", async () => {
		const html = await highlightLineToHtml(
			"<img onerror=x>",
			"text" as never,
			TOKENS,
		);
		expect(html).not.toContain("<img");
	});

	it("returns an empty line unchanged", async () => {
		expect(await highlightLineToHtml("", "typescript" as never, TOKENS)).toBe(
			"",
		);
	});
});
