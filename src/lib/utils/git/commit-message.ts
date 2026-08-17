// Turning a provider's answer into the two fields of the commit form, and
// building the prompt that asks for it.

/** The commit form's two fields, as parsed out of one block of text. */
export interface ParsedCommitMessage {
	title: string;
	body: string;
}

/**
 * A Conventional Commits subject: `type(scope)!: description`. Anchored and
 * length-bounded, so a sentence that merely contains a colon - a line of
 * reasoning, typically - is not mistaken for one.
 */
const CONVENTIONAL_SUBJECT =
	/^(?:build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(?:\([^)\n]{1,50}\))?!?: .{1,120}$/;

/**
 * Where the commit message actually starts. An agent asked for a message
 * sometimes states its reasoning first ("The convention is clear: ...") and
 * only then writes the message, which would otherwise make the reasoning the
 * subject and push the real subject into the body. When a line looks like a
 * Conventional Commits subject, the message starts there and everything above
 * it is commentary.
 *
 * Nothing is dropped when no such line exists: a project whose convention is
 * not Conventional Commits still gets its answer read from the top.
 */
function firstSubjectLine(lines: string[]): number {
	const found = lines.findIndex((line) =>
		CONVENTIONAL_SUBJECT.test(line.trim()),
	);
	return found === -1 ? 0 : found;
}

/**
 * First line is the subject, the rest is the body. A provider that answers with
 * a leading blank line, or that repeats the `Subject:` label it was given, is
 * read the same way as one that follows the instruction exactly.
 */
export function parseCommitMessage(text: string): ParsedCommitMessage {
	const lines = text.replace(/\r\n/g, "\n").split("\n");
	let index = firstSubjectLine(lines);
	while (index < lines.length && lines[index].trim() === "") index += 1;
	if (index >= lines.length) return { title: "", body: "" };

	const title = lines[index]
		.replace(/^\s*(?:subject|title)\s*:\s*/i, "")
		.trim();
	const body = lines
		.slice(index + 1)
		.join("\n")
		.replace(/^\s*\n/, "")
		.replace(/^\s*body\s*:\s*/i, "")
		.trimEnd();

	return { title, body };
}

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
