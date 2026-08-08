import { invoke } from "@tauri-apps/api/core";

export type ConversationScope = "instance" | "project";

export interface MessageUsage {
	model?: string;
	inputTokens?: number;
	outputTokens?: number;
	cacheReadTokens?: number;
	costUsd?: number;
	durationMs?: number;
	numTurns?: number;
}

export interface ConversationMessage {
	role: "system" | "user" | "agent";
	content: string;
	time: string;
	streaming?: boolean;
	thinking?: string;
	usage?: MessageUsage;
}

export interface ConversationActivity {
	time: string;
	icon: string;
	label: string;
	source: "stdin" | "tool" | "system";
	done?: boolean;
	failed?: boolean;
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
	sessionId: string | null;
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
