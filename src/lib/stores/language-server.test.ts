// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CairnSettings } from "$lib/services/settings-service";

const listLanguageServers = vi.hoisted(() => vi.fn());
const checkLanguageServerUpdates = vi.hoisted(() => vi.fn());
vi.mock("$lib/services/lsp-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	listLanguageServers,
	checkLanguageServerUpdates,
	startLanguageServer: vi.fn().mockResolvedValue(null),
	stopLanguageServersFor: vi.fn().mockResolvedValue(undefined),
	stopLanguageServersWithId: vi.fn().mockResolvedValue(undefined),
}));

const getSettings = vi.hoisted(() => vi.fn());
const updateSettings = vi.hoisted(() => vi.fn());
vi.mock("$lib/services/settings-service", () => ({
	getSettings,
	updateSettings,
}));

import { serverForPath } from "$lib/utils/languages/servers";
import {
	clearUpdateCheck,
	customServerId,
	dismissServerSuggestion,
	languageServerInfos,
	liveStatusFor,
	refreshLanguageServers,
	shouldSuggestFor,
	updateChecks,
} from "./language-server";
import { settings } from "./settings";

/** A settings object with only the language-server fields a test cares about. */
function config(overrides: Partial<CairnSettings> = {}): CairnSettings {
	return {
		suggestLanguageServers: true,
		languageServers: [],
		dismissedLanguageServers: [],
		customLanguageServers: [],
		...overrides,
	} as CairnSettings;
}

/** A path the shipped catalogue covers, whatever the catalogue holds today. */
const KNOWN_PATH = "/repo/src/main.ts";

beforeEach(async () => {
	vi.clearAllMocks();
	listLanguageServers.mockResolvedValue([]);
	checkLanguageServerUpdates.mockResolvedValue([]);
	updateSettings.mockImplementation(async (s) => s);
	getSettings.mockResolvedValue({});
	await settings.load();
});

describe("liveStatusFor", () => {
	it("finds the live instance of a server, whatever root it is on", () => {
		expect(liveStatusFor({ "tsserver:/repo": "ready" }, "tsserver")).toBe(
			"ready",
		);
	});

	it("ignores a stopped instance", () => {
		expect(
			liveStatusFor({ "tsserver:/repo": "stopped" }, "tsserver"),
		).toBeNull();
	});

	it("reports the one that is up when another root stopped", () => {
		expect(
			liveStatusFor(
				{ "tsserver:/a": "stopped", "tsserver:/b": "ready" },
				"tsserver",
			),
		).toBe("ready");
	});

	it("answers null for a server that is not running anywhere", () => {
		expect(liveStatusFor({}, "tsserver")).toBeNull();
		expect(liveStatusFor({ "other:/repo": "ready" }, "tsserver")).toBeNull();
	});

	it("never mistakes a server whose id merely starts the same", () => {
		expect(liveStatusFor({ "ts:/repo": "ready" }, "tsserver")).toBeNull();
	});
});

describe("customServerId", () => {
	it("derives a readable id from the name", () => {
		expect(customServerId("My Server", [])).toBe("my-server");
	});

	it("collapses anything that is not alphanumeric", () => {
		expect(customServerId("My  Server!!", [])).toBe("my-server");
		expect(customServerId("a_b.c", [])).toBe("a-b-c");
	});

	it("trims the separators it produced at either end", () => {
		expect(customServerId("  server  ", [])).toBe("server");
		expect(customServerId("!!server!!", [])).toBe("server");
	});

	it("falls back to a name rather than an empty id", () => {
		expect(customServerId("", [])).toBe("server");
		expect(customServerId("...", [])).toBe("server");
	});

	it("keeps the id unique against what is already declared", () => {
		expect(customServerId("mine", ["mine"])).toBe("mine-2");
		expect(customServerId("mine", ["mine", "mine-2"])).toBe("mine-3");
	});

	it("leaves a free id alone even when others are taken", () => {
		expect(customServerId("mine", ["other"])).toBe("mine");
	});

	it("drops accents rather than keeping a character the id cannot hold", () => {
		expect(customServerId("Serveur Élan", [])).toBe("serveur-lan");
	});
});

describe("shouldSuggestFor", () => {
	it("suggests the server the catalogue has for the file", () => {
		const def = serverForPath(KNOWN_PATH);
		expect(def).toBeTruthy();
		expect(shouldSuggestFor(KNOWN_PATH, config())?.id).toBe(def?.id);
	});

	it("suggests nothing when the user turned suggestions off", () => {
		expect(
			shouldSuggestFor(KNOWN_PATH, config({ suggestLanguageServers: false })),
		).toBeNull();
	});

	it("suggests nothing for a file the catalogue does not cover", () => {
		expect(shouldSuggestFor("/repo/notes.unknownext", config())).toBeNull();
	});

	it("suggests nothing for a server already enabled", () => {
		const def = serverForPath(KNOWN_PATH);
		if (!def) return;
		expect(
			shouldSuggestFor(
				KNOWN_PATH,
				config({
					languageServers: [
						{ id: def.id, enabled: true, command: "", args: [] },
					],
				}),
			),
		).toBeNull();
	});

	it("still suggests a server the user declared but left disabled", () => {
		const def = serverForPath(KNOWN_PATH);
		if (!def) return;
		expect(
			shouldSuggestFor(
				KNOWN_PATH,
				config({
					languageServers: [
						{ id: def.id, enabled: false, command: "", args: [] },
					],
				}),
			)?.id,
		).toBe(def.id);
	});

	it("suggests nothing for a server the user dismissed", () => {
		const def = serverForPath(KNOWN_PATH);
		if (!def) return;
		expect(
			shouldSuggestFor(
				KNOWN_PATH,
				config({ dismissedLanguageServers: [def.id] }),
			),
		).toBeNull();
	});
});

describe("dismissServerSuggestion", () => {
	it("records the dismissal", async () => {
		dismissServerSuggestion("tsserver");
		await vi.waitFor(() =>
			expect(get(settings).dismissedLanguageServers).toContain("tsserver"),
		);
	});

	it("records it once, however often it is dismissed", async () => {
		dismissServerSuggestion("tsserver");
		await vi.waitFor(() =>
			expect(get(settings).dismissedLanguageServers).toContain("tsserver"),
		);
		const calls = updateSettings.mock.calls.length;
		dismissServerSuggestion("tsserver");
		expect(updateSettings.mock.calls.length).toBe(calls);
	});

	it("keeps the servers dismissed before it", async () => {
		dismissServerSuggestion("a");
		await vi.waitFor(() =>
			expect(get(settings).dismissedLanguageServers).toContain("a"),
		);
		dismissServerSuggestion("b");
		await vi.waitFor(() =>
			expect(get(settings).dismissedLanguageServers).toEqual(["a", "b"]),
		);
	});
});

describe("refreshLanguageServers", () => {
	it("stores the catalogue the backend reports", async () => {
		listLanguageServers.mockResolvedValue([
			{ id: "tsserver", installed: true },
		]);
		await refreshLanguageServers("/repo");
		expect(get(languageServerInfos)).toHaveLength(1);
	});

	it("leaves the previous list showing when the read fails", async () => {
		listLanguageServers.mockResolvedValue([
			{ id: "tsserver", installed: true },
		]);
		await refreshLanguageServers("/repo");
		listLanguageServers.mockRejectedValue(new Error("boom"));
		await expect(refreshLanguageServers("/repo")).resolves.toBeUndefined();
		expect(get(languageServerInfos)).toHaveLength(1);
	});

	it("asks for the root it is given", async () => {
		await refreshLanguageServers("/repo");
		expect(listLanguageServers).toHaveBeenCalledWith("/repo");
	});

	it("accepts having no root at all", async () => {
		await refreshLanguageServers(null);
		expect(listLanguageServers).toHaveBeenCalledWith(null);
	});
});

describe("clearUpdateCheck", () => {
	it("forgets the result for one server", async () => {
		checkLanguageServerUpdates.mockResolvedValue([
			{ serverId: "tsserver", outdated: true, latest: "2.0.0" },
		]);
		const { checkForUpdates } = await import("./language-server");
		await checkForUpdates("/repo");
		expect(get(updateChecks)).toHaveProperty("tsserver");
		clearUpdateCheck("tsserver");
		expect(get(updateChecks)).not.toHaveProperty("tsserver");
	});

	it("does nothing for a server with no result", () => {
		expect(() => clearUpdateCheck("never-checked")).not.toThrow();
	});

	it("keeps the results of the other servers", async () => {
		checkLanguageServerUpdates.mockResolvedValue([
			{ serverId: "a", outdated: true, latest: "2" },
			{ serverId: "b", outdated: false, latest: null },
		]);
		const { checkForUpdates } = await import("./language-server");
		await checkForUpdates("/repo");
		clearUpdateCheck("a");
		expect(get(updateChecks)).toHaveProperty("b");
	});

	it("keeps a previous result when the check fails", async () => {
		checkLanguageServerUpdates.mockResolvedValue([
			{ serverId: "a", outdated: true, latest: "2" },
		]);
		const { checkForUpdates } = await import("./language-server");
		await checkForUpdates("/repo");
		checkLanguageServerUpdates.mockRejectedValue(new Error("offline"));
		await expect(checkForUpdates("/repo")).resolves.toBeUndefined();
		expect(get(updateChecks)).toHaveProperty("a");
	});
});
