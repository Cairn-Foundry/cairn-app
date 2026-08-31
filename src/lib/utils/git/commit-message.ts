// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Building the prompt that asks for a commit message.
//
// Nothing parses the answer: the CLI is held to a `{ subject, body }` schema by
// its own flag, so the two fields arrive as fields.

/** The ticket fields a commit template may quote verbatim. */
export interface CommitPromptTicket {
	key?: string;
	title?: string;
	url?: string;
}

/**
 * `{{ticket}}` expands to an instruction when the instance has a ticket and to
 * nothing when it does not, so a template can mention it unconditionally.
 * `{{ticket.key}}`, `{{ticket.title}}` and `{{ticket.url}}` expand to the raw
 * values of the linked ticket, empty when unknown.
 */
export function renderCommitPrompt(
	template: string,
	ticketId: string,
	ticket: CommitPromptTicket = {},
): string {
	const clause = ticketId ? ` End the subject with \`, ${ticketId}\`.` : "";
	return template
		.replaceAll("{{ticket.key}}", ticket.key ?? ticketId)
		.replaceAll("{{ticket.title}}", ticket.title ?? "")
		.replaceAll("{{ticket.url}}", ticket.url ?? "")
		.replaceAll("{{ticket}}", clause);
}
