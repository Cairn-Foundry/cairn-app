// The AI assists Cairn offers outside the Agent step, and which provider serves
// each one. Adding an assist is an entry in AI_FEATURES plus its i18n pair;
// nothing else is keyed by id outside the feature's own call site.

import { PROVIDERS } from "$lib/components/home/agents/providers-data";
import type {
	AiProvidersConfig,
	ProviderSettings,
} from "$lib/services/ai-provider-service";
import type { AiFeatureAssignment } from "$lib/services/settings-service";

export type AiFeatureId =
	| "commitMessage"
	| "testFix"
	| "mrDescription"
	| "ciFix"
	| "reviewReply";

export interface AiFeatureDef {
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

const DEFAULT_REVIEW_REPLY_TEMPLATE = `A reviewer left a comment on the merge request of this branch. Address it in this worktree.

File: {{path}}
Line: {{line}}

Code under review:
\`\`\`
{{excerpt}}
\`\`\`

Comment:
> {{comment}}

Make the change the reviewer asks for when it is right, or explain in one paragraph why the current code should stay. Say what you changed.`;

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
		id: "reviewReply",
		icon: "review",
		runsProvider: false,
		defaultPromptTemplate: DEFAULT_REVIEW_REPLY_TEMPLATE,
	},
];

export function featureDef(id: AiFeatureId): AiFeatureDef | undefined {
	return AI_FEATURES.find((f) => f.id === id);
}

/**
 * Only a CLI provider can serve a feature: it explores the worktree itself,
 * which is what lets the commit assist read the staged diff instead of being
 * handed one, and it needs no API key.
 */
/**
 * The CLI providers a picker offers, in registry order. `enabled` defaults to
 * false for everything but Claude Code - it means "configured on the Providers
 * page", not "usable" - so filtering on it would offer a single provider to
 * someone who never opened that page. What disqualifies a CLI here is being
 * unreleased, or having been switched off on purpose.
 */
export function assignableProviders(
	config: AiProvidersConfig | null,
): { id: string; name: string; settings: ProviderSettings | null }[] {
	return PROVIDERS.filter(
		(p) => p.kind === "cli" && p.status !== "coming-soon",
	).map((p) => ({
		id: p.id,
		name: p.name,
		settings: config?.providers?.[p.id] ?? null,
	}));
}

/**
 * Reading the worktree is all a generated commit message needs, and the CLIs
 * state that differently: Claude Code as an approval mode, Codex as the sandbox
 * its tools run in, Copilot as whether tools run at all. Passing one CLI's
 * vocabulary to another would either be rejected or, worse, quietly grant more
 * than intended - so each is asked in its own terms, and a CLI Cairn has no
 * read-only wording for is left on its own default.
 */
export function readOnlyPermissionMode(providerId: string): string {
	switch (providerId) {
		case "claude-code-cli":
			return "dontAsk";
		case "codex-cli":
			return "read-only";
		case "copilot-cli":
			return "ask";
		case "mistral-vibe":
			return "plan";
		default:
			return "";
	}
}

/**
 * The tools a read-only assist may use, in the CLI's own naming. Only Claude
 * Code models a tool grant finely enough to say "the shell, but only these git
 * reads"; Copilot names one whole tool per flag, so granting it the shell would
 * hand over more than the default does. Every other CLI is confined by its
 * permission mode alone, which is why an empty list is the right answer rather
 * than a guessed one.
 */
export function readOnlyTools(providerId: string): string[] {
	if (providerId !== "claude-code-cli") return [];
	return [
		"Read",
		"Grep",
		"Glob",
		"Bash(git diff:*)",
		"Bash(git status:*)",
		"Bash(git log:*)",
	];
}

/** What a feature actually runs with, once fallbacks are applied. */
export interface ResolvedAiFeature {
	providerId: string;
	model: string;
	promptTemplate: string;
	/** No CLI provider is usable, so the caller must not attempt a run. */
	unavailable: boolean;
}

/**
 * An assignment left behind by a provider that was since disabled, removed or
 * switched to an API degrades to the default provider rather than failing at
 * run time. When even that is not a usable CLI, the first enabled CLI is taken,
 * and only an empty list reports `unavailable`.
 */
export function resolveAiFeature(
	id: AiFeatureId,
	assignments: Record<string, AiFeatureAssignment> | undefined,
	config: AiProvidersConfig | null,
): ResolvedAiFeature {
	const assigned = assignments?.[id];
	const available = assignableProviders(config);
	const usable = (candidate: string) =>
		candidate !== "" && available.some((p) => p.id === candidate);

	const providerId = [assigned?.providerId, config?.defaultProviderId].find(
		(candidate) => usable(candidate ?? ""),
	);
	const resolvedId = providerId ?? available[0]?.id ?? "";
	const settings = config?.providers?.[resolvedId] ?? null;

	const model =
		assigned?.providerId === resolvedId && assigned.model
			? assigned.model
			: (settings?.model ?? "");

	const template = assigned?.promptTemplate?.trim()
		? assigned.promptTemplate
		: (featureDef(id)?.defaultPromptTemplate ?? "");

	return {
		providerId: resolvedId,
		model,
		promptTemplate: template,
		unavailable: resolvedId === "",
	};
}
