// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CairnSettings } from "#lib/services/settings-service";

const listLanguageServers = vi.hoisted(() => vi.fn());
const checkLanguageServerUpdates = vi.hoisted(() => vi.fn());
const startLanguageServer = vi.hoisted(() => vi.fn());
const stopLanguageServersFor = vi.hoisted(() => vi.fn());
const stopLanguageServersWithId = vi.hoisted(() => vi.fn());
vi.mock("#lib/services/lsp-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	listLanguageServers,
	checkLanguageServerUpdates,
	startLanguageServer,
	stopLanguageServersFor,
	stopLanguageServersWithId,
}));

const getSettings = vi.hoisted(() => vi.fn());
const updateSettings = vi.hoisted(() => vi.fn());
vi.mock("#lib/services/settings-service", () => ({
	getSettings,
	updateSettings,
}));

import { listen } from "@tauri-apps/api/event";
import { serverForPath } from "#lib/utils/languages/servers";
import {
	clearDiagnosticsFor,
	clearManagerOutput,
	clearUpdateCheck,
	customServerId,
	dismissServerSuggestion,
	disposeLanguageServers,
	ensureDocument,
	forgetDocument,
	initLanguageServers,
	languageServerInfos,
	languageServerStatuses,
	liveStatusFor,
	lspDiagnostics,
	managerOutput,
	refreshLanguageServers,
	removeCustomServer,
	saveCustomServer,
	setServerEnabled,
	shouldSuggestFor,
	stopServersForWorktree,
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
	disposeLanguageServers();
	for (const path of Object.keys(get(lspDiagnostics)))
		clearDiagnosticsFor(path);
	listLanguageServers.mockResolvedValue([]);
	checkLanguageServerUpdates.mockResolvedValue([]);
	startLanguageServer.mockResolvedValue(null);
	stopLanguageServersFor.mockResolvedValue(undefined);
	stopLanguageServersWithId.mockResolvedValue(undefined);
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

const diagnostic = (message: string) =>
	({
		range: {
			start: { line: 0, character: 0 },
			end: { line: 0, character: 1 },
		},
		severity: 1,
		message,
	}) as never;

/** Registers the store's listeners against a fake event bus and returns it. */
async function connectEvents() {
	const handlers: Record<string, (event: { payload: unknown }) => void> = {};
	vi.mocked(listen).mockImplementation((async (
		name: string,
		handler: (event: { payload: unknown }) => void,
	) => {
		handlers[name] = handler;
		return () => {};
	}) as never);
	initLanguageServers();
	await vi.waitFor(() => expect(Object.keys(handlers)).toHaveLength(3));
	return handlers;
}

describe("setServerEnabled", () => {
	it("declares a server that had no setting", () => {
		setServerEnabled("typescript", true);
		expect(get(settings).languageServers).toEqual([
			{ id: "typescript", enabled: true, command: "", args: [] },
		]);
		expect(stopLanguageServersWithId).not.toHaveBeenCalled();
	});

	it("flips the flag of a declared server and keeps its command", () => {
		settings.save({
			languageServers: [
				{ id: "typescript", enabled: true, command: "tsls", args: ["--x"] },
				{ id: "python", enabled: true, command: "", args: [] },
			],
		});
		setServerEnabled("typescript", false);
		expect(get(settings).languageServers).toEqual([
			{ id: "typescript", enabled: false, command: "tsls", args: ["--x"] },
			{ id: "python", enabled: true, command: "", args: [] },
		]);
	});

	it("stops the process and drops its diagnostics when turned off", async () => {
		const handlers = await connectEvents();
		handlers["lsp-diagnostics-batch"]({
			payload: [
				{ path: "/r/off/a.ts", diagnostics: [diagnostic("ts")] },
				{ path: "/r/off/a.py", diagnostics: [diagnostic("py")] },
			],
		});
		await vi.waitFor(() =>
			expect(Object.keys(get(lspDiagnostics))).toEqual([
				"/r/off/a.ts",
				"/r/off/a.py",
			]),
		);

		setServerEnabled("typescript", false);

		expect(stopLanguageServersWithId).toHaveBeenCalledWith("typescript");
		expect(Object.keys(get(lspDiagnostics))).toEqual(["/r/off/a.py"]);
		disposeLanguageServers();
	});
});

describe("custom servers", () => {
	const custom = (id: string, name: string) => ({
		id,
		name,
		binary: "bin",
		args: [],
		languageIds: ["x"],
		extensions: [".x"],
		rootMarkers: [],
		docUrl: "",
	});

	it("adds a server that is new", async () => {
		await saveCustomServer(custom("mine", "Mine"));
		expect(get(settings).customLanguageServers).toEqual([
			custom("mine", "Mine"),
		]);
	});

	it("replaces a server with the same id in place", async () => {
		await saveCustomServer(custom("a", "A"));
		await saveCustomServer(custom("b", "B"));
		await saveCustomServer(custom("a", "A2"));
		expect(get(settings).customLanguageServers).toEqual([
			custom("a", "A2"),
			custom("b", "B"),
		]);
	});

	it("removes the server, its enabled flag, and stops it", async () => {
		await saveCustomServer(custom("a", "A"));
		await saveCustomServer(custom("b", "B"));
		await settings.save({
			languageServers: [
				{ id: "a", enabled: true, command: "", args: [] },
				{ id: "b", enabled: true, command: "", args: [] },
			],
		});

		await removeCustomServer("a");

		expect(get(settings).customLanguageServers).toEqual([custom("b", "B")]);
		expect(get(settings).languageServers).toEqual([
			{ id: "b", enabled: true, command: "", args: [] },
		]);
		expect(stopLanguageServersWithId).toHaveBeenCalledWith("a");
	});

	it("drops the diagnostics of the files the removed server covered", async () => {
		const handlers = await connectEvents();
		await saveCustomServer(custom("mine", "Mine"));
		handlers["lsp-diagnostics-batch"]({
			payload: [
				{ path: "/r/own/a.x", diagnostics: [diagnostic("x")] },
				{ path: "/r/own/a.ts", diagnostics: [diagnostic("ts")] },
			],
		});
		await vi.waitFor(() =>
			expect(Object.keys(get(lspDiagnostics))).toEqual([
				"/r/own/a.x",
				"/r/own/a.ts",
			]),
		);

		await removeCustomServer("mine");

		expect(Object.keys(get(lspDiagnostics))).toEqual(["/r/own/a.ts"]);
		disposeLanguageServers();
	});

	it("keeps every diagnostic when the removed id matches no server", async () => {
		const handlers = await connectEvents();
		handlers["lsp-diagnostics-batch"]({
			payload: [{ path: "/r/keep/a.ts", diagnostics: [diagnostic("ts")] }],
		});
		await vi.waitFor(() =>
			expect(Object.keys(get(lspDiagnostics))).toEqual(["/r/keep/a.ts"]),
		);

		await removeCustomServer("ghost");

		expect(Object.keys(get(lspDiagnostics))).toEqual(["/r/keep/a.ts"]);
		expect(stopLanguageServersWithId).toHaveBeenCalledWith("ghost");
	});
});

describe("events and clearing", () => {
	it("subscribes to the backend only once however often it is initialised", async () => {
		await connectEvents();
		vi.mocked(listen).mockClear();
		initLanguageServers();
		expect(listen).not.toHaveBeenCalled();
	});

	it("does not subscribe again once a single listener is registered", async () => {
		const settle: ((off: () => void) => void)[] = [];
		vi.mocked(listen).mockClear();
		vi.mocked(listen).mockImplementation(
			(() =>
				new Promise<() => void>((resolve) => settle.push(resolve))) as never,
		);
		initLanguageServers();
		expect(listen).toHaveBeenCalledTimes(3);

		settle[0](() => {});
		await new Promise((resolve) => setTimeout(resolve, 0));
		initLanguageServers();

		expect(listen).toHaveBeenCalledTimes(3);
		settle[1](() => {});
		settle[2](() => {});
		await new Promise((resolve) => setTimeout(resolve, 0));
		disposeLanguageServers();
	});

	it("unsubscribes every backend listener when disposed", async () => {
		const offs = [vi.fn(), vi.fn(), vi.fn()];
		let next = 0;
		vi.mocked(listen).mockImplementation((async () => offs[next++]) as never);
		initLanguageServers();
		await new Promise((resolve) => setTimeout(resolve, 0));

		disposeLanguageServers();

		for (const off of offs) expect(off).toHaveBeenCalledTimes(1);
		disposeLanguageServers();
		for (const off of offs) expect(off).toHaveBeenCalledTimes(1);
	});

	it("keeps the last manager line per server until it is cleared", async () => {
		const handlers = await connectEvents();
		handlers["lsp-manager"]({ payload: { serverId: "a", line: "one" } });
		handlers["lsp-manager"]({ payload: { serverId: "b", line: "two" } });
		handlers["lsp-manager"]({ payload: { serverId: "a", line: "three" } });
		expect(get(managerOutput)).toEqual({ a: "three", b: "two" });

		clearManagerOutput("a");

		expect(get(managerOutput)).toEqual({ b: "two" });
		disposeLanguageServers();
	});

	it("drops the diagnostics of one file only", async () => {
		const handlers = await connectEvents();
		handlers["lsp-diagnostics-batch"]({
			payload: [
				{ path: "/r/clear/a.ts", diagnostics: [diagnostic("a")] },
				{ path: "/r/clear/b.ts", diagnostics: [diagnostic("b")] },
			],
		});
		await vi.waitFor(() =>
			expect(get(lspDiagnostics)["/r/clear/b.ts"]).toBeDefined(),
		);

		clearDiagnosticsFor("/r/clear/a.ts");

		expect(Object.keys(get(lspDiagnostics))).not.toContain("/r/clear/a.ts");
		expect(get(lspDiagnostics)["/r/clear/b.ts"]).toEqual([diagnostic("b")]);
		disposeLanguageServers();
	});

	it("records the status of a server per root", async () => {
		const handlers = await connectEvents();
		handlers["lsp-status"]({
			payload: { serverId: "typescript", root: "/r/status", status: "ready" },
		});
		expect(get(languageServerStatuses)["typescript:/r/status"]).toBe("ready");
		disposeLanguageServers();
	});
});

describe("ensureDocument", () => {
	beforeEach(() => {
		settings.save({
			languageServers: [
				{ id: "typescript", enabled: true, command: "tsls", args: ["--stdio"] },
			],
		});
	});

	it("is null for a file no server covers", async () => {
		await expect(
			ensureDocument("/wt", "/wt/notes.unknownext"),
		).resolves.toBeNull();
		expect(startLanguageServer).not.toHaveBeenCalled();
	});

	it("is null for a server the user never enabled", async () => {
		await expect(ensureDocument("/wt", "/wt/a.py")).resolves.toBeNull();
		expect(startLanguageServer).not.toHaveBeenCalled();
	});

	it("starts the server with the configured command and answers with its root", async () => {
		startLanguageServer.mockResolvedValue("/wt-root");

		await expect(ensureDocument("/wt1", "/wt1/a.ts")).resolves.toEqual({
			serverId: "typescript",
			root: "/wt-root",
			path: "/wt1/a.ts",
		});
		expect(startLanguageServer).toHaveBeenCalledWith(
			"typescript",
			"/wt1",
			"/wt1/a.ts",
			"tsls",
			["--stdio"],
		);
	});

	it("starts with an empty command when the setting carries none", async () => {
		await settings.save({ languageServers: [] });
		setServerEnabled("typescript", true);
		startLanguageServer.mockResolvedValue("/wt-root");

		await ensureDocument("/wt2", "/wt2/a.ts");

		expect(startLanguageServer).toHaveBeenCalledWith(
			"typescript",
			"/wt2",
			"/wt2/a.ts",
			"",
			[],
		);
	});

	it("starts with an empty command and no arguments when the setting omits them", async () => {
		await settings.save({
			languageServers: [{ id: "typescript", enabled: true } as never],
		});
		startLanguageServer.mockResolvedValue("/wt-root");

		await ensureDocument("/wt12", "/wt12/a.ts");

		expect(startLanguageServer).toHaveBeenCalledWith(
			"typescript",
			"/wt12",
			"/wt12/a.ts",
			"",
			[],
		);
	});

	it("is null when the server fails to start", async () => {
		startLanguageServer.mockRejectedValue(new Error("no binary"));
		await expect(ensureDocument("/wt3", "/wt3/a.ts")).resolves.toBeNull();
	});

	it("is null when the server answers without a root", async () => {
		startLanguageServer.mockResolvedValue("");
		await expect(ensureDocument("/wt4", "/wt4/a.ts")).resolves.toBeNull();
	});

	it("costs no second start once the root is known", async () => {
		startLanguageServer.mockResolvedValue("/wt-root");
		await ensureDocument("/wt5", "/wt5/a.ts");
		const again = await ensureDocument("/wt5", "/wt5/a.ts");

		expect(again).toEqual({
			serverId: "typescript",
			root: "/wt-root",
			path: "/wt5/a.ts",
		});
		expect(startLanguageServer).toHaveBeenCalledTimes(1);
	});

	it("shares one start between simultaneous requests for the same file", async () => {
		startLanguageServer.mockResolvedValue("/wt-root");
		const [first, second] = await Promise.all([
			ensureDocument("/wt6", "/wt6/a.ts"),
			ensureDocument("/wt6", "/wt6/a.ts"),
		]);

		expect(first).toEqual(second);
		expect(startLanguageServer).toHaveBeenCalledTimes(1);
	});

	it("starts again once the document is forgotten", async () => {
		startLanguageServer.mockResolvedValue("/wt-root7");
		const doc = await ensureDocument("/wt7", "/wt7/a.ts");
		forgetDocument(doc as never);

		await ensureDocument("/wt7", "/wt7/a.ts");

		expect(startLanguageServer).toHaveBeenCalledTimes(2);
	});

	it("keeps other roots known when one is forgotten", async () => {
		startLanguageServer.mockResolvedValue("/root-a");
		await ensureDocument("/wt8", "/wt8/a.ts");
		forgetDocument({ serverId: "typescript", root: "/other", path: "/x.ts" });

		await ensureDocument("/wt8", "/wt8/a.ts");

		expect(startLanguageServer).toHaveBeenCalledTimes(1);
	});

	it("forgets the roots of a server that stopped, so the next tab restarts it", async () => {
		const handlers = await connectEvents();
		startLanguageServer.mockResolvedValue("/root-9");
		await ensureDocument("/wt9", "/wt9/a.ts");

		handlers["lsp-status"]({
			payload: { serverId: "typescript", root: "/root-9", status: "failed" },
		});
		await ensureDocument("/wt9", "/wt9/a.ts");

		expect(startLanguageServer).toHaveBeenCalledTimes(2);
		disposeLanguageServers();
	});

	it("forgets the roots of a server that stopped on purpose", async () => {
		const handlers = await connectEvents();
		startLanguageServer.mockResolvedValue("/root-11");
		await ensureDocument("/wt11", "/wt11/a.ts");

		handlers["lsp-status"]({
			payload: { serverId: "typescript", root: "/root-11", status: "stopped" },
		});
		await ensureDocument("/wt11", "/wt11/a.ts");

		expect(startLanguageServer).toHaveBeenCalledTimes(2);
		disposeLanguageServers();
	});

	it("keeps the roots of a server that is merely ready", async () => {
		const handlers = await connectEvents();
		startLanguageServer.mockResolvedValue("/root-10");
		await ensureDocument("/wt10", "/wt10/a.ts");

		handlers["lsp-status"]({
			payload: { serverId: "typescript", root: "/root-10", status: "ready" },
		});
		await ensureDocument("/wt10", "/wt10/a.ts");

		expect(startLanguageServer).toHaveBeenCalledTimes(1);
		disposeLanguageServers();
	});
});

describe("stopServersForWorktree", () => {
	it("drops the diagnostics inside the worktree and stops its servers", async () => {
		const handlers = await connectEvents();
		handlers["lsp-diagnostics-batch"]({
			payload: [
				{ path: "/r/gone/a.ts", diagnostics: [diagnostic("in")] },
				{ path: "/r/kept/a.ts", diagnostics: [diagnostic("out")] },
			],
		});
		await vi.waitFor(() =>
			expect(get(lspDiagnostics)["/r/kept/a.ts"]).toBeDefined(),
		);

		await stopServersForWorktree("/r/gone");

		expect(Object.keys(get(lspDiagnostics))).not.toContain("/r/gone/a.ts");
		expect(get(lspDiagnostics)["/r/kept/a.ts"]).toEqual([diagnostic("out")]);
		expect(stopLanguageServersFor).toHaveBeenCalledWith("/r/gone");
		disposeLanguageServers();
	});

	it("does not fail when the backend cannot stop them", async () => {
		stopLanguageServersFor.mockRejectedValue(new Error("boom"));
		await expect(stopServersForWorktree("/r/x")).resolves.toBeUndefined();
	});
});
