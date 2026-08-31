// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { toHexColor } from "$lib/utils/editor/color";

const LIGHT_FG = "oklch(0.96 0.005 80)";
const DARK_FG = "oklch(0.22 0.01 60)";

function channelLuminance(channel: number): number {
	const v = channel / 255;
	return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance as WCAG defines it, from any colour `toHexColor` reads. */
export function relativeLuminance(color: string): number {
	const hex = toHexColor(color);
	const r = channelLuminance(Number.parseInt(hex.slice(1, 3), 16));
	const g = channelLuminance(Number.parseInt(hex.slice(3, 5), 16));
	const b = channelLuminance(Number.parseInt(hex.slice(5, 7), 16));
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The text drawn on the accent. A pale accent - yellow, lime, sand - carried
 * near-white text that could not be read; the fill decides its own foreground
 * rather than assuming a dark accent.
 */
export function foregroundOn(color: string): string {
	return relativeLuminance(color) > 0.45 ? DARK_FG : LIGHT_FG;
}
