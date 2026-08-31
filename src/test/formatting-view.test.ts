// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	FormatterStatus,
	FormattingConfig,
	ImportReport,
	StyleOptionInfo,
} from "$lib/services/formatting-service";

const openDialog = vi.fn<(...a: unknown[]) => unknown>();
const saveDialog = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("@tauri-apps/plugin-dialog", () => ({
	open: (...a: unknown[]) => openDialog(...a),
	save: (...a: unknown[]) => saveDialog(...a),
}));

const detectRepoFormatters = vi.fn<(...a: unknown[]) => unknown>();
const exportFormattingConfig = vi.fn<(...a: unknown[]) => unknown>();
const importFormattingConfig = vi.fn<(...a: unknown[]) => unknown>();
const installFormatter = vi.fn<(...a: unknown[]) => unknown>();
const uninstallFormatter = vi.fn<(...a: unknown[]) => unknown>();
const updateFormatter = vi.fn<(...a: unknown[]) => unknown>();
const uninstallManagerForFormatter = vi.fn<(...a: unknown[]) => unknown>();
const updateManagerForFormatter = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/services/formatting-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	detectRepoFormatters: (...a: unknown[]) => detectRepoFormatters(...a),
	exportFormattingConfig: (...a: unknown[]) => exportFormattingConfig(...a),
	importFormattingConfig: (...a: unknown[]) => importFormattingConfig(...a),
	installFormatter: (...a: unknown[]) => installFormatter(...a),
	uninstallFormatter: (...a: unknown[]) => uninstallFormatter(...a),
	updateFormatter: (...a: unknown[]) => updateFormatter(...a),
	uninstallManagerForFormatter: (...a: unknown[]) =>
		uninstallManagerForFormatter(...a),
	updateManagerForFormatter: (...a: unknown[]) =>
		updateManagerForFormatter(...a),
}));

const projectConfigs = writable<Record<string, FormattingConfig>>({});
const styleOptions = writable<StyleOptionInfo[]>([]);
const formatterList = writable<FormatterStatus[]>([]);
const loadStyleOptions = vi.fn<(...a: unknown[]) => unknown>();
const loadProject = vi.fn<(...a: unknown[]) => unknown>();
const saveProject = vi.fn<(...a: unknown[]) => unknown>();
const scan = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/stores/formatting", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	formatting: {
		projects: { subscribe: projectConfigs.subscribe },
		options: { subscribe: styleOptions.subscribe },
		formatters: { subscribe: formatterList.subscribe },
		scanning: { subscribe: writable(false).subscribe },
		loadStyleOptions: (...a: unknown[]) => loadStyleOptions(...a),
		loadProject: (...a: unknown[]) => loadProject(...a),
		saveProject: (...a: unknown[]) => saveProject(...a),
		scan: (...a: unknown[]) => scan(...a),
	},
}));

const activeInstance = writable<unknown>(null);
vi.mock("$lib/stores/instance", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	activeInstance: { subscribe: activeInstance.subscribe },
}));

const { DEFAULT_FORMATTING } = await import("$lib/services/formatting-service");
const { projects, activeProjectId } = await import("$lib/stores/project");
const { project } = await import("./fixtures");
const { default: FormattingView } = await import(
	"$lib/components/formatting/FormattingView.svelte"
);

function formatter(overrides: Partial<FormatterStatus> = {}): FormatterStatus {
	return {
		id: "prettier",
		name: "Prettier",
		binary: "prettier",
		languageIds: ["javascript"],
		extensions: [".js"],
		supported: ["indentWidth"],
		configFiles: [".prettierrc"],
		docUrl: "https://prettier.io",
		toolchain: false,
		installed: true,
		binaryPath: "/usr/bin/prettier",
		version: "3.0.0",
		projectLocal: false,
		installOptions: [],
		uninstallOptions: [],
		updateOptions: [],
		...overrides,
	};
}

function option(overrides: Partial<StyleOptionInfo> = {}): StyleOptionInfo {
	return {
		id: "indentWidth",
		kind: "number",
		choices: [],
		min: 1,
		max: 8,
		default: 2,
		languages: [],
		...overrides,
	};
}

function config(overrides: Partial<FormattingConfig> = {}): FormattingConfig {
	return { ...DEFAULT_FORMATTING, ...overrides };
}

function mount() {
	render(FormattingView, { props: {} });
}

const rows = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".fmt-lang"));
const rowLabels = () =>
	rows().map((r) =>
		r.querySelector(".settings-row-label")?.textContent?.trim(),
	);
const searchField = () =>
	document.querySelector(".fmt-search-input") as HTMLInputElement;
const toggleFor = (label: RegExp) =>
	Array.from(document.querySelectorAll<HTMLElement>(".settings-toggle")).find(
		(el) => label.test(el.getAttribute("aria-label") ?? ""),
	) as HTMLElement;
const checkboxIn = (el: HTMLElement) =>
	el.querySelector('input[type="checkbox"]') as HTMLInputElement;
const buttonBy = (re: RegExp) =>
	Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
		re.test(b.textContent ?? ""),
	) as HTMLButtonElement;
const errorText = () => document.querySelector(".fmt-error")?.textContent ?? "";
const saved = () =>
	saveProject.mock.calls.at(-1)?.[1] as Partial<FormattingConfig>;

async function settle() {
	await tick();
	await tick();
	await tick();
}

/** Opens a language row, where the formatter picker and its style live. */
async function openRow(index = 0) {
	await userEvent.click(
		rows()[index].querySelector(".fmt-lang-main") as HTMLElement,
	);
	await settle();
}

beforeEach(() => {
	openDialog.mockReset().mockResolvedValue("/picked/.prettierrc");
	saveDialog.mockReset().mockResolvedValue("/out/.prettierrc");
	detectRepoFormatters.mockReset().mockResolvedValue([]);
	exportFormattingConfig.mockReset().mockResolvedValue(undefined);
	importFormattingConfig.mockReset().mockResolvedValue(null);
	installFormatter.mockReset().mockResolvedValue(undefined);
	uninstallFormatter.mockReset().mockResolvedValue(undefined);
	updateFormatter.mockReset().mockResolvedValue(undefined);
	uninstallManagerForFormatter.mockReset().mockResolvedValue("brew");
	updateManagerForFormatter.mockReset().mockResolvedValue("brew");
	loadStyleOptions.mockReset().mockResolvedValue(undefined);
	loadProject.mockReset().mockResolvedValue(undefined);
	saveProject.mockReset().mockResolvedValue(undefined);
	scan.mockReset().mockResolvedValue(undefined);
	projects.set([project("p1")]);
	activeProjectId.set("p1");
	activeInstance.set({ id: "i1", worktreePath: "/wt" });
	projectConfigs.set({ p1: config() });
	styleOptions.set([option()]);
	formatterList.set([formatter()]);
});

describe("FormattingView", () => {
	describe("loading", () => {
		it("loads the config of the open project", async () => {
			mount();
			await settle();
			expect(loadProject).toHaveBeenCalledWith("p1");
		});

		it("loads it again when the project changes", async () => {
			mount();
			await settle();
			activeProjectId.set("p2");
			projects.set([project("p1"), project("p2")]);
			await settle();
			expect(loadProject).toHaveBeenCalledTimes(2);
		});

		it("scans the machine for formatters", async () => {
			mount();
			await settle();
			expect(scan).toHaveBeenCalledWith("/wt");
		});

		it("scans again when the worktree changes", async () => {
			mount();
			await settle();
			activeInstance.set({ id: "i2", worktreePath: "/other" });
			await settle();
			expect(scan).toHaveBeenCalledTimes(2);
		});

		it("rescans on request", async () => {
			mount();
			await settle();
			scan.mockClear();
			await userEvent.click(
				document.querySelector('[aria-label="Scan again"]') as HTMLElement,
			);
			await settle();
			expect(scan).toHaveBeenCalledTimes(1);
		});

		/** Without a project there is nothing to configure. */
		it("offers no import or export with no project", async () => {
			activeProjectId.set(null);
			mount();
			await settle();
			expect(buttonBy(/import/i).disabled).toBe(true);
			expect(buttonBy(/export/i).disabled).toBe(true);
		});
	});

	describe("the behaviour switches", () => {
		it("turns formatting off", async () => {
			mount();
			await settle();
			await userEvent.click(checkboxIn(toggleFor(/^format/i)));
			await settle();
			expect(saveProject).toHaveBeenCalledWith("p1", { enabled: false });
		});

		it("turns format on save on", async () => {
			mount();
			await settle();
			await userEvent.click(
				checkboxIn(toggleFor(/on save|à l'enregistrement/i)),
			);
			await settle();
			expect(saved()).toEqual({ formatOnSave: true });
		});

		it("stops respecting the repository config", async () => {
			mount();
			await settle();
			await userEvent.click(checkboxIn(toggleFor(/repo|dépôt|repository/i)));
			await settle();
			expect(saved()).toEqual({ respectRepoConfig: false });
		});

		it("shows what the project already had set", async () => {
			projectConfigs.set({ p1: config({ formatOnSave: true }) });
			mount();
			await settle();
			expect(checkboxIn(toggleFor(/on save|à l'enregistrement/i)).checked).toBe(
				true,
			);
		});
	});

	describe("the language list", () => {
		beforeEach(() => {
			formatterList.set([
				formatter({ id: "prettier", languageIds: ["javascript"] }),
				formatter({
					id: "rustfmt",
					name: "rustfmt",
					languageIds: ["rust"],
					toolchain: true,
				}),
			]);
		});

		it("lists every language the catalogue covers", async () => {
			mount();
			await settle();
			expect(rowLabels()).toHaveLength(2);
		});

		it("keeps only the languages the search matched", async () => {
			mount();
			await settle();
			await userEvent.type(searchField(), "rust");
			await settle();
			expect(rowLabels()).toHaveLength(1);
			expect(rowLabels()[0]?.toLowerCase()).toContain("rust");
		});

		/** The formatter's name is searchable too, not only the language. */
		it("matches on the formatter's name", async () => {
			mount();
			await settle();
			await userEvent.type(searchField(), "Prettier");
			await settle();
			expect(rowLabels()).toHaveLength(1);
		});

		it("says when nothing matched", async () => {
			mount();
			await settle();
			await userEvent.type(searchField(), "zzzz");
			await settle();
			expect(document.querySelector(".fmt-empty")).not.toBeNull();
		});

		it("clears the search on request", async () => {
			mount();
			await settle();
			await userEvent.type(searchField(), "rust");
			await settle();
			await userEvent.click(
				document.querySelector(".fmt-search-clear") as HTMLElement,
			);
			await settle();
			expect(rowLabels()).toHaveLength(2);
		});

		it("opens one language at a time", async () => {
			mount();
			await settle();
			await openRow(0);
			expect(rows()[0].classList.contains("open")).toBe(true);
			await openRow(1);
			expect(rows()[0].classList.contains("open")).toBe(false);
			expect(rows()[1].classList.contains("open")).toBe(true);
		});

		it("closes the language that was open", async () => {
			mount();
			await settle();
			await openRow(0);
			await openRow(0);
			expect(rows()[0].classList.contains("open")).toBe(false);
		});
	});

	describe("installing a formatter", () => {
		beforeEach(() => {
			formatterList.set([
				formatter({
					installed: false,
					binaryPath: null,
					version: null,
					installOptions: [
						{ manager: "npm", available: false },
						{ manager: "brew", available: true },
					] as FormatterStatus["installOptions"],
				}),
			]);
		});

		/** The one-click install uses a manager this machine actually has. */
		it("installs with the manager the machine has", async () => {
			mount();
			await settle();
			await userEvent.click(buttonBy(/install/i));
			await settle();
			expect(installFormatter).toHaveBeenCalledWith("prettier", "brew");
		});

		it("rescans once the install finished", async () => {
			mount();
			await settle();
			scan.mockClear();
			await userEvent.click(buttonBy(/install/i));
			await settle();
			expect(scan).toHaveBeenCalled();
		});

		/**
		 * An install that reports success yet leaves the binary unreachable is
		 * the one failure a row cannot show by itself.
		 */
		it("reports an install that left nothing installed", async () => {
			mount();
			await settle();
			await userEvent.click(buttonBy(/install/i));
			await settle();
			expect(errorText()).toContain("brew");
		});

		it("reports nothing when the install worked", async () => {
			installFormatter.mockImplementation(async () => {
				formatterList.set([formatter({ installed: true })]);
			});
			mount();
			await settle();
			await userEvent.click(buttonBy(/install/i));
			await settle();
			expect(errorText()).toBe("");
		});

		it("reports a failed install", async () => {
			installFormatter.mockRejectedValue(new Error("network down"));
			mount();
			await settle();
			await userEvent.click(buttonBy(/install/i));
			await settle();
			expect(errorText()).toContain("network down");
		});

		/** A toolchain formatter ships with its language and is never installed. */
		it("offers no install for a toolchain formatter", async () => {
			formatterList.set([
				formatter({ toolchain: true, installed: false, binaryPath: null }),
			]);
			mount();
			await settle();
			expect(buttonBy(/install/i)).toBeUndefined();
		});
	});

	describe("removing and upgrading a formatter", () => {
		beforeEach(() => {
			formatterList.set([
				formatter({
					uninstallOptions: [
						{ manager: "brew", available: true },
					] as FormatterStatus["uninstallOptions"],
					updateOptions: [
						{ manager: "brew", available: true },
					] as FormatterStatus["updateOptions"],
				}),
			]);
		});

		it("removes the formatter with its own manager", async () => {
			mount();
			await settle();
			await openRow(0);
			await userEvent.click(
				document.querySelector(".fmt-remove") as HTMLElement,
			);
			await settle();
			expect(uninstallFormatter).toHaveBeenCalledWith("prettier", "brew");
		});

		it("removes nothing when no manager owns it", async () => {
			uninstallManagerForFormatter.mockResolvedValue(null);
			mount();
			await settle();
			await openRow(0);
			await userEvent.click(
				document.querySelector(".fmt-remove") as HTMLElement,
			);
			await settle();
			expect(uninstallFormatter).not.toHaveBeenCalled();
		});

		it("upgrades the formatter with its own manager", async () => {
			mount();
			await settle();
			await openRow(0);
			await userEvent.click(buttonBy(/update|upgrade|mettre à jour/i));
			await settle();
			expect(updateFormatter).toHaveBeenCalledWith("prettier", "brew");
		});
	});

	describe("importing a config", () => {
		it("looks at the repository again when opening", async () => {
			mount();
			await settle();
			detectRepoFormatters.mockClear();
			await userEvent.click(buttonBy(/import/i));
			await settle();
			expect(detectRepoFormatters).toHaveBeenCalledWith("/wt");
		});

		it("reports a file that could not be read", async () => {
			importFormattingConfig.mockRejectedValue(new Error("bad json"));
			mount();
			await settle();
			await userEvent.click(buttonBy(/import/i));
			await settle();
			const fromFile = buttonBy(/file|fichier|browse|parcourir/i);
			await userEvent.click(fromFile);
			await settle();
			expect(errorText()).toContain("bad json");
		});

		it("imports nothing when no file is chosen", async () => {
			openDialog.mockResolvedValue(null);
			mount();
			await settle();
			await userEvent.click(buttonBy(/import/i));
			await settle();
			await userEvent.click(buttonBy(/file|fichier|browse|parcourir/i));
			await settle();
			expect(importFormattingConfig).not.toHaveBeenCalled();
		});
	});

	describe("applying an imported style", () => {
		const report = (overrides: Partial<ImportReport> = {}): ImportReport => ({
			source: "prettier",
			style: {},
			mapped: [],
			unsupported: [],
			unknown: [],
			...overrides,
		});

		async function importAndApply(r: ImportReport) {
			importFormattingConfig.mockResolvedValue(r);
			mount();
			await settle();
			await userEvent.click(buttonBy(/import/i));
			await settle();
			await userEvent.click(buttonBy(/file|fichier|browse|parcourir/i));
			await settle();
			await userEvent.click(buttonBy(/apply|appliquer/i));
			await settle();
		}

		/** Cairn's own export carries a whole config and replaces it wholesale. */
		it("applies a Cairn export as the whole config", async () => {
			const whole = config({ formatOnSave: true });
			await importAndApply(report({ config: whole }));
			expect(saveProject).toHaveBeenCalledWith("p1", whole);
		});

		/** A universal option belongs to the common style. */
		it("puts a universal option in the common style", async () => {
			styleOptions.set([option({ id: "indentWidth", languages: [] })]);
			await importAndApply(report({ style: { indentWidth: 4 } }));
			expect(saved().base).toMatchObject({ indentWidth: 4 });
		});

		/**
		 * A language-specific option must not be pushed at every language that
		 * happens to share the common style.
		 */
		it("puts a language option on its own languages only", async () => {
			styleOptions.set([
				option({ id: "quoteStyle", kind: "enum", languages: ["javascript"] }),
			]);
			await importAndApply(report({ style: { quoteStyle: "single" } }));
			expect(saved().base).not.toHaveProperty("quoteStyle");
			expect(saved().languages).toEqual([
				expect.objectContaining({
					languageId: "javascript",
					style: { quoteStyle: "single" },
				}),
			]);
		});

		it("keeps the style a language already had", async () => {
			projectConfigs.set({
				p1: config({
					languages: [
						{
							languageId: "javascript",
							enabled: true,
							formatterId: "",
							command: "",
							args: [],
							style: { indentWidth: 2 },
						},
					],
				}),
			});
			styleOptions.set([
				option({ id: "quoteStyle", kind: "enum", languages: ["javascript"] }),
			]);
			await importAndApply(report({ style: { quoteStyle: "single" } }));
			expect(saved().languages?.[0].style).toEqual({
				indentWidth: 2,
				quoteStyle: "single",
			});
		});

		/** An option the catalogue never heard of is treated as universal. */
		it("puts an unknown option in the common style", async () => {
			styleOptions.set([option({ id: "indentWidth", languages: [] })]);
			await importAndApply(report({ style: { madeUp: 1 } }));
			expect(saved().base).toMatchObject({ madeUp: 1 });
		});
	});

	describe("exporting a config", () => {
		/** Opens the export modal, picks a target and confirms. */
		async function exportAs(file: string) {
			await userEvent.click(buttonBy(/export/i));
			await settle();
			await userEvent.click(
				document.querySelector(".select-trigger") as HTMLElement,
			);
			await settle();
			const choice = Array.from(
				document.querySelectorAll<HTMLElement>(".select-option"),
			).find((o) => o.textContent?.trim() === file) as HTMLElement;
			await userEvent.click(choice);
			await settle();
			await userEvent.click(
				document.querySelector(".modal-foot .btn.primary") as HTMLElement,
			);
			await settle();
		}

		it("writes the file the user chose", async () => {
			mount();
			await settle();
			await exportAs(".prettierrc");
			expect(exportFormattingConfig).toHaveBeenCalledTimes(1);
			expect(exportFormattingConfig.mock.calls[0][0]).toMatchObject({
				path: "/out/.prettierrc",
				target: "prettier",
			});
		});

		/** Each target has its conventional file name. */
		it("suggests the target's own file name", async () => {
			mount();
			await settle();
			await exportAs(".prettierrc");
			expect(saveDialog).toHaveBeenCalledWith({
				defaultPath: ".prettierrc",
			});
		});

		it("writes nothing when the dialog is dismissed", async () => {
			saveDialog.mockResolvedValue(null);
			mount();
			await settle();
			await exportAs(".prettierrc");
			expect(exportFormattingConfig).not.toHaveBeenCalled();
		});

		it("reports an export that failed", async () => {
			exportFormattingConfig.mockRejectedValue(new Error("read only"));
			mount();
			await settle();
			await exportAs(".prettierrc");
			expect(errorText()).toContain("read only");
		});
	});
});
