// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CairnSettings } from "$lib/services/settings-service";
import {
	defaultSyntaxTokens,
	type SyntaxTokens,
} from "$lib/utils/editor/syntax-tokens";
import { DEFAULT_WF_TABS } from "$lib/utils/home/workflow-tabs";

/** A complete palette whose keyword colour is the one a test looks for. */
const paletteWith = (color: string): SyntaxTokens => ({
	...defaultSyntaxTokens("default"),
	kw: { color },
});

const getSettings = vi.hoisted(() => vi.fn());
const updateSettings = vi.hoisted(() => vi.fn());

vi.mock("$lib/services/settings-service", () => ({
	getSettings,
	updateSettings,
}));

const setCustomServers = vi.hoisted(() => vi.fn());
vi.mock("$lib/utils/languages/servers", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	setCustomServers,
}));

const reportPersistError = vi.hoisted(() => vi.fn());
vi.mock("$lib/utils/persist-error", () => ({
	reportPersistError,
	persist: vi.fn(),
}));

import { activeSyntaxTokens, settings } from "./settings";

/** Whatever the store holds right now. */
const current = () => get(settings) as CairnSettings;

beforeEach(() => {
	getSettings.mockReset();
	updateSettings.mockReset();
	reportPersistError.mockReset();
	setCustomServers.mockReset();
	updateSettings.mockImplementation(async (s: CairnSettings) => s);
});

describe("load", () => {
	it("applies what is stored on disk", async () => {
		getSettings.mockResolvedValue({ editorFontSize: 20 });
		await settings.load();
		expect(current().editorFontSize).toBe(20);
	});

	it("fills in a field the saved config predates", async () => {
		getSettings.mockResolvedValue({ editorFontSize: 20 });
		await settings.load();
		expect(current().showMinimap).toBe(true);
		expect(current().saveOn).toBe("blur");
	});

	it("leaves the settings alone when the read fails, rather than throwing", async () => {
		await settings.save({ editorFontSize: 17 });
		getSettings.mockRejectedValue(new Error("no such file"));
		await expect(settings.load()).resolves.toBeUndefined();
		expect(current().editorFontSize).toBe(17);
	});

	it("starts from the factory defaults before anything is loaded", async () => {
		getSettings.mockResolvedValue({});
		await settings.load();
		expect(current()).toMatchObject({
			editorFontSize: 13,
			showMinimap: true,
			saveOn: "blur",
			treePanelWidth: 220,
		});
	});

	it("ignores a null or undefined field instead of storing it", async () => {
		getSettings.mockResolvedValue({
			editorFontSize: null,
			theme: undefined,
			uiScale: 2,
		});
		await settings.load();
		expect(current().editorFontSize).toBe(13);
		expect(current().theme).toBe("default");
		expect(current().uiScale).toBe(2);
	});

	it("keeps a falsy value that is a real choice", async () => {
		getSettings.mockResolvedValue({ showMinimap: false, splitLeftWidth: 0 });
		await settings.load();
		expect(current().showMinimap).toBe(false);
		expect(current().splitLeftWidth).toBe(0);
	});

	it("drops a key that is not a known setting", async () => {
		getSettings.mockResolvedValue({ notASetting: "x" });
		await settings.load();
		expect(current()).not.toHaveProperty("notASetting");
	});
});

describe("workflow tab restoration", () => {
	it("keeps the tabs the user arranged", async () => {
		const saved = DEFAULT_WF_TABS.map((t, i) => ({
			...t,
			order: DEFAULT_WF_TABS.length - 1 - i,
		}));
		getSettings.mockResolvedValue({ workflowTabs: saved });
		await settings.load();
		expect(current().workflowTabs).toEqual(saved);
	});

	it("appends a tab that shipped after the config was saved", async () => {
		const saved = DEFAULT_WF_TABS.slice(0, 2);
		getSettings.mockResolvedValue({ workflowTabs: saved });
		await settings.load();
		const keys = current().workflowTabs.map((t) => t.key);
		expect(keys).toEqual([
			...saved.map((t) => t.key),
			...DEFAULT_WF_TABS.slice(2).map((t) => t.key),
		]);
	});

	it("restores every tab when the saved list is empty", async () => {
		getSettings.mockResolvedValue({ workflowTabs: [] });
		await settings.load();
		expect(current().workflowTabs.map((t) => t.key)).toEqual(
			DEFAULT_WF_TABS.map((t) => t.key),
		);
	});

	it("adds no duplicate when every tab is already saved", async () => {
		getSettings.mockResolvedValue({ workflowTabs: DEFAULT_WF_TABS });
		await settings.load();
		expect(current().workflowTabs).toHaveLength(DEFAULT_WF_TABS.length);
	});

	it("keeps a tab the user disabled rather than resetting it", async () => {
		const saved = DEFAULT_WF_TABS.map((t) => ({ ...t, enabled: false }));
		getSettings.mockResolvedValue({ workflowTabs: saved });
		await settings.load();
		expect(current().workflowTabs.every((t) => !t.enabled)).toBe(true);
	});
});

describe("save", () => {
	it("applies the patch to the store", async () => {
		await settings.save({ editorFontSize: 18 });
		expect(current().editorFontSize).toBe(18);
	});

	it("writes the whole settings object, not just the patch", async () => {
		await settings.save({ editorFontSize: 18 });
		const written = updateSettings.mock.calls.at(-1)?.[0] as CairnSettings;
		expect(written.editorFontSize).toBe(18);
		expect(written.showMinimap).toBe(true);
	});

	it("leaves the other settings untouched", async () => {
		await settings.save({ editorFontSize: 18 });
		await settings.save({ uiScale: 2 });
		expect(current().editorFontSize).toBe(18);
		expect(current().uiScale).toBe(2);
	});

	it("waits for the write, so a backend re-read sees it", async () => {
		let done = false;
		updateSettings.mockImplementation(async (s: CairnSettings) => {
			await Promise.resolve();
			done = true;
			return s;
		});
		await settings.save({ uiScale: 2 });
		expect(done).toBe(true);
	});

	it("takes back what the backend normalized", async () => {
		updateSettings.mockImplementation(async (s: CairnSettings) => ({
			...s,
			editorFontSize: 10,
		}));
		await settings.save({ editorFontSize: 999 });
		expect(current().editorFontSize).toBe(10);
	});

	it("reports a failed write instead of losing it silently", async () => {
		updateSettings.mockRejectedValue(new Error("EACCES"));
		await settings.save({ uiScale: 3 });
		expect(reportPersistError).toHaveBeenCalledWith(
			"the settings",
			expect.any(Error),
		);
	});

	it("keeps the change on screen even when the write failed", async () => {
		updateSettings.mockRejectedValue(new Error("EACCES"));
		await settings.save({ uiScale: 3 });
		expect(current().uiScale).toBe(3);
	});

	it("does not reject its caller when the write fails", async () => {
		updateSettings.mockRejectedValue(new Error("EACCES"));
		await expect(settings.save({ uiScale: 3 })).resolves.toBeUndefined();
	});

	it("accepts an empty patch as a plain rewrite", async () => {
		await settings.save({});
		expect(updateSettings).toHaveBeenCalledTimes(1);
	});
});

describe("custom language servers", () => {
	it("pushes the user's servers to the lookups on every change", async () => {
		await settings.save({
			customLanguageServers: [
				{
					id: "mine",
					name: "Mine",
					binary: "run",
					args: [],
					languageIds: ["mine"],
					extensions: ["x"],
					rootMarkers: [],
					docUrl: "",
				},
			],
		});
		expect(setCustomServers).toHaveBeenCalledWith([
			{ id: "mine", name: "Mine", extensions: ["x"], languageIds: ["mine"] },
		]);
	});

	it("clears them when the list empties", async () => {
		await settings.save({ customLanguageServers: [] });
		expect(setCustomServers).toHaveBeenLastCalledWith([]);
	});
});

describe("activeSyntaxTokens", () => {
	it("falls back to the built-in palette when no theme is selected", async () => {
		await settings.save({ syntaxThemes: [], activeSyntaxThemeId: "" });
		expect(Object.keys(get(activeSyntaxTokens)).length).toBeGreaterThan(0);
	});

	it("uses the selected theme's tokens", async () => {
		await settings.save({
			syntaxThemes: [
				{ id: "mine", name: "Mine", tokens: paletteWith("#ff0000") },
			],
			activeSyntaxThemeId: "mine",
		});
		expect(get(activeSyntaxTokens).kw.color).toBe("#ff0000");
	});

	it("falls back when the selected id matches no theme", async () => {
		await settings.save({
			syntaxThemes: [
				{ id: "mine", name: "Mine", tokens: paletteWith("#ff0000") },
			],
			activeSyntaxThemeId: "gone",
		});
		expect(get(activeSyntaxTokens).kw.color).not.toBe("#ff0000");
	});

	it("fills in the tokens a partial theme leaves out", async () => {
		await settings.save({
			syntaxThemes: [
				{ id: "mine", name: "Mine", tokens: paletteWith("#ff0000") },
			],
			activeSyntaxThemeId: "mine",
		});
		const tokens = get(activeSyntaxTokens);
		for (const style of Object.values(tokens)) {
			expect(style.color).toBeTruthy();
		}
	});
});
