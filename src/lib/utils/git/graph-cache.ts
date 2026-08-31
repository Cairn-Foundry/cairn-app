/**
 * Deciding whether a laid-out graph can be extended rather than laid out again.
 *
 * Lane assignment is a fold: the lanes after a row depend only on the rows
 * before it. So a list that merely grew at the end can resume from the state
 * left after the last known row, and only the appended commits cost anything.
 * Any other change - a search narrowing the list, a refresh rewriting history -
 * invalidates the whole layout.
 */

/** How much of `hashes` a layout of `computed` rows can still be reused for. */
export function reusablePrefix(
	computed: readonly string[],
	hashes: readonly string[],
): number {
	if (computed.length === 0 || computed.length > hashes.length) return 0;
	// The last computed row is enough to identify the prefix: the rows before it
	// were checked the same way when they were themselves the last one.
	if (computed[computed.length - 1] !== hashes[computed.length - 1]) return 0;
	return computed.length;
}
