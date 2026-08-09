import type { CustomAgent } from "$lib/services/ai-provider-service";

export interface ConversationRunSettings {
	providerId: string;
	modelId: string;
	effort: string;
	permissionMode: string;
}

export interface ResolvedAgentRun {
	providerId: string;
	model: string;
	effort: string;
	permissionMode: string;
}

/** An agent with no provider of its own runs on whoever the conversation uses. */
export function isInheriting(agent: CustomAgent | undefined): boolean {
	return !agent?.providerId;
}

/**
 * What an agent run uses. Two cases, and the difference matters:
 *
 * - inheriting: everything comes from the conversation, at every call, so the
 *   agent follows it when it switches provider;
 * - pinned: the provider is the agent's, and an empty model, effort or
 *   permission falls back to that provider's own default - never to the
 *   conversation's, which names settings of a backend this run is not on.
 */
export function resolveAgentRun(
	agent: CustomAgent | undefined,
	conversation: ConversationRunSettings,
): ResolvedAgentRun {
	if (isInheriting(agent)) {
		return {
			providerId: conversation.providerId,
			model: conversation.modelId || "",
			effort: conversation.effort || "",
			permissionMode: conversation.permissionMode || "",
		};
	}
	return {
		providerId: agent?.providerId ?? "",
		model: agent?.model || "",
		effort: agent?.effort || "",
		permissionMode: agent?.permissionMode || "",
	};
}
