import type {
	AgentProviderRow,
	CustomAgent,
} from "$lib/services/ai-provider-service";

export interface ConversationRunSettings {
	modelId: string;
	effort: string;
	permissionMode: string;
}

export interface ResolvedAgentRun {
	model: string;
	effort: string;
	permissionMode: string;
}

/** The settings an agent declared for that provider, if it declared any. */
export function rowFor(
	agent: CustomAgent | undefined,
	providerId: string,
): AgentProviderRow | undefined {
	return agent?.rows?.find((r) => r.providerId === providerId);
}

/**
 * What a run uses once the agent has had its say. The provider is never part of
 * this: an agent runs on whoever the conversation is already talking to.
 *
 * A row wins over the conversation because filling one in is an explicit
 * statement about that provider; a row that leaves a field empty defers to
 * whatever the conversation picked, and an agent with no row for this provider
 * changes nothing but the prompt, tools and params it carries everywhere.
 */
export function resolveAgentRun(
	agent: CustomAgent | undefined,
	providerId: string,
	conversation: ConversationRunSettings,
): ResolvedAgentRun {
	const row = rowFor(agent, providerId);
	return {
		model: row?.model || conversation.modelId || "",
		effort: row?.effort || conversation.effort || "",
		permissionMode: row?.permissionMode || conversation.permissionMode || "",
	};
}

/** The providers an agent is tuned for, in the order they were added. */
export function agentProviderIds(agent: CustomAgent): string[] {
	return (agent.rows ?? []).map((r) => r.providerId).filter(Boolean);
}
