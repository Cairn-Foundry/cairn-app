// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * True when `text` still contains git conflict markers (an unresolved
 * `<<<<<<<` / `>>>>>>>` pair). Mirrors the marker detection used by the
 * editor conflict extension so callers agree on what "resolved" means.
 */
export function hasConflictMarkers(text: string): boolean {
	return /^<<<<<<</m.test(text) && /^>>>>>>>/m.test(text);
}
