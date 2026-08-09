import { describe, expect, it } from "vitest";
import type {
	ConversationMessage,
	ConversationMeta,
} from "$lib/services/conversation-service";
import { formatDate } from "$lib/utils/format";
import {
	conversationMatches,
	conversationPreview,
	conversationToMarkdown,
	deriveConversationTitle,
	markdownFileName,
	sortConversations,
} from "./conversation-export";

const T0 = new Date(2026, 0, 15, 10, 0, 0).getTime();
const MIN = 60_000;

const MESSAGES: ConversationMessage[] = [
	{ role: "system", content: "Instance started", ts: T0 + 0 * MIN },
	{ role: "user", content: "Fix the lexer", ts: T0 + 1 * MIN },
	{ role: "agent", content: "Done, see **lexer.ts**", ts: T0 + 2 * MIN },
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
		sessions: {},
		lastProviderId: "",
		agentThreads: {},
		messageCount: 3,
		preview: "Fix the lexer",
		...overrides,
	};
}

describe("conversationToMarkdown", () => {
	it("dates a message written before turns carried one exactly as it was written", () => {
		const markdown = conversationToMarkdown("T", [
			{ role: "user", content: "go", ts: 0, time: "10:00" },
		]);
		expect(markdown).toContain("## You - 10:00");
	});

	it("renders a heading per message with its role and date", () => {
		expect(conversationToMarkdown("Fix the parser", MESSAGES)).toBe(
			[
				"# Fix the parser",
				"",
				`## System - ${formatDate(T0)}`,
				"",
				"Instance started",
				"",
				`## You - ${formatDate(T0 + MIN)}`,
				"",
				"Fix the lexer",
				"",
				`## Agent - ${formatDate(T0 + 2 * MIN)}`,
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
				{ role: "user", content: "Fix the lexer", ts: T0 + 1 * MIN },
				{
					role: "agent",
					content: "  Done,\n  see   lexer.ts ",
					ts: T0 + 2 * MIN,
				},
			]),
		).toBe("Done, see lexer.ts");
	});

	it("ignores system banners, so a fresh conversation has no preview", () => {
		expect(
			conversationPreview([
				{ role: "system", content: "Instance started", ts: T0 + 0 * MIN },
			]),
		).toBe("");
	});

	it("skips a trailing message with no content yet", () => {
		expect(
			conversationPreview([
				{ role: "user", content: "Fix the lexer", ts: T0 + 1 * MIN },
				{ role: "agent", content: "", ts: T0 + 2 * MIN, streaming: true },
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

describe("conversationToMarkdown, empty turns", () => {
	it("leaves out a message that says nothing", () => {
		const markdown = conversationToMarkdown("T", [
			{ role: "user", content: "go", ts: T0 + 0 * MIN },
			{ role: "agent", content: "", ts: T0 + 0 * MIN },
			{ role: "agent", content: "done", ts: T0 + 1 * MIN },
		]);
		expect(markdown).toContain("done");
		expect(markdown.match(/## Agent/g)?.length).toBe(1);
	});
});
