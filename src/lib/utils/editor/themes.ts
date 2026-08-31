// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ThemeName } from "$lib/utils/editor/editor-theme";

/** One selectable app theme; `needsTransparentWindow` hides it where the window cannot be see-through. */
export interface ThemeOption {
	id: ThemeName;
	label: string;
	needsTransparentWindow?: boolean;
}

/** Every theme the app ships, in the order the picker lists them. */
export const THEME_OPTIONS: readonly ThemeOption[] = [
	{ id: "default", label: "Default" },
	{ id: "dark", label: "Dark" },
	{ id: "light", label: "Light" },
	{ id: "high-contrast", label: "Contrast" },
	{ id: "glass", label: "Transparent", needsTransparentWindow: true },
	{ id: "nord", label: "Nord" },
	{ id: "solarized", label: "Solarized" },
	{ id: "dracula", label: "Dracula" },
	{ id: "paper", label: "Paper" },
];

/**
 * Sniffed from the user agent, since this also runs outside the Tauri shell. macOS blurs
 * behind the window natively; on Linux the window is see-through and the blur is left to
 * the compositor (Blur my Shell on GNOME, KWin on KDE).
 */
export function hasTransparentWindow(): boolean {
	if (typeof navigator === "undefined") return false;
	return /mac|linux/i.test(navigator.userAgent);
}

/** Drops the themes this platform cannot render. */
export function availableThemes(
	transparent = hasTransparentWindow(),
): readonly ThemeOption[] {
	return THEME_OPTIONS.filter(
		(theme) => transparent || !theme.needsTransparentWindow,
	);
}
