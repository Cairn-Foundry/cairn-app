// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Search and ordering for the conversation history panel.
//
// Search runs on the title alone: the transcript belongs to the CLI, and Cairn
// no longer keeps a preview of it to match against.
import { getLocale, t } from "#lib/i18n";
import type { ConversationMeta } from "#lib/services/conversation-service";
import { relativeTime } from "#lib/utils/format";

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

/** Falls back to the last launch for entries written before activity was tracked. */
export function lastActivityOf(meta: ConversationMeta): number {
	return meta.lastActiveAt || meta.lastOpenedAt || meta.createdAt;
}

/** Date and time in the interface language, with the age beside it unless told otherwise. */
export function formatConversationDate(ts: number, withAge = true): string {
	if (!ts || !Number.isFinite(ts)) return "";
	const date = new Date(ts);
	const absolute = new Intl.DateTimeFormat(getLocale(), {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(date);
	return withAge
		? `${absolute} (${relativeTime(date.toISOString())})`
		: absolute;
}

/** The hover text of a conversation: its full title, its CLI and its dates. */
export function conversationTooltip(
	meta: ConversationMeta,
	cliLabel: string,
): string {
	const lines = [
		meta.title || (t("agent.history.untitled") as string),
		cliLabel,
	];
	const created = formatConversationDate(meta.createdAt);
	if (created) {
		lines.push(
			(t("agent.history.createdAt") as (d: string) => string)(created),
		);
	}
	const active = formatConversationDate(lastActivityOf(meta));
	if (active) {
		lines.push(
			(t("agent.history.lastActivityAt") as (d: string) => string)(active),
		);
	}
	return lines.join("\n");
}
