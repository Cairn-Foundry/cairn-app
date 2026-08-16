// Filtering the test tree. Kept out of the component so the matching rules are
// testable on their own, and so search and status filter compose in one place.
import type { TestCase, TestSuite } from "$lib/types/tests";

export type TestFilter = "all" | "failed" | "passed" | "skipped";

/** One highlighted span of a matched label, as [start, end) offsets. */
export interface MatchRange {
	start: number;
	end: number;
}

/** The full label a case is searched and displayed by. */
export function caseLabel(entry: TestCase): string {
	return [...entry.ancestors, entry.name].join(" ");
}

/**
 * Splits a query into terms. Every term must match, in any order, so
 * "totp window" finds "rejects tokens from the previous window" under a
 * `totp` describe.
 */
export function parseQuery(query: string): string[] {
	return query
		.toLowerCase()
		.split(/\s+/)
		.filter((term) => term.length > 0);
}

/** Whether a case satisfies the status filter alone. */
export function matchesFilter(entry: TestCase, filter: TestFilter): boolean {
	if (filter === "failed") return entry.status === "fail";
	if (filter === "passed") return entry.status === "pass";
	if (filter === "skipped")
		return entry.status === "skip" || entry.status === "todo";
	return true;
}

/**
 * Whether a case satisfies the query. The file name is searchable too, so
 * "cart" finds every test of `cart.test.js` even when the term appears
 * nowhere in the test names.
 */
export function matchesQuery(
	entry: TestCase,
	file: string,
	terms: string[],
): boolean {
	if (terms.length === 0) return true;
	const haystack = `${file} ${caseLabel(entry)}`.toLowerCase();
	return terms.every((term) => haystack.includes(term));
}

/**
 * Where each term hits inside `label`, merged and sorted, so the view can
 * highlight the match instead of leaving the user to find it.
 */
export function highlightRanges(label: string, terms: string[]): MatchRange[] {
	const haystack = label.toLowerCase();
	const found: MatchRange[] = [];
	for (const term of terms) {
		let from = haystack.indexOf(term);
		while (from !== -1) {
			found.push({ start: from, end: from + term.length });
			from = haystack.indexOf(term, from + term.length);
		}
	}
	if (found.length === 0) return [];

	found.sort((a, b) => a.start - b.start);
	const merged: MatchRange[] = [found[0]];
	for (const range of found.slice(1)) {
		const last = merged[merged.length - 1];
		if (range.start <= last.end) last.end = Math.max(last.end, range.end);
		else merged.push(range);
	}
	return merged;
}

/** A label cut into its matched and unmatched runs, ready to render. */
export function splitHighlight(
	label: string,
	terms: string[],
): Array<{ text: string; hit: boolean }> {
	const ranges = highlightRanges(label, terms);
	if (ranges.length === 0) return [{ text: label, hit: false }];

	const parts: Array<{ text: string; hit: boolean }> = [];
	let cursor = 0;
	for (const range of ranges) {
		if (range.start > cursor) {
			parts.push({ text: label.slice(cursor, range.start), hit: false });
		}
		parts.push({ text: label.slice(range.start, range.end), hit: true });
		cursor = range.end;
	}
	if (cursor < label.length)
		parts.push({ text: label.slice(cursor), hit: false });
	return parts;
}

/**
 * The tree as the list should show it. A suite that failed to load survives a
 * text query matching its file, and is dropped by a status filter that cannot
 * apply to it.
 */
export function filterSuites(
	suites: TestSuite[],
	query: string,
	filter: TestFilter,
): TestSuite[] {
	const terms = parseQuery(query);
	const result: TestSuite[] = [];

	for (const suite of suites) {
		const cases = suite.cases.filter(
			(entry) =>
				matchesFilter(entry, filter) && matchesQuery(entry, suite.file, terms),
		);
		const fileMatches =
			terms.length === 0 ||
			terms.every((term) => suite.file.toLowerCase().includes(term));
		const keepError =
			suite.error !== null &&
			fileMatches &&
			(filter === "all" || filter === "failed");

		if (cases.length > 0 || keepError) {
			result.push({ ...suite, cases });
		}
	}
	return result;
}

/** How many cases a filtered tree holds, for the "n results" hint. */
export function countVisible(suites: TestSuite[]): number {
	return suites.reduce((total, suite) => total + suite.cases.length, 0);
}
