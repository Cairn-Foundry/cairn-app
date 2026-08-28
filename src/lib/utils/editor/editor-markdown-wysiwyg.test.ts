import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState, RangeSetBuilder } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import {
	collectBlockRanges,
	collectInlineRanges,
	decodeHtmlEntities,
	fillTableCell,
	findHeadingLine,
	isOpenableLink,
	linkHref,
	parseHtmlImage,
	parseLinkTarget,
	parseMarkdownTable,
	resolveDocRelativePath,
	resolveImageSrc,
	slugifyHeading,
} from "./editor-markdown-wysiwyg";

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
