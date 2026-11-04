// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveLanguageExtension } from "#lib/utils/editor/editor-theme";
import {
	defaultSyntaxTokens,
	type SyntaxTokens,
} from "#lib/utils/editor/syntax-tokens";
import {
	highlightDocumentInline,
	highlightLineInline,
} from "./diff-highlight-core";
import { cachedLineHtml, highlightLineToHtml } from "./diff-syntax-highlight";

vi.mock("#lib/utils/editor/editor-theme", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("#lib/utils/editor/editor-theme")>();
	return {
		...actual,
		resolveLanguageExtension: vi.fn(actual.resolveLanguageExtension),
	};
});

const TOKENS: SyntaxTokens = defaultSyntaxTokens("default");

/** The source line the rendered HTML stands for: spans dropped, entities decoded. */
const textOf = (html: string) => {
	const el = document.createElement("div");
	el.innerHTML = html;
	return el.textContent ?? "";
};

describe("highlightLineInline", () => {
	it("wraps the tokens of a line in colour spans", async () => {
		const html = await highlightLineInline("const x = 1;", "ts", TOKENS);
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
			const html = await highlightLineInline(line, "ts", TOKENS);
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
		expect(await highlightLineInline("", "ts", TOKENS)).toBe("");
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
			"ts",
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
		const html = await highlightLineInline("const x = 1;", "ts", custom);
		expect(html).toContain("#ff0000");
	});

	it("carries the italic and bold flags of a token into the style", async () => {
		const custom: SyntaxTokens = {
			...TOKENS,
			cmt: { color: "#888888", italic: true, bold: true },
		};
		const html = await highlightLineInline("// a comment", "ts", custom);
		expect(html).toContain("font-style:italic");
		expect(html).toContain("font-weight:600");
	});

	it("leaves a token the palette does not style without any colour", async () => {
		const custom = { ...TOKENS, kw: undefined } as unknown as SyntaxTokens;
		const html = await highlightLineInline("const x", "ts", custom);
		expect(html).toContain('<span style="">const</span>');
		expect(textOf(html)).toBe("const x");
	});

	it("writes the exact style of a token, with only the flags it carries", async () => {
		const custom: SyntaxTokens = {
			...TOKENS,
			kw: { color: "#ff0000" },
			cmt: { color: "#888888", italic: true },
			str: { color: "#00ff00", bold: true },
		};
		expect(await highlightLineInline("const", "ts", custom)).toBe(
			'<span style="color:#ff0000;">const</span>',
		);
		expect(await highlightLineInline("// hi", "ts", custom)).toBe(
			'<span style="color:#888888;font-style:italic;">// hi</span>',
		);
		expect(await highlightLineInline('"s"', "ts", custom)).toBe(
			'<span style="color:#00ff00;font-weight:600;">"s"</span>',
		);
	});

	it("leaves the text between tokens outside any span", async () => {
		const html = await highlightLineInline("const x", "ts", TOKENS);
		expect(html).toMatch(/<\/span> <span/);
	});

	it("keeps accents and non-latin scripts byte for byte", async () => {
		for (const line of [
			'const s = "café été";',
			'const s = "日本語";',
			'const s = "مرحبا";',
		]) {
			const html = await highlightLineInline(line, "ts", TOKENS);
			expect(textOf(html), line).toBe(line);
		}
	});

	it("keeps a tab and a run of spaces", async () => {
		const line = "\tif (x)   return;";
		const html = await highlightLineInline(line, "ts", TOKENS);
		expect(textOf(html)).toBe(line);
	});

	it("survives a line that is not valid source", async () => {
		const line = "const const const {{{";
		const html = await highlightLineInline(line, "ts", TOKENS);
		expect(textOf(html)).toBe(line);
	});

	it("handles a very long line without truncating it", async () => {
		const line = `const x = "${"a".repeat(20_000)}";`;
		const html = await highlightLineInline(line, "ts", TOKENS);
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
		expect(await highlightLineToHtml(line, "ts", TOKENS)).toBe(
			await highlightLineInline(line, "ts", TOKENS),
		);
	});

	it("renders several lines independently", async () => {
		const [a, b] = await Promise.all([
			highlightLineToHtml("const a = 1;", "ts", TOKENS),
			highlightLineToHtml("const b = 2;", "ts", TOKENS),
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
		expect(await highlightLineToHtml("", "ts", TOKENS)).toBe("");
	});
});

describe("the highlighted line cache", () => {
	it("serves a line again without highlighting it twice", async () => {
		const tokens = defaultSyntaxTokens("default");
		expect(cachedLineHtml("const cached = 1;", "ts", tokens)).toBeUndefined();
		const first = await highlightLineToHtml("const cached = 1;", "ts", tokens);
		expect(cachedLineHtml("const cached = 1;", "ts", tokens)).toBe(first);
		expect(await highlightLineToHtml("const cached = 1;", "ts", tokens)).toBe(
			first,
		);
	});

	it("keys a line by its language", async () => {
		const tokens = defaultSyntaxTokens("default");
		await highlightLineToHtml("a < b", "text" as never, tokens);
		expect(cachedLineHtml("a < b", "text" as never, tokens)).toBe("a &lt; b");
		expect(cachedLineHtml("a < b", "ts", tokens)).toBeUndefined();
	});

	it("starts over when the palette changes", async () => {
		const tokens = defaultSyntaxTokens("default");
		await highlightLineToHtml("plain", "text" as never, tokens);
		expect(cachedLineHtml("plain", "text" as never, tokens)).toBe("plain");
		expect(
			cachedLineHtml("plain", "text" as never, { ...tokens }),
		).toBeUndefined();
	});

	it("empties itself once it holds 50000 lines", async () => {
		const tokens = defaultSyntaxTokens("default");
		const lines = Array.from({ length: 50_001 }, (_, i) => `line-${i}`);
		await Promise.all(
			lines.map((line) => highlightLineToHtml(line, "text" as never, tokens)),
		);
		expect(cachedLineHtml("line-0", "text" as never, tokens)).toBeUndefined();
		expect(cachedLineHtml("line-50000", "text" as never, tokens)).toBe(
			"line-50000",
		);
	});

	it("keeps earlier lines while the cache is below its limit", async () => {
		const tokens = defaultSyntaxTokens("default");
		await highlightLineToHtml("first kept", "text" as never, tokens);
		await highlightLineToHtml("second kept", "text" as never, tokens);
		expect(cachedLineHtml("first kept", "text" as never, tokens)).toBe(
			"first kept",
		);
		expect(cachedLineHtml("second kept", "text" as never, tokens)).toBe(
			"second kept",
		);
	});
});

describe("highlighting through a Worker", () => {
	class FakeWorker {
		static instances: FakeWorker[] = [];
		onmessage: ((e: MessageEvent) => void) | null = null;
		onerror: (() => void) | null = null;
		postMessage = vi.fn();
		terminate = vi.fn();
		constructor() {
			FakeWorker.instances.push(this);
		}
		answer(id: number, html: string) {
			this.onmessage?.({ data: { id, html } } as MessageEvent);
		}
	}

	const tokens = defaultSyntaxTokens("default");

	const loadModule = async () => {
		vi.resetModules();
		return import("./diff-syntax-highlight");
	};

	beforeEach(() => {
		FakeWorker.instances = [];
		vi.stubGlobal("Worker", FakeWorker);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("posts the line to the worker and resolves with its answer", async () => {
		const { highlightLineToHtml: highlight } = await loadModule();
		const result = highlight("const a", "ts", tokens);
		const [worker] = FakeWorker.instances;
		expect(worker.postMessage).toHaveBeenCalledWith({
			id: 1,
			code: "const a",
			lang: "ts",
			tokens,
		});
		worker.answer(1, "<span>const a</span>");
		expect(await result).toBe("<span>const a</span>");
	});

	it("builds one worker and numbers the requests", async () => {
		const { highlightLineToHtml: highlight } = await loadModule();
		const first = highlight("line one", "ts", tokens);
		const second = highlight("line two", "ts", tokens);
		expect(FakeWorker.instances).toHaveLength(1);
		const [worker] = FakeWorker.instances;
		expect(worker.postMessage).toHaveBeenCalledTimes(2);
		expect(worker.postMessage.mock.calls.map(([r]) => r.id)).toEqual([1, 2]);
		worker.answer(2, "two");
		worker.answer(1, "one");
		expect(await first).toBe("one");
		expect(await second).toBe("two");
	});

	it("answers a repeated line from the cache without asking the worker", async () => {
		const { highlightLineToHtml: highlight } = await loadModule();
		const first = highlight("same line", "ts", tokens);
		FakeWorker.instances[0].answer(1, "cached html");
		await first;
		expect(await highlight("same line", "ts", tokens)).toBe("cached html");
		expect(FakeWorker.instances[0].postMessage).toHaveBeenCalledTimes(1);
	});

	it("highlights inline when the worker answers with nothing", async () => {
		const { highlightLineToHtml: highlight } = await loadModule();
		const result = highlight("plain & text", "text" as never, tokens);
		FakeWorker.instances[0].answer(1, "");
		expect(await result).toBe("plain &amp; text");
	});

	it("falls back inline for good once the worker fails", async () => {
		const { highlightLineToHtml: highlight } = await loadModule();
		const waiting = highlight("a < b", "text" as never, tokens);
		const [worker] = FakeWorker.instances;
		worker.onerror?.();
		expect(worker.terminate).toHaveBeenCalledTimes(1);
		expect(await waiting).toBe("a &lt; b");
		expect(await highlight("c < d", "text" as never, tokens)).toBe("c &lt; d");
		expect(FakeWorker.instances).toHaveLength(1);
		expect(worker.postMessage).toHaveBeenCalledTimes(1);
	});
});

describe("the language cache of highlightLineInline", () => {
	beforeEach(() => {
		vi.mocked(resolveLanguageExtension).mockClear();
	});

	it("resolves a language once however many lines use it", async () => {
		await highlightLineInline("select 1", "sql", TOKENS);
		await highlightLineInline("select 2", "sql", TOKENS);
		expect(resolveLanguageExtension).toHaveBeenCalledTimes(1);
		expect(resolveLanguageExtension).toHaveBeenCalledWith("sql");
	});

	it("does not resolve a language for an empty line", async () => {
		await highlightLineInline("", "xml", TOKENS);
		expect(resolveLanguageExtension).not.toHaveBeenCalled();
	});

	it("does not resolve a language for plain text", async () => {
		await highlightLineInline("plain", "text" as never, TOKENS);
		expect(resolveLanguageExtension).not.toHaveBeenCalled();
	});
});

describe("highlightDocumentInline", () => {
	const SOURCE = "<style>\n  a { color: red; }\n</style>";

	it("returns one entry per line, text intact", async () => {
		const lines = await highlightDocumentInline(SOURCE, "svelte", TOKENS);
		expect(lines.map(textOf)).toEqual(SOURCE.split("\n"));
	});

	it("colours a css line from the style block it sits in", async () => {
		const [, cssLine] = await highlightDocumentInline(SOURCE, "svelte", TOKENS);
		const alone = await highlightLineInline(
			"  a { color: red; }",
			"svelte",
			TOKENS,
		);
		expect(cssLine.match(/<span/g)?.length ?? 0).toBeGreaterThan(
			alone.match(/<span/g)?.length ?? 0,
		);
	});
});
