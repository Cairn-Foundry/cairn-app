// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CairnSettings } from "$lib/services/settings-service";

/** The custom title bar's fill, or null when it follows the theme. */
export function titleBarFillColor(
	settings: Pick<
		CairnSettings,
		"titleBarFill" | "titleBarColor" | "accentColor"
	>,
	projectColor: string | null,
): string | null {
	switch (settings.titleBarFill) {
		case "accent":
			return settings.accentColor;
		case "project":
			return projectColor;
		case "custom":
			return settings.titleBarColor || null;
		default:
			return null;
	}
}
