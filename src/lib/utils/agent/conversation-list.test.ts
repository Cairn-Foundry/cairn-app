// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import type { ConversationMeta } from "#lib/services/conversation-service";
import {
	conversationMatches,
	conversationTooltip,
	lastActivityOf,
	sortConversations,
} from "./conversation-list";

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

describe("lastActivityOf", () => {
	it("prefers the last typing, then the last launch, then the creation", () => {
		expect(
			lastActivityOf(meta({ createdAt: 1, lastOpenedAt: 2, lastActiveAt: 3 })),
		).toBe(3);
		expect(lastActivityOf(meta({ createdAt: 1, lastOpenedAt: 2 }))).toBe(2);
		expect(lastActivityOf(meta({ createdAt: 1 }))).toBe(1);
	});
});

describe("conversationTooltip", () => {
	it("gives the full title, the CLI and both dates", () => {
		const lines = conversationTooltip(
			meta({
				title: "A title far too long to fit in the history panel",
				createdAt: Date.UTC(2026, 0, 2, 10),
				lastActiveAt: Date.UTC(2026, 0, 3, 10),
			}),
			"Claude Code",
		).split("\n");

		expect(lines[0]).toBe("A title far too long to fit in the history panel");
		expect(lines[1]).toBe("Claude Code");
		expect(lines[2]).toMatch(/2026/);
		expect(lines[3]).toMatch(/2026/);
		expect(lines).toHaveLength(4);
	});

	it("leaves the dates out of an entry that has none", () => {
		expect(
			conversationTooltip(meta({ title: "" }), "Codex").split("\n"),
		).toHaveLength(2);
	});
});
