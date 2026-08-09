import type { PermissionResponse } from "$lib/services/agent-service";

export type PermissionDecision = "allow" | "always" | "deny";

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
