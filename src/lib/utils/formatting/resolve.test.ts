import { describe, expect, it } from "vitest";
import type {
	FormattingConfig,
	StyleOptionInfo,
	StyleSet,
} from "$lib/services/formatting-service";
import { DEFAULT_FORMATTING } from "$lib/services/formatting-service";
import {
	effectiveFormatterId,
	inheritedValue,
	isSupported,
	LSP_FORMATTER_ID,
	optionsForLanguage,
	resolveStyle,
	resolveStyleDetailed,
	withLanguage,
	withOverride,
} from "./resolve";

const OPTIONS: StyleOptionInfo[] = [
	{
		id: "indentSize",
		kind: "number",
		choices: [],
		min: 1,
		max: 16,
		default: 2,
		languages: [],
	},
	{
		id: "lineWidth",
		kind: "number",
		choices: [],
		min: 40,
		max: 400,
		default: 80,
		languages: [],
	},
	{
		id: "quoteStyle",
		kind: "enum",
		choices: ["single", "double"],
		min: null,
		max: null,
		default: "double",
		languages: ["typescript"],
	},
	{
		id: "reorderImports",
		kind: "boolean",
		choices: [],
		min: null,
		max: null,
		default: false,
		languages: ["rust"],
	},
];

function config(
	base: StyleSet,
	languages: {
		languageId: string;
		style?: StyleSet;
		formatterId?: string;
	}[] = [],
): FormattingConfig {
	return {
		...DEFAULT_FORMATTING,
		base,
		languages: languages.map((l) => ({
			languageId: l.languageId,
			enabled: true,
			formatterId: l.formatterId ?? "",
			command: "",
			args: [],
			style: l.style ?? {},
		})),
	};
}

describe("optionsForLanguage", () => {
	it("keeps the universal options and the language's own", () => {
		const ids = optionsForLanguage(OPTIONS, "typescript").map((o) => o.id);
		expect(ids).toEqual(["indentSize", "lineWidth", "quoteStyle"]);
	});

	it("leaves another language's options out", () => {
		const ids = optionsForLanguage(OPTIONS, "rust").map((o) => o.id);
		expect(ids).not.toContain("quoteStyle");
		expect(ids).toContain("reorderImports");
	});
});

describe("resolveStyleDetailed", () => {
	it("falls back to the catalogue default", () => {
		const resolved = resolveStyleDetailed(OPTIONS, null, "typescript");
		expect(resolved.get("indentSize")).toEqual({
			id: "indentSize",
			value: 2,
			origin: "default",
		});
	});

	it("lets a language override win over the common style", () => {
		const c = config({ lineWidth: 100 }, [
			{ languageId: "typescript", style: { lineWidth: 120 } },
		]);
		expect(
			resolveStyleDetailed(OPTIONS, c, "typescript").get("lineWidth"),
		).toEqual({ id: "lineWidth", value: 120, origin: "language" });
	});

	it("reports the layer a value came from", () => {
		const c = config({ lineWidth: 100 });
		expect(
			resolveStyleDetailed(OPTIONS, c, "typescript").get("lineWidth")?.origin,
		).toBe("common");
	});

	it("ignores an override for an option the language does not have", () => {
		const c = config({ quoteStyle: "single" });
		expect(resolveStyleDetailed(OPTIONS, c, "rust").has("quoteStyle")).toBe(
			false,
		);
	});

	it("leaves a language that overrides nothing on the common style", () => {
		const c = config({ lineWidth: 100 }, [
			{ languageId: "typescript", style: { lineWidth: 110 } },
		]);
		expect(resolveStyle(OPTIONS, c, "rust").lineWidth).toBe(100);
	});
});

describe("inheritedValue", () => {
	it("is the common style once a language override is cleared", () => {
		const c = config({ lineWidth: 100 }, [
			{ languageId: "typescript", style: { lineWidth: 110 } },
		]);
		expect(
			inheritedValue(OPTIONS, c, "typescript", "language", "lineWidth"),
		).toBe(100);
	});

	it("reaches the catalogue default when the common style says nothing", () => {
		const c = config({}, [
			{ languageId: "typescript", style: { indentSize: 8 } },
		]);
		expect(
			inheritedValue(OPTIONS, c, "typescript", "language", "indentSize"),
		).toBe(2);
	});

	it("is the catalogue default for the common style itself", () => {
		const c = config({ lineWidth: 140 });
		expect(
			inheritedValue(OPTIONS, c, "typescript", "common", "lineWidth"),
		).toBe(80);
	});
});

describe("withOverride", () => {
	it("sets a value", () => {
		expect(withOverride({}, "lineWidth", 120)).toEqual({ lineWidth: 120 });
	});

	it("clearing an override removes the key rather than writing a default", () => {
		expect(
			withOverride({ lineWidth: 120, indentSize: 4 }, "lineWidth", undefined),
		).toEqual({ indentSize: 4 });
	});

	it("does not mutate the set it was given", () => {
		const original: StyleSet = { lineWidth: 100 };
		withOverride(original, "lineWidth", 120);
		expect(original).toEqual({ lineWidth: 100 });
	});
});

describe("withLanguage", () => {
	it("creates the entry when the config has none", () => {
		const next = withLanguage(DEFAULT_FORMATTING, "rust", {
			formatterId: "rustfmt",
		});
		expect(next.languages).toHaveLength(1);
		expect(next.languages[0]).toMatchObject({
			languageId: "rust",
			formatterId: "rustfmt",
			enabled: true,
		});
	});

	it("patches the existing entry without touching its siblings", () => {
		const start = config({}, [
			{ languageId: "rust", style: { indentSize: 4 } },
			{ languageId: "typescript" },
		]);
		const next = withLanguage(start, "rust", { enabled: false });
		expect(next.languages).toHaveLength(2);
		expect(next.languages[0]).toMatchObject({ enabled: false });
		expect(next.languages[0].style).toEqual({ indentSize: 4 });
		expect(next.languages[1].languageId).toBe("typescript");
	});
});

describe("effectiveFormatterId", () => {
	const catalogue = [
		{ id: "prettier", languageIds: ["typescript"] },
		{ id: "biome", languageIds: ["typescript"] },
		{ id: "rustfmt", languageIds: ["rust"] },
	];

	it("falls back to the catalogue's first for the language", () => {
		expect(effectiveFormatterId(null, "typescript", catalogue)).toBe(
			"prettier",
		);
	});

	it("prefers what the project chose", () => {
		const c = config({}, [{ languageId: "typescript", formatterId: "biome" }]);
		expect(effectiveFormatterId(c, "typescript", catalogue)).toBe("biome");
	});

	it("is empty when nothing in the catalogue claims the language", () => {
		expect(effectiveFormatterId(null, "cobol", catalogue)).toBe("");
	});

	it("keeps the language server apart from having chosen nothing", () => {
		const chosen = config({}, [
			{ languageId: "typescript", formatterId: LSP_FORMATTER_ID },
		]);
		expect(effectiveFormatterId(chosen, "typescript", catalogue)).toBe(
			LSP_FORMATTER_ID,
		);
		// Nothing chosen still lands on the catalogue's own answer.
		expect(effectiveFormatterId(config({}, []), "typescript", catalogue)).toBe(
			"prettier",
		);
	});
});

describe("isSupported", () => {
	it("is false for an option the formatter cannot honour", () => {
		expect(isSupported(["indentSize"], "lineWidth")).toBe(false);
	});

	it("is true when the formatter declares the option", () => {
		expect(isSupported(["indentSize", "lineWidth"], "lineWidth")).toBe(true);
	});

	it("assumes support when nothing is declared", () => {
		expect(isSupported(undefined, "lineWidth")).toBe(true);
	});
});
