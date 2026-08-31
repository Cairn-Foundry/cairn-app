// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import {
	EDITOR_DEFAULTS,
	FOLD_MARKERS,
	FONT_SIZE_MAX,
	FONT_SIZE_MIN,
} from "./editor-config";
import {
	buildEditorTheme,
	diffColors,
	resolveLanguageExtension,
} from "./editor-theme";
import { THEME_OPTIONS } from "./themes";

describe("editor sizing", () => {
	it("states every default as a positive number", () => {
		for (const [name, value] of Object.entries(EDITOR_DEFAULTS)) {
			expect(typeof value, name).toBe("number");
			expect(value, name).toBeGreaterThan(0);
		}
	});

	it("bounds the font size around its default", () => {
		expect(FONT_SIZE_MIN).toBeLessThan(FONT_SIZE_MAX);
		expect(EDITOR_DEFAULTS.fontSize).toBeGreaterThanOrEqual(FONT_SIZE_MIN);
		expect(EDITOR_DEFAULTS.fontSize).toBeLessThanOrEqual(FONT_SIZE_MAX);
	});

	it("keeps the font size readable at both ends", () => {
		expect(FONT_SIZE_MIN).toBeGreaterThanOrEqual(6);
		expect(FONT_SIZE_MAX).toBeLessThanOrEqual(72);
	});

	it("draws a distinct marker for an open and a closed fold", () => {
		expect(FOLD_MARKERS.open).not.toBe(FOLD_MARKERS.closed);
		expect(FOLD_MARKERS.open.length).toBeGreaterThan(0);
		expect(FOLD_MARKERS.closed.length).toBeGreaterThan(0);
	});
});

describe("diffColors", () => {
	it("gives the three kinds a colour", () => {
		const colors = diffColors("default");
		expect(Object.keys(colors).sort()).toEqual([
			"added",
			"deleted",
			"modified",
		]);
		for (const [kind, value] of Object.entries(colors)) {
			expect(value, kind).toBeTruthy();
		}
	});

	it("tells the three kinds apart, so the gutter is readable", () => {
		const { added, modified, deleted } = diffColors("default");
		expect(new Set([added, modified, deleted]).size).toBe(3);
	});

	it("serves every shipped theme", () => {
		for (const theme of THEME_OPTIONS) {
			const colors = diffColors(theme.id);
			expect(colors.added, theme.id).toBeTruthy();
			expect(colors.deleted, theme.id).toBeTruthy();
		}
	});

	it("falls back to the default palette for a theme nobody knows", () => {
		expect(diffColors("no-such-theme")).toEqual(diffColors("default"));
		expect(diffColors("")).toEqual(diffColors("default"));
	});

	it("gives a light and a dark theme different colours", () => {
		expect(diffColors("light")).not.toEqual(diffColors("dark"));
	});
});

describe("buildEditorTheme", () => {
	it("builds an extension for every shipped theme", () => {
		for (const theme of THEME_OPTIONS) {
			expect(buildEditorTheme(theme.id), theme.id).toBeTruthy();
		}
	});

	it("falls back rather than failing on an unknown theme", () => {
		expect(() => buildEditorTheme("no-such-theme")).not.toThrow();
		expect(buildEditorTheme("no-such-theme")).toBeTruthy();
	});
});

describe("resolveLanguageExtension", () => {
	it("resolves the languages the editor opens most", async () => {
		for (const lang of ["typescript", "javascript", "json", "css", "html"]) {
			await expect(
				resolveLanguageExtension(lang as never),
				lang,
			).resolves.toBeTruthy();
		}
	});

	it("resolves the JSX and TSX variants", async () => {
		await expect(
			resolveLanguageExtension("tsx" as never),
		).resolves.toBeTruthy();
		await expect(
			resolveLanguageExtension("jsx" as never),
		).resolves.toBeTruthy();
	});

	it("resolves the component languages loaded on demand", async () => {
		await expect(
			resolveLanguageExtension("svelte" as never),
		).resolves.toBeTruthy();
		await expect(
			resolveLanguageExtension("vue" as never),
		).resolves.toBeTruthy();
	});

	it("resolves markdown, which the WYSIWYG rendering needs", async () => {
		await expect(
			resolveLanguageExtension("markdown" as never),
		).resolves.toBeTruthy();
	});

	it("answers something rather than throwing for plain text", async () => {
		await expect(
			resolveLanguageExtension("text" as never),
		).resolves.toBeDefined();
	});

	it("answers something rather than throwing for a language it has no mode for", async () => {
		await expect(
			resolveLanguageExtension("no-such-language" as never),
		).resolves.toBeDefined();
	});
});
