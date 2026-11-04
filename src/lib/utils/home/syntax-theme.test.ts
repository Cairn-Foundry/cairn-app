// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from "vitest";
import {
	defaultSyntaxTokens,
	SYNTAX_TOKEN_KEYS,
} from "#lib/utils/editor/syntax-tokens";
import {
	createSyntaxTheme,
	duplicateSyntaxTheme,
	PREVIEW_LINES,
	parseSyntaxTheme,
	serializeSyntaxTheme,
} from "./syntax-theme";

const previewed = new Set(
	PREVIEW_LINES.flat()
		.map((segment) => segment.token)
		.filter(Boolean),
);

describe("PREVIEW_LINES", () => {
	it.each(SYNTAX_TOKEN_KEYS)("previews the %s category", (key) => {
		expect(previewed.has(key)).toBe(true);
	});

	it("previews nothing that is not customizable", () => {
		for (const token of previewed) {
			expect(SYNTAX_TOKEN_KEYS).toContain(token);
		}
	});
});

describe("syntax theme documents", () => {
	const UUID = "00000000-0000-4000-8000-000000000001";

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("seeds a new theme from the defaults of the app theme", () => {
		vi.spyOn(crypto, "randomUUID").mockReturnValue(UUID);
		expect(createSyntaxTheme("Mine", "default")).toEqual({
			id: UUID,
			name: "Mine",
			tokens: defaultSyntaxTokens("default"),
		});
	});

	it("duplicates a theme under a new id and a copy name", () => {
		vi.spyOn(crypto, "randomUUID").mockReturnValue(UUID);
		const source = {
			id: "original",
			name: "Mine",
			tokens: defaultSyntaxTokens("default"),
		};
		const copy = duplicateSyntaxTheme(source);
		expect(copy.id).toBe(UUID);
		expect(copy.name).toBe("Mine copy");
		expect(copy.tokens).toEqual(source.tokens);
		expect(copy.tokens).not.toBe(source.tokens);
	});

	it("exports the name and tokens, never the id", () => {
		const tokens = defaultSyntaxTokens("default");
		const json = serializeSyntaxTheme({ id: "secret", name: "Mine", tokens });
		expect(JSON.parse(json)).toEqual({ name: "Mine", tokens });
		expect(json).not.toContain("secret");
		expect(json).toBe(JSON.stringify({ name: "Mine", tokens }, null, 2));
	});

	it("imports an exported theme under a fresh id", () => {
		vi.spyOn(crypto, "randomUUID").mockReturnValue(UUID);
		const tokens = defaultSyntaxTokens("default");
		tokens.kw = { color: "#123456", italic: true };
		const json = serializeSyntaxTheme({ id: "old", name: "Mine", tokens });
		const parsed = parseSyntaxTheme(json, "default");
		expect(parsed.id).toBe(UUID);
		expect(parsed.name).toBe("Mine");
		expect(parsed.tokens.kw).toEqual({ color: "#123456", italic: true });
	});

	it("fills the tokens a file leaves out from the app theme defaults", () => {
		const parsed = parseSyntaxTheme(
			JSON.stringify({ name: "Partial", tokens: {} }),
			"default",
		);
		expect(parsed.tokens).toEqual(defaultSyntaxTokens("default"));
	});

	it("refuses a payload that is not a theme", () => {
		const message = "This file is not a Cairn Foundry syntax theme.";
		expect(() => parseSyntaxTheme('{"tokens": {}}', "default")).toThrow(
			message,
		);
		expect(() => parseSyntaxTheme("null", "default")).toThrow(message);
		expect(() => parseSyntaxTheme("[1]", "default")).toThrow(message);
	});

	it("lets a malformed file surface its parse error", () => {
		expect(() => parseSyntaxTheme("{nope", "default")).toThrow(SyntaxError);
	});
});
