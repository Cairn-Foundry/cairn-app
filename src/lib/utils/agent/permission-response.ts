import type { PermissionResponse } from "$lib/services/agent-service";

/** What the user answered to a tool permission prompt. */
export type PermissionDecision = "allow" | "always" | "deny";

/** A `can_use_tool` request from the CLI, waiting on the user. */
export interface PendingPermission {
	runId: string;
	requestId: string;
	toolName: string;
	displayName?: string;
	input: Record<string, unknown>;
	description?: string;
	suggestions?: unknown[];
}

/**
 * What goes back to the CLI for one `can_use_tool` request. "Always" only
 * differs by carrying the provider's own suggestions, so a permission is
 * widened with what it proposed rather than with something invented here.
 */
export function buildPermissionResponse(
	request: PendingPermission,
	decision: PermissionDecision,
	deniedMessage: string,
): PermissionResponse {
	if (decision === "deny") {
		return { behavior: "deny", message: deniedMessage };
	}
	return {
		behavior: "allow",
		updatedInput: request.input,
		...(decision === "always" && request.suggestions?.length
			? { updatedPermissions: request.suggestions }
			: {}),
	};
}
