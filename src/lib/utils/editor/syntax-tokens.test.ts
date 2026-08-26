import { describe, expect, it } from "vitest";
import {
	defaultSyntaxTokens,
	isSyntaxTheme,
	normalizeSyntaxTokens,
	SYNTAX_TOKEN_KEYS,
	type SyntaxTokens,
} from "./syntax-tokens";

describe("defaultSyntaxTokens", () => {
	it("fills every key of the palette", () => {
		const tokens = defaultSyntaxTokens("dark");
		expect(Object.keys(tokens).sort()).toEqual([...SYNTAX_TOKEN_KEYS].sort());
	});

	it("gives every token a colour", () => {
		for (const theme of ["dark", "light"]) {
			for (const key of SYNTAX_TOKEN_KEYS) {
				const color = defaultSyntaxTokens(theme)[key].color;
				expect(color, `${theme}/${key}`).toMatch(
					/^(#[0-9a-fA-F]{3,8}|oklch\()/,
				);
			}
		}
	});

	it("serves a different palette to a light theme than to a dark one", () => {
		expect(defaultSyntaxTokens("light")).not.toEqual(
			defaultSyntaxTokens("dark"),
		);
	});

	it("falls back to the dark palette for an unknown theme", () => {
		expect(defaultSyntaxTokens("no-such-theme")).toEqual(
			defaultSyntaxTokens("dark"),
		);
		expect(defaultSyntaxTokens("")).toEqual(defaultSyntaxTokens("dark"));
	});

	it("hands back a fresh object each time, so editing one palette cannot leak", () => {
		const first = defaultSyntaxTokens("dark");
		first.kw.color = "#000000";
		expect(defaultSyntaxTokens("dark").kw.color).not.toBe("#000000");
	});
});

describe("normalizeSyntaxTokens", () => {
	it("returns the defaults when nothing is stored", () => {
		expect(normalizeSyntaxTokens(undefined, "dark")).toEqual(
			defaultSyntaxTokens("dark"),
		);
	});

	it("fills in the keys a partial theme is missing", () => {
		const result = normalizeSyntaxTokens({ kw: { color: "#ff0000" } }, "dark");
		expect(result.kw.color).toBe("#ff0000");
		expect(Object.keys(result).sort()).toEqual([...SYNTAX_TOKEN_KEYS].sort());
		for (const key of SYNTAX_TOKEN_KEYS) {
			expect(result[key].color, key).toBeTruthy();
		}
	});

	it("keeps the italic and bold flags a stored token carries", () => {
		const result = normalizeSyntaxTokens(
			{ cmt: { color: "#123456", italic: true, bold: true } },
			"dark",
		);
		expect(result.cmt).toEqual({
			color: "#123456",
			italic: true,
			bold: true,
		});
	});

	it("ignores a token that carries no colour", () => {
		const base = defaultSyntaxTokens("dark");
		const result = normalizeSyntaxTokens(
			{ kw: { color: "" }, str: undefined },
			"dark",
		);
		expect(result.kw).toEqual(base.kw);
		expect(result.str).toEqual(base.str);
	});

	it("normalizes against the theme it is given, not the stored one", () => {
		const result = normalizeSyntaxTokens({ kw: { color: "#ff0000" } }, "light");
		const light = defaultSyntaxTokens("light");
		expect(result.str).toEqual(light.str);
	});

	it("drops a key the palette does not define", () => {
		const result = normalizeSyntaxTokens(
			{ notAToken: { color: "#fff" } } as unknown as Partial<SyntaxTokens>,
			"dark",
		);
		expect(result).not.toHaveProperty("notAToken");
	});

	it("accepts an empty object as no override at all", () => {
		expect(normalizeSyntaxTokens({}, "dark")).toEqual(
			defaultSyntaxTokens("dark"),
		);
	});
});

describe("isSyntaxTheme", () => {
	it("accepts a well-formed theme", () => {
		expect(isSyntaxTheme({ name: "mine", tokens: {} })).toBe(true);
	});

	it("rejects what an imported file may hand over instead", () => {
		for (const value of [
			null,
			undefined,
			"a string",
			42,
			[],
			{},
			{ name: "mine" },
			{ tokens: {} },
			{ name: 42, tokens: {} },
			{ name: "mine", tokens: "not an object" },
		]) {
			expect(isSyntaxTheme(value), JSON.stringify(value) ?? "undefined").toBe(
				false,
			);
		}
	});

	it("accepts an array as the tokens field, since typeof says object", () => {
		expect(isSyntaxTheme({ name: "mine", tokens: [] })).toBe(true);
	});

	it("rejects a null tokens field, which typeof alone calls an object", () => {
		expect(isSyntaxTheme({ name: "mine", tokens: null })).toBe(false);
	});
});
