import { describe, expect, it } from "vitest";
import { SETTINGS_REGISTRY, searchSettings } from "./settings-registry";

describe("SETTINGS_REGISTRY", () => {
	it("carries entries", () => {
		expect(SETTINGS_REGISTRY.length).toBeGreaterThan(0);
	});

	it("gives every entry the fields the palette renders", () => {
		for (const entry of SETTINGS_REGISTRY) {
			expect(typeof entry.label, entry.label).toBe("string");
			expect(entry.label.length, entry.label).toBeGreaterThan(0);
			expect(typeof entry.desc, entry.label).toBe("string");
			expect(typeof entry.tab, entry.label).toBe("string");
			expect(typeof entry.group, entry.label).toBe("string");
		}
	});

	it("leaves no entry labelled by a missing i18n key", () => {
		for (const entry of SETTINGS_REGISTRY) {
			expect(entry.label, entry.label).not.toMatch(/^settings\./);
			expect(entry.group, entry.label).not.toMatch(/^settings\./);
		}
	});

	it("includes the shortcuts alongside the static settings", () => {
		const tabs = new Set(SETTINGS_REGISTRY.map((e) => e.tab));
		expect(tabs.has("shortcuts")).toBe(true);
		expect(tabs.size).toBeGreaterThan(1);
	});
});

describe("searchSettings", () => {
	it("finds an entry by a fragment of its label", () => {
		const target = SETTINGS_REGISTRY[0];
		const found = searchSettings(target.label);
		expect(found).toContainEqual(target);
	});

	it("matches on the description too, not only the label", () => {
		const withDesc = SETTINGS_REGISTRY.find((e) => e.desc.length > 4);
		expect(withDesc).toBeDefined();
		if (!withDesc) return;
		expect(searchSettings(withDesc.desc)).toContainEqual(withDesc);
	});

	it("ignores case", () => {
		const target = SETTINGS_REGISTRY[0];
		expect(searchSettings(target.label.toUpperCase())).toContainEqual(target);
		expect(searchSettings(target.label.toLowerCase())).toContainEqual(target);
	});

	it("matches nothing on an empty or blank query, rather than everything", () => {
		expect(searchSettings("")).toEqual([]);
		expect(searchSettings("   ")).toEqual([]);
		expect(searchSettings("\t\n")).toEqual([]);
	});

	it("trims the query before matching", () => {
		const target = SETTINGS_REGISTRY[0];
		expect(searchSettings(`  ${target.label}  `)).toContainEqual(target);
	});

	it("returns nothing for a query no entry carries", () => {
		expect(searchSettings("zzzzzznotasetting")).toEqual([]);
	});

	it("matches a substring, not only a whole word", () => {
		const target = SETTINGS_REGISTRY.find((e) => e.label.length > 4);
		expect(target).toBeDefined();
		if (!target) return;
		expect(searchSettings(target.label.slice(1, 4))).toContainEqual(target);
	});

	it("never invents an entry that is not in the registry", () => {
		for (const entry of searchSettings("e")) {
			expect(SETTINGS_REGISTRY).toContain(entry);
		}
	});
});
