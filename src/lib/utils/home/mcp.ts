import type { McpTransport } from "$lib/services/mcp-service";

/** stdio is a local process, everything else is reached over the network. */
export function transportIcon(transport: McpTransport): string {
	if (transport === "stdio") return "terminal";
	return "globe";
}

/**
 * The host is what identifies a remote server in a list; the rest of the URL is
 * plumbing. A malformed URL is shown as typed rather than hidden.
 */
export function originOf(url: string): string {
	const trimmed = url.trim();
	if (trimmed === "") return "-";
	try {
		return new URL(trimmed).host;
	} catch {
		return trimmed;
	}
}
