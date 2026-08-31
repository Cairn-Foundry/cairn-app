// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$lib/services/settings-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	updateSettings: vi.fn(async (next: unknown) => next),
}));

const { settings } = await import("$lib/stores/settings");
const { ACCENT_PRESETS, FONT_OPTIONS, DEFAULT_ACCENT } = await import(
	"$lib/utils/home/appearance"
);
const { availableThemes } = await import("$lib/utils/editor/themes");
const { default: AppearanceTab } = await import(
	"$lib/components/home/settings/AppearanceTab.svelte"
);

const themeCards = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".theme-card"));
const accentPresets = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".accent-preset"));
const customAccent = () =>
	document.querySelector(".accent-preset-custom") as HTMLElement;
const fontCards = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".font-card"));
const scaleField = () =>
	document.querySelector(".settings-number-input") as HTMLInputElement;
const scaleReset = () =>
	document.querySelector(".settings-reset-btn") as HTMLElement;
const resetAll = () =>
	document.querySelector(".settings-section-reset .btn") as HTMLElement;
const active = (els: HTMLElement[]) =>
	els.filter((e) => e.classList.contains("active"));
const stored = () => {
	let value: Record<string, unknown> = {};
	settings.subscribe((s) => {
		value = s as unknown as Record<string, unknown>;
	})();
	return value;
};

/** Types a new scale and lets the change handler run. */
async function setScale(text: string) {
	await userEvent.clear(scaleField());
	await userEvent.type(scaleField(), text);
	scaleField().dispatchEvent(new Event("change", { bubbles: true }));
	await tick();
}

beforeEach(async () => {
	await settings.save({
		theme: "default",
		accentColor: DEFAULT_ACCENT,
		fontFamily: "Menlo, ui-monospace, monospace",
		uiScale: 1,
	});
});

describe("AppearanceTab", () => {
	describe("the theme", () => {
		it("offers every theme the app ships with", () => {
			render(AppearanceTab, {});
			expect(themeCards()).toHaveLength(availableThemes().length);
		});

		it("marks the theme in use, and only that one", () => {
			render(AppearanceTab, {});
			expect(active(themeCards())).toHaveLength(1);
		});

		it("stores the theme that was picked", async () => {
			render(AppearanceTab, {});
			const other = themeCards().find(
				(c) => !c.classList.contains("active"),
			) as HTMLElement;
			await userEvent.click(other);
			await tick();
			expect(stored().theme).not.toBe("default");
		});
	});

	describe("the accent colour", () => {
		it("offers the preset colours plus a free one", () => {
			render(AppearanceTab, {});
			expect(accentPresets()).toHaveLength(ACCENT_PRESETS.length + 1);
			expect(customAccent()).not.toBeNull();
		});

		it("marks the preset in use", () => {
			render(AppearanceTab, {});
			expect(active(accentPresets())).toHaveLength(1);
			expect(customAccent().classList.contains("active")).toBe(false);
		});

		it("stores the preset that was picked", async () => {
			render(AppearanceTab, {});
			const other = accentPresets().find(
				(p) =>
					!p.classList.contains("active") &&
					!p.classList.contains("accent-preset-custom"),
			) as HTMLElement;
			await userEvent.click(other);
			await tick();
			expect(stored().accentColor).not.toBe(DEFAULT_ACCENT);
		});

		/**
		 * A colour outside the presets marks the free swatch rather than leaving
		 * every preset unmarked, so the choice is still visible.
		 */
		it("marks the free swatch for a colour that is not a preset", async () => {
			await settings.save({ accentColor: "#123456" });
			render(AppearanceTab, {});
			expect(customAccent().classList.contains("active")).toBe(true);
			expect(
				active(accentPresets().filter((p) => p !== customAccent())),
			).toHaveLength(0);
		});
	});

	describe("the interface font", () => {
		it("offers every font it knows", () => {
			render(AppearanceTab, {});
			expect(fontCards()).toHaveLength(FONT_OPTIONS.length);
		});

		it("marks the font in use", () => {
			render(AppearanceTab, {});
			expect(active(fontCards())).toHaveLength(1);
		});

		/** Each card is previewed in its own face, not in the current one. */
		it("previews each font in its own face", () => {
			render(AppearanceTab, {});
			const styles = fontCards().map(
				(c) =>
					(c.querySelector(".font-card-preview") as HTMLElement).style
						.fontFamily,
			);
			expect(new Set(styles).size).toBe(styles.length);
		});

		it("stores the font that was picked", async () => {
			render(AppearanceTab, {});
			const other = fontCards().find(
				(c) => !c.classList.contains("active"),
			) as HTMLElement;
			await userEvent.click(other);
			await tick();
			expect(stored().fontFamily).not.toBe("Menlo, ui-monospace, monospace");
		});
	});

	describe("the interface scale", () => {
		it("shows the scale as a percentage", async () => {
			await settings.save({ uiScale: 1.25 });
			render(AppearanceTab, {});
			expect(scaleField().value).toBe("125");
		});

		it("stores a scale typed as a percentage", async () => {
			render(AppearanceTab, {});
			await setScale("150");
			expect(stored().uiScale).toBe(1.5);
		});

		/** A scale outside the usable range is clamped, not stored as typed. */
		it("clamps a scale that is far too large", async () => {
			render(AppearanceTab, {});
			await setScale("400");
			expect(stored().uiScale).toBe(2);
		});

		it("clamps a scale that is far too small", async () => {
			render(AppearanceTab, {});
			await setScale("10");
			expect(stored().uiScale).toBe(0.5);
		});

		/** A field cleared to nothing is not a scale of zero. */
		it("stores nothing for a field left empty", async () => {
			render(AppearanceTab, {});
			await userEvent.clear(scaleField());
			scaleField().dispatchEvent(new Event("change", { bubbles: true }));
			await tick();
			expect(stored().uiScale).toBe(1);
		});

		it("puts the scale back to normal on request", async () => {
			await settings.save({ uiScale: 1.5 });
			render(AppearanceTab, {});
			await userEvent.click(scaleReset());
			await tick();
			expect(stored().uiScale).toBe(1);
		});
	});

	describe("putting the appearance back", () => {
		it("restores the theme, the accent and the font at once", async () => {
			await settings.save({
				theme: "nord",
				accentColor: "#123456",
				fontFamily: "Comic Sans",
			});
			render(AppearanceTab, {});
			await userEvent.click(resetAll());
			await tick();
			expect(stored().theme).toBe("default");
			expect(stored().accentColor).toBe(DEFAULT_ACCENT);
			expect(stored().fontFamily).toContain("Menlo");
		});

		/** The scale is a separate choice, with its own reset. */
		it("leaves the scale alone", async () => {
			await settings.save({ uiScale: 1.5, theme: "nord" });
			render(AppearanceTab, {});
			await userEvent.click(resetAll());
			await tick();
			expect(stored().uiScale).toBe(1.5);
		});
	});
});
