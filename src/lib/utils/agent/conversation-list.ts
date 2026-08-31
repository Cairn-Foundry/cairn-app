// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Search and ordering for the conversation history panel.
//
// Search runs on the title alone: the transcript belongs to the CLI, and Cairn
// no longer keeps a preview of it to match against.
import type { ConversationMeta } from "$lib/services/conversation-service";

/** Whether a conversation matches what was typed in the search box. */
export function conversationMatches(
	meta: ConversationMeta,
	query: string,
): boolean {
	const needle = query.trim().toLowerCase();
	if (!needle) return true;
	return meta.title.toLowerCase().includes(needle);
}

/**
 * Pinned first, then most recently opened. Ordering is never manual: dragging a
 * conversation moves it between scopes, it does not reorder its group.
 */
export function sortConversations(
	list: ConversationMeta[],
): ConversationMeta[] {
	const activityOf = (c: ConversationMeta) => c.lastOpenedAt || c.createdAt;
	return [...list].sort(
		(a, b) =>
			Number(b.pinned) - Number(a.pinned) || activityOf(b) - activityOf(a),
	);
}
