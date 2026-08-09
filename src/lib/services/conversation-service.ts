import { invoke } from "@tauri-apps/api/core";

export type ConversationScope = "instance" | "project";

export interface AgentBlock {
	kind: "text" | "thinking" | "tool";
	text: string;
	icon?: string;
	done?: boolean;
	failed?: boolean;
}

export interface MessageUsage {
	model?: string;
	inputTokens?: number;
	outputTokens?: number;
	cacheReadTokens?: number;
	cacheCreationTokens?: number;
	/** The window the provider itself reported for this model, when it does. */
	contextWindow?: number;
	costUsd?: number;
	durationMs?: number;
	numTurns?: number;
}

export interface ConversationMessage {
	role: "system" | "user" | "agent";
	/** The answer itself: the last text the turn produced. */
	content: string;
	time: string;
	streaming?: boolean;
	thinking?: string;
	/**
	 * What the turn did, in the order it did it. Absent on messages written
	 * before turns were recorded this way, which fall back to `content`.
	 */
	blocks?: AgentBlock[];
	/** The prompt an agent was given, kept on its answer so it reads as a reply. */
	replyTo?: string;
	/** Where that prompt sits, so the quote leads back to it. */
	replyToIndex?: number;
	/** Set on the line that acknowledges an agent was launched. */
	agentStarted?: boolean;
	usage?: MessageUsage;
}

export interface ConversationActivity {
	time: string;
	icon: string;
	label: string;
	source: "stdin" | "tool" | "system";
	done?: boolean;
	failed?: boolean;
	agentRunId?: string;
	/** The message this line stands for, so clicking it goes straight there. */
	messageIndex?: number;
}

/**
 * What one agent remembers of one conversation. Its sessions are per provider
 * for the same reason the conversation's are: an agent left on `inherit`
 * follows the conversation when it switches backend.
 */
export interface AgentThread {
	sessions: Record<string, string>;
	lastProviderId: string;
	/**
	 * How many of the conversation's messages this agent has already been told
	 * about. A message carries a display time, not a timestamp, so the delta can
	 * only be counted, not dated.
	 */
	syncedMessages: number;
	lastRunId: string;
	/** When the agent was last made to forget, so its thread can show the break. */
	contextResetAt: number;
}

export interface ConversationMeta {
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	lastMessageAt: number;
	providerId: string;
	pinned: boolean;
	archived: boolean;
	/**
	 * One session per provider: a session id only means something to the
	 * provider that minted it, and a conversation may talk to several.
	 */
	sessions: Record<string, string>;
	/**
	 * The provider that answered last here. A chat API never mints a session, so
	 * `sessions` alone cannot tell whether a provider has already spoken.
	 */
	lastProviderId: string;
	/**
	 * One thread per agent called here, keyed by agent id. An agent runs in its
	 * own process with its own context, so it never touches `sessions`.
	 */
	agentThreads: Record<string, AgentThread>;
	messageCount: number;
	preview: string;
	modelId?: string | null;
	effort?: string | null;
	permissionMode?: string | null;
}

export interface ConversationIndex {
	conversations: ConversationMeta[];
	activeId: string | null;
}

export interface ConversationBody {
	messages: ConversationMessage[];
	activity: ConversationActivity[];
}

export async function getConversationIndex(
	projectId: string,
	instanceId: string | null,
): Promise<ConversationIndex | null> {
	return await invoke("get_conversation_index", { projectId, instanceId });
}

export async function saveConversationIndex(
	projectId: string,
	instanceId: string | null,
	index: ConversationIndex,
): Promise<void> {
	await invoke("save_conversation_index", { projectId, instanceId, index });
}

export async function getConversationBody(
	projectId: string,
	instanceId: string | null,
	conversationId: string,
): Promise<ConversationBody | null> {
	return await invoke("get_conversation_body", {
		projectId,
		instanceId,
		conversationId,
	});
}

export async function saveConversationBody(
	projectId: string,
	instanceId: string | null,
	conversationId: string,
	body: ConversationBody,
): Promise<void> {
	await invoke("save_conversation_body", {
		projectId,
		instanceId,
		conversationId,
		body,
	});
}

export async function deleteConversationBody(
	projectId: string,
	instanceId: string | null,
	conversationId: string,
): Promise<void> {
	await invoke("delete_conversation_body", {
		projectId,
		instanceId,
		conversationId,
	});
}
