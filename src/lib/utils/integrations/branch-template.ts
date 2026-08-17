// The branch name derived from a ticket, through the user's template
// (`settings.branchTemplate`, default `feat/{{key}}-{{slug}}`).

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
