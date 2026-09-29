// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// The branch name derived from a ticket, through the user's template
// (`branchTemplate`, global or overridden per project, default
// `{{kind}}/{{key}}/{{slug}}`), and the reverse: what a branch name says about
// the ticket it was cut for.

const PLACEHOLDER = /\{\{\s*(key|slug|kind)\s*\}\}/g;

export const DEFAULT_BRANCH_TEMPLATE = "{{kind}}/{{key}}/{{slug}}";

export interface BranchTemplateInput {
	key: string;
	slug: string;
	kind?: string | null;
}

/**
 * A ticket key as a branch segment. The case is the tracker's, not ours:
 * `APP-214` is how the ticket is named everywhere else - in the tracker, in
 * the merge request, in the commit trailer - and a branch that lower-cases it
 * stops matching what the user searches for. Only characters git refuses in a
 * ref are replaced, so `#123` becomes `123`.
 */
export function branchKeySegment(key: string): string {
	return key.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * Tracker issue types read back as the branch prefixes a repository actually
 * uses. A tracker says "Bug" or "User Story"; a branch says `fix` or `feat`,
 * the same words its commits use. An unknown type is kept as-is rather than
 * forced into one of these - a team with its own taxonomy is not wrong.
 */
const KIND_PREFIXES: Record<string, string> = {
	bug: "fix",
	bogue: "fix",
	defect: "fix",
	anomalie: "fix",
	incident: "fix",
	hotfix: "fix",
	story: "feat",
	"user story": "feat",
	feature: "feat",
	"nouvelle fonctionnalite": "feat",
	evolution: "feat",
	improvement: "feat",
	enhancement: "feat",
	amelioration: "feat",
	task: "feat",
	"sub-task": "feat",
	subtask: "feat",
	tache: "feat",
	epic: "feat",
	documentation: "docs",
	doc: "docs",
	chore: "chore",
	spike: "chore",
	support: "chore",
};

/**
 * What a branch prefix falls back to. A ticket typed by hand carries no issue
 * type, and a tracker may not expose one either; a branch still needs its
 * prefix, and `{{kind}}` collapsing to nothing leaves names like
 * `APP-214/drop-stale-sessions` that no repository uses.
 */
export const DEFAULT_BRANCH_KIND = "feat";

/**
 * The types a tracker hands out to everything it tracks. GitHub answers `issue`
 * or `pull_request` for every ticket it has, and GitLab defaults to `issue`, so
 * these say nothing about the nature of the work - kept as a prefix they turn
 * every GitHub and GitLab branch into `issue/...`. Treated as no type at all,
 * which is what they are.
 */
const GENERIC_KINDS = new Set([
	"issue",
	"issues",
	"pull request",
	"pull_request",
	"merge request",
	"merge_request",
	"ticket",
	"item",
	"work item",
]);

/** A tracker issue type as a branch segment, mapped to its conventional prefix. */
export function branchKindSegment(kind: string | null | undefined): string {
	const raw = deaccent((kind ?? "").trim().toLowerCase()).replace(/\s+/g, " ");
	if (!raw || GENERIC_KINDS.has(raw)) return DEFAULT_BRANCH_KIND;
	const mapped = KIND_PREFIXES[raw];
	if (mapped) return mapped;
	return (
		raw.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") ||
		DEFAULT_BRANCH_KIND
	);
}

/** Every `{{key}}`, `{{slug}}`, `{{kind}}` filled in, then collapsed into a valid branch name. */
export function renderBranchTemplate(
	template: string,
	input: BranchTemplateInput,
): string {
	const values: Record<string, string> = {
		key: branchKeySegment(input.key),
		slug: input.slug,
		kind: branchKindSegment(input.kind),
	};
	return template
		.replace(PLACEHOLDER, (_, name: string) => values[name] ?? "")
		.replace(/-{2,}/g, "-")
		.replace(/\/{2,}/g, "/")
		.replace(/(^|\/)-+|-+(?=\/|$)/g, "$1")
		.replace(/^\/+|\/+$/g, "");
}

function deaccent(text: string): string {
	return text.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Kept short enough to read at a glance in a branch list, long enough to mean something. */
const MAX_SLUG_WORDS = 6;
const MAX_SLUG_CHARS = 52;

/**
 * A ticket key leading its own summary - `[APP-214] Suppression...`,
 * `APP-214 : Suppression...` - repeated in the slug beside `{{key}}`, which
 * is exactly the doubling this avoids.
 */
function stripLeadingKey(title: string, key: string): string {
	let out = title;
	if (key.trim()) {
		const escaped = key.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		out = out.replace(new RegExp(escaped, "gi"), " ");
	}
	return out
		.replace(/^\s*[[(]?\s*[A-Za-z][A-Za-z0-9]*[-_]\d+\s*[)\]]?\s*/, " ")
		.replace(/^[\s\-–—:;,.]+/, "");
}

/**
 * The descriptive half of a branch name, derived from the ticket title with no
 * model involved: accents folded, elisions dropped, cut to a handful of words.
 * It stays in the language of the ticket - translating is a judgement call, and
 * the assisted rename is there for when the user wants one.
 *
 * Every word is kept. A list of filler words to drop would need one per
 * language Cairn ever speaks, and the words it would drop include the
 * negations: "Do not send emails to unsubscribed users" shortened to
 * `send-emails-unsubscribed-users` names the opposite of the ticket.
 */
export function titleSlug(title: string, ticketKey = ""): string {
	const words = deaccent(stripLeadingKey(title ?? "", ticketKey))
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean);
	// A one-letter word is an elision the split left behind (`l'envoi`, `d'un`)
	// or an initial; neither says anything in a branch name.
	const kept = words.filter((w) => w.length > 1).slice(0, MAX_SLUG_WORDS);
	while (kept.length > 1 && kept.join("-").length > MAX_SLUG_CHARS) kept.pop();
	return kept.join("-");
}

/**
 * A slug a model already wrote, made safe for a ref and nothing more. Passing
 * it back through `titleSlug` would rewrite its wording - the words it chose
 * are the answer, and dropping one can reverse the meaning.
 */
export function slugSegment(slug: string): string {
	return deaccent(slug ?? "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, MAX_SLUG_CHARS)
		.replace(/-+$/g, "");
}
