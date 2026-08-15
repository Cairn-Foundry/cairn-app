import type { ThemeName } from "$lib/utils/editor/editor-theme";

/** One selectable app theme; `macOnly` hides it where it cannot render. */
export interface ThemeOption {
	id: ThemeName;
	label: string;
	macOnly?: boolean;
}

/** Every theme the app ships, in the order the picker lists them. */
export const THEME_OPTIONS: readonly ThemeOption[] = [
	{ id: "default", label: "Default" },
	{ id: "dark", label: "Dark" },
	{ id: "light", label: "Light" },
	{ id: "high-contrast", label: "Contrast" },
	{ id: "glass", label: "Transparent", macOnly: true },
	{ id: "nord", label: "Nord" },
	{ id: "solarized", label: "Solarized" },
	{ id: "dracula", label: "Dracula" },
	{ id: "paper", label: "Paper" },
];

/** Sniffed from the user agent, since this also runs outside the Tauri shell. */
export function isMacOS(): boolean {
	if (typeof navigator === "undefined") return false;
	return /mac/i.test(navigator.userAgent);
}

/** Drops the themes this platform cannot render - `glass` needs macOS vibrancy. */
export function availableThemes(mac = isMacOS()): readonly ThemeOption[] {
	return THEME_OPTIONS.filter((theme) => mac || !theme.macOnly);
}
