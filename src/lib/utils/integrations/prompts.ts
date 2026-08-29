// The prompts handed to the Agent step by the integrations: a failing CI job,
// a review comment to address, a ticket to start from. Each one renders the
// feature's template (the user's, or the default) with `{{name}}` placeholders.

import type { AiFeatureAssignment } from "$lib/services/settings-service";
import type { PipelineJob, Ticket } from "$lib/types/integrations";
import type { AiFeatureId } from "$lib/utils/home/ai-features";
import { featureDef } from "$lib/utils/home/ai-features";

const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g;

/** Every `{{name}}` replaced by its value; an unknown name expands to nothing. */
export function renderPromptTemplate(
	template: string,
	values: Record<string, string>,
): string {
	return template.replace(PLACEHOLDER, (_, name: string) => values[name] ?? "");
}

function templateOf(
	id: AiFeatureId,
	assignments?: Record<string, AiFeatureAssignment>,
): string {
	const custom = assignments?.[id]?.promptTemplate?.trim();
	return custom || (featureDef(id)?.defaultPromptTemplate ?? "");
}

/** The ticket placeholders shared by every prompt; empty strings without a ticket. */
export function ticketValues(
	ticket: Pick<Ticket, "key" | "title" | "url"> | null | undefined,
): Record<string, string> {
	return {
		"ticket.key": ticket?.key ?? "",
		"ticket.title": ticket?.title ?? "",
		"ticket.url": ticket?.url ?? "",
		ticket: ticket
			? ` The branch works on ticket ${ticket.key}: ${ticket.title}.`
			: "",
	};
}

export function buildCiFixPrompt(
	job: Pick<PipelineJob, "name">,
	excerpt: string,
	sha: string,
	assignments?: Record<string, AiFeatureAssignment>,
): string {
	return renderPromptTemplate(templateOf("ciFix", assignments), {
		job: job.name,
		sha,
		excerpt: excerpt.trim(),
	});
}

export function buildMrDescriptionPrompt(
	base: string,
	ticket: Pick<Ticket, "key" | "title" | "url"> | null,
	assignments?: Record<string, AiFeatureAssignment>,
): string {
	return renderPromptTemplate(templateOf("mrDescription", assignments), {
		base,
		...ticketValues(ticket),
	});
}

/**
 * Not a template: the ticket is quoted as is, so the agent reads the same text
 * the user reads in the ticket panel.
 */
export function buildTicketStartPrompt(
	ticket: Pick<Ticket, "key" | "title" | "description" | "url" | "labels">,
): string {
	const parts = [
		`Start working on ticket ${ticket.key}: ${ticket.title}`,
		"",
		"Description:",
		ticket.description.trim() === "" ? "(none)" : ticket.description.trim(),
	];
	if (ticket.labels.length > 0)
		parts.push("", `Labels: ${ticket.labels.join(", ")}`);
	if (ticket.url) parts.push("", `Ticket: ${ticket.url}`);
	parts.push(
		"",
		"Read the ticket, explore the worktree, and propose a plan before changing code. Ask when the acceptance criteria are unclear.",
	);
	return parts.join("\n");
}

export interface ReviewGuideInput {
	base: string;
	head: string;
	diff: string;
	truncated: boolean;
	/** The merge request title and description, when the branch has one. */
	mrTitle?: string;
	mrDescription?: string;
	ticket?: Pick<Ticket, "key" | "title"> | null;
	/** The interface language, so the guide reads in the reviewer's language. */
	language: string;
}

/**
 * The context block: merge request and ticket when they exist, nothing when the
 * branch is reviewed locally. It is the only part of the prompt that says what
 * the author meant, so it goes in whole rather than summarised.
 */
function guideContext(input: ReviewGuideInput): string {
	const parts: string[] = [];
	if (input.mrTitle?.trim())
		parts.push(`Merge request: ${input.mrTitle.trim()}`);
	if (input.mrDescription?.trim())
		parts.push(`Description:\n${input.mrDescription.trim()}`);
	if (input.ticket)
		parts.push(`Ticket ${input.ticket.key}: ${input.ticket.title}`);
	return parts.length === 0 ? "" : `\n${parts.join("\n\n")}\n`;
}

export function buildReviewGuidePrompt(
	input: ReviewGuideInput,
	assignments?: Record<string, AiFeatureAssignment>,
): string {
	return renderPromptTemplate(templateOf("reviewGuide", assignments), {
		base: input.base,
		head: input.head,
		diff: input.diff.trim(),
		context: guideContext(input),
		truncated: input.truncated
			? "\nThis diff was too large to include whole: it was cut on hunk boundaries. Say so for a file you could not read entirely rather than guessing what the rest holds.\n"
			: "",
		language: input.language,
	});
}

export interface ReviewCommentInput {
	path: string;
	line: number;
	excerpt: string;
	title: string;
	body: string;
	language: string;
}

export function buildReviewCommentPrompt(
	input: ReviewCommentInput,
	assignments?: Record<string, AiFeatureAssignment>,
): string {
	return renderPromptTemplate(templateOf("reviewComment", assignments), {
		path: input.path,
		line: String(input.line),
		excerpt: input.excerpt.trim(),
		title: input.title.trim(),
		body: input.body.trim(),
		language: input.language,
	});
}

/**
 * The shape the guide has to come back in. Hashes are absent on purpose: the
 * model produces paths and lines, the frontend attaches them to hunks.
 */
export const REVIEW_GUIDE_SCHEMA = {
	type: "object",
	required: ["overview", "chapters"],
	properties: {
		overview: { type: "string" },
		chapters: {
			type: "array",
			items: {
				type: "object",
				required: ["title", "summary", "excerpts", "remarks"],
				properties: {
					title: { type: "string" },
					summary: { type: "string" },
					excerpts: {
						type: "array",
						items: {
							type: "object",
							required: ["path", "side", "from", "to"],
							properties: {
								path: { type: "string" },
								side: { type: "string", enum: ["old", "new"] },
								from: { type: "integer" },
								to: { type: "integer" },
							},
						},
					},
					remarks: {
						type: "array",
						items: {
							type: "object",
							required: ["kind", "path", "side", "line", "title", "body"],
							properties: {
								kind: {
									type: "string",
									enum: ["issue", "question", "refactor", "note"],
								},
								path: { type: "string" },
								side: { type: "string", enum: ["old", "new"] },
								line: { type: "integer" },
								title: { type: "string" },
								body: { type: "string" },
							},
						},
					},
				},
			},
		},
	},
} as const;
