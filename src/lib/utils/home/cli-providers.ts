import type { CliProviderId } from "$lib/services/cli-provider-service";

/**
 * The agent ids used by the skills, MCP and agents registry are not the ones the
 * provider catalogue uses. Brand marks and provider capabilities - which models,
 * efforts and permission modes an agent accepts - are both reached through this
 * map rather than duplicated.
 */
const CATALOGUE_IDS: Record<CliProviderId, string> = {
	"claude-code": "claude-code-cli",
	codex: "codex-cli",
	copilot: "copilot-cli",
	antigravity: "antigravity-cli",
	vibe: "mistral-vibe",
};

/** Registry id to catalogue id, unchanged when the two already agree. */
export function catalogueIdOf(provider: CliProviderId): string {
	return CATALOGUE_IDS[provider] ?? provider;
}

/**
 * Sorts a provider list the way the registry declares them, so two rows never
 * show the same agents in a different order.
 */
const ORDER: CliProviderId[] = [
	"claude-code",
	"codex",
	"copilot",
	"antigravity",
	"vibe",
];

/**
 * Registry order, one entry each. Two agents can reach the same entry through
 * different paths, so a list arriving here may repeat one - and a repeated id
 * is a duplicate key in a keyed list, which is an error rather than a cosmetic
 * problem.
 */
export function sortProviders(providers: CliProviderId[]): CliProviderId[] {
	return ORDER.filter((id) => providers.includes(id));
}

/**
 * Agents that would end up written to the same file as the ones already picked.
 * Claude Code and Copilot both read a project's `.mcp.json`, and Codex,
 * Antigravity and Vibe all read `.agents/skills`, so choosing one can hand the
 * entry to another whether you asked for it or not - which is worth saying
 * before the save rather than explaining after it.
 */
export function impliedProviders(
	picked: CliProviderId[],
	reachable: CliProviderId[],
): CliProviderId[] {
	return sortProviders(reachable.filter((p) => !picked.includes(p)));
}
