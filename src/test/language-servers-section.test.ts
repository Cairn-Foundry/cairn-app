// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LanguageServerInfo } from "$lib/services/lsp-service";

const installLanguageServer = vi.fn<(...a: unknown[]) => unknown>();
const uninstallLanguageServer = vi.fn<(...a: unknown[]) => unknown>();
const updateLanguageServer = vi.fn<(...a: unknown[]) => unknown>();
const uninstallManagerFor = vi.fn<(...a: unknown[]) => unknown>();
const updateManagerFor = vi.fn<(...a: unknown[]) => unknown>();
const cancelLanguageServerCommand = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/services/lsp-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	installLanguageServer: (...a: unknown[]) => installLanguageServer(...a),
	uninstallLanguageServer: (...a: unknown[]) => uninstallLanguageServer(...a),
	updateLanguageServer: (...a: unknown[]) => updateLanguageServer(...a),
	uninstallManagerFor: (...a: unknown[]) => uninstallManagerFor(...a),
	updateManagerFor: (...a: unknown[]) => updateManagerFor(...a),
	cancelLanguageServerCommand: (...a: unknown[]) =>
		cancelLanguageServerCommand(...a),
}));

const infos = writable<LanguageServerInfo[]>([]);
const statuses = writable<Record<string, unknown>>({});
const managerOutput = writable<Record<string, string>>({});
const updateChecks = writable<Record<string, unknown>>({});
const refreshLanguageServers = vi.fn<(...a: unknown[]) => unknown>();
const checkForUpdates = vi.fn<(...a: unknown[]) => unknown>();
const clearUpdateCheck = vi.fn<(...a: unknown[]) => unknown>();
const clearManagerOutput = vi.fn<(...a: unknown[]) => unknown>();
const setServerEnabled = vi.fn<(...a: unknown[]) => unknown>();
const saveCustomServer = vi.fn<(...a: unknown[]) => unknown>();
const removeCustomServer = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/stores/language-server", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	languageServerInfos: { subscribe: infos.subscribe },
	languageServerStatuses: { subscribe: statuses.subscribe },
	managerOutput: { subscribe: managerOutput.subscribe },
	updateChecks: { subscribe: updateChecks.subscribe },
	refreshLanguageServers: (...a: unknown[]) => refreshLanguageServers(...a),
	checkForUpdates: (...a: unknown[]) => checkForUpdates(...a),
	clearUpdateCheck: (...a: unknown[]) => clearUpdateCheck(...a),
	clearManagerOutput: (...a: unknown[]) => clearManagerOutput(...a),
	setServerEnabled: (...a: unknown[]) => setServerEnabled(...a),
	saveCustomServer: (...a: unknown[]) => saveCustomServer(...a),
	removeCustomServer: (...a: unknown[]) => removeCustomServer(...a),
}));

const settingsState = writable<Record<string, unknown>>({});
const saveSettings = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/stores/settings", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	settings: {
		subscribe: settingsState.subscribe,
		save: (...a: unknown[]) => saveSettings(...a),
	},
}));

const activeInstance = writable<unknown>(null);
vi.mock("$lib/stores/instance", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	activeInstance: { subscribe: activeInstance.subscribe },
}));

const { COMMAND_CANCELLED } = await import("$lib/services/lsp-service");
const { default: LanguageServersSection } = await import(
	"$lib/components/home/LanguageServersSection.svelte"
);

function server(
	overrides: Partial<LanguageServerInfo> = {},
): LanguageServerInfo {
	return {
		id: "tsserver",
		name: "TypeScript",
		binary: "typescript-language-server",
		args: [],
		extensions: [".ts", ".tsx"],
		languageIds: ["typescript"],
		rootMarkers: ["package.json"],
		custom: false,
		installOptions: [],
		uninstallOptions: [],
		updateOptions: [],
		alsoRemoves: [],
		docUrl: "https://example.com",
		binaryPath: "/usr/bin/tsserver",
		version: "4.3.3",
		status: "stopped",
		runningRoot: null,
		...overrides,
	} as LanguageServerInfo;
}

function mount() {
	render(LanguageServersSection, { props: {} });
}

const rows = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".settings-row")).filter(
		(r) => r.querySelector(".ls-name"),
	);
const names = () =>
	rows().map((r) => r.querySelector(".ls-name")?.textContent?.trim());
const rowFor = (name: string) =>
	rows().find((r) =>
		r.querySelector(".ls-name")?.textContent?.includes(name),
	) as HTMLElement;
const searchField = () =>
	document.querySelector(".ls-search-input") as HTMLInputElement;
const buttonBy = (re: RegExp) =>
	Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
		re.test(b.textContent ?? ""),
	) as HTMLButtonElement;
const fallbackText = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".ls-fallback-text"))
		.map((e) => e.textContent ?? "")
		.join(" ");

async function settle() {
	for (let i = 0; i < 8; i++) await tick();
}

beforeEach(() => {
	installLanguageServer.mockReset().mockResolvedValue(undefined);
	uninstallLanguageServer.mockReset().mockResolvedValue(undefined);
	updateLanguageServer.mockReset().mockResolvedValue(undefined);
	uninstallManagerFor.mockReset().mockResolvedValue("npm");
	updateManagerFor.mockReset().mockResolvedValue("npm");
	cancelLanguageServerCommand.mockReset().mockResolvedValue(undefined);
	refreshLanguageServers.mockReset().mockResolvedValue(undefined);
	checkForUpdates.mockReset().mockResolvedValue(undefined);
	clearUpdateCheck.mockReset();
	clearManagerOutput.mockReset();
	setServerEnabled.mockReset();
	saveCustomServer.mockReset().mockResolvedValue(undefined);
	removeCustomServer.mockReset().mockResolvedValue(undefined);
	saveSettings.mockReset().mockResolvedValue(undefined);
	statuses.set({});
	managerOutput.set({});
	updateChecks.set({});
	settingsState.set({
		suggestLanguageServers: true,
		languageServers: [{ id: "tsserver", enabled: true }],
		customLanguageServers: [],
	});
	activeInstance.set({ id: "i1", worktreePath: "/wt" });
	infos.set([server()]);
});

describe("LanguageServersSection", () => {
	describe("reading the catalogue", () => {
		/** Availability depends on the worktree, so the scan is path-aware. */
		it("reads the catalogue against the open worktree", async () => {
			mount();
			await settle();
			expect(refreshLanguageServers).toHaveBeenCalledWith("/wt");
		});

		it("reads it against nothing when no instance is open", async () => {
			activeInstance.set(null);
			mount();
			await settle();
			expect(refreshLanguageServers).toHaveBeenCalledWith(null);
		});

		it("reads it again on request", async () => {
			mount();
			await settle();
			refreshLanguageServers.mockClear();
			await userEvent.click(
				document.querySelector(".ls-action.icon-only") as HTMLElement,
			);
			await settle();
			expect(refreshLanguageServers).toHaveBeenCalledTimes(1);
		});

		it("lists every server it found", async () => {
			infos.set([
				server({ id: "tsserver", name: "TypeScript" }),
				server({ id: "rust", name: "rust-analyzer" }),
			]);
			mount();
			await settle();
			expect(names()).toHaveLength(2);
		});

		it("keeps only the servers the search matched", async () => {
			infos.set([
				server({ id: "tsserver", name: "TypeScript" }),
				server({ id: "rust", name: "rust-analyzer" }),
			]);
			mount();
			await settle();
			await userEvent.type(searchField(), "rust");
			await settle();
			expect(names()).toHaveLength(1);
			expect(names()[0]).toContain("rust-analyzer");
		});

		it("clears the search on request", async () => {
			infos.set([
				server({ id: "tsserver", name: "TypeScript" }),
				server({ id: "rust", name: "rust-analyzer" }),
			]);
			mount();
			await settle();
			await userEvent.type(searchField(), "rust");
			await settle();
			await userEvent.click(
				document.querySelector(".ls-search-clear") as HTMLElement,
			);
			await settle();
			expect(names()).toHaveLength(2);
		});

		/** The live status wins over the one captured when the list was read. */
		it("shows the live status over the captured one", async () => {
			infos.set([server({ status: "stopped" })]);
			statuses.set({ "tsserver:/wt": "ready" });
			mount();
			await settle();
			expect(rowFor("TypeScript").querySelector(".ls-dot")).not.toBeNull();
		});
	});

	describe("installing", () => {
		beforeEach(() => {
			infos.set([
				server({
					binaryPath: null,
					version: null,
					installOptions: [
						{ manager: "brew", available: false },
						{ manager: "npm", available: true },
					] as LanguageServerInfo["installOptions"],
				}),
			]);
		});

		/** The one-click install uses a manager this machine actually has. */
		it("installs with the manager the machine has", async () => {
			mount();
			await settle();
			await userEvent.click(
				rowFor("TypeScript").querySelector(".ls-install") as HTMLElement,
			);
			await settle();
			expect(installLanguageServer).toHaveBeenCalledWith("tsserver", "npm");
		});

		/** A server the user installed is a server the user wants running. */
		it("switches the server on once it is installed", async () => {
			mount();
			await settle();
			await userEvent.click(
				rowFor("TypeScript").querySelector(".ls-install") as HTMLElement,
			);
			await settle();
			expect(setServerEnabled).toHaveBeenCalledWith("tsserver", true);
		});

		it("re-reads the catalogue after installing", async () => {
			mount();
			await settle();
			refreshLanguageServers.mockClear();
			await userEvent.click(
				rowFor("TypeScript").querySelector(".ls-install") as HTMLElement,
			);
			await settle();
			expect(refreshLanguageServers).toHaveBeenCalled();
		});

		it("reports a failed install", async () => {
			installLanguageServer.mockRejectedValue(new Error("network down"));
			mount();
			await settle();
			await userEvent.click(
				rowFor("TypeScript").querySelector(".ls-install") as HTMLElement,
			);
			await settle();
			expect(fallbackText()).toContain("network down");
			expect(setServerEnabled).not.toHaveBeenCalled();
		});

		/**
		 * A cancelled command is a choice, not a failure: the row must not turn
		 * red the way a real error makes it.
		 */
		it("reports nothing when the command was cancelled", async () => {
			installLanguageServer.mockRejectedValue(COMMAND_CANCELLED);
			mount();
			await settle();
			await userEvent.click(
				rowFor("TypeScript").querySelector(".ls-install") as HTMLElement,
			);
			await settle();
			expect(document.querySelector(".ls-fallback-text.danger")).toBeNull();
		});

		it("does turn the row red on a real failure", async () => {
			installLanguageServer.mockRejectedValue(new Error("network down"));
			mount();
			await settle();
			await userEvent.click(
				rowFor("TypeScript").querySelector(".ls-install") as HTMLElement,
			);
			await settle();
			expect(document.querySelector(".ls-fallback-text.danger")).not.toBeNull();
		});

		/** With no manager available the command to run by hand is shown. */
		it("shows the command to run by hand when no manager is available", async () => {
			infos.set([
				server({
					binaryPath: null,
					version: null,
					installOptions: [
						{
							manager: "npm",
							available: false,
							command: "npm i -g typescript-language-server",
						},
					] as LanguageServerInfo["installOptions"],
				}),
			]);
			mount();
			await settle();
			expect(
				document.querySelector(".ls-fallback-cmd code")?.textContent,
			).toContain("npm i -g");
			expect(
				(document.querySelector(".ls-install") as HTMLButtonElement).disabled,
			).toBe(true);
		});
	});

	describe("updating", () => {
		beforeEach(() => {
			infos.set([
				server({
					updateOptions: [
						{ manager: "npm", available: true },
					] as LanguageServerInfo["updateOptions"],
				}),
			]);
		});

		it("asks every installed server's manager on request", async () => {
			mount();
			await settle();
			await userEvent.click(buttonBy(/check.*update|vérifier/i));
			await settle();
			expect(checkForUpdates).toHaveBeenCalledWith("/wt");
		});

		it("says a server is up to date once it was checked", async () => {
			updateChecks.set({ tsserver: { outdated: false, latest: null } });
			mount();
			await settle();
			expect(rowFor("TypeScript").querySelector(".ls-badge.ok")).not.toBeNull();
		});

		/** An "up to date" verdict hides the update button, an outdated one shows it. */
		it("offers no update to a server that is up to date", async () => {
			updateChecks.set({ tsserver: { outdated: false, latest: null } });
			mount();
			await settle();
			expect(rowFor("TypeScript").querySelector(".ls-update")).toBeNull();
		});

		it("names the version an outdated server would move to", async () => {
			updateChecks.set({ tsserver: { outdated: true, latest: "5.0.0" } });
			mount();
			await settle();
			expect(
				rowFor("TypeScript").querySelector(".ls-target")?.textContent,
			).toContain("5.0.0");
		});

		it("updates through the manager that owns the binary", async () => {
			mount();
			await settle();
			await userEvent.click(
				rowFor("TypeScript").querySelector(".ls-update") as HTMLElement,
			);
			await settle();
			expect(updateLanguageServer).toHaveBeenCalledWith("tsserver", "npm");
		});

		it("updates nothing when no manager owns it", async () => {
			updateManagerFor.mockResolvedValue(null);
			mount();
			await settle();
			await userEvent.click(
				rowFor("TypeScript").querySelector(".ls-update") as HTMLElement,
			);
			await settle();
			expect(updateLanguageServer).not.toHaveBeenCalled();
		});

		/** The old verdict describes the version that has just been replaced. */
		it("drops the stale verdict after updating", async () => {
			updateChecks.set({ tsserver: { outdated: true, latest: "5.0.0" } });
			mount();
			await settle();
			await userEvent.click(
				rowFor("TypeScript").querySelector(".ls-update") as HTMLElement,
			);
			await settle();
			expect(clearUpdateCheck).toHaveBeenCalledWith("tsserver");
		});

		it("reports a failed update", async () => {
			updateLanguageServer.mockRejectedValue(new Error("no permission"));
			mount();
			await settle();
			await userEvent.click(
				rowFor("TypeScript").querySelector(".ls-update") as HTMLElement,
			);
			await settle();
			expect(fallbackText()).toContain("no permission");
		});
	});

	describe("removing", () => {
		beforeEach(() => {
			infos.set([
				server({
					uninstallOptions: [
						{ manager: "npm", available: true },
					] as LanguageServerInfo["uninstallOptions"],
				}),
			]);
		});

		it("asks before removing", async () => {
			mount();
			await settle();
			await userEvent.click(
				rowFor("TypeScript").querySelector(".ls-remove") as HTMLElement,
			);
			await settle();
			expect(uninstallLanguageServer).not.toHaveBeenCalled();
			expect(document.querySelector(".modal-backdrop")).not.toBeNull();
		});

		it("removes it once confirmed", async () => {
			mount();
			await settle();
			await userEvent.click(
				rowFor("TypeScript").querySelector(".ls-remove") as HTMLElement,
			);
			await settle();
			await userEvent.click(
				document.querySelector(".modal .btn.danger") as HTMLElement,
			);
			await settle();
			expect(uninstallLanguageServer).toHaveBeenCalledWith("tsserver", "npm");
		});

		/** A removed server has nothing left to run. */
		it("switches the server off once it is removed", async () => {
			mount();
			await settle();
			await userEvent.click(
				rowFor("TypeScript").querySelector(".ls-remove") as HTMLElement,
			);
			await settle();
			await userEvent.click(
				document.querySelector(".modal .btn.danger") as HTMLElement,
			);
			await settle();
			expect(setServerEnabled).toHaveBeenCalledWith("tsserver", false);
		});

		it("removes nothing when the question is dismissed", async () => {
			mount();
			await settle();
			await userEvent.click(
				rowFor("TypeScript").querySelector(".ls-remove") as HTMLElement,
			);
			await settle();
			await userEvent.click(
				document.querySelector(".modal .btn.ghost") as HTMLElement,
			);
			await settle();
			expect(uninstallLanguageServer).not.toHaveBeenCalled();
		});

		/**
		 * With no manager owning the binary there is no command to run, so the
		 * confirmation cannot be given. `confirmRemoval`'s own `!manager` guard
		 * is therefore unreachable through the UI - a second line of defence.
		 */
		it("cannot be confirmed when no manager owns the binary", async () => {
			uninstallManagerFor.mockResolvedValue(null);
			mount();
			await settle();
			await userEvent.click(
				rowFor("TypeScript").querySelector(".ls-remove") as HTMLElement,
			);
			await settle();
			expect(
				(document.querySelector(".modal .btn.danger") as HTMLButtonElement)
					.disabled,
			).toBe(true);
			expect(uninstallLanguageServer).not.toHaveBeenCalled();
		});
	});

	describe("switching a server on and off", () => {
		it("switches the server the user asked about", async () => {
			mount();
			await settle();
			await userEvent.click(
				rowFor("TypeScript").querySelector(
					".settings-toggle input",
				) as HTMLElement,
			);
			await settle();
			expect(setServerEnabled).toHaveBeenCalledWith("tsserver", false);
		});

		it("shows a server switched off as switched off", async () => {
			settingsState.set({
				suggestLanguageServers: true,
				languageServers: [{ id: "tsserver", enabled: false }],
				customLanguageServers: [],
			});
			mount();
			await settle();
			expect(
				(
					rowFor("TypeScript").querySelector(
						".settings-toggle input",
					) as HTMLInputElement
				).checked,
			).toBe(false);
		});

		/** A server the settings never mention is off. */
		it("treats an unknown server as switched off", async () => {
			settingsState.set({
				suggestLanguageServers: true,
				languageServers: [],
				customLanguageServers: [],
			});
			mount();
			await settle();
			expect(
				(
					rowFor("TypeScript").querySelector(
						".settings-toggle input",
					) as HTMLInputElement
				).checked,
			).toBe(false);
		});

		it("saves the suggestion setting", async () => {
			mount();
			await settle();
			await userEvent.click(
				document.querySelector(
					'.settings-toggle[aria-label="Offer a server on open"] input',
				) as HTMLElement,
			);
			await settle();
			expect(saveSettings).toHaveBeenCalledWith({
				suggestLanguageServers: false,
			});
		});
	});

	describe("the custom servers", () => {
		const custom = server({
			id: "custom-1",
			name: "My server",
			custom: true,
		});

		it("marks a user-declared server as such", async () => {
			infos.set([custom]);
			mount();
			await settle();
			expect(rowFor("My server").querySelector(".ls-tag")).not.toBeNull();
		});

		/** Cairn runs a custom server but never installs or removes its binary. */
		it("offers no install or update for a custom server", async () => {
			infos.set([custom]);
			mount();
			await settle();
			expect(rowFor("My server").querySelector(".ls-install")).toBeNull();
			expect(rowFor("My server").querySelector(".ls-update")).toBeNull();
		});

		it("says when a custom server's binary is missing", async () => {
			infos.set([{ ...custom, binaryPath: null }]);
			mount();
			await settle();
			expect(rowFor("My server").querySelector(".ls-missing")).not.toBeNull();
		});

		it("opens the editor to declare a new one", async () => {
			mount();
			await settle();
			await userEvent.click(document.querySelector(".ls-add") as HTMLElement);
			await settle();
			expect(document.querySelector(".modal-backdrop")).not.toBeNull();
		});

		it("asks before removing a custom server", async () => {
			infos.set([custom]);
			mount();
			await settle();
			await userEvent.click(
				rowFor("My server").querySelector(".ls-remove") as HTMLElement,
			);
			await settle();
			expect(removeCustomServer).not.toHaveBeenCalled();
			expect(document.querySelector(".modal-backdrop")).not.toBeNull();
		});

		it("removes it once confirmed", async () => {
			infos.set([custom]);
			mount();
			await settle();
			await userEvent.click(
				rowFor("My server").querySelector(".ls-remove") as HTMLElement,
			);
			await settle();
			await userEvent.click(
				document.querySelector(".modal .btn.danger") as HTMLElement,
			);
			await settle();
			expect(removeCustomServer).toHaveBeenCalledWith("custom-1");
			expect(refreshLanguageServers).toHaveBeenCalled();
		});
	});
});
