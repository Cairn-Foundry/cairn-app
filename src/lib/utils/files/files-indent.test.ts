// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import {
	convertToSpaces,
	convertToTabs,
	denormalizeLineEndings,
	detectIndentStyle,
	detectLineEndings,
	detectSpaceSize,
	normalizeLineEndings,
} from "./files-indent";

describe("detectLineEndings", () => {
	it("detects CRLF", () => {
		expect(detectLineEndings("hello\r\nworld")).toBe("CRLF");
	});

	it("detects LF", () => {
		expect(detectLineEndings("hello\nworld")).toBe("LF");
	});

	it("defaults to LF when no newlines", () => {
		expect(detectLineEndings("hello")).toBe("LF");
	});
});

describe("normalizeLineEndings", () => {
	it("strips \\r from CRLF text", () => {
		expect(normalizeLineEndings("a\r\nb", "CRLF")).toBe("a\nb");
	});

	it("is a no-op for LF text", () => {
		expect(normalizeLineEndings("a\nb", "LF")).toBe("a\nb");
	});
});

describe("denormalizeLineEndings", () => {
	it("converts \\n to \\r\\n for CRLF", () => {
		expect(denormalizeLineEndings("a\nb", "CRLF")).toBe("a\r\nb");
	});

	it("is a no-op for LF", () => {
		expect(denormalizeLineEndings("a\nb", "LF")).toBe("a\nb");
	});
});

describe("detectIndentStyle", () => {
	it("detects tabs", () => {
		expect(detectIndentStyle("\tconst x = 1;\n\treturn x;")).toBe("tabs");
	});

	it("detects spaces", () => {
		expect(detectIndentStyle("  const x = 1;\n  return x;")).toBe("spaces");
	});

	it("returns null for no indentation", () => {
		expect(detectIndentStyle("const x = 1;\nreturn x;")).toBeNull();
	});

	it("prefers tabs when equal", () => {
		expect(detectIndentStyle("\ta\n  b")).toBe("tabs");
	});
});

describe("detectSpaceSize", () => {
	it("detects 2-space indent", () => {
		expect(detectSpaceSize("  a\n  b\n  c")).toBe(2);
	});

	it("detects 4-space indent", () => {
		expect(detectSpaceSize("    a\n    b")).toBe(4);
	});

	it("returns 2 when no indentation found", () => {
		expect(detectSpaceSize("a\nb")).toBe(2);
	});

	it("prefers smaller sizes up to 4", () => {
		expect(detectSpaceSize("  a\n    b")).toBe(2);
	});

	it("falls back to first size when all are > 4", () => {
		expect(detectSpaceSize("     a\n     b")).toBe(5);
	});
});

describe("convertToSpaces", () => {
	it("converts leading tabs to spaces", () => {
		expect(convertToSpaces("\tconst x = 1;", 2)).toBe("  const x = 1;");
	});

	it("converts double-tab indentation", () => {
		expect(convertToSpaces("\t\tdeep", 4)).toBe("        deep");
	});

	it("leaves non-indentation content untouched", () => {
		expect(convertToSpaces("no indent", 2)).toBe("no indent");
	});

	it("handles multiline", () => {
		expect(convertToSpaces("\ta\n\t\tb", 2)).toBe("  a\n    b");
	});
});

describe("convertToTabs", () => {
	it("converts leading spaces to tabs", () => {
		expect(convertToTabs("  const x = 1;", 2)).toBe("\tconst x = 1;");
	});

	it("converts 4-space indent", () => {
		expect(convertToTabs("        deep", 4)).toBe("\t\tdeep");
	});

	it("leaves non-indentation content untouched", () => {
		expect(convertToTabs("no indent", 2)).toBe("no indent");
	});

	it("handles multiline", () => {
		expect(convertToTabs("  a\n    b", 2)).toBe("\ta\n\t\tb");
	});

	it("handles partial indentation (not a full tab-width)", () => {
		expect(convertToTabs(" x", 2)).toBe(" x");
	});
});
