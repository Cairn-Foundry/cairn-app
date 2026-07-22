import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationMessage } from "$lib/services/conversation-service";
import {
	type ConversationRef,
	conversationsOf,
	createConversation,
	instanceConversations,
	updateConversationContent,
} from "./conversation";

vi.mock("$lib/services/conversation-service", () => ({
	getConversationIndex: vi.fn().mockResolvedValue(null),
	saveConversationIndex: vi.fn().mockResolvedValue(undefined),
	getConversationBody: vi.fn().mockResolvedValue(null),
	saveConversationBody: vi.fn().mockResolvedValue(undefined),
	deleteConversationBody: vi.fn().mockResolvedValue(undefined),
}));

const ref: ConversationRef = {
	projectId: "p",
	instanceId: "i",
	scope: "instance",
};

const banner: ConversationMessage = {
	role: "system",
	content: "Instance started",
	time: "10:00",
};

function metaOf(id: string) {
	const found = conversationsOf(ref).find((c) => c.id === id);
	if (!found) throw new Error(`missing conversation ${id}`);
	return found;
}

describe("updateConversationContent", () => {
	beforeEach(() => {
		instanceConversations.set({});
		vi.useFakeTimers();
	});

	it("bumps lastMessageAt when a message is added", () => {
		const { id } = createConversation(ref, "claude-code", "New");
		const before = metaOf(id).lastMessageAt;

		vi.advanceTimersByTime(1000);
		updateConversationContent(
			ref,
			id,
			[banner, { role: "user", content: "hi", time: "10:01" }],
			[],
		);

		expect(metaOf(id).lastMessageAt).toBeGreaterThan(before);
		expect(metaOf(id).preview).toBe("hi");
	});

	it("leaves lastMessageAt alone when the same transcript is handed back", () => {
		const { id } = createConversation(ref, "claude-code", "New");
		const messages = [
			banner,
			{ role: "user" as const, content: "hi", time: "10:01" },
		];
		updateConversationContent(ref, id, messages, []);
		const after = metaOf(id).lastMessageAt;

		vi.advanceTimersByTime(5000);
		updateConversationContent(ref, id, [...messages], []);

		expect(metaOf(id).lastMessageAt).toBe(after);
	});

	it("does not float a conversation on tool activity alone", () => {
		const { id } = createConversation(ref, "claude-code", "New");
		const messages = [
			banner,
			{ role: "user" as const, content: "hi", time: "10:01" },
		];
		updateConversationContent(ref, id, messages, []);
		const after = metaOf(id).lastMessageAt;

		vi.advanceTimersByTime(5000);
		updateConversationContent(ref, id, messages, [
			{ time: "10:02", icon: "file", label: "Read: a.ts", source: "tool" },
		]);

		expect(metaOf(id).lastMessageAt).toBe(after);
	});

	it("gives a conversation holding only its banner no preview", () => {
		const { id } = createConversation(ref, "claude-code", "New");
		updateConversationContent(ref, id, [banner], []);

		expect(metaOf(id).preview).toBe("");
		expect(metaOf(id).messageCount).toBe(1);
	});
});
