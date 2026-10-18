// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { GitDiffHunk } from "$lib/services/git-service";

/** Lines one click on an expander reveals, as on GitHub. */
export const EXPAND_STEP = 20;

/** First and last line a hunk covers on each side; `last < first` when that side is empty. */
export type HunkRange = {
	oldFirst: number;
	oldLast: number;
	newFirst: number;
	newLast: number;
};

/**
 * The unchanged lines before hunk `index` (or after the last one when `index === hunks.length`),
 * in new-side numbers. `end` is null until the file length is known. `delta` turns a new-side
 * number into the old-side one, constant across a gap since nothing in it changed.
 */
export type DiffGap = { start: number; end: number | null; delta: number };

/** Lines revealed at the top of a gap (below the previous hunk) and at its bottom (above the next). */
export type GapExpansion = { top: number; bottom: number };

export type DiffRow =
	| { kind: "sep"; header: string }
	| {
			kind: "gap";
			gap: number;
			header: string;
			up: boolean;
			down: boolean;
			remaining: number | null;
	  }
	| {
			kind: "add" | "remove" | "context";
			oldNo: number | null;
			newNo: number | null;
			content: string;
	  };

/** Parses an `@@ -a,b +c,d @@` header; null for anything else, a combined diff's `@@@` included. */
export function parseHunkRange(header: string): HunkRange | null {
	const m = header.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
	if (!m) return null;
	const side = (start: string, count: string | undefined) => {
		const n = count === undefined ? 1 : Number(count);
		const first = n === 0 ? Number(start) + 1 : Number(start);
		return { first, last: first + n - 1 };
	};
	const o = side(m[1], m[2]);
	const n = side(m[3], m[4]);
	return {
		oldFirst: o.first,
		oldLast: o.last,
		newFirst: n.first,
		newLast: n.last,
	};
}

/**
 * One gap per hunk plus the trailing one. Null when a header does not parse, or when the diff
 * adds or deletes the whole file and there is nothing around it to reveal.
 */
export function diffGaps(
	hunks: GitDiffHunk[],
	fileLength: number | null,
): DiffGap[] | null {
	if (hunks.length === 0) return null;
	const ranges: HunkRange[] = [];
	for (const h of hunks) {
		const r = parseHunkRange(h.header);
		if (!r) return null;
		ranges.push(r);
	}
	const only = ranges.length === 1 ? ranges[0] : null;
	if (only && (only.oldLast === 0 || only.newLast === 0)) return null;
	const gaps: DiffGap[] = ranges.map((r, i) => ({
		start: i === 0 ? 1 : ranges[i - 1].newLast + 1,
		end: r.newFirst - 1,
		delta: r.oldFirst - r.newFirst,
	}));
	const last = ranges[ranges.length - 1];
	gaps.push({
		start: last.newLast + 1,
		end: fileLength,
		delta: last.oldLast - last.newLast,
	});
	return gaps;
}

/** Lines of a gap still hidden, null while the end of the file is unknown. */
export function gapRemaining(
	gap: DiffGap,
	exp: GapExpansion | undefined,
): number | null {
	if (gap.end === null) return null;
	return Math.max(
		0,
		gap.end - gap.start + 1 - (exp?.top ?? 0) - (exp?.bottom ?? 0),
	);
}

/**
 * Reveals more of gap `index`: `down` grows it from the hunk above, `up` from the hunk below,
 * `all` uncovers what is left. Needs the gap's end, so the file must be loaded first.
 */
export function expandGap(
	expansions: GapExpansion[],
	gaps: DiffGap[],
	index: number,
	direction: "up" | "down" | "all",
	step = EXPAND_STEP,
): GapExpansion[] {
	const exp = expansions[index] ?? { top: 0, bottom: 0 };
	const remaining = gapRemaining(gaps[index], exp) ?? 0;
	const n = direction === "all" ? remaining : Math.min(step, remaining);
	const next = [...expansions];
	next[index] =
		direction === "down"
			? { ...exp, top: exp.top + n }
			: { ...exp, bottom: exp.bottom + n };
	return next;
}

/**
 * Flattens hunks into display rows, walking each side's counter so added and removed lines only
 * advance their own. Without `gaps` the hunks are separated by their header, as plain git shows
 * them; with them, each gap gets its revealed lines and an expander for what is still hidden.
 * Rows past `limit` are counted in `total` but never built: a 20k-line diff shows a page, and
 * allocating the rest only to slice it away costs megabytes per expanded file.
 */
export function buildDiffRows(
	hunks: GitDiffHunk[],
	gaps: DiffGap[] | null,
	expansions: GapExpansion[],
	fileLines: string[] | null,
	limit: number,
): { rows: DiffRow[]; total: number } {
	const rows: DiffRow[] = [];
	let total = 0;
	const push = (row: () => DiffRow) => {
		if (total < limit) rows.push(row());
		total++;
	};

	const pushGap = (i: number) => {
		if (!gaps) {
			if (i > 0 && i < hunks.length)
				push(() => ({ kind: "sep", header: hunks[i].header }));
			return;
		}
		const gap = gaps[i];
		const exp = expansions[i];
		const top = fileLines ? (exp?.top ?? 0) : 0;
		const bottom = fileLines ? (exp?.bottom ?? 0) : 0;
		const revealed = (newNo: number) =>
			push(() => ({
				kind: "context",
				oldNo: newNo + gap.delta,
				newNo,
				content: fileLines?.[newNo - 1] ?? "",
			}));
		for (let k = 0; k < top; k++) revealed(gap.start + k);
		const remaining = gapRemaining(gap, exp);
		if (remaining === null || remaining > 0) {
			const isFirst = i === 0;
			const isLast = i === hunks.length;
			push(() => ({
				kind: "gap",
				gap: i,
				header: isLast ? "" : hunks[i].header,
				up: !isLast,
				down: !isFirst,
				remaining,
			}));
		}
		const end = gap.end ?? gap.start - 1;
		for (let k = bottom; k > 0; k--) revealed(end - k + 1);
	};

	for (let i = 0; i < hunks.length; i++) {
		pushGap(i);
		const range = parseHunkRange(hunks[i].header);
		let oldNo = range?.oldFirst ?? 1;
		let newNo = range?.newFirst ?? 1;
		for (const line of hunks[i].lines) {
			if (line.kind === "add") {
				const n = newNo++;
				push(() => ({
					kind: "add",
					oldNo: null,
					newNo: n,
					content: line.content,
				}));
			} else if (line.kind === "remove") {
				const o = oldNo++;
				push(() => ({
					kind: "remove",
					oldNo: o,
					newNo: null,
					content: line.content,
				}));
			} else {
				const o = oldNo++;
				const n = newNo++;
				push(() => ({
					kind: "context",
					oldNo: o,
					newNo: n,
					content: line.content,
				}));
			}
		}
	}
	if (hunks.length > 0) pushGap(hunks.length);
	return { rows, total };
}

/** Splits file content into lines the way a diff numbers them, without a phantom last line. */
export function splitFileLines(content: string): string[] {
	const lines = content.split(/\r?\n/);
	if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
	return lines;
}
