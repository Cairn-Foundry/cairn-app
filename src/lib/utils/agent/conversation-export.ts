import type {
	ConversationMessage,
	ConversationMeta,
} from "$lib/services/conversation-service";
import { messageDate } from "./message-time";

const ROLE_HEADING: Record<ConversationMessage["role"], string> = {
	system: "System",
	user: "You",
	agent: "Agent",
};

export function conversationToMarkdown(
	title: string,
	messages: ConversationMessage[],
): string {
	const lines = [`# ${title}`, ""];

	for (const message of messages) {
		// A message with nothing in it is a marker, not a turn: an agent being
		// launched, a run that was stopped before it said anything.
		const content = message.content.trim();
		if (!content) continue;
		// The full date, not the clock the app shows: an exported file is read
		// away from the conversation it came from.
		lines.push(
			`## ${ROLE_HEADING[message.role]} - ${messageDate(message)}`,
			"",
		);
		lines.push(content, "");
	}

	return `${lines.join("\n").trimEnd()}\n`;
}

export function conversationMatches(
	meta: ConversationMeta,
	query: string,
): boolean {
	const needle = query.trim().toLowerCase();
	if (!needle) return true;
	return (
		meta.title.toLowerCase().includes(needle) ||
		meta.preview.toLowerCase().includes(needle)
	);
}

export function conversationPreview(messages: ConversationMessage[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === "system") continue;
		const content = messages[i].content.replace(/\s+/g, " ").trim();
		if (content) return content.slice(0, 120);
	}
	return "";
}

export function deriveConversationTitle(prompt: string): string {
	const cleaned = prompt.replace(/\s+/g, " ").trim();
	if (!cleaned) return "";
	return cleaned.length > 48 ? `${cleaned.slice(0, 48)}...` : cleaned;
}

export function sortConversations(
	list: ConversationMeta[],
): ConversationMeta[] {
	const activityOf = (c: ConversationMeta) => c.lastMessageAt || c.createdAt;
	return [...list].sort(
		(a, b) =>
			Number(b.pinned) - Number(a.pinned) || activityOf(b) - activityOf(a),
	);
}

export function markdownFileName(title: string): string {
	const slug = title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60)
		.replace(/-+$/, "");
	return slug || "conversation";
}
