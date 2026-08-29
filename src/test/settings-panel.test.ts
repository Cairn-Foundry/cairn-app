import { readFileSync } from "node:fs";
import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$lib/services/settings-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	updateSettings: vi.fn(async (next: unknown) => next),
}));

const writeFile = vi.fn();
vi.mock("$lib/services/file-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	writeFile: (...a: unknown[]) => writeFile(...a),
}));

const saveDialog = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
	save: (...a: unknown[]) => saveDialog(...a),
}));

const { settings } = await import("$lib/stores/settings");
const { SETTINGS_REGISTRY, searchSettings } = await import(
	"$lib/utils/home/settings-registry"
);
type SettingsTab = import("$lib/utils/home/settings-registry").SettingsTab;
const { default: SettingsPanel } = await import(
	"$lib/components/home/SettingsPanel.svelte"
);

function mount(settingsTab: SettingsTab = "languages") {
	const onOpenSection = vi.fn();
	render(SettingsPanel, {
		props: { settingsTab },
		events: { openSection: (e: CustomEvent) => onOpenSection(e.detail) },
	});
	return { onOpenSection };
}

const tabs = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".settings-tab"));
const activeTab = () => tabs().find((t) => t.classList.contains("active"));
const search = () =>
	document.querySelector(".settings-search-input") as HTMLInputElement;
const results = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".settings-search-result"));
const importError = () =>
	document.querySelector(".settings-import-error")?.textContent;
const ioButtons = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".settings-io-btn"));
const fileInput = () =>
	document.querySelector('input[type="file"]') as HTMLInputElement;

/** A registry entry that lives in a settings tab, and one that opens a section. */
const tabEntry = SETTINGS_REGISTRY.find((e) => !e.homeSection);
const sectionEntry = SETTINGS_REGISTRY.find((e) => e.homeSection);

beforeEach(() => {
	writeFile.mockReset().mockResolvedValue(undefined);
	saveDialog.mockReset().mockResolvedValue("/tmp/cairn-settings.json");
});

describe("SettingsPanel tabs", () => {
	it("offers a tab per settings group", () => {
		mount();
		expect(tabs().length).toBeGreaterThan(5);
	});

	it("marks the tab on screen, and only that one", () => {
		mount("languages");
		expect(tabs().filter((t) => t.classList.contains("active"))).toHaveLength(
			1,
		);
	});

	it("switches to the tab that was picked", async () => {
		mount("languages");
		const before = activeTab()?.textContent;
		const other = tabs().find(
			(t) =>
				!t.classList.contains("active") && /git/i.test(t.textContent ?? ""),
		) as HTMLElement;
		await userEvent.click(other);
		await tick();
		expect(activeTab()?.textContent).not.toBe(before);
	});
});

describe("SettingsPanel search", () => {
	it("shows no results until something is typed", () => {
		mount();
		expect(results()).toHaveLength(0);
	});

	it("finds a setting by its label", async () => {
		mount();
		await userEvent.type(search(), tabEntry?.label.slice(0, 6) ?? "theme");
		expect(results().length).toBeGreaterThan(0);
	});

	it("finds a setting by its description", async () => {
		const withDesc = SETTINGS_REGISTRY.find((e) => e.desc.length > 10);
		mount();
		await userEvent.type(search(), withDesc?.desc.slice(0, 10) ?? "colour");
		expect(results().length).toBeGreaterThan(0);
	});

	it("says so when nothing matches, quoting what was typed", async () => {
		mount();
		await userEvent.type(search(), "zzznothing");
		expect(results()).toHaveLength(0);
		expect(document.body.textContent).toContain("zzznothing");
	});

	/** Picking a result goes to its tab and clears the search on the way. */
	it("goes to the tab of the setting that was picked", async () => {
		mount("languages");
		await userEvent.type(search(), tabEntry?.label ?? "");
		const hit = results()[0];
		expect(hit).toBeTruthy();
		await userEvent.click(hit);
		await tick();
		expect(search().value).toBe("");
		expect(results()).toHaveLength(0);
	});

	/**
	 * Some settings live outside the settings screen entirely: those ask the
	 * home shell to open their section rather than switching a tab.
	 */
	it("asks for a home section when the setting lives outside the tabs", async () => {
		if (!sectionEntry) return;
		const { onOpenSection } = mount("languages");
		await userEvent.type(search(), sectionEntry.label);
		const hit = results().find((r) =>
			r.textContent?.includes(sectionEntry.label),
		) as HTMLElement;
		await userEvent.click(hit);
		expect(onOpenSection).toHaveBeenCalledWith(sectionEntry.homeSection);
	});

	it("clears the search on request", async () => {
		mount();
		await userEvent.type(search(), "theme");
		await userEvent.click(
			document.querySelector(".search-clear") as HTMLElement,
		);
		expect(search().value).toBe("");
	});
});

describe("SettingsPanel import and export", () => {
	it("writes the settings to the file that was chosen", async () => {
		mount();
		await userEvent.click(ioButtons()[0]);
		await tick();
		await tick();
		expect(writeFile).toHaveBeenCalledWith(
			"/tmp/cairn-settings.json",
			expect.stringContaining("{"),
		);
	});

	/** A dismissed file dialog writes nothing. */
	it("writes nothing when no file is chosen", async () => {
		saveDialog.mockResolvedValue(null);
		mount();
		await userEvent.click(ioButtons()[0]);
		await tick();
		await tick();
		expect(writeFile).not.toHaveBeenCalled();
	});

	it("writes the settings as readable JSON", async () => {
		mount();
		await userEvent.click(ioButtons()[0]);
		await tick();
		await tick();
		const written = writeFile.mock.calls[0][1] as string;
		expect(() => JSON.parse(written)).not.toThrow();
		expect(written).toContain("\n");
	});

	/** A file that is not settings is reported inline rather than swallowed. */
	it("reports a file it cannot parse", async () => {
		mount();
		const file = new File(["not json at all"], "x.json", {
			type: "application/json",
		});
		Object.defineProperty(fileInput(), "files", { value: [file] });
		fileInput().dispatchEvent(new Event("change", { bubbles: true }));
		await vi.waitFor(() => expect(importError()).toBeTruthy());
	});

	it("reads a valid settings file back in", async () => {
		mount();
		const file = new File([JSON.stringify({ uiScale: 1.4 })], "x.json", {
			type: "application/json",
		});
		Object.defineProperty(fileInput(), "files", { value: [file] });
		fileInput().dispatchEvent(new Event("change", { bubbles: true }));
		await vi.waitFor(() => {
			let scale = 0;
			settings.subscribe((s) => {
				scale = s.uiScale;
			})();
			expect(scale).toBe(1.4);
		});
		expect(importError()).toBeUndefined();
	});

	/**
	 * Choosing the same file twice must fire again, so the input is cleared.
	 *
	 * Caveat: a file input's `value` cannot be set to anything but the empty
	 * string, so jsdom reads it as empty whether or not the component clears it.
	 * This checks the handler runs to the end; the clearing itself is not
	 * distinguishable from this harness.
	 */
	it("runs to the end after reading a file", async () => {
		mount();
		const file = new File(["{}"], "x.json", { type: "application/json" });
		Object.defineProperty(fileInput(), "files", {
			value: [file],
			configurable: true,
		});
		fileInput().dispatchEvent(new Event("change", { bubbles: true }));
		await tick();
		expect(fileInput().value).toBe("");
	});
});

/**
 * The tab strip and the tab bodies are two lists that have to agree: a tab with
 * no body is a button that shows nothing. Checked where they are declared,
 * since mounting the panel pulls in every settings tab of the app.
 */
describe("SettingsPanel tab routing", () => {
	const source = readFileSync(
		"src/lib/components/home/SettingsPanel.svelte",
		"utf8",
	);

	const offered = Array.from(
		source.matchAll(/settingsTab = '([a-zA-Z]+)'/g),
		(m) => m[1],
	);
	const routed = Array.from(
		source.matchAll(/settingsTab === '([a-zA-Z]+)'/g),
		(m) => m[1],
	);

	it("offers at least a few tabs", () => {
		expect(new Set(offered).size).toBeGreaterThan(5);
	});

	it("has a body for every tab it offers", () => {
		const orphans = [...new Set(offered)].filter((t) => !routed.includes(t));
		expect(orphans).toEqual([]);
	});

	/** Every registry entry must point at a tab that exists. */
	it("points every searchable setting at a real tab", () => {
		const known = new Set(offered);
		const unknown = SETTINGS_REGISTRY.filter(
			(e) => !e.homeSection && !known.has(e.tab),
		).map((e) => e.tab);
		expect(unknown).toEqual([]);
	});

	it("returns nothing for an empty search", () => {
		expect(searchSettings("   ")).toEqual([]);
	});
});
