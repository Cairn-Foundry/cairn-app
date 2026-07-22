import { describe, expect, it } from "vitest";
import type {
	ConversationMessage,
	ConversationMeta,
} from "$lib/services/conversation-service";
import {
	conversationMatches,
	conversationPreview,
	conversationToMarkdown,
	deriveConversationTitle,
	markdownFileName,
	sortConversations,
} from "./conversation-export";

const MESSAGES: ConversationMessage[] = [
	{ role: "system", content: "Instance started", time: "10:00" },
	{ role: "user", content: "Fix the lexer", time: "10:01" },
	{ role: "agent", content: "Done, see **lexer.ts**", time: "10:02" },
];

function makeMeta(overrides: Partial<ConversationMeta> = {}): ConversationMeta {
	return {
		id: "c1",
		title: "Fix the parser",
		createdAt: 0,
		updatedAt: 0,
		lastMessageAt: 0,
		providerId: "claude-code",
		pinned: false,
		archived: false,
		sessionId: null,
		messageCount: 3,
		preview: "Fix the lexer",
		...overrides,
	};
}

describe("conversationToMarkdown", () => {
	it("renders a heading per message with its role and time", () => {
		expect(conversationToMarkdown("Fix the parser", MESSAGES)).toBe(
			[
				"# Fix the parser",
				"",
				"## System - 10:00",
				"",
				"Instance started",
				"",
				"## You - 10:01",
				"",
				"Fix the lexer",
				"",
				"## Agent - 10:02",
				"",
				"Done, see **lexer.ts**",
				"",
			].join("\n"),
		);
	});

	it("keeps only the title for an empty conversation", () => {
		expect(conversationToMarkdown("Fix the parser", [])).toBe(
			"# Fix the parser\n",
		);
	});
});

describe("conversationMatches", () => {
	it("matches on the title regardless of case", () => {
		expect(conversationMatches(makeMeta(), "PARSER")).toBe(true);
	});

	it("matches on the stored preview", () => {
		expect(conversationMatches(makeMeta(), "lexer")).toBe(true);
	});

	it("returns true for a blank query", () => {
		expect(conversationMatches(makeMeta(), "   ")).toBe(true);
	});

	it("returns false when nothing matches", () => {
		expect(conversationMatches(makeMeta(), "webpack")).toBe(false);
	});
});

describe("conversationPreview", () => {
	it("takes the last message and collapses whitespace", () => {
		expect(
			conversationPreview([
				{ role: "user", content: "Fix the lexer", time: "10:01" },
				{ role: "agent", content: "  Done,\n  see   lexer.ts ", time: "10:02" },
			]),
		).toBe("Done, see lexer.ts");
	});

	it("ignores system banners, so a fresh conversation has no preview", () => {
		expect(
			conversationPreview([
				{ role: "system", content: "Instance started", time: "10:00" },
			]),
		).toBe("");
	});

	it("skips a trailing message with no content yet", () => {
		expect(
			conversationPreview([
				{ role: "user", content: "Fix the lexer", time: "10:01" },
				{ role: "agent", content: "", time: "10:02", streaming: true },
			]),
		).toBe("Fix the lexer");
	});

	it("returns an empty string when there is no message", () => {
		expect(conversationPreview([])).toBe("");
	});
});

describe("deriveConversationTitle", () => {
	it("collapses whitespace", () => {
		expect(deriveConversationTitle("  add   a  test ")).toBe("add a test");
	});

	it("truncates long prompts", () => {
		expect(deriveConversationTitle("x".repeat(60))).toBe(
			`${"x".repeat(48)}...`,
		);
	});

	it("returns an empty string for a blank prompt", () => {
		expect(deriveConversationTitle("   \n ")).toBe("");
	});
});

describe("markdownFileName", () => {
	it("slugifies the title", () => {
		expect(markdownFileName("Fix the parser!")).toBe("fix-the-parser");
	});

	it("trims a trailing dash left by truncation", () => {
		expect(markdownFileName(`${"a".repeat(60)} b`)).toBe("a".repeat(60));
	});

	it("falls back when the title has nothing usable", () => {
		expect(markdownFileName("...")).toBe("conversation");
	});
});

describe("sortConversations", () => {
	const at = (id: string, lastMessageAt: number, pinned = false) =>
		makeMeta({ id, lastMessageAt, pinned });

	it("puts the most recently answered first", () => {
		const sorted = sortConversations([
			at("a", 100),
			at("c", 300),
			at("b", 200),
		]);
		expect(sorted.map((c) => c.id)).toEqual(["c", "b", "a"]);
	});

	it("keeps pinned conversations on top, sorted among themselves", () => {
		const sorted = sortConversations([
			at("a", 400),
			at("pinned-old", 100, true),
			at("pinned-new", 200, true),
		]);
		expect(sorted.map((c) => c.id)).toEqual(["pinned-new", "pinned-old", "a"]);
	});

	it("falls back to the creation date for records with no last message", () => {
		const sorted = sortConversations([
			makeMeta({ id: "old", createdAt: 100, lastMessageAt: 0 }),
			makeMeta({ id: "new", createdAt: 500, lastMessageAt: 0 }),
		]);
		expect(sorted.map((c) => c.id)).toEqual(["new", "old"]);
	});

	it("does not mutate the input", () => {
		const list = [at("a", 100), at("b", 200)];
		sortConversations(list);
		expect(list.map((c) => c.id)).toEqual(["a", "b"]);
	});
});
