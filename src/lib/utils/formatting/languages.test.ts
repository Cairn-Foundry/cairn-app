import { describe, expect, it } from "vitest";
import { languageLabel, matchesLanguageQuery, sortByLabel } from "./languages";

describe("languageLabel", () => {
	it("turns an LSP id into something readable", () => {
		expect(languageLabel("typescriptreact")).toBe("TypeScript (TSX)");
		expect(languageLabel("objective-cpp")).toBe("Objective-C++");
		expect(languageLabel("csharp")).toBe("C#");
	});

	it("falls back to the id rather than showing nothing", () => {
		expect(languageLabel("cobol")).toBe("cobol");
	});
});

describe("sortByLabel", () => {
	it("orders by what is displayed, not by the id", () => {
		// By id "shellscript" trails "rust"; by label "Shell" leads "Rust".
		expect(sortByLabel(["shellscript", "rust", "go"])).toEqual([
			"go",
			"rust",
			"shellscript",
		]);
		// "javascriptreact" sorts after "javascript" either way, but
		// "typescriptreact" only lands next to "typescript" by label.
		expect(sortByLabel(["typescriptreact", "toml", "typescript"])).toEqual([
			"toml",
			"typescript",
			"typescriptreact",
		]);
	});

	it("does not mutate the list it was given", () => {
		const ids = ["rust", "c"];
		sortByLabel(ids);
		expect(ids).toEqual(["rust", "c"]);
	});
});

describe("matchesLanguageQuery", () => {
	it("matches on the label", () => {
		expect(matchesLanguageQuery("typescriptreact", "TypeScript")).toBe(true);
	});

	it("matches on the raw id", () => {
		expect(matchesLanguageQuery("typescriptreact", "tsx")).toBe(true);
	});

	it("matches on the formatter name, so searching a tool finds its languages", () => {
		expect(matchesLanguageQuery("rust", "rustfmt", "rustfmt")).toBe(true);
		expect(matchesLanguageQuery("rust", "prettier", "rustfmt")).toBe(false);
	});

	it("is case insensitive and ignores surrounding space", () => {
		expect(matchesLanguageQuery("rust", "  RUST ")).toBe(true);
	});

	it("keeps everything when the box is empty", () => {
		expect(matchesLanguageQuery("rust", "")).toBe(true);
	});
});
