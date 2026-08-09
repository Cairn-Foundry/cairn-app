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
