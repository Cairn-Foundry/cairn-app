/**
 * The tools a Claude Code run exposes by default. Offered as suggestions only:
 * a CLI release may add or rename one, and MCP servers contribute names of
 * their own (`mcp__server__tool`), so a hand-typed name is always accepted.
 */
export const KNOWN_TOOLS = [
	"Bash",
	"Edit",
	"Glob",
	"Grep",
	"NotebookEdit",
	"Read",
	"Task",
	"TodoWrite",
	"WebFetch",
	"WebSearch",
	"Write",
] as const;

/** Trims and drops duplicates, keeping the order the user added them in. */
export function normalizeToolList(tools: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const raw of tools) {
		const tool = raw.trim();
		if (!tool || seen.has(tool)) continue;
		seen.add(tool);
		out.push(tool);
	}
	return out;
}

/**
 * A tool listed as both allowed and denied is denied: the deny list is the
 * safety net, so it wins whenever the two disagree.
 */
export function effectiveAllowedTools(
	allowed: string[],
	disallowed: string[],
): string[] {
	const denied = new Set(disallowed.map((t) => t.trim()));
	return normalizeToolList(allowed).filter((t) => !denied.has(t));
}
