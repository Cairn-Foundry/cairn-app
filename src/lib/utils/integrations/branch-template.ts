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

/** A tracker issue type as a branch segment, mapped to its conventional prefix. */
export function branchKindSegment(kind: string | null | undefined): string {
	const raw = deaccent((kind ?? "").trim().toLowerCase()).replace(/\s+/g, " ");
	if (!raw) return DEFAULT_BRANCH_KIND;
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

/**
 * The words a title carries that say nothing about the work, in the two
 * languages Cairn speaks. Dropping them is what turns a ticket summary into a
 * branch segment a reader can size up: "Suppression des sessions expirées lors
 * de la déconnexion" says the same thing as
 * `suppression-sessions-expirees-deconnexion`, in a form a branch list can
 * show whole.
 */
const STOP_WORDS = new Set([
	"a",
	"about",
	"after",
	"all",
	"an",
	"and",
	"any",
	"are",
	"as",
	"at",
	"be",
	"been",
	"being",
	"but",
	"by",
	"can",
	"cannot",
	"do",
	"does",
	"for",
	"from",
	"has",
	"have",
	"if",
	"in",
	"into",
	"is",
	"it",
	"its",
	"must",
	"no",
	"not",
	"of",
	"on",
	"one",
	"only",
	"or",
	"our",
	"out",
	"over",
	"should",
	"so",
	"some",
	"than",
	"that",
	"the",
	"their",
	"then",
	"there",
	"these",
	"this",
	"to",
	"under",
	"up",
	"was",
	"were",
	"when",
	"which",
	"while",
	"who",
	"will",
	"with",
	"would",
	"afin",
	"apres",
	"au",
	"aussi",
	"autre",
	"aux",
	"avant",
	"avec",
	"car",
	"ce",
	"cela",
	"ces",
	"cet",
	"cette",
	"chaque",
	"comme",
	"dans",
	"de",
	"depuis",
	"des",
	"deux",
	"doit",
	"donc",
	"dont",
	"du",
	"elle",
	"elles",
	"en",
	"encore",
	"est",
	"et",
	"etre",
	"faire",
	"fait",
	"il",
	"ils",
	"je",
	"la",
	"le",
	"les",
	"leur",
	"lors",
	"lorsque",
	"lui",
	"mais",
	"meme",
	"mes",
	"moins",
	"mon",
	"ne",
	"nos",
	"notre",
	"nous",
	"ont",
	"ou",
	"par",
	"pas",
	"peut",
	"plus",
	"pour",
	"pourquoi",
	"quand",
	"que",
	"quel",
	"quelle",
	"qui",
	"sa",
	"sans",
	"se",
	"selon",
	"ses",
	"si",
	"soit",
	"son",
	"sont",
	"sous",
	"sur",
	"tous",
	"tout",
	"toute",
	"trop",
	"un",
	"une",
	"vers",
	"voir",
	"vos",
	"votre",
	"vous",
]);

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
 * model involved: accents folded, filler words dropped, cut to a handful of
 * words. It stays in the language of the ticket - translating is a judgement
 * call, and the Agent-assisted rename is there for when the user wants one.
 *
 * Dropping every word would leave a branch named after nothing, so a title made
 * only of filler keeps its words.
 */
export function titleSlug(title: string, ticketKey = ""): string {
	const words = deaccent(stripLeadingKey(title ?? "", ticketKey))
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean);
	// A one-letter word is an elision the split left behind (`l'envoi`, `d'un`)
	// or an initial; neither says anything in a branch name.
	const meaningful = words.filter((w) => w.length > 1 && !STOP_WORDS.has(w));
	const kept = (meaningful.length > 0 ? meaningful : words).slice(
		0,
		MAX_SLUG_WORDS,
	);
	while (kept.length > 1 && kept.join("-").length > MAX_SLUG_CHARS) kept.pop();
	return kept.join("-");
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
