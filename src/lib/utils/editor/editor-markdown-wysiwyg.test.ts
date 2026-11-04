// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { forceParsing } from "@codemirror/language";
import { EditorState, RangeSetBuilder } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import { minimapOpaqueRanges } from "@replit/codemirror-minimap";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	type Mock,
	vi,
} from "vitest";
import { t } from "#lib/i18n";
import { openUrl } from "#lib/services/opener-service";
import { CLIPBOARD_CLEAR_DELAY } from "#lib/utils/timing";
import {
	buildMarkdownWysiwyg,
	collectBlockRanges,
	collectInlineRanges,
	decodeHtmlEntities,
	fillTableCell,
	findHeadingLine,
	isOpenableLink,
	linkHref,
	MERMAID_OPEN_EVENT,
	MermaidWidget,
	parseHtmlImage,
	parseLinkTarget,
	parseMarkdownImage,
	parseMarkdownTable,
	resolveDocRelativePath,
	resolveImageSrc,
	setMarkdownDocPath,
	slugifyHeading,
} from "./editor-markdown-wysiwyg";
import { renderMermaid } from "./mermaid";
import { attachMermaidZoom } from "./mermaid-zoom";

vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
	convertFileSrc: vi.fn((path: string) => `asset://localhost${path}`),
}));

vi.mock("#lib/services/opener-service", () => ({ openUrl: vi.fn() }));

vi.mock("./mermaid", () => ({ renderMermaid: vi.fn() }));

vi.mock("./mermaid-zoom", () => ({
	attachMermaidZoom: vi.fn(() => ({ reset: vi.fn(), destroy: vi.fn() })),
}));

function stateOf(doc: string): EditorState {
	return EditorState.create({
		doc,
		extensions: [markdown({ base: markdownLanguage })],
		selection: { anchor: doc.length },
	});
}

function renderInline(doc: string): string {
	const state = stateOf(`${doc}\n\n`);
	const ranges = collectInlineRanges(state, 0, state.doc.length)
		.filter((r) => r.from !== r.to && !r.value.spec?.class)
		.sort((a, b) => a.from - b.from);

	let out = "";
	let cursor = 0;
	for (const range of ranges) {
		if (range.from < cursor) continue;
		out += state.doc.sliceString(cursor, range.from);
		cursor = range.to;
	}
	return (out + state.doc.sliceString(cursor)).trim();
}

describe("inline rendering of the reported cases", () => {
	it("hides a single-quoted link title", () => {
		expect(
			renderInline(
				"- [Dmitriy Mozgovoy](https://github.com/DigitalBrainJS '+247/-16 (#7030 #7022 )')",
			),
		).toBe("Dmitriy Mozgovoy");
	});

	it("renders a link nested in parentheses", () => {
		expect(
			renderInline(
				"- adding build artifacts ([9ec86de](https://github.com/axios/axios/commit/9ec86de))",
			),
		).toBe("adding build artifacts (9ec86de)");
	});

	it("replaces an inline <img> tag", () => {
		expect(
			renderInline(
				'- <img src="https://avatars.githubusercontent.com/u/1?v=4" alt="avatar" width="18"/> [Dmitriy](https://github.com/x)',
			),
		).toBe("Dmitriy");
	});

	it("leaves an unsupported html tag as raw text", () => {
		expect(renderInline("- <span>hello</span>")).toBe("<span>hello</span>");
	});

	it("keeps inline code content but hides its backticks", () => {
		expect(renderInline("run `npm test` now")).toBe("run npm test now");
	});
});

describe("linkHref", () => {
	it("reads a plain destination", () => {
		expect(linkHref("[a](https://example.com/x)")).toBe(
			"https://example.com/x",
		);
	});

	it("ignores a quoted title", () => {
		expect(linkHref("[a](https://example.com 'the title')")).toBe(
			"https://example.com",
		);
	});

	it("decodes entities and strips angle brackets", () => {
		expect(linkHref("[a](<https://x/y?v&#x3D;4>)")).toBe("https://x/y?v=4");
	});

	it("returns null when there is no destination", () => {
		expect(linkHref("[a][ref]")).toBeNull();
	});
});

describe("isOpenableLink", () => {
	it("accepts web and mail schemes", () => {
		expect(isOpenableLink("https://example.com")).toBe(true);
		expect(isOpenableLink("mailto:a@b.c")).toBe(true);
	});

	it("rejects anything else", () => {
		expect(isOpenableLink("file:///etc/passwd")).toBe(false);
		expect(isOpenableLink("javascript:alert(1)")).toBe(false);
		expect(isOpenableLink("./relative.md")).toBe(false);
	});
});

describe("collectBlockRanges", () => {
	it("hides both fence lines of a code block", () => {
		const doc = "```bash\n$ npm install axios\n```\n";
		const state = stateOf(doc);
		const ranges = collectBlockRanges(state);

		expect(ranges).toHaveLength(2);
		expect(state.doc.sliceString(ranges[0].from, ranges[0].to)).toBe("```bash");
		expect(state.doc.sliceString(ranges[1].from, ranges[1].to)).toBe("\n```");
	});

	it("keeps the fence source visible when the cursor sits inside", () => {
		const doc = "```bash\n$ npm install axios\n```\n";
		const state = EditorState.create({
			doc,
			extensions: [markdown({ base: markdownLanguage })],
			selection: { anchor: 10 },
		});

		expect(collectBlockRanges(state)).toHaveLength(0);
	});

	it("replaces a mermaid block whole, with only its body as source", () => {
		const doc = "```mermaid\ngraph TD;\n  A-->B;\n```\n";
		const state = stateOf(doc);
		const ranges = collectBlockRanges(state);

		expect(ranges).toHaveLength(1);
		expect(state.doc.sliceString(ranges[0].from, ranges[0].to)).toBe(
			"```mermaid\ngraph TD;\n  A-->B;\n```",
		);
		expect(ranges[0].value.spec.widget.source).toBe("graph TD;\n  A-->B;\n");
	});

	it("falls back to a plain fence for an empty mermaid block", () => {
		const state = stateOf("```mermaid\n```\n");
		const ranges = collectBlockRanges(state);

		expect(ranges).toHaveLength(2);
		expect(ranges[0].value.spec.widget.source).toBeUndefined();
	});

	it("hides only the opening fence when the block is never closed", () => {
		const state = EditorState.create({
			doc: "intro\n\n```\nloose\n",
			extensions: [markdown({ base: markdownLanguage })],
			selection: { anchor: 0 },
		});

		const ranges = collectBlockRanges(state);
		expect(ranges).toHaveLength(1);
		expect(state.doc.sliceString(ranges[0].from, ranges[0].to)).toBe("```");
	});
});

describe("parseHtmlImage", () => {
	it("reads src, alt and size from a self-closing tag", () => {
		expect(
			parseHtmlImage('<img src="a/b.png" alt="avatar" width="18"/>'),
		).toEqual({ src: "a/b.png", alt: "avatar", width: "18", height: null });
	});

	it("accepts single-quoted and unquoted attributes", () => {
		expect(parseHtmlImage("<img src='a.png' width=20>")).toEqual({
			src: "a.png",
			alt: "",
			width: "20",
			height: null,
		});
	});

	it("returns null without a src", () => {
		expect(parseHtmlImage('<img alt="x"/>')).toBeNull();
	});

	it("returns null for any other tag", () => {
		expect(parseHtmlImage("<script>alert(1)</script>")).toBeNull();
		expect(parseHtmlImage("<span>x</span>")).toBeNull();
	});
});

describe("decodeHtmlEntities", () => {
	it("decodes named and numeric entities", () => {
		expect(decodeHtmlEntities("a&amp;b&#x3D;c&#61;d")).toBe("a&b=c=d");
	});

	it("leaves an unknown entity untouched", () => {
		expect(decodeHtmlEntities("&unknown;")).toBe("&unknown;");
	});
});

describe("resolveImageSrc", () => {
	it("passes remote and data urls through", () => {
		expect(resolveImageSrc("https://x/y.png?v&#x3D;4", null)).toBe(
			"https://x/y.png?v=4",
		);
	});

	it("drops a url carrying an unsupported scheme", () => {
		expect(resolveImageSrc("javascript:alert(1)", "/repo/README.md")).toBe("");
	});
});

describe("parseMarkdownTable", () => {
	it("separates the header row from the body and drops the delimiter", () => {
		const table = parseMarkdownTable(
			["| Name | Size |", "| --- | --- |", "| a.ts | 12 |"].join("\n"),
		);

		expect(table).toEqual({
			rows: [
				["Name", "Size"],
				["a.ts", "12"],
			],
			align: [null, null],
			hasHeader: true,
		});
	});

	it("reads the alignment markers", () => {
		const table = parseMarkdownTable(
			["| l | c | r |", "| :-- | :-: | --: |", "| 1 | 2 | 3 |"].join("\n"),
		);

		expect(table?.align).toEqual(["left", "center", "right"]);
	});

	it("accepts rows without outer pipes", () => {
		const table = parseMarkdownTable(
			["Name | Size", "--- | ---", "a.ts | 12"].join("\n"),
		);

		expect(table?.rows).toEqual([
			["Name", "Size"],
			["a.ts", "12"],
		]);
	});

	it("keeps an escaped pipe inside a cell", () => {
		const table = parseMarkdownTable(
			["| a | b |", "| --- | --- |", "| x \\| y | z |"].join("\n"),
		);

		expect(table?.rows[1]).toEqual(["x | y", "z"]);
	});

	it("returns null for an empty source", () => {
		expect(parseMarkdownTable("   \n  ")).toBeNull();
	});
});

describe("parseLinkTarget", () => {
	it("recognises an external link", () => {
		expect(parseLinkTarget("https://example.com")).toEqual({
			kind: "external",
			href: "https://example.com",
		});
	});

	it("recognises an in-document anchor", () => {
		expect(parseLinkTarget("#code-style")).toEqual({
			kind: "anchor",
			anchor: "code-style",
		});
	});

	it("splits a file link from its anchor", () => {
		expect(parseLinkTarget("./docs/guide.md#setup")).toEqual({
			kind: "file",
			path: "./docs/guide.md",
			anchor: "setup",
		});
	});

	it("accepts a file link with no anchor", () => {
		expect(parseLinkTarget("../README.md")).toEqual({
			kind: "file",
			path: "../README.md",
			anchor: null,
		});
	});

	it("decodes a percent-encoded path", () => {
		expect(parseLinkTarget("my%20notes.md")).toMatchObject({
			path: "my notes.md",
		});
	});

	it("rejects any other scheme", () => {
		expect(parseLinkTarget("javascript:alert(1)")).toEqual({
			kind: "unsupported",
		});
		expect(parseLinkTarget("  ")).toEqual({ kind: "unsupported" });
	});
});

describe("resolveDocRelativePath", () => {
	it("resolves a sibling file", () => {
		expect(resolveDocRelativePath("/repo/docs/a.md", "./b.md")).toBe(
			"/repo/docs/b.md",
		);
	});

	it("walks up with ..", () => {
		expect(resolveDocRelativePath("/repo/docs/a.md", "../README.md")).toBe(
			"/repo/README.md",
		);
	});

	it("keeps an absolute target as is", () => {
		expect(resolveDocRelativePath("/repo/docs/a.md", "/etc/hosts")).toBe(
			"/etc/hosts",
		);
	});

	it("returns null without a document path", () => {
		expect(resolveDocRelativePath(null, "./b.md")).toBeNull();
	});
});

describe("slugifyHeading", () => {
	it("matches the GitHub slug", () => {
		expect(slugifyHeading("Code style & conventions")).toBe(
			"code-style-conventions",
		);
	});

	it("strips inline code, emphasis and links", () => {
		expect(slugifyHeading("Using `bun run **dev**` [here](x)")).toBe(
			"using-bun-run-dev-here",
		);
	});
});

describe("findHeadingLine", () => {
	const doc = ["# Title", "", "text", "", "## Code style", "", "more"].join(
		"\n",
	);

	it("finds the 1-based line of a heading", () => {
		expect(findHeadingLine(doc, "code-style")).toBe(5);
	});

	it("accepts a leading hash and any case", () => {
		expect(findHeadingLine(doc, "#Code-Style")).toBe(5);
	});

	it("returns null for an unknown anchor", () => {
		expect(findHeadingLine(doc, "nope")).toBeNull();
	});
});

describe("fillTableCell", () => {
	function cellFor(text: string): HTMLElement {
		const cell = document.createElement("td");
		fillTableCell(cell, text);
		return cell;
	}

	it("renders a markdown link inside a table cell", () => {
		const cell = cellFor("see [docs](https://example.com) now");
		const link = cell.querySelector("[data-cm-md-href]");
		expect(link?.textContent).toBe("docs");
		expect(link?.getAttribute("data-cm-md-href")).toBe("https://example.com");
		expect(cell.textContent).toBe("see docs now");
	});

	it("keeps a cell without a link as plain text", () => {
		const cell = cellFor("just text");
		expect(cell.querySelector("[data-cm-md-href]")).toBeNull();
		expect(cell.textContent).toBe("just text");
	});

	it("leaves an unsupported scheme as its raw source", () => {
		const cell = cellFor("[x](javascript:alert(1))");
		expect(cell.querySelector("[data-cm-md-href]")).toBeNull();
		expect(cell.textContent).toBe("[x](javascript:alert(1))");
	});
});

/**
 * Both traps documented in CLAUDE.md have the same symptom: the markdown
 * rendering silently disappears, because CodeMirror tears the plugin down
 * rather than reporting anything. They are covered here explicitly.
 */
describe("the two ways the rendering silently disappears", () => {
	/**
	 * Trap one: tree iteration yields a parent before its children, so ranges
	 * arrive out of order. A RangeSetBuilder throws on that; Decoration.set with
	 * sort: true is what the module relies on. A document mixing nested inline
	 * markup is what actually produces the out-of-order emission.
	 */
	const nested = [
		"# A *heading* with `code` and [a link](https://example.com)",
		"",
		"> A quote with **bold**, *emphasis* and `code` inside it",
		"",
		"- A bullet with [link](./other.md) and **bold**",
		"- Another with `code`",
		"",
		"| a | b |",
		"| - | - |",
		"| **x** | [y](https://example.com) |",
		"",
		"```ts",
		"const x = 1;",
		"```",
		"",
	].join("\n");

	it("emits inline ranges the set constructor has to sort", () => {
		const state = stateOf(nested);
		const ranges = collectInlineRanges(state, 0, state.doc.length);
		expect(ranges.length).toBeGreaterThan(0);
		// A parent emitted before its children shares their start and ends
		// later, which is precisely the order a builder refuses.
		const ordered = ranges.every(
			(r, i) =>
				i === 0 ||
				ranges[i - 1].from < r.from ||
				(ranges[i - 1].from === r.from && ranges[i - 1].to <= r.to),
		);
		expect(
			ordered,
			"the fixture no longer produces out-of-order ranges, so it stops testing the sort",
		).toBe(false);
	});

	it("builds a decoration set from those unsorted ranges", () => {
		const state = stateOf(nested);
		const ranges = collectInlineRanges(state, 0, state.doc.length);
		expect(() => Decoration.set(ranges, true)).not.toThrow();
		expect(Decoration.set(ranges, true).size).toBe(ranges.length);
	});

	/** A builder is what the module must not use: it rejects the same input. */
	it("would throw through a range set builder, which is why one is not used", () => {
		const state = stateOf(nested);
		const ranges = collectInlineRanges(state, 0, state.doc.length);
		expect(() => {
			const builder = new RangeSetBuilder<Decoration>();
			for (const r of ranges) builder.add(r.from, r.to, r.value);
			builder.finish();
		}).toThrow();
	});

	it("sorts block ranges too", () => {
		const state = stateOf(nested);
		const ranges = collectBlockRanges(state);
		expect(ranges.length).toBeGreaterThan(0);
		expect(() => Decoration.set(ranges, true)).not.toThrow();
	});

	/**
	 * Trap two: a decoration replacing a line break may only come from a
	 * StateField. Anything the ViewPlugin emits is viewport-scoped, and a
	 * viewport-scoped range across a line break tears the plugin down.
	 */
	it("keeps every range that spans a line break in the block collector", () => {
		const state = stateOf(nested);
		const spansBreak = (r: { from: number; to: number }) =>
			state.doc.lineAt(r.from).number !== state.doc.lineAt(r.to).number;

		expect(collectBlockRanges(state).some(spansBreak)).toBe(true);
		expect(
			collectInlineRanges(state, 0, state.doc.length).some(spansBreak),
			"an inline range crossing a line break belongs in the block field",
		).toBe(false);
	});

	it("collects block ranges over the whole document, not a viewport slice", () => {
		const long = `${"filler\n".repeat(400)}| a | b |\n| - | - |\n| x | y |\n`;
		const state = stateOf(long);
		const ranges = collectBlockRanges(state);
		const lastLine = state.doc.lines;
		expect(
			ranges.some((r) => state.doc.lineAt(r.from).number > lastLine - 5),
		).toBe(true);
	});

	it("takes a from/to window for the inline ranges only", () => {
		const state = stateOf(nested);
		const whole = collectInlineRanges(state, 0, state.doc.length);
		const head = collectInlineRanges(state, 0, 40);
		expect(head.length).toBeLessThan(whole.length);
	});
});

describe("mermaid block widget", () => {
	function mermaidDom() {
		const state = stateOf("```mermaid\ngraph TD;\n  A-->B;\n```\n");
		for (const range of collectBlockRanges(state)) {
			const widget = (range.value.spec as { widget?: { toDOM(): HTMLElement } })
				.widget;
			const dom = widget?.toDOM();
			if (dom?.classList.contains("cm-md-mermaid")) return dom;
		}
		return null;
	}

	it("marks the diagram as failed when rendering left an error", async () => {
		vi.mocked(renderMermaid).mockImplementation(async (stage) => {
			stage.classList.add("cm-md-mermaid-error");
		});
		const dom = mermaidDom();
		await vi.waitFor(() =>
			expect(dom?.classList.contains("cm-md-mermaid-failed")).toBe(true),
		);
	});

	it("leaves a successfully rendered diagram unmarked", async () => {
		vi.mocked(renderMermaid).mockResolvedValue(undefined);
		const dom = mermaidDom();
		await vi.waitFor(() =>
			expect(renderMermaid).toHaveBeenLastCalledWith(
				dom?.querySelector(".cm-md-mermaid-stage"),
				"graph TD;\n  A-->B;\n",
			),
		);
		await Promise.resolve();
		expect(dom?.classList.contains("cm-md-mermaid-failed")).toBe(false);
	});
});

describe("code fence widget", () => {
	function fenceWidget(doc: string) {
		const state = stateOf(doc);
		for (const range of collectBlockRanges(state)) {
			const widget = (range.value.spec as { widget?: { toDOM(): HTMLElement } })
				.widget;
			const dom = widget?.toDOM();
			if (dom?.classList.contains("cm-md-fence")) return dom;
		}
		return null;
	}

	it("offers a copy button carrying the body of the block, fences excluded", () => {
		const dom = fenceWidget("```ts\nconst a = 1;\nconst b = 2;\n```\n");
		const button = dom?.querySelector<HTMLElement>(".cm-md-fence-copy");
		expect(button).toBeTruthy();

		let copied: string | null = null;
		const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: {
				writeText: (v: string) => {
					copied = v;
					return Promise.resolve();
				},
			},
		});
		try {
			button?.click();
			expect(copied).toBe("const a = 1;\nconst b = 2;\n");
		} finally {
			if (original) Object.defineProperty(navigator, "clipboard", original);
			else Reflect.deleteProperty(navigator, "clipboard");
		}
	});

	it("still offers the button on a fence with no language", () => {
		const dom = fenceWidget("```\nplain\n```\n");
		expect(dom?.querySelector(".cm-md-fence-copy")).toBeTruthy();
		expect(dom?.querySelector(".cm-md-fence-lang")).toBeNull();
	});
});

describe("decodeHtmlEntities with a malformed numeric entity", () => {
	it("leaves a numeric entity that is not a number untouched", () => {
		expect(decodeHtmlEntities("a&#abc;b")).toBe("a&#abc;b");
	});

	it("leaves an entity beyond the last code point untouched instead of throwing", () => {
		expect(decodeHtmlEntities("a&#99999999;b")).toBe("a&#99999999;b");
		expect(decodeHtmlEntities("a&#x110000;b")).toBe("a&#x110000;b");
	});

	it("still decodes the last valid code point", () => {
		expect(decodeHtmlEntities("&#x10FFFF;")).toBe(
			String.fromCodePoint(0x10ffff),
		);
	});
});

describe("resolveImageSrc local files", () => {
	beforeEach(() => {
		vi.mocked(convertFileSrc).mockClear();
	});

	it("serves an absolute path through the asset protocol", () => {
		expect(resolveImageSrc("/img/a.png", "/repo/README.md")).toBe(
			"asset://localhost/img/a.png",
		);
		expect(convertFileSrc).toHaveBeenCalledWith("/img/a.png");
	});

	it("resolves a relative path against the directory of the document", () => {
		expect(resolveImageSrc("img/a.png", "/repo/docs/README.md")).toBe(
			"asset://localhost/repo/docs/img/a.png",
		);
		expect(convertFileSrc).toHaveBeenCalledWith("/repo/docs/img/a.png");
	});

	it("drops a relative path when the document has no path", () => {
		expect(resolveImageSrc("img/a.png", null)).toBe("");
		expect(convertFileSrc).not.toHaveBeenCalled();
	});

	it("drops the image when the asset protocol refuses the path", () => {
		vi.mocked(convertFileSrc).mockImplementationOnce(() => {
			throw new Error("no protocol");
		});
		expect(resolveImageSrc("/img/a.png", null)).toBe("");
	});
});

describe("resolveDocRelativePath without a leading slash", () => {
	it("keeps the result relative when the document path is relative", () => {
		expect(resolveDocRelativePath("docs/a.md", "./b.md")).toBe("docs/b.md");
		expect(resolveDocRelativePath("docs/a.md", "../c.md")).toBe("c.md");
	});
});

describe("findHeadingLine with an empty anchor", () => {
	it("returns null for a blank anchor or a lone hash", () => {
		expect(findHeadingLine("# Title", "  ")).toBeNull();
		expect(findHeadingLine("# Title", "#")).toBeNull();
	});
});

describe("parseMarkdownImage", () => {
	it("reads the alt text and the source", () => {
		expect(parseMarkdownImage("![the logo](img/logo.png)")).toEqual({
			src: "img/logo.png",
			alt: "the logo",
			width: null,
			height: null,
		});
	});

	it("ignores a quoted title", () => {
		expect(parseMarkdownImage('![a](b.png "A title")')).toEqual({
			src: "b.png",
			alt: "a",
			width: null,
			height: null,
		});
	});

	it("returns null for anything that is not a lone image", () => {
		expect(parseMarkdownImage("![a][ref]")).toBeNull();
		expect(parseMarkdownImage("text ![a](b.png)")).toBeNull();
		expect(parseMarkdownImage("![a](<my img.png>)")).toBeNull();
	});
});

describe("parseMarkdownTable without a delimiter row", () => {
	it("draws the block as a headerless table", () => {
		expect(parseMarkdownTable("a | b\nc | d")).toEqual({
			rows: [
				["a", "b"],
				["c", "d"],
			],
			align: [],
			hasHeader: false,
		});
	});
});

describe("collectInlineRanges decorations", () => {
	function describeRanges(doc: string, anchor?: number): string[] {
		const state = EditorState.create({
			doc,
			extensions: [markdown({ base: markdownLanguage })],
			selection: { anchor: anchor ?? doc.length },
		});
		return collectInlineRanges(state, 0, state.doc.length)
			.sort((a, b) => a.from - b.from || a.to - b.to)
			.map((r) => {
				const spec = r.value.spec as {
					widget?: { constructor: { name: string } };
					class?: string;
				};
				const what = spec.widget?.constructor.name ?? spec.class ?? "hidden";
				return `${r.from}-${r.to}:${what}`;
			});
	}

	it("replaces a markdown image away from the cursor", () => {
		expect(describeRanges("![alt](a.png)\n\n")).toEqual(["0-13:ImageWidget"]);
	});

	it("reveals the source of an image on the line of the cursor", () => {
		expect(describeRanges("![alt](a.png)")).toEqual([]);
	});

	it("leaves an image it cannot parse as it is", () => {
		expect(describeRanges("![alt](<my img.png>)\n\n")).toEqual([]);
	});

	it("replaces an html img tag away from the cursor", () => {
		expect(describeRanges('x <img src="a.png"> y\n\n')).toEqual([
			"2-19:ImageWidget",
		]);
	});

	it("reveals an html img tag on the line of the cursor", () => {
		expect(describeRanges('x <img src="a.png"> y')).toEqual([]);
	});

	it("draws a horizontal rule unless the cursor is on it", () => {
		expect(describeRanges("text\n\n---\n\n")).toEqual(["6-9:RuleWidget"]);
		expect(describeRanges("text\n\n---")).toEqual([]);
	});

	it("replaces an unchecked and a checked task marker", () => {
		expect(describeRanges("- [ ] todo\n- [x] done\n\n")).toEqual([
			"0-1:BulletWidget",
			"2-5:TaskWidget",
			"11-12:BulletWidget",
			"13-16:TaskWidget",
		]);
	});

	it("tells a checked marker from an unchecked one", () => {
		const state = stateOf("- [ ] a\n- [X] b\n\n");
		const checked = collectInlineRanges(state, 0, state.doc.length)
			.map((r) => (r.value.spec as { widget?: { checked?: boolean } }).widget)
			.filter((w) => w && "checked" in w)
			.map((w) => w?.checked);
		expect(checked).toEqual([false, true]);
	});

	it("reveals a task line under the cursor", () => {
		expect(describeRanges("- [x] done")).toEqual([]);
	});

	it("draws a bullet for the three bullet marks and none for a number", () => {
		expect(describeRanges("- a\n* b\n+ c\n\n")).toEqual([
			"0-1:BulletWidget",
			"4-5:BulletWidget",
			"8-9:BulletWidget",
		]);
		expect(describeRanges("1. a\n\n")).toEqual([]);
	});

	it("hides the backticks of inline code unless the cursor is on them", () => {
		expect(describeRanges("a `code` b\n\n")).toEqual([
			"2-3:hidden",
			"7-8:hidden",
		]);
		expect(describeRanges("a `code` b")).toEqual([]);
	});

	it("hides the heading mark unless the cursor is on the heading", () => {
		expect(describeRanges("# Title\n\n")).toEqual([
			"0-0:cm-md-heading cm-md-h1",
			"0-1:hidden",
		]);
		expect(describeRanges("# Title")).toEqual(["0-0:cm-md-heading cm-md-h1"]);
	});

	it("hides the url of a link unless the cursor is on it", () => {
		expect(describeRanges("[a](https://x.io)\n\n")).toEqual([
			"0-1:hidden",
			"0-17:cm-md-link",
			"2-3:hidden",
			"3-4:hidden",
			"4-16:hidden",
			"16-17:hidden",
		]);
		expect(describeRanges("[a](https://x.io)")).toEqual(["0-17:cm-md-link"]);
	});

	it("keeps the url of an autolink visible", () => {
		const ranges = describeRanges("<https://x.io>\n\n");
		expect(ranges).not.toContain("1-13:hidden");
	});
});

describe("collectBlockRanges with the cursor in a table", () => {
	it("reveals the source of the table", () => {
		const table = "| a | b |\n| - | - |\n| x | y |";
		expect(collectBlockRanges(stateOf(table))).toEqual([]);
		expect(collectBlockRanges(stateOf(`${table}\n\n`))).toHaveLength(1);
	});
});

describe("buildMarkdownWysiwyg", () => {
	let view: EditorView | null = null;
	let onOpenFile: Mock<(path: string, anchor: string | null) => void>;

	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
		onOpenFile = vi.fn<(path: string, anchor: string | null) => void>();
		vi.mocked(openUrl).mockClear();
	});

	afterEach(() => {
		view?.destroy();
		view = null;
		vi.useRealTimers();
	});

	function mount(doc: string, docPath: string | null = null) {
		view = new EditorView({
			state: EditorState.create({
				doc,
				extensions: [
					markdown({ base: markdownLanguage }),
					buildMarkdownWysiwyg({ onOpenFile }),
				],
				selection: { anchor: doc.length },
			}),
			parent: document.body,
		});
		if (docPath) view.dispatch({ effects: setMarkdownDocPath.of(docPath) });
		return view;
	}

	function press(target: Element | null | undefined, shiftKey: boolean) {
		if (!target) throw new Error("nothing to press");
		const event = new MouseEvent("mousedown", {
			bubbles: true,
			cancelable: true,
			shiftKey,
		});
		target.dispatchEvent(event);
		return event;
	}

	function clickLink(shiftKey: boolean) {
		return press(view?.dom.querySelector(".cm-md-link"), shiftKey);
	}

	it("decorates a link with its destination", () => {
		mount("[a](https://x.io)\n\n");
		const link = view?.dom.querySelector(".cm-md-link");
		expect(link?.getAttribute("data-cm-md-href")).toBe("https://x.io");
		expect(link?.getAttribute("title")).toBe("https://x.io");
	});

	it("hands an external link to the opener on shift-click", async () => {
		mount("[a](https://x.io)\n\n");
		clickLink(true);
		await vi.waitFor(() =>
			expect(openUrl).toHaveBeenCalledWith("https://x.io"),
		);
	});

	it("leaves a plain click alone", () => {
		mount("[a](./b.md)\n\n", "/repo/a.md");
		clickLink(false);
		expect(onOpenFile).not.toHaveBeenCalled();
	});

	it("ignores a link with an unsupported scheme", async () => {
		mount("[a](ftp://x.io)\n\n");
		clickLink(true);
		await vi.dynamicImportSettled();
		expect(openUrl).not.toHaveBeenCalled();
		expect(onOpenFile).not.toHaveBeenCalled();
	});

	it("ignores a shift-click that does not land on a link", async () => {
		mount("[a](https://x.io)\n\nplain text");
		press(view?.contentDOM, true);
		await vi.dynamicImportSettled();
		expect(openUrl).not.toHaveBeenCalled();
		expect(onOpenFile).not.toHaveBeenCalled();
	});

	it("keeps the cursor when the anchor names no heading", () => {
		mount("# Top\n\n[go](#missing)\n\n");
		const before = view?.state.selection.main.head;
		clickLink(true);
		expect(view?.state.selection.main.head).toBe(before);
	});

	it("opens a relative file link resolved against the document", () => {
		mount("[a](../b.md#intro)\n\n", "/repo/docs/a.md");
		clickLink(true);
		expect(onOpenFile).toHaveBeenCalledWith("/repo/b.md", "intro");
	});

	it("does not open a relative file link without a document path", () => {
		mount("[a](./b.md)\n\n");
		clickLink(true);
		expect(onOpenFile).not.toHaveBeenCalled();
	});

	it("moves the cursor to the heading an anchor names", () => {
		mount("# Top\n\ntext\n\n## Code style\n\n[go](#code-style)\n\n");
		clickLink(true);
		expect(view?.state.selection.main.head).toBe(view?.state.doc.line(5).from);
	});

	it("arms the links while shift is held", () => {
		mount("text");
		window.dispatchEvent(new KeyboardEvent("keydown", { shiftKey: true }));
		expect(view?.dom.classList.contains("cm-md-link-armed")).toBe(true);
		window.dispatchEvent(new KeyboardEvent("keyup"));
		expect(view?.dom.classList.contains("cm-md-link-armed")).toBe(false);
	});
});

describe("decodeHtmlEntities with an uppercase hexadecimal marker", () => {
	it("decodes &#X41; like &#x41;", () => {
		expect(decodeHtmlEntities("&#X41;&#x42;")).toBe("AB");
	});
});

describe("resolveDocRelativePath with empty segments", () => {
	it("ignores doubled slashes in the target", () => {
		expect(resolveDocRelativePath("/repo/a.md", "x//b.md")).toBe(
			"/repo/x/b.md",
		);
	});
});

describe("findHeadingLine edge cases", () => {
	it("finds a heading on the very first line", () => {
		expect(findHeadingLine("# Title\ntext", "title")).toBe(1);
	});

	it("does not match a heading whose slug is empty against a blank anchor", () => {
		expect(findHeadingLine("# !!!", "")).toBeNull();
		expect(findHeadingLine("# !!!", "#")).toBeNull();
	});
});

describe("parseMarkdownTable edge shapes", () => {
	it("keeps a one-character row", () => {
		expect(parseMarkdownTable("a")?.rows).toEqual([["a"]]);
	});

	it("reads a one-column table with its delimiter row", () => {
		expect(parseMarkdownTable("| a |\n| - |\n| x |")).toEqual({
			rows: [["a"], ["x"]],
			align: [null],
			hasHeader: true,
		});
	});

	it("drops a delimiter row that comes first and draws no header", () => {
		expect(parseMarkdownTable("| --- |\n| a |")).toEqual({
			rows: [["a"]],
			align: [null],
			hasHeader: false,
		});
	});

	it("lets a leading backslash escape the pipe that follows it", () => {
		expect(parseMarkdownTable("\\|x | y")?.rows).toEqual([["|x", "y"]]);
	});
});

describe("fillTableCell node layout", () => {
	function cellFor(text: string): HTMLElement {
		const cell = document.createElement("td");
		fillTableCell(cell, text);
		return cell;
	}

	it("keeps the text that precedes a link that is not at the start", () => {
		expect(cellFor("x[a](https://e.com)").textContent).toBe("xa");
	});

	it("adds no empty text node around a link that fills the cell", () => {
		const cell = cellFor("[a](https://e.com)");
		expect(cell.childNodes).toHaveLength(1);
		expect(cell.firstElementChild?.className).toBe("cm-md-link");
	});

	it("adds no empty text node between two adjacent links", () => {
		expect(
			cellFor("[a](https://e.com)[b](https://f.com)").childNodes,
		).toHaveLength(2);
	});

	it("adds the trailing text only when some follows the last link", () => {
		expect(cellFor("see [a](https://e.com)").childNodes).toHaveLength(2);
		expect(cellFor("see [a](https://e.com) now").childNodes).toHaveLength(3);
	});
});

describe("MermaidWidget structure", () => {
	function buildDom() {
		vi.mocked(renderMermaid).mockResolvedValue(undefined);
		return new MermaidWidget("graph TD;").toDOM(
			new EditorView({ state: stateOf("x") }),
		);
	}

	it("wraps the stage in a surface and offers a reset button", () => {
		const dom = buildDom();
		const surface = dom.querySelector(".cm-md-mermaid-surface");
		expect(surface?.parentElement).toBe(dom);
		expect(surface?.querySelector(".cm-md-mermaid-stage")).toBeTruthy();

		const reset = dom.querySelector<HTMLButtonElement>(".cm-md-mermaid-reset");
		expect(reset?.parentElement?.className).toBe("cm-md-mermaid-actions");
		expect(reset?.parentElement?.parentElement).toBe(dom);
		expect(reset?.type).toBe("button");
		expect(reset?.title).toBe("Reset zoom");
		expect(reset?.getAttribute("aria-label")).toBe("Reset zoom");
		expect(reset?.querySelector("svg")).toBeTruthy();
	});

	it("resets the zoom when the button is pressed once the diagram is drawn", async () => {
		const reset = vi.fn();
		vi.mocked(attachMermaidZoom).mockReturnValueOnce({
			reset,
			destroy: vi.fn(),
		} as unknown as ReturnType<typeof attachMermaidZoom>);
		const dom = buildDom();
		await vi.waitFor(() => expect(attachMermaidZoom).toHaveBeenCalled());
		dom.querySelector<HTMLButtonElement>(".cm-md-mermaid-reset")?.click();
		expect(reset).toHaveBeenCalledTimes(1);
	});

	it("announces the diagram's source to the editor host from the expand button", () => {
		const dom = buildDom();
		const received: string[] = [];
		document.body.appendChild(dom);
		document.body.addEventListener(MERMAID_OPEN_EVENT, (event) =>
			received.push((event as CustomEvent<{ source: string }>).detail.source),
		);
		dom
			.querySelector<HTMLButtonElement>(
				'[aria-label="Open the diagram full screen"]',
			)
			?.click();
		dom.remove();
		expect(received).toEqual(["graph TD;"]);
	});

	it("keeps a press on the action buttons away from the editor", () => {
		const dom = buildDom();
		const reachedEditor = vi.fn();
		const host = document.createElement("div");
		host.addEventListener("mousedown", reachedEditor);
		host.appendChild(dom);
		const press = new MouseEvent("mousedown", {
			bubbles: true,
			cancelable: true,
		});
		dom.querySelector(".cm-md-mermaid-action")?.dispatchEvent(press);
		expect(reachedEditor).not.toHaveBeenCalled();
		expect(press.defaultPrevented).toBe(true);
	});

	it("is equal to another widget of the same source only", () => {
		const widget = new MermaidWidget("a");
		expect(widget.eq(new MermaidWidget("a"))).toBe(true);
		expect(widget.eq(new MermaidWidget("b"))).toBe(false);
	});
});

describe("code fence widget details", () => {
	function fenceDom(doc: string): HTMLElement {
		const state = stateOf(doc);
		for (const range of collectBlockRanges(state)) {
			const widget = (range.value.spec as { widget?: { toDOM(): HTMLElement } })
				.widget;
			const dom = widget?.toDOM();
			if (dom?.classList.contains("cm-md-fence")) return dom;
		}
		throw new Error("no fence widget");
	}

	beforeEach(() => {
		vi.useFakeTimers();
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText: () => Promise.resolve() },
		});
	});

	afterEach(() => {
		vi.useRealTimers();
		Reflect.deleteProperty(navigator, "clipboard");
	});

	function pressCopy(button: HTMLElement) {
		const event = new MouseEvent("click", { bubbles: true, cancelable: true });
		button.dispatchEvent(event);
		return event;
	}

	it("shows the language as a badge before the copy button", () => {
		const dom = fenceDom("```ts\nconst a = 1;\n```\n");
		const badge = dom.querySelector(".cm-md-fence-lang");
		expect(badge?.textContent).toBe("ts");
		expect(dom.firstElementChild).toBe(badge);
	});

	it("labels the copy button and keeps it from submitting", () => {
		const dom = fenceDom("```ts\nconst a = 1;\n```\n");
		const button = dom.querySelector<HTMLButtonElement>(".cm-md-fence-copy");
		expect(button?.type).toBe("button");
		expect(button?.getAttribute("aria-label")).toBe(t("common.copy"));
		expect(button?.title).toBe(t("common.copy"));
	});

	it("swallows the click and shows the copied state, then restores it", async () => {
		const dom = fenceDom("```ts\nconst a = 1;\n```\n");
		const outer = vi.fn();
		const holder = document.createElement("div");
		holder.addEventListener("click", outer);
		holder.appendChild(dom);
		const button = dom.querySelector<HTMLElement>(".cm-md-fence-copy");
		if (!button) throw new Error("no copy button");

		const event = pressCopy(button);
		expect(event.defaultPrevented).toBe(true);
		expect(outer).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(0);
		expect(button.classList.contains("copied")).toBe(true);
		expect(button.title).toBe(t("common.copied"));

		await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_DELAY);
		expect(button.classList.contains("copied")).toBe(false);
		expect(button.title).toBe(t("common.copy"));
	});

	it("restarts the restore delay when copied again", async () => {
		const dom = fenceDom("```ts\nconst a = 1;\n```\n");
		const button = dom.querySelector<HTMLElement>(".cm-md-fence-copy");
		if (!button) throw new Error("no copy button");

		pressCopy(button);
		await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_DELAY - 100);
		pressCopy(button);
		await vi.advanceTimersByTimeAsync(200);
		expect(button.classList.contains("copied")).toBe(true);

		await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_DELAY);
		expect(button.classList.contains("copied")).toBe(false);
	});

	it("is equal to another fence of the same language and body only", () => {
		const state = stateOf("```ts\na\n```\n");
		const widgets = collectBlockRanges(state).map(
			(r) => (r.value.spec as { widget?: { eq(o: unknown): boolean } }).widget,
		);
		const fence = widgets.find(Boolean);
		expect(fence?.eq(fence)).toBe(true);
		expect(fence?.eq({ language: "ts", body: "b" })).toBe(false);
	});
});

describe("inline decorations of blocks and marks", () => {
	function describeRanges(doc: string, anchor?: number): string[] {
		const state = EditorState.create({
			doc,
			extensions: [markdown({ base: markdownLanguage })],
			selection: { anchor: anchor ?? doc.length },
		});
		return collectInlineRanges(state, 0, state.doc.length)
			.sort((a, b) => a.from - b.from || a.to - b.to)
			.map((r) => {
				const spec = r.value.spec as {
					widget?: { constructor: { name: string } };
					class?: string;
				};
				const what = spec.widget?.constructor.name ?? spec.class ?? "hidden";
				return `${r.from}-${r.to}:${what}`;
			});
	}

	const fence = "```bash\nline one\nline two\n```\n";

	it("tints every line of a blockquote and hides its marks", () => {
		expect(describeRanges("> a\n> b\n\n")).toEqual([
			"0-0:cm-md-quote",
			"0-1:hidden",
			"4-4:cm-md-quote",
			"4-5:hidden",
		]);
	});

	it("tints the body of a fence but not its fence lines", () => {
		expect(describeRanges(fence)).toEqual([
			"8-8:cm-md-code-block",
			"17-17:cm-md-code-block",
		]);
	});

	it("tints the fence lines too while the cursor is on the opening fence", () => {
		expect(describeRanges(fence, 3)).toEqual([
			"0-0:cm-md-code-block",
			"8-8:cm-md-code-block",
			"17-17:cm-md-code-block",
			"26-26:cm-md-code-block",
		]);
	});

	it("tints the fence lines too while the cursor is on the closing fence", () => {
		expect(describeRanges(fence, 28)).toEqual([
			"0-0:cm-md-code-block",
			"8-8:cm-md-code-block",
			"17-17:cm-md-code-block",
			"26-26:cm-md-code-block",
		]);
	});

	it("hides emphasis and strikethrough marks away from the cursor", () => {
		expect(describeRanges("**b** ~~s~~\n\n")).toEqual([
			"0-2:hidden",
			"3-5:hidden",
			"6-8:hidden",
			"9-11:hidden",
		]);
	});

	it("decorates a level six heading", () => {
		expect(describeRanges("###### Deep\n\n")).toEqual([
			"0-0:cm-md-heading cm-md-h6",
			"0-6:hidden",
		]);
	});

	it("does not decorate inside a table", () => {
		const table = "| a | [y](https://x.io) |\n| - | - |\n| x | y |\n\ntail";
		expect(describeRanges(table)).toEqual([]);
	});

	it("does not mark a link that has no destination", () => {
		const ranges = describeRanges("[a][ref]\n\n[ref]: https://x.io\n\ntail");
		expect(ranges).not.toContain(expect.stringContaining("cm-md-link"));
	});
});

describe("collectBlockRanges structure", () => {
	it("does not hide a closing fence when the block is a single line", () => {
		const state = EditorState.create({
			doc: "x\n\n```",
			extensions: [markdown({ base: markdownLanguage })],
			selection: { anchor: 0 },
		});
		expect(collectBlockRanges(state)).toHaveLength(1);
	});

	it("leaves a fenced block inside a blockquote as raw source", () => {
		expect(collectBlockRanges(stateOf("> ```\n> code\n> ```\n\n"))).toEqual([]);
	});
});

describe("the wysiwyg extension in a mounted view", () => {
	let view: EditorView | null = null;

	afterEach(() => {
		view?.destroy();
		view = null;
	});

	function mount(doc: string, anchor: number = doc.length) {
		view = new EditorView({
			state: EditorState.create({
				doc,
				extensions: [
					markdown({ base: markdownLanguage }),
					buildMarkdownWysiwyg({ onOpenFile: vi.fn() }),
				],
				selection: { anchor },
			}),
			parent: document.body,
		});
		return view;
	}

	function press(shiftKey: boolean, target?: Element | null) {
		const event = new MouseEvent("mousedown", {
			bubbles: true,
			cancelable: true,
			shiftKey,
		});
		(target ?? view?.dom.querySelector(".cm-md-link"))?.dispatchEvent(event);
		return event;
	}

	it("reveals a table when the cursor enters it and draws it again after", () => {
		const table = "| a | b |\n| - | - |\n| x | y |\n\ntail";
		mount(table);
		expect(view?.dom.querySelector(".cm-md-table")).toBeTruthy();

		view?.dispatch({ selection: { anchor: 3 } });
		expect(view?.dom.querySelector(".cm-md-table")).toBeNull();

		view?.dispatch({ selection: { anchor: table.length } });
		expect(view?.dom.querySelector(".cm-md-table")).toBeTruthy();
	});

	it("decorates a table beyond the first parsed region once the parser reaches it", () => {
		const filler = "paragraph of filler text\n\n".repeat(20000);
		mount(`${filler}| a | b |\n| - | - |\n| x | y |\n\ntail`, 0);
		const countTables = () => {
			let count = 0;
			for (const source of view?.state.facet(EditorView.decorations) ?? []) {
				if (typeof source === "function") continue;
				const cursor = source.iter();
				for (; cursor.value; cursor.next()) {
					if (cursor.value.spec.block) count++;
				}
			}
			return count;
		};
		expect(countTables()).toBe(0);
		forceParsing(view as EditorView, view?.state.doc.length, 5000);
		expect(countTables()).toBe(1);
	});

	it("draws a table once an edit completes it", () => {
		mount("| a | b |\n| x | y |\n\ntail");
		expect(view?.dom.querySelector(".cm-md-table")).toBeNull();
		view?.dispatch({ changes: { from: 10, insert: "| - | - |\n" } });
		expect(view?.dom.querySelector(".cm-md-table")).toBeTruthy();
	});

	it("registers a remeasure that rebuilds the inline decorations", () => {
		const spy = vi.spyOn(EditorView.prototype, "requestMeasure");
		try {
			mount("# Title\n\nbody");
			const own = spy.mock.calls.filter(
				([measure]) =>
					typeof measure === "object" &&
					(measure as unknown as { read: () => unknown }).read() === null,
			);
			expect(own).toHaveLength(1);
			expect(() =>
				(own[0][0] as unknown as { write: () => void }).write(),
			).not.toThrow();
		} finally {
			spy.mockRestore();
		}
	});

	it("shows the heading mark again once the cursor moves onto the heading", () => {
		mount("# Title\n\nbody");
		const firstLine = () => view?.dom.querySelector(".cm-line")?.textContent;
		expect(firstLine()).toBe(" Title");

		view?.dispatch({ selection: { anchor: 0 } });
		expect(firstLine()).toBe("# Title");
	});

	it("decorates a heading created by an edit", () => {
		mount("plain\n\nbody");
		expect(view?.dom.querySelector(".cm-md-h1")).toBeNull();
		view?.dispatch({ changes: { from: 0, insert: "# " } });
		expect(view?.dom.querySelector(".cm-md-h1")).toBeTruthy();
	});

	it("keeps the document path across transactions that do not set it", () => {
		const onOpenFile = vi.fn();
		view = new EditorView({
			state: EditorState.create({
				doc: "[a](./b.md)\n\n",
				extensions: [
					markdown({ base: markdownLanguage }),
					buildMarkdownWysiwyg({ onOpenFile }),
				],
				selection: { anchor: 13 },
			}),
			parent: document.body,
		});
		view.dispatch({ effects: setMarkdownDocPath.of("/repo/a.md") });
		view.dispatch({
			effects: EditorView.scrollIntoView(0),
			selection: { anchor: 12 },
		});
		view.dispatch({ selection: { anchor: 13 } });

		press(true);
		expect(onOpenFile).toHaveBeenCalledWith("/repo/b.md", null);
	});

	it("reports no error when a link has an unsupported scheme", () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		try {
			mount("[a](ftp://x.io)\n\n");
			press(true);
			expect(consoleError).not.toHaveBeenCalled();
		} finally {
			consoleError.mockRestore();
		}
	});

	it("reports no error when an anchor names no heading", () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		try {
			mount("# Top\n\n[go](#missing)\n\n");
			press(true);
			expect(consoleError).not.toHaveBeenCalled();
		} finally {
			consoleError.mockRestore();
		}
	});

	it("stops arming the links and clears the arming once destroyed", () => {
		mount("text");
		const dom = (view as EditorView).dom;
		window.dispatchEvent(new KeyboardEvent("keydown", { shiftKey: true }));
		expect(dom.classList.contains("cm-md-link-armed")).toBe(true);

		view?.destroy();
		view = null;
		expect(dom.classList.contains("cm-md-link-armed")).toBe(false);

		window.dispatchEvent(new KeyboardEvent("keydown", { shiftKey: true }));
		expect(dom.classList.contains("cm-md-link-armed")).toBe(false);
		window.dispatchEvent(new KeyboardEvent("keyup"));
	});
});

describe("minimap opaque ranges", () => {
	function opaqueRangesOf(doc: string): Array<[number, number]> {
		const state = EditorState.create({
			doc,
			extensions: [
				markdown({ base: markdownLanguage }),
				buildMarkdownWysiwyg(),
			],
			selection: { anchor: doc.length },
		});
		forceParsing(new EditorView({ state }), state.doc.length, 1000);
		const found: Array<[number, number]> = [];
		for (const set of state.facet(minimapOpaqueRanges)) {
			set.between(0, state.doc.length, (from, to) => {
				found.push([from, to]);
			});
		}
		return found;
	}

	it("reports a rendered mermaid block as one range", () => {
		const doc = "```mermaid\ngraph TD;\n A-->B\n```\n\ntext after";
		expect(opaqueRangesOf(doc)).toEqual([[0, doc.indexOf("\n\ntext")]]);
	});

	it("leaves other code blocks to the minimap's own text", () => {
		expect(opaqueRangesOf("```ts\nconst a = 1;\n```\n\ntext after")).toEqual(
			[],
		);
	});
});

describe("mermaid source toggle", () => {
	const doc = "```mermaid\ngraph TD;\n A-->B\n```\n\ntext after";

	function mount() {
		const parent = document.createElement("div");
		document.body.appendChild(parent);
		const view = new EditorView({
			state: EditorState.create({
				doc,
				extensions: [
					markdown({ base: markdownLanguage }),
					buildMarkdownWysiwyg(),
				],
			}),
			parent,
		});
		forceParsing(view, view.state.doc.length, 1000);
		view.dispatch({});
		return view;
	}

	function press(view: EditorView, label: string) {
		view.dom
			.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)
			?.click();
	}

	it("swaps the rendering for the source and back from the buttons", () => {
		const view = mount();
		expect(view.dom.querySelector(".cm-md-mermaid")).toBeTruthy();

		press(view, "Show the source");
		expect(view.dom.querySelector(".cm-md-mermaid")).toBeNull();
		expect(view.dom.querySelector(".cm-md-mermaid-sourcebar")).toBeTruthy();

		press(view, "Show the diagram");
		expect(view.dom.querySelector(".cm-md-mermaid")).toBeTruthy();
		expect(view.dom.querySelector(".cm-md-mermaid-sourcebar")).toBeNull();
		view.destroy();
	});

	it("keeps the diagram rendered while the caret sits inside it", () => {
		const view = mount();
		view.dispatch({ selection: { anchor: 14 } });
		expect(view.dom.querySelector(".cm-md-mermaid")).toBeTruthy();
		view.destroy();
	});
});
