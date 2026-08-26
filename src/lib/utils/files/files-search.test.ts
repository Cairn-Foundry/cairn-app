import { describe, expect, it } from "vitest";
import type { FileNode } from "../../../lib/services/file-service";
import {
	flattenTreeEntries,
	highlightPathMatch,
	htmlEscape,
	matchesSearch,
	scorePathMatch,
	splitSearchTerms,
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

describe("flattenTreeEntries", () => {
	it("keeps directories alongside their files", () => {
		expect(flattenTreeEntries([dir("src", [file("src/a.ts")])])).toEqual([
			{ path: "src", isDir: true },
			{ path: "src/a.ts", isDir: false },
		]);
	});

	it("keeps an empty directory", () => {
		expect(flattenTreeEntries([dir("empty", [])])).toEqual([
			{ path: "empty", isDir: true },
		]);
	});
});

describe("splitSearchTerms", () => {
	it("splits on whitespace and path separators", () => {
		expect(splitSearchTerms("utils/files bar")).toEqual([
			"utils",
			"files",
			"bar",
		]);
	});

	it("drops empty terms", () => {
		expect(splitSearchTerms("  //a// ")).toEqual(["a"]);
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

	it("matches every term of a multi-term query, wherever it sits", () => {
		// "utils" only hits the path (60), "search" hits the filename (80)
		expect(
			scorePathMatch("src/utils/files/files-search.ts", "utils search"),
		).toBe(70);
	});

	it("treats a slash as a term separator", () => {
		expect(scorePathMatch("src/utils/files/deep/a.ts", "utils/a")).toBe(80);
	});

	it("rejects when one term is missing", () => {
		expect(scorePathMatch("src/utils/a.ts", "utils zzz")).toBe(-1);
	});

	it("returns 1 for a separator-only query", () => {
		expect(scorePathMatch("src/foo.ts", " / ")).toBe(1);
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

	it("escapes the double quote that would break out of an attribute", () => {
		expect(htmlEscape('say "hi"')).toBe("say &quot;hi&quot;");
	});

	it("escapes the single quote that would break out of an attribute", () => {
		expect(htmlEscape("it's")).toBe("it&#39;s");
	});

	it("escapes all together", () => {
		expect(htmlEscape("<a & b>")).toBe("&lt;a &amp; b&gt;");
	});

	it("neutralises an injected tag with its attributes", () => {
		expect(htmlEscape("<img src=\"x\" onerror='alert(1)'>")).toBe(
			"&lt;img src=&quot;x&quot; onerror=&#39;alert(1)&#39;&gt;",
		);
	});

	it("escapes the ampersand once, not twice", () => {
		expect(htmlEscape("&amp;")).toBe("&amp;amp;");
		expect(htmlEscape("&lt;")).toBe("&amp;lt;");
	});

	it("leaves plain text untouched", () => {
		expect(htmlEscape("hello")).toBe("hello");
		expect(htmlEscape("")).toBe("");
	});

	it("leaves accents and emoji intact", () => {
		expect(htmlEscape("café")).toBe("café");
		expect(htmlEscape("dossier/été")).toBe("dossier/été");
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

	it("requires every term but not their order", () => {
		expect(matchesSearch("Toggle split editor", "editor toggle")).toBe(true);
		expect(matchesSearch("Toggle split editor", "editor zzz")).toBe(false);
	});
});
