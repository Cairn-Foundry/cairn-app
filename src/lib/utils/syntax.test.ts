import { describe, expect, it } from "vitest";
import { tok } from "./syntax";

describe("tok", () => {
	it("escapes HTML entities before highlighting", () => {
		expect(tok("<div>")).toContain("&lt;div&gt;");
	});

	it("wraps keywords in tok-k span", () => {
		expect(tok("const x = 1")).toContain('<span class="tok-k">const</span>');
	});

	it("wraps string literals in a tok-s span", () => {
		const result = tok('x = "hello"');
		expect(result).toContain("tok-s");
		expect(result).toContain('"hello"');
	});

	it("wraps single-quoted strings in a tok-s span", () => {
		const result = tok("x = 'world'");
		expect(result).toContain("tok-s");
		expect(result).toContain("'world'");
	});

	it("wraps numbers in tok-n span", () => {
		expect(tok("return 42")).toContain('<span class="tok-n">42</span>');
	});

	it("wraps known types in tok-t span", () => {
		expect(tok("string")).toContain('<span class="tok-t">string</span>');
	});

	it("wraps line comments in a tok-c span", () => {
		const result = tok("// a comment");
		expect(result).toContain("tok-c");
		expect(result).toContain("// a comment");
	});

	it("handles multiple tokens in one string", () => {
		const result = tok("const x: number = 42");
		expect(result).toContain("tok-k");
		expect(result).toContain("tok-t");
		expect(result).toContain("tok-n");
	});

	it("returns plain text unchanged when no tokens match", () => {
		expect(tok("hello")).toBe("hello");
	});
});
