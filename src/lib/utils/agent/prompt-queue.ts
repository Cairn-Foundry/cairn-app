/**
 * Puts prompts that were waiting back into the composer, ahead of whatever is
 * being written there now.
 *
 * Order is the order they were written in, and the draft comes last: it is the
 * newest thing typed, and the one the caret is in. Empty entries are dropped
 * rather than leaving blank lines to clean up.
 */
export function mergeIntoDraft(waiting: string[], draft: string): string {
	return [...waiting, draft]
		.map((text) => text.trim())
		.filter(Boolean)
		.join("\n\n");
}
