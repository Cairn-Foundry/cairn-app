import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
	collectBlockRanges,
	collectInlineRanges,
	decodeHtmlEntities,
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
