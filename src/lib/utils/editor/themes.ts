import type { ThemeName } from "$lib/utils/editor/editor-theme";

export interface ThemeOption {
	id: ThemeName;
	label: string;
	macOnly?: boolean;
}

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

export function isMacOS(): boolean {
	if (typeof navigator === "undefined") return false;
	return /mac/i.test(navigator.userAgent);
}

export function availableThemes(mac = isMacOS()): readonly ThemeOption[] {
	return THEME_OPTIONS.filter((theme) => mac || !theme.macOnly);
}
