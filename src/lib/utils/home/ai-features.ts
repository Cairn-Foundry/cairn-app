// The AI assists Cairn offers outside the Agent step, and which provider serves
// each one. Adding an assist is an entry in AI_FEATURES plus its i18n pair;
// nothing else is keyed by id outside the feature's own call site.

import { CLAUDE_CODE } from "$lib/services/cli-provider-service";
import type { AiFeatureAssignment } from "$lib/services/settings-service";

export type AiFeatureId =
	| "commitMessage"
	| "testFix"
	| "mrDescription"
	| "ciFix"
	| "reviewGuide"
	| "reviewComment"
	| "ticketPlan";

interface AiFeatureDef {
	id: AiFeatureId;
	icon: string;
	/** Whether the feature runs a provider itself, or only composes a prompt. */
	runsProvider: boolean;
	/** Editable on the Features page; empty for a feature that has no template. */
	defaultPromptTemplate: string;
}

const DEFAULT_COMMIT_TEMPLATE = `Read the staged changes of this repository (git diff --staged) and write the commit message for them.

Answer with the message itself and nothing else: no preamble, no reasoning, no restating of these rules, no code fence, no quotes.
The very first character of your answer is the first character of the subject line.
Then one blank line, then the body.

Subject: Conventional Commits, \`type(scope): description\`, 80 characters maximum, imperative mood, no trailing period.{{ticket}}
Body: what changed and why, wrapped at 72 characters. Omit it entirely when the subject says everything.`;

const DEFAULT_MR_DESCRIPTION_TEMPLATE = `Read the commits of this branch (git log {{base}}..HEAD) and its diff (git diff {{base}}...HEAD), then write the merge request for them.

Answer with the merge request itself and nothing else: no preamble, no reasoning, no code fence around the whole answer.
The very first line of your answer is the title: one line, 80 characters maximum, imperative mood, no trailing period.
Then one blank line, then the description in markdown: what changed, why, and how to test it. Keep it factual and short.{{ticket}}`;

const DEFAULT_CI_FIX_TEMPLATE = `A CI job is failing on this branch. Find out why and fix it in this worktree.

Job: {{job}}
Commit: {{sha}}

Log excerpt:
\`\`\`
{{excerpt}}
\`\`\`

Reproduce the failure locally when you can, fix the cause rather than the symptom, and say what you changed.`;

const DEFAULT_REVIEW_GUIDE_TEMPLATE = `You are guiding a reviewer through a branch they did not write. Read the diff below and write the guided tour of it.

Base: {{base}}
Head: {{head}}
{{context}}
Diff:
\`\`\`diff
{{diff}}
\`\`\`
{{truncated}}
Write an overview of what the branch does, then split the change into chapters ordered the way the reviewer should read them: intention first, then what it required. A chapter is one intention, not one file - a change spread over five files is one chapter, and one file touched for two unrelated reasons is two.

For each chapter give a title, a summary of two to six lines saying what changed and why, the extracts of the diff it covers, and the remarks worth raising.

An extract is a real path and a real line range taken from the diff above. Never invent a path or a line number: an extract that is not in the diff is dropped.

A remark is anchored to one line and carries a kind: \`issue\` for something that looks wrong, \`question\` for something you cannot tell from the diff alone, \`refactor\` for something that works but could be simpler, \`note\` for something the reviewer should know. Raise what is worth a reviewer's attention, nothing for the sake of filling the list - a chapter with no remark is a fine chapter.

Write in {{language}}.`;

const DEFAULT_REVIEW_COMMENT_TEMPLATE = `Write the review comment for the remark below, as the reviewer would leave it on the merge request.

File: {{path}}
Line: {{line}}

Code:
\`\`\`
{{excerpt}}
\`\`\`

Remark: {{title}}
{{body}}

Answer with the comment itself and nothing else: no preamble, no code fence around the whole answer. Address the author directly, stay short and concrete, and say what you would like changed or ask the question plainly. Write in {{language}}.`;

const DEFAULT_TICKET_PLAN_TEMPLATE = `Here is every open ticket across the projects being worked on, grouped by project.

{{tickets}}

Write the plan of attack for this backlog as a whole.

Answer in markdown and nothing else: no preamble, no restating of these rules, no code fence around the whole answer.

Start with a short read of the situation: where the work is piling up, what is blocking what, what can be ignored for now.
Then order the tickets the way they should actually be taken on, across projects rather than project by project - a ticket that unblocks three others comes before a bigger one that unblocks nothing. Give each entry its project, its ticket key, and one line saying why it sits there.
Group tickets that should be done together in one instance when they touch the same thing, and say so.
Close with what you would leave undone, and why.

Judge only from the titles, labels and descriptions given: say when a ticket is too vague to place rather than guessing at it. Write in {{language}}.`;

export const AI_FEATURES: AiFeatureDef[] = [
	{
		id: "commitMessage",
		icon: "git",
		runsProvider: true,
		defaultPromptTemplate: DEFAULT_COMMIT_TEMPLATE,
	},
	{
		id: "testFix",
		icon: "beaker",
		runsProvider: false,
		defaultPromptTemplate: "",
	},
	{
		id: "mrDescription",
		icon: "review",
		runsProvider: true,
		defaultPromptTemplate: DEFAULT_MR_DESCRIPTION_TEMPLATE,
	},
	{
		id: "ciFix",
		icon: "ci",
		runsProvider: false,
		defaultPromptTemplate: DEFAULT_CI_FIX_TEMPLATE,
	},
	{
		id: "reviewGuide",
		icon: "review",
		runsProvider: true,
		defaultPromptTemplate: DEFAULT_REVIEW_GUIDE_TEMPLATE,
	},
	{
		id: "reviewComment",
		icon: "review",
		runsProvider: true,
		defaultPromptTemplate: DEFAULT_REVIEW_COMMENT_TEMPLATE,
	},
	{
		id: "ticketPlan",
		icon: "ticket",
		runsProvider: true,
		defaultPromptTemplate: DEFAULT_TICKET_PLAN_TEMPLATE,
	},
];

/**
 * The shape each feature's answer must take. The CLI is held to it by its own
 * schema flag, so these are constraints rather than requests: a field declared
 * here always comes back, and nothing has to be parsed out of prose.
 *
 * A feature whose answer really is one block of markdown keeps `{ answer }` -
 * a schema cannot make prose more structured than it is.
 */
export const FEATURE_SCHEMAS: Record<string, Record<string, unknown>> = {
	commitMessage: {
		type: "object",
		required: ["subject", "body"],
		additionalProperties: false,
		properties: {
			subject: { type: "string" },
			body: { type: "string" },
		},
	},
	mrDescription: {
		type: "object",
		required: ["title", "description"],
		additionalProperties: false,
		properties: {
			title: { type: "string" },
			description: { type: "string" },
		},
	},
};

export function featureDef(id: AiFeatureId): AiFeatureDef | undefined {
	return AI_FEATURES.find((f) => f.id === id);
}

/**
 * The CLIs an assist can be served by, and the one it falls back to.
 *
 * This is not the Agent step, which runs whichever CLI the user picked in a
 * terminal and reads none of its output. An assist asks one question and needs
 * the answer back in a known shape, so the list is exactly the CLIs that take a
 * JSON schema as a flag and are held to it - mirrored from `HEADLESS_CLIS` in
 * `commands/oneshot.rs`, which is the authority. A CLI that can only be asked
 * nicely in its prompt is not offered: a shape that is merely requested comes
 * back as prose often enough to show up as a silently empty commit message.
 */
export const ASSIST_CLIS = [CLAUDE_CODE, "codex"] as const;

/** The provider an assist runs on when the user pinned none. */
export const ASSIST_CLI = CLAUDE_CODE;

/**
 * Model ids offered as suggestions for a provider. Only ever a datalist, never
 * a closed list: a model released after this version has to work by typing its
 * id rather than by waiting for a release of Cairn.
 *
 * Claude Code takes the aliases it documents itself, which always name the
 * latest model of each family - so the list does not go stale as models are
 * released. Codex has no alias and no published list, so it suggests nothing
 * and leaves the field to the id the user knows they have access to; empty
 * still means "the CLI's own default", which is the right answer for most.
 */
export const MODEL_SUGGESTIONS: Record<string, string[]> = {
	[CLAUDE_CODE]: ["haiku", "sonnet", "opus", "fable"],
	codex: [],
};

/** What a feature actually runs with, once the fallbacks are applied. */
export interface ResolvedAiFeature {
	providerId: string;
	model: string;
	promptTemplate: string;
	/** The assist CLI is not on this machine, so the caller must not run it. */
	unavailable: boolean;
}

/**
 * The feature's own prompt template when it has one, the built-in default
 * otherwise. The model is whatever the user pinned for this feature; empty
 * leaves the CLI on its own default.
 */
export function resolveAiFeature(
	id: AiFeatureId,
	assignments: Record<string, AiFeatureAssignment> | undefined,
	isInstalled: (providerId: string) => boolean,
): ResolvedAiFeature {
	const assigned = assignments?.[id];
	const template = assigned?.promptTemplate?.trim()
		? assigned.promptTemplate
		: (featureDef(id)?.defaultPromptTemplate ?? "");

	const pinned = assigned?.providerId ?? "";
	// An assignment naming a CLI Cairn no longer offers degrades to the default;
	// one naming a CLI that is simply not installed does not, because an assist
	// quietly served by another model reads as if it came from the chosen one.
	const providerId = ASSIST_CLIS.includes(
		pinned as (typeof ASSIST_CLIS)[number],
	)
		? pinned
		: ASSIST_CLI;

	return {
		providerId,
		model: assigned?.model ?? "",
		promptTemplate: template,
		unavailable: !isInstalled(providerId),
	};
}
