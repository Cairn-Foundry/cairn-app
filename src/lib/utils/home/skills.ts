// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A skill answers to its directory name, typed at a prompt as `/name`, so the
 * name has to survive being typed: lowercase, ASCII, single dashes. Mirrors
 * `slugify` in `src-tauri/src/commands/skills.rs`, which is what actually names
 * the directory - the editor only previews the outcome.
 */
export function slugifySkill(name: string): string {
	let slug = "";
	let dash = false;
	for (const char of name.trim()) {
		if (/[a-zA-Z0-9]/.test(char)) {
			slug += char.toLowerCase();
			dash = false;
		} else if (slug !== "" && !dash) {
			slug += "-";
			dash = true;
		}
	}
	return slug.replace(/-+$/, "");
}

/** The budget a description has before Claude Code stops reading it. */
export const MAX_DESCRIPTION = 1024;
