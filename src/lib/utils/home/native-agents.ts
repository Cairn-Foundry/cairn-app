// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The file name is what `@name` invokes, so it has to survive being typed at a
 * prompt: lowercase, no spaces, no separators of its own. Mirrors `slugify` on
 * the Rust side, which is what actually names the file.
 */
export function agentSlug(name: string): string {
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

/**
 * The colours a definition can carry. A subagent's frontmatter holds a colour
 * *name*, not a hex, so anything outside this list would be dropped on write -
 * offering a free picker would lose the choice silently.
 */
export const AGENT_COLORS = [
	"#ef4444",
	"#f97316",
	"#eab308",
	"#22c55e",
	"#06b6d4",
	"#3b82f6",
	"#a855f7",
	"#ec4899",
] as const;

/** What the CLIs truncate a description to when they load the roster. */
export const MAX_DESCRIPTION = 1024;

/** Two letters for an avatar, taken from the first two words of the name. */
export function agentInitials(name: string): string {
	const words = name.split(/[-_\s]+/).filter(Boolean);
	if (words.length === 0) return "?";
	if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
	return (words[0][0] + words[1][0]).toUpperCase();
}
