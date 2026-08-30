import { describe, expect, it } from "vitest";
import type { ConversationMeta } from "$lib/services/conversation-service";
import { conversationMatches, sortConversations } from "./conversation-list";

function meta(over: Partial<ConversationMeta> = {}): ConversationMeta {
	return {
		id: "a",
		title: "Fix the parser",
		cli: "claude-code",
		sessionId: null,
		cwd: "/repo",
		createdAt: 0,
		lastOpenedAt: 0,
		pinned: false,
		archived: false,
		...over,
	};
}

describe("conversationMatches", () => {
	it("matches the title, case-insensitively", () => {
		expect(conversationMatches(meta(), "PARSER")).toBe(true);
		expect(conversationMatches(meta(), "lexer")).toBe(false);
	});

	it("keeps everything when nothing is typed", () => {
		expect(conversationMatches(meta(), "   ")).toBe(true);
	});
});

describe("sortConversations", () => {
	it("puts pinned conversations first, whatever their age", () => {
		const sorted = sortConversations([
			meta({ id: "recent", lastOpenedAt: 100 }),
			meta({ id: "pinned", lastOpenedAt: 1, pinned: true }),
		]);
		expect(sorted.map((c) => c.id)).toEqual(["pinned", "recent"]);
	});

	it("orders the rest by when they were last opened", () => {
		const sorted = sortConversations([
			meta({ id: "old", lastOpenedAt: 1 }),
			meta({ id: "new", lastOpenedAt: 9 }),
		]);
		expect(sorted.map((c) => c.id)).toEqual(["new", "old"]);
	});

	it("falls back to creation time for a conversation never reopened", () => {
		const sorted = sortConversations([
			meta({ id: "a", createdAt: 1, lastOpenedAt: 0 }),
			meta({ id: "b", createdAt: 5, lastOpenedAt: 0 }),
		]);
		expect(sorted.map((c) => c.id)).toEqual(["b", "a"]);
	});
});
