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
	ts: new Date(2026, 0, 15, 10, 0).getTime(),
};

// Metadata is patched from the debounced write, so nothing lands until it fires.
function flushPersist() {
	vi.advanceTimersByTime(250);
}

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
			[
				banner,
				{
					role: "user",
					content: "hi",
					ts: new Date(2026, 0, 15, 10, 1).getTime(),
				},
			],
			[],
		);
		flushPersist();

		expect(metaOf(id).lastMessageAt).toBeGreaterThan(before);
		expect(metaOf(id).preview).toBe("hi");
	});

	it("leaves lastMessageAt alone when the same transcript is handed back", () => {
		const { id } = createConversation(ref, "claude-code", "New");
		const messages = [
			banner,
			{
				role: "user" as const,
				content: "hi",
				ts: new Date(2026, 0, 15, 10, 1).getTime(),
			},
		];
		updateConversationContent(ref, id, messages, []);
		flushPersist();
		const after = metaOf(id).lastMessageAt;

		vi.advanceTimersByTime(5000);
		updateConversationContent(ref, id, [...messages], []);
		flushPersist();

		expect(metaOf(id).lastMessageAt).toBe(after);
	});

	it("does not float a conversation on tool activity alone", () => {
		const { id } = createConversation(ref, "claude-code", "New");
		const messages = [
			banner,
			{
				role: "user" as const,
				content: "hi",
				ts: new Date(2026, 0, 15, 10, 1).getTime(),
			},
		];
		updateConversationContent(ref, id, messages, []);
		flushPersist();
		const after = metaOf(id).lastMessageAt;

		vi.advanceTimersByTime(5000);
		updateConversationContent(ref, id, messages, [
			{
				ts: new Date(2026, 0, 15, 10, 2).getTime(),
				icon: "file",
				label: "Read: a.ts",
				source: "tool",
			},
		]);
		flushPersist();

		expect(metaOf(id).lastMessageAt).toBe(after);
	});

	it("writes during a continuous stream instead of waiting for it to end", async () => {
		const { saveConversationBody } = await import(
			"$lib/services/conversation-service"
		);
		vi.mocked(saveConversationBody).mockClear();
		const { id } = createConversation(ref, "claude-code", "New");

		// A chunk every 100ms never lets the 250ms debounce elapse on its own.
		for (let i = 0; i < 40; i++) {
			updateConversationContent(
				ref,
				id,
				[banner, { role: "agent", content: "x".repeat(i + 1), ts: i }],
				[],
			);
			vi.advanceTimersByTime(100);
		}

		expect(vi.mocked(saveConversationBody).mock.calls.length).toBeGreaterThan(
			0,
		);
	});

	it("gives a conversation holding only its banner no preview", () => {
		const { id } = createConversation(ref, "claude-code", "New");
		updateConversationContent(ref, id, [banner], []);
		flushPersist();

		expect(metaOf(id).preview).toBe("");
		expect(metaOf(id).messageCount).toBe(1);
	});
});
