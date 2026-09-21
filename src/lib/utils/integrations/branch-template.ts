// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// The branch name derived from a ticket, through the user's template
// (`settings.branchTemplate`, default `feat/{{key}}-{{slug}}`), and the reverse:
// what a branch name says about the ticket it was cut for.

const PLACEHOLDER = /\{\{\s*(key|slug|kind)\s*\}\}/g;

export interface BranchTemplateInput {
	key: string;
	slug: string;
	kind?: string | null;
}

/** A ticket key as a branch segment: lower-case, `#123` becomes `123`, `CAIRN-42` stays `cairn-42`. */
export function branchKeySegment(key: string): string {
	return key
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

/** Every `{{key}}`, `{{slug}}`, `{{kind}}` filled in, then collapsed into a valid branch name. */
export function renderBranchTemplate(
	template: string,
	input: BranchTemplateInput,
): string {
	const values: Record<string, string> = {
		key: branchKeySegment(input.key),
		slug: input.slug,
		kind: (input.kind ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-"),
	};
	return template
		.replace(PLACEHOLDER, (_, name: string) => values[name] ?? "")
		.replace(/-{2,}/g, "-")
		.replace(/\/{2,}/g, "/")
		.replace(/(^|\/)-+|-+(?=\/|$)/g, "$1")
		.replace(/^\/+|\/+$/g, "");
}

/** A branch segment that reads as a ticket key: `PORE-3243`, `CAIRN-42`. */
const TICKET_SEGMENT = /^[a-z][a-z0-9]*-\d+$/i;

export interface TicketFromBranch {
	id: string;
	title: string;
}

/**
 * What a branch name says about the work it carries, for a branch that already
 * exists: the reverse of `renderBranchTemplate`, used to fill the ticket in
 * rather than to ask for it again.
 *
 * The id is the segment reading as a ticket key when there is one - the whole
 * point, since that is what a tracker knows the work by - and the last segment
 * of the branch otherwise. The title is that same segment read back as a
 * sentence, the separators becoming spaces. Both are suggestions: they land in
 * fields the user is looking at and can overwrite.
 */
export function ticketFromBranch(branch: string): TicketFromBranch | null {
	const segments = branch
		.split("/")
		.map((s) => s.trim())
		.filter(Boolean);
	if (segments.length === 0) return null;

	const last = segments[segments.length - 1];
	const key = segments.find((s) => TICKET_SEGMENT.test(s));
	// `PORE-3243-mikrotik-casing` holds both: the key names the ticket, the rest
	// says what it is about.
	const inKey = last.match(/^([a-z][a-z0-9]*-\d+)[-_](.+)$/i);
	const id = key ? key.toUpperCase() : inKey ? inKey[1].toUpperCase() : last;
	const words = inKey ? inKey[2] : key === last ? "" : last;
	return { id, title: deslug(words || last) };
}

/** A slug read back as a sentence: separators become spaces, the first letter grows. */
function deslug(text: string): string {
	const words = text.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
	if (!words) return "";
	return words[0].toUpperCase() + words.slice(1);
}
