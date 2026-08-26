import type { FileNode, QuickSearchHit } from "$lib/services/file-service";

// Scoring and highlighting paths for the quick open palette: exact substrings
// first, then a subsequence match so acronyms still find their file.

/** The whole tree as a flat list, directories included. */
export function flattenTreeEntries(nodes: FileNode[]): QuickSearchHit[] {
	const entries: QuickSearchHit[] = [];
	for (const n of nodes) {
		entries.push({ path: n.path, isDir: n.isDir });
		if (n.children) entries.push(...flattenTreeEntries(n.children));
	}
	return entries;
}

/** Path separators are term separators too, so "utils/files" matches "src/utils/x/files.ts". */
export function splitSearchTerms(q: string): string[] {
	return q.split(/[\s/\\]+/).filter(Boolean);
}

/**
 * Best match wins: a filename prefix, then anywhere in the filename, then
 * anywhere in the path, and last a scattered subsequence. -1 means no match,
 * which rejects the path outright.
 */
function scoreTerm(lPath: string, term: string): number {
	const filename = lPath.split("/").pop() as string;

	if (filename.startsWith(term)) return 100;
	if (filename.includes(term)) return 80;
	if (lPath.includes(term)) return 60;

	let pi = 0;
	for (const ch of term) {
		pi = lPath.indexOf(ch, pi);
		if (pi === -1) return -1;
		pi++;
	}
	return 30;
}

/** Every term must match; the score is their average, so order is stable. */
export function scorePathMatch(path: string, q: string): number {
	const terms = splitSearchTerms(q.toLowerCase());
	if (terms.length === 0) return 1;

	const lPath = path.toLowerCase();
	let total = 0;
	for (const term of terms) {
		const score = scoreTerm(lPath, term);
		if (score < 0) return -1;
		total += score;
	}
	return Math.round(total / terms.length);
}

/**
 * Escapes before the <mark> tags go in - the result is injected as HTML.
 * Quotes are escaped too: the result is only ever placed in text content
 * today, but an unescaped quote turns the first attribute use into an XSS.
 */
export function htmlEscape(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

/** Marks the contiguous match if there is one, otherwise the matched letters. */
export function highlightPathMatch(path: string, q: string): string {
	if (!q) return htmlEscape(path);
	const lPath = path.toLowerCase();
	const lQ = q.toLowerCase();

	const idx = lPath.indexOf(lQ);
	if (idx !== -1) {
		return (
			htmlEscape(path.slice(0, idx)) +
			`<mark>${htmlEscape(path.slice(idx, idx + q.length))}</mark>` +
			htmlEscape(path.slice(idx + q.length))
		);
	}

	let result = "";
	let pi = 0;
	for (let i = 0; i < path.length; i++) {
		if (pi < lQ.length && path[i].toLowerCase() === lQ[pi]) {
			result += `<mark>${htmlEscape(path[i])}</mark>`;
			pi++;
		} else {
			result += htmlEscape(path[i]);
		}
	}
	return result;
}

/** Plain AND filter over whitespace-separated terms, case-insensitive. */
export function matchesSearch(text: string, query: string): boolean {
	const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (terms.length === 0) return true;
	const lText = text.toLowerCase();
	return terms.every((term) => lText.includes(term));
}
