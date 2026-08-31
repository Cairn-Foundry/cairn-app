// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import {
	isReservedEnvKey,
	isValidEnvKey,
	parseEnvFile,
	quoteEnvValue,
	serializeEnvFile,
} from "./env-file";

describe("parseEnvFile", () => {
	it("reads plain assignments and skips comments and blank lines", () => {
		const { entries, invalid } = parseEnvFile(
			"# a comment\n\nAPI_URL=https://example.test\n\nPORT=3000\n",
		);

		expect(entries).toEqual([
			{ key: "API_URL", value: "https://example.test" },
			{ key: "PORT", value: "3000" },
		]);
		expect(invalid).toEqual([]);
	});

	it("drops the export prefix", () => {
		expect(parseEnvFile("export TOKEN=abc").entries).toEqual([
			{ key: "TOKEN", value: "abc" },
		]);
	});

	it("keeps single quoted values literal", () => {
		expect(parseEnvFile("MSG='hello # world'").entries).toEqual([
			{ key: "MSG", value: "hello # world" },
		]);
	});

	it("unescapes double quoted values", () => {
		expect(parseEnvFile('MSG="line\\nnext \\"quoted\\""').entries).toEqual([
			{ key: "MSG", value: 'line\nnext "quoted"' },
		]);
	});

	it("reads a value spanning several lines", () => {
		const { entries } = parseEnvFile(
			'KEY="-----BEGIN-----\nbody\n-----END-----"\nNEXT=1',
		);

		expect(entries).toEqual([
			{ key: "KEY", value: "-----BEGIN-----\nbody\n-----END-----" },
			{ key: "NEXT", value: "1" },
		]);
	});

	it("strips an inline comment from an unquoted value", () => {
		expect(parseEnvFile("PORT=3000 # the dev port").entries).toEqual([
			{ key: "PORT", value: "3000" },
		]);
	});

	it("reports lines whose key is unusable", () => {
		const { entries, invalid } = parseEnvFile(
			"2BAD=1\nnot an assignment\nGOOD=1",
		);

		expect(entries).toEqual([{ key: "GOOD", value: "1" }]);
		expect(invalid).toEqual(["2BAD=1", "not an assignment"]);
	});

	it("keeps the last value when a key repeats", () => {
		expect(parseEnvFile("A=1\nA=2").entries).toEqual([
			{ key: "A", value: "2" },
		]);
	});

	it("reads an empty value", () => {
		expect(parseEnvFile("EMPTY=").entries).toEqual([
			{ key: "EMPTY", value: "" },
		]);
	});
});

describe("serializeEnvFile", () => {
	it("leaves a simple value unquoted", () => {
		expect(serializeEnvFile([{ key: "PORT", value: "3000" }])).toBe(
			"PORT=3000",
		);
	});

	it("single quotes a value with spaces", () => {
		expect(quoteEnvValue("hello world")).toBe("'hello world'");
	});

	it("double quotes a value carrying a quote or a newline", () => {
		expect(quoteEnvValue("it's here")).toBe('"it\'s here"');
		expect(quoteEnvValue("a\nb")).toBe('"a\\nb"');
	});

	it("round trips through the parser", () => {
		const entries = [
			{ key: "SIMPLE", value: "3000" },
			{ key: "SPACED", value: "hello world" },
			{ key: "QUOTED", value: `it's "both"` },
			{ key: "MULTI", value: "a\nb" },
			{ key: "EMPTY", value: "" },
			{ key: "HASHED", value: "value # not a comment" },
		];

		expect(parseEnvFile(serializeEnvFile(entries)).entries).toEqual(entries);
	});
});

describe("keys", () => {
	it("accepts a usual key and refuses the rest", () => {
		expect(isValidEnvKey("API_KEY_2")).toBe(true);
		expect(isValidEnvKey("_private")).toBe(true);
		expect(isValidEnvKey("2FA")).toBe(false);
		expect(isValidEnvKey("with-dash")).toBe(false);
		expect(isValidEnvKey("")).toBe(false);
	});

	it("flags the keys Cairn reserves", () => {
		expect(isReservedEnvKey("CAIRN_BRANCH")).toBe(true);
		expect(isReservedEnvKey("cairn_branch")).toBe(true);
		expect(isReservedEnvKey("MY_CAIRN")).toBe(false);
	});
});
