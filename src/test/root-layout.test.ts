import { render } from "@testing-library/svelte";
import { tick } from "svelte";
import { writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

const setWindowVibrancy = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/services/settings-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	setWindowVibrancy: (...a: unknown[]) => setWindowVibrancy(...a),
}));

const setZoom = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("@tauri-apps/api/webview", () => ({
	getCurrentWebview: () => ({ setZoom: (...a: unknown[]) => setZoom(...a) }),
}));

const settingsState = writable<Record<string, unknown>>({});
vi.mock("$lib/stores/settings", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	settings: { subscribe: settingsState.subscribe },
}));

const { default: Layout } = await import("../routes/+layout.svelte");

function setSettings(overrides: Record<string, unknown> = {}) {
	settingsState.set({
		theme: "dark",
		accentColor: "#6366f1",
		fontFamily: "MonoLisa",
		uiScale: 1,
		...overrides,
	});
}

const root = () => document.documentElement;
const cssVar = (name: string) => root().style.getPropertyValue(name);

async function settle() {
	// The webview module is imported lazily, so its call lands a turn later.
	for (let i = 0; i < 6; i++) {
		await tick();
		await Promise.resolve();
	}
}

beforeEach(() => {
	setWindowVibrancy.mockReset().mockResolvedValue(undefined);
	setZoom.mockReset().mockResolvedValue(undefined);
	root().removeAttribute("data-theme");
	root().removeAttribute("data-os");
	root().style.cssText = "";
	setSettings();
});

describe("root layout", () => {
	describe("mirroring the appearance onto the document", () => {
		it("puts the theme on the document", async () => {
			render(Layout);
			await settle();
			expect(root().getAttribute("data-theme")).toBe("dark");
		});

		it("follows a theme change", async () => {
			render(Layout);
			await settle();
			setSettings({ theme: "light" });
			await settle();
			expect(root().getAttribute("data-theme")).toBe("light");
		});

		it("publishes the accent colour", async () => {
			setSettings({ accentColor: "#123456" });
			render(Layout);
			await settle();
			expect(cssVar("--accent")).toBe("#123456");
		});

		/** The accent's foreground has to stay readable on it. */
		it("publishes a foreground that reads on the accent", async () => {
			setSettings({ accentColor: "#ffffff" });
			render(Layout);
			await settle();
			expect(cssVar("--accent-fg")).not.toBe("");
			expect(cssVar("--accent-fg")).not.toBe("#ffffff");
		});

		it("publishes the chosen font to both families", async () => {
			setSettings({ fontFamily: "Fira Code" });
			render(Layout);
			await settle();
			expect(cssVar("--font-mono")).toBe("Fira Code");
			expect(cssVar("--font-ui")).toBe("Fira Code");
		});

		it("names the platform on the document", async () => {
			render(Layout);
			await settle();
			expect(["macos", "other"]).toContain(root().getAttribute("data-os"));
		});
	});

	describe("the window itself", () => {
		it("applies the interface scale to the webview", async () => {
			setSettings({ uiScale: 1.25 });
			render(Layout);
			await settle();
			expect(setZoom).toHaveBeenCalledWith(1.25);
		});

		/** Glass is the theme that asks the window for vibrancy. */
		it("turns vibrancy on for the glass theme", async () => {
			setSettings({ theme: "glass" });
			render(Layout);
			await settle();
			expect(setWindowVibrancy).toHaveBeenCalledWith(true);
		});

		it("turns it off for any other theme", async () => {
			render(Layout);
			await settle();
			expect(setWindowVibrancy).toHaveBeenCalledWith(false);
		});

		/** The native call is not free, so an unchanged value is not re-sent. */
		it("asks the window only when the value changed", async () => {
			render(Layout);
			await settle();
			setWindowVibrancy.mockClear();
			setSettings({ accentColor: "#abcdef" });
			await settle();
			expect(setWindowVibrancy).not.toHaveBeenCalled();
		});

		it("asks again once vibrancy really changes", async () => {
			render(Layout);
			await settle();
			setWindowVibrancy.mockClear();
			setSettings({ theme: "glass" });
			await settle();
			expect(setWindowVibrancy).toHaveBeenCalledWith(true);
		});

		/** A window that refuses the call must not break the layout. */
		it("survives a window that refuses", async () => {
			setWindowVibrancy.mockRejectedValue(new Error("no window"));
			setZoom.mockRejectedValue(new Error("no webview"));
			render(Layout);
			await settle();
			expect(root().getAttribute("data-theme")).toBe("dark");
		});
	});
});
