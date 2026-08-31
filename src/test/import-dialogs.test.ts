// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	DetectedConfig,
	FormatterStatus,
} from "$lib/services/formatting-service";
import type { ImportCandidate } from "$lib/utils/commands/command-import";

const scanPackageJson = vi.fn();
vi.mock("$lib/utils/commands/command-import", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	scanPackageJson: (...a: unknown[]) => scanPackageJson(...a),
}));

const { default: CommandImport } = await import(
	"$lib/components/commands/CommandImport.svelte"
);
const { default: ImportSourceModal } = await import(
	"$lib/components/formatting/ImportSourceModal.svelte"
);

describe("CommandImport", () => {
	function candidate(name: string, script = `run ${name}`): ImportCandidate {
		return { name, script, icon: "play" };
	}

	function mount(props: Record<string, unknown> = {}) {
		const onImport = vi.fn();
		const onClose = vi.fn();
		render(CommandImport, {
			props: { dir: "/repo", ...props },
			events: {
				import: (e: CustomEvent) => onImport(e.detail),
				close: () => onClose(),
			},
		});
		return { onImport, onClose };
	}

	const rows = () =>
		Array.from(document.querySelectorAll<HTMLElement>(".ci-row"));
	const boxes = () =>
		rows().map((r) => r.querySelector("input") as HTMLInputElement);
	const names = () =>
		rows().map((r) => r.querySelector(".ci-name")?.textContent);
	const confirm = () =>
		document.querySelector(".modal-foot .btn.primary") as HTMLButtonElement;
	const allButton = () => document.querySelector(".ci-all") as HTMLElement;

	async function settle() {
		await tick();
		await tick();
	}

	beforeEach(() => {
		scanPackageJson.mockReset();
		scanPackageJson.mockResolvedValue({
			manager: "npm",
			candidates: [candidate("build"), candidate("test"), candidate("lint")],
		});
	});

	it("shows a placeholder while it scans, not a word", () => {
		scanPackageJson.mockReturnValue(new Promise(() => {}));
		mount();
		expect(document.querySelector(".skeleton, .sk-line")).not.toBeNull();
		expect(document.body.textContent?.toLowerCase()).not.toContain("loading");
	});

	it("scans the folder it was given", async () => {
		mount({ dir: "/other" });
		await settle();
		expect(scanPackageJson).toHaveBeenCalledWith("/other");
	});

	it("lists every script it found, with its command", async () => {
		mount();
		await settle();
		expect(names()).toEqual(["build", "test", "lint"]);
		expect(rows()[0].querySelector(".ci-script")?.textContent).toBe(
			"run build",
		);
	});

	it("names the package manager the project uses", async () => {
		scanPackageJson.mockResolvedValue({
			manager: "pnpm",
			candidates: [candidate("build")],
		});
		mount();
		await settle();
		expect(document.querySelector(".ci-manager")?.textContent).toBe("pnpm");
	});

	it("says so when there is nothing to import", async () => {
		scanPackageJson.mockResolvedValue({ manager: "npm", candidates: [] });
		mount();
		await settle();
		expect(rows()).toHaveLength(0);
		expect(document.querySelector(".ci-empty")).not.toBeNull();
	});

	/** Everything is preselected: importing all of them is the common case. */
	it("preselects every script it found", async () => {
		mount();
		await settle();
		expect(boxes().every((b) => b.checked)).toBe(true);
		expect(confirm().disabled).toBe(false);
	});

	it("drops a script that was unticked", async () => {
		const { onImport } = mount();
		await settle();
		await userEvent.click(boxes()[1]);
		await userEvent.click(confirm());
		expect(onImport.mock.calls[0][0]).toHaveLength(2);
		expect(
			(onImport.mock.calls[0][0] as { name: string }[]).map((c) => c.name),
		).toEqual(["build", "lint"]);
	});

	/** The same control clears everything or takes everything, by what is on. */
	it("clears the selection when everything is on", async () => {
		mount();
		await settle();
		await userEvent.click(allButton());
		expect(boxes().every((b) => !b.checked)).toBe(true);
	});

	it("takes everything when some are off", async () => {
		mount();
		await settle();
		await userEvent.click(boxes()[0]);
		await userEvent.click(allButton());
		expect(boxes().every((b) => b.checked)).toBe(true);
	});

	it("refuses to import nothing", async () => {
		const { onImport } = mount();
		await settle();
		await userEvent.click(allButton());
		expect(confirm().disabled).toBe(true);
		confirm().disabled = false;
		await userEvent.click(confirm());
		expect(onImport).not.toHaveBeenCalled();
	});

	it("imports the scripts as commands, not as raw candidates", async () => {
		const { onImport } = mount();
		await settle();
		await userEvent.click(confirm());
		const imported = onImport.mock.calls[0][0] as Record<string, unknown>[];
		expect(imported[0]).toHaveProperty("steps");
		expect(imported[0]).toHaveProperty("id");
	});

	it("closes without importing anything", async () => {
		const { onImport, onClose } = mount();
		await settle();
		await userEvent.click(
			document.querySelector(".modal-foot .btn.ghost") as HTMLElement,
		);
		expect(onClose).toHaveBeenCalled();
		expect(onImport).not.toHaveBeenCalled();
	});
});

describe("ImportSourceModal", () => {
	function detected(formatterId: string, file: string): DetectedConfig {
		return { formatterId, file };
	}

	function formatter(id: string, name: string): FormatterStatus {
		return {
			id,
			name,
			binary: id,
			languageIds: [],
			extensions: [],
			supported: [],
			configFiles: [],
			docUrl: "",
			toolchain: false,
			installed: true,
			binaryPath: null,
			version: null,
			projectLocal: false,
			installOptions: [],
			uninstallOptions: [],
			updateOptions: [],
		};
	}

	function mount(props: Record<string, unknown> = {}) {
		const onPick = vi.fn();
		const onBrowse = vi.fn();
		const onClose = vi.fn();
		render(ImportSourceModal, {
			props: { detected: [], formatters: [], scanning: false, ...props },
			events: {
				pick: (e: CustomEvent) => onPick(e.detail),
				browse: () => onBrowse(),
				close: () => onClose(),
			},
		});
		return { onPick, onBrowse, onClose };
	}

	const sources = () =>
		Array.from(document.querySelectorAll<HTMLElement>(".src-row"));
	const files = () =>
		sources().map((s) => s.querySelector(".src-file")?.textContent);
	const labels = () =>
		sources().map((s) => s.querySelector(".src-source")?.textContent);

	it("says it is looking while it scans", () => {
		mount({ scanning: true });
		expect(document.querySelector(".src-empty")).not.toBeNull();
		expect(sources()).toHaveLength(0);
	});

	it("says so when it found nothing", () => {
		mount({ detected: [], scanning: false });
		expect(document.querySelector(".src-empty")).not.toBeNull();
	});

	it("lists the config files it found", () => {
		mount({
			detected: [
				detected("prettier", ".prettierrc"),
				detected("editorconfig", ".editorconfig"),
			],
		});
		expect(files()).toEqual([".prettierrc", ".editorconfig"]);
	});

	/** The file is named by the tool that writes it, not by its raw id. */
	it("names the tool each file belongs to", () => {
		mount({
			detected: [detected("prettier", ".prettierrc")],
			formatters: [formatter("prettier", "Prettier")],
		});
		expect(labels()).toEqual(["Prettier"]);
	});

	/** EditorConfig is a source without being a formatter of the catalogue. */
	it("names EditorConfig even though it is not a formatter", () => {
		mount({ detected: [detected("editorconfig", ".editorconfig")] });
		expect(labels()).toEqual(["EditorConfig"]);
	});

	it("falls back to the id for a tool it does not know", () => {
		mount({ detected: [detected("unknown-tool", ".foorc")] });
		expect(labels()).toEqual(["unknown-tool"]);
	});

	it("picks the file that was clicked", async () => {
		const { onPick } = mount({
			detected: [
				detected("prettier", ".prettierrc"),
				detected("biome", "biome.json"),
			],
		});
		await userEvent.click(sources()[1]);
		expect(onPick).toHaveBeenCalledWith({ file: "biome.json" });
	});

	/** Nothing detected is not a dead end: a file can still be picked by hand. */
	it("offers to browse for a file even with nothing detected", async () => {
		const { onBrowse } = mount({ detected: [] });
		const browse = Array.from(
			document.querySelectorAll<HTMLElement>(".modal-foot .btn"),
		).find((b) => !b.classList.contains("ghost")) as HTMLElement;
		await userEvent.click(browse);
		expect(onBrowse).toHaveBeenCalled();
	});

	it("closes without importing anything", async () => {
		const { onPick, onClose } = mount();
		await userEvent.click(
			document.querySelector(".modal-foot .btn.ghost") as HTMLElement,
		);
		expect(onClose).toHaveBeenCalled();
		expect(onPick).not.toHaveBeenCalled();
	});

	/** The names follow the formatters being resupplied, they are not frozen. */
	it("renames the sources when the formatters arrive", async () => {
		const { rerender } = render(ImportSourceModal, {
			props: {
				detected: [detected("prettier", ".prettierrc")],
				formatters: [],
				scanning: false,
			},
		});
		expect(labels()).toEqual(["prettier"]);

		await rerender({
			detected: [detected("prettier", ".prettierrc")],
			formatters: [formatter("prettier", "Prettier")],
			scanning: false,
		});
		expect(labels()).toEqual(["Prettier"]);
	});
});
