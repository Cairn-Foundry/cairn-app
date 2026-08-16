// Agent conversations on disk: the per-scope index and the transcripts it points
// at. A null `instanceId` addresses the project scope rather than an instance.

import { invoke } from "@tauri-apps/api/core";

/** Which of the two conversation lists a conversation belongs to. */
export type ConversationScope = "instance" | "project";

/** One step of an agent turn, in the order the provider produced it. */
export interface AgentBlock {
	/**
	 * `agent` is a subagent the provider delegated to from inside this turn. It
	 * is a block rather than a message of its own: the delegation happened at
	 * one point of the turn, and the agent that started it goes on writing
	 * afterwards - two writers appending to one transcript is what reordered it.
	 */
	kind: "text" | "thinking" | "tool" | "agent";
	text: string;
	icon?: string;
	done?: boolean;
	failed?: boolean;
	/** The provider's id for the tool call this block draws, when it has one. */
	toolId?: string;
	/** `agent` blocks: the run holding what the subagent did, and its answer. */
	agentRunId?: string;
	color?: string;
	result?: string;
	/**
	 * Which end of a delegation this block is. Starting one and finishing it are
	 * two moments of the turn, with whatever the provider wrote in between, so
	 * they are two entries - rewriting the first one would date the answer from
	 * before the work that produced it.
	 */
	phase?: "start" | "end";
}

/** What the turn cost, as far as the provider reported it. All fields optional. */
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

/** One line of the transcript, user prompt or agent turn. */
export interface ConversationMessage {
	/**
	 * Identity of the line inside its transcript, so rendering it keeps the DOM
	 * it already built instead of rebuilding the turn on every streamed chunk.
	 * Absent on messages written before it was recorded, which fall back to
	 * their position.
	 */
	id?: string;
	role: "system" | "user" | "agent";
	/** The answer itself: the last text the turn produced. */
	content: string;
	/** When the turn happened, in milliseconds. */
	ts: number;
	/**
	 * The clock face messages were stamped with before they carried a date.
	 * Read for what is already on disk, never written: "10:02" cannot be turned
	 * back into a day, so such a message keeps showing what it recorded.
	 */
	time?: string;
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

/** One entry of the activity feed shown beside the transcript. */
export interface ConversationActivity {
	/** When the line happened, in milliseconds. */
	ts: number;
	/** Legacy clock face, read for what is already on disk, never written. */
	time?: string;
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
 * A conversation as the index knows it: everything the panel lists without
 * opening the transcript. `lastMessageAt` orders the list, so it only moves
 * when the transcript itself gains something.
 */
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
	messageCount: number;
	preview: string;
	modelId?: string | null;
	effort?: string | null;
	permissionMode?: string | null;
}

/** Contents of one scope's `index.json`: metadata only, never transcripts. */
export interface ConversationIndex {
	conversations: ConversationMeta[];
	activeId: string | null;
}

/** One conversation's own file: the transcript and its activity feed. */
export interface ConversationBody {
	messages: ConversationMessage[];
	activity: ConversationActivity[];
}

/** Null when the scope has no conversations yet, which is not an error. */
export async function getConversationIndex(
	projectId: string,
	instanceId: string | null,
): Promise<ConversationIndex | null> {
	return await invoke("get_conversation_index", { projectId, instanceId });
}

/** Rewrites the whole index; transcript files are left alone. */
export async function saveConversationIndex(
	projectId: string,
	instanceId: string | null,
	index: ConversationIndex,
): Promise<void> {
	await invoke("save_conversation_index", { projectId, instanceId, index });
}

/** Reads one transcript file; null when it has never been written. */
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

/** Rewrites one transcript file; the index entry is not updated for you. */
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

/** Removes the transcript file only; drop the index entry separately. */
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
