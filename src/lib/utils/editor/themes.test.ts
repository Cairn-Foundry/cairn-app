import { afterEach, describe, expect, it, vi } from "vitest";
import { availableThemes, hasTransparentWindow, THEME_OPTIONS } from "./themes";

afterEach(() => {
	vi.unstubAllGlobals();
});

/** Stages the user agent the sniffing reads. */
function onPlatform(userAgent: string) {
	vi.stubGlobal("navigator", { userAgent });
}

const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1";
const LINUX = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

describe("THEME_OPTIONS", () => {
	it("ships several themes", () => {
		expect(THEME_OPTIONS.length).toBeGreaterThan(3);
	});

	it("gives every theme a distinct id and a label", () => {
		const ids = THEME_OPTIONS.map((t) => t.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const theme of THEME_OPTIONS) {
			expect(theme.label.length, theme.id).toBeGreaterThan(0);
		}
	});

	it("offers the default theme, which settings start on", () => {
		expect(THEME_OPTIONS.map((t) => t.id)).toContain("default");
	});

	it("marks only the themes that need a see-through window", () => {
		const needy = THEME_OPTIONS.filter((t) => t.needsTransparentWindow);
		expect(needy.length).toBeGreaterThan(0);
		expect(needy.length).toBeLessThan(THEME_OPTIONS.length);
	});
});

describe("hasTransparentWindow", () => {
	it("is true on macOS, which blurs behind the window natively", () => {
		onPlatform(MAC);
		expect(hasTransparentWindow()).toBe(true);
	});

	it("is true on Linux, where the compositor does the blur", () => {
		onPlatform(LINUX);
		expect(hasTransparentWindow()).toBe(true);
	});

	it("is false on Windows", () => {
		onPlatform(WINDOWS);
		expect(hasTransparentWindow()).toBe(false);
	});

	it("is false where there is no navigator at all", () => {
		vi.stubGlobal("navigator", undefined);
		expect(hasTransparentWindow()).toBe(false);
	});
});

describe("availableThemes", () => {
	it("offers every theme where the window can be see-through", () => {
		expect(availableThemes(true)).toEqual(THEME_OPTIONS);
	});

	it("drops the themes the platform cannot render", () => {
		const offered = availableThemes(false);
		expect(offered.length).toBeLessThan(THEME_OPTIONS.length);
		expect(offered.every((t) => !t.needsTransparentWindow)).toBe(true);
	});

	it("keeps the picker's order", () => {
		const offered = availableThemes(false).map((t) => t.id);
		const expected = THEME_OPTIONS.filter((t) => !t.needsTransparentWindow).map(
			(t) => t.id,
		);
		expect(offered).toEqual(expected);
	});

	it("always keeps the default theme, whatever the platform", () => {
		for (const transparent of [true, false]) {
			expect(
				availableThemes(transparent).map((t) => t.id),
				String(transparent),
			).toContain("default");
		}
	});

	it("sniffs the platform when the caller says nothing", () => {
		onPlatform(WINDOWS);
		expect(availableThemes().every((t) => !t.needsTransparentWindow)).toBe(
			true,
		);
		onPlatform(MAC);
		expect(availableThemes()).toEqual(THEME_OPTIONS);
	});
});
