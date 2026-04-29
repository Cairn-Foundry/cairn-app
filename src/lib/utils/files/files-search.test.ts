import { describe, expect, it } from "vitest";
import type { FileNode } from "../../../lib/services/file-service";
import {
	flattenTreeFilePaths,
	highlightPathMatch,
	htmlEscape,
	matchesSearch,
	scorePathMatch,
} from "./files-search";

const file = (path: string): FileNode => ({
	name: path.split("/").at(-1) ?? "",
	path,
	isDir: false,
});
const dir = (path: string, children: FileNode[]): FileNode => ({
	name: path.split("/").at(-1) ?? "",
	path,
	isDir: true,
	children,
});

describe("flattenTreeFilePaths", () => {
	it("returns paths of flat file list", () => {
		expect(flattenTreeFilePaths([file("a.ts"), file("b.ts")])).toEqual([
			"a.ts",
			"b.ts",
		]);
	});

	it("recurses into directories", () => {
		expect(
			flattenTreeFilePaths([dir("src", [file("src/a.ts"), file("src/b.ts")])]),
		).toEqual(["src/a.ts", "src/b.ts"]);
	});

	it("skips directories themselves", () => {
		const paths = flattenTreeFilePaths([dir("src", [file("src/a.ts")])]);
		expect(paths).not.toContain("src");
	});

	it("handles empty tree", () => {
		expect(flattenTreeFilePaths([])).toEqual([]);
	});

	it("handles directory with no children", () => {
		expect(flattenTreeFilePaths([dir("empty", [])])).toEqual([]);
	});
});

describe("scorePathMatch", () => {
	it("returns 1 for empty query", () => {
		expect(scorePathMatch("src/foo.ts", "")).toBe(1);
	});

	it("scores 100 for filename prefix match", () => {
		expect(scorePathMatch("src/foo.ts", "foo")).toBe(100);
	});

	it("scores 80 for filename contains match", () => {
		expect(scorePathMatch("src/my-foo-bar.ts", "foo")).toBe(80);
	});

	it("scores 60 for path contains match", () => {
		expect(scorePathMatch("src/components/Button.ts", "comp")).toBe(60);
	});

	it("scores 30 for fuzzy match", () => {
		expect(scorePathMatch("src/foo.ts", "sft")).toBe(30);
	});

	it("returns -1 for no match", () => {
		expect(scorePathMatch("src/foo.ts", "zzz")).toBe(-1);
	});

	it("is case-insensitive", () => {
		expect(scorePathMatch("src/Foo.ts", "FOO")).toBe(100);
	});
});

describe("htmlEscape", () => {
	it("escapes &", () => {
		expect(htmlEscape("a & b")).toBe("a &amp; b");
	});

	it("escapes <", () => {
		expect(htmlEscape("<tag>")).toBe("&lt;tag&gt;");
	});

	it("escapes >", () => {
		expect(htmlEscape("a > b")).toBe("a &gt; b");
	});

	it("escapes all together", () => {
		expect(htmlEscape("<a & b>")).toBe("&lt;a &amp; b&gt;");
	});

	it("leaves plain text untouched", () => {
		expect(htmlEscape("hello")).toBe("hello");
	});
});

describe("highlightPathMatch", () => {
	it("returns escaped path when no query", () => {
		expect(highlightPathMatch("src/a.ts", "")).toBe("src/a.ts");
	});

	it("wraps substring match in <mark>", () => {
		expect(highlightPathMatch("src/foo.ts", "foo")).toBe(
			"src/<mark>foo</mark>.ts",
		);
	});

	it("uses fuzzy highlight when no substring match", () => {
		const result = highlightPathMatch("src/foo.ts", "sf");
		expect(result).toContain("<mark>s</mark>");
		expect(result).toContain("<mark>f</mark>");
	});

	it("escapes HTML in path", () => {
		expect(highlightPathMatch("a<b>.ts", "")).toBe("a&lt;b&gt;.ts");
	});
});

describe("matchesSearch", () => {
	it("returns true for empty query", () => {
		expect(matchesSearch("anything", "")).toBe(true);
	});

	it("returns true for matching substring", () => {
		expect(matchesSearch("hello world", "world")).toBe(true);
	});

	it("returns false for non-matching query", () => {
		expect(matchesSearch("hello", "xyz")).toBe(false);
	});

	it("is case-insensitive", () => {
		expect(matchesSearch("Hello World", "HELLO")).toBe(true);
	});

	it("returns true for whitespace-only query", () => {
		expect(matchesSearch("anything", "   ")).toBe(true);
	});
});
