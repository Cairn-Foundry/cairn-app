// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Turning what the model answered into a guide the view can trust, and keeping
// that guide honest as the branch moves under it. Pure functions: the store
// holds the state, this decides what the state should become.

import type {
	GuideChapter,
	GuideExcerpt,
	GuideRemark,
	RemarkKind,
	ReviewGuide,
	ReviewHunk,
	ReviewState,
} from "$lib/types/review";

const KINDS: RemarkKind[] = ["issue", "question", "refactor", "note"];

/** The raw shape the model answers in: no ids, no hashes, nothing resolved. */
export interface RawGuide {
	overview?: unknown;
	chapters?: unknown;
}

function asString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function asLine(value: unknown): number {
	const line = typeof value === "number" ? Math.trunc(value) : Number.NaN;
	return Number.isFinite(line) && line > 0 ? line : 0;
}

function asSide(value: unknown): "old" | "new" {
	return value === "old" ? "old" : "new";
}

/**
 * The hunk containing `line` on `side` of `path`. A hunk covers the lines its
 * `@@` header declares; an excerpt that starts inside one and runs past its end
 * still belongs to it, which is why only the start is looked up.
 */
export function hunkFor(
	hunks: ReviewHunk[],
	path: string,
	side: "old" | "new",
	line: number,
): ReviewHunk | null {
	for (const hunk of hunks) {
		if (hunk.path !== path) continue;
		const start = side === "old" ? hunk.oldStart : hunk.newStart;
		const count = side === "old" ? hunk.oldLines : hunk.newLines;
		if (line >= start && line < start + count) return hunk;
	}
	return null;
}

/**
 * Attaches an excerpt to its hunk. An excerpt that falls in no hunk is a line
 * the model invented: it is dropped rather than shown, because a guide must
 * never point at a line that is not in the diff.
 */
function resolveExcerpt(
	raw: unknown,
	hunks: ReviewHunk[],
): GuideExcerpt | null {
	if (typeof raw !== "object" || raw === null) return null;
	const value = raw as Record<string, unknown>;
	const path = asString(value.path);
	const side = asSide(value.side);
	const from = asLine(value.from);
	const to = Math.max(from, asLine(value.to));
	if (path === "" || from === 0) return null;
	const hunk = hunkFor(hunks, path, side, from);
	if (!hunk) return null;
	return { path, side, from, to, hunkHash: hunk.hunkHash };
}

/** A remark keeps its anchor only when that anchor exists in the diff. */
function resolveRemark(
	raw: unknown,
	hunks: ReviewHunk[],
	id: string,
): GuideRemark | null {
	if (typeof raw !== "object" || raw === null) return null;
	const value = raw as Record<string, unknown>;
	const path = asString(value.path);
	const side = asSide(value.side);
	const line = asLine(value.line);
	const title = asString(value.title);
	if (path === "" || line === 0 || title === "") return null;
	if (!hunkFor(hunks, path, side, line)) return null;
	const kind = KINDS.includes(value.kind as RemarkKind)
		? (value.kind as RemarkKind)
		: "note";
	return {
		id,
		kind,
		path,
		side,
		line,
		title,
		body: asString(value.body),
		status: "open",
	};
}

/**
 * The model's answer turned into a guide: ids minted here, extracts and remarks
 * attached to real hunks, everything that does not attach dropped. A chapter
 * left without a single extract is dropped too - it would be a title the
 * reviewer could not navigate to.
 */
export function resolveGuide(
	raw: RawGuide,
	hunks: ReviewHunk[],
	baseSha: string,
	headSha: string,
	generatedAt: string,
): ReviewGuide {
	const rawChapters = Array.isArray(raw.chapters) ? raw.chapters : [];
	const chapters: GuideChapter[] = [];
	rawChapters.forEach((rawChapter, index) => {
		if (typeof rawChapter !== "object" || rawChapter === null) return;
		const value = rawChapter as Record<string, unknown>;
		const id = `c${index + 1}`;
		const excerpts = (Array.isArray(value.excerpts) ? value.excerpts : [])
			.map((excerpt) => resolveExcerpt(excerpt, hunks))
			.filter((excerpt): excerpt is GuideExcerpt => excerpt !== null);
		if (excerpts.length === 0) return;
		const remarks = (Array.isArray(value.remarks) ? value.remarks : [])
			.map((remark, position) =>
				resolveRemark(remark, hunks, `${id}r${position + 1}`),
			)
			.filter((remark): remark is GuideRemark => remark !== null);
		chapters.push({
			id,
			title: asString(value.title) || id,
			summary: asString(value.summary),
			excerpts,
			remarks,
			isSeen: false,
		});
	});
	return {
		headSha,
		baseSha,
		generatedAt,
		overview: asString(raw.overview),
		chapters,
	};
}

/**
 * Realigns the state on the diff as it is now. A hunk the author rewrote has a
 * new hash, so it drops out of `seenHunks` and every chapter covering it goes
 * back to unread: what changed since the last pass is exactly what has to be
 * read again.
 */
export function reconcileWithDiff(
	state: ReviewState,
	hunks: ReviewHunk[],
): ReviewState {
	const present = new Set((hunks ?? []).map((hunk) => hunk.hunkHash));
	const seenHunks = state.seenHunks.filter((hash) => present.has(hash));
	const guide = state.guide
		? {
				...state.guide,
				chapters: state.guide.chapters.map((chapter) => ({
					...chapter,
					isSeen:
						chapter.isSeen &&
						chapter.excerpts.every((excerpt) => present.has(excerpt.hunkHash)),
				})),
			}
		: null;
	return { ...state, seenHunks, guide };
}

export interface ReviewProgress {
	seenHunks: number;
	totalHunks: number;
	seenChapters: number;
	totalChapters: number;
	/** Between 0 and 1; 0 when there is nothing to read yet. */
	ratio: number;
}

/**
 * How far the reading got. Hunks drive the ratio rather than chapters: a
 * chapter covering twelve hunks is not one twelfth of the reading.
 */
export function guideProgress(
	state: ReviewState,
	hunks: ReviewHunk[],
): ReviewProgress {
	const chapters = state.guide?.chapters ?? [];
	// Only the hunks the guide actually covers count: the diff can hold hunks no
	// chapter took, and the reviewer cannot mark those from the guide.
	const covered = new Set<string>();
	for (const chapter of chapters)
		for (const excerpt of chapter.excerpts) covered.add(excerpt.hunkHash);
	const present = new Set((hunks ?? []).map((hunk) => hunk.hunkHash));
	const totalHunks = [...covered].filter((hash) => present.has(hash)).length;
	const seenHunks = state.seenHunks.filter((hash) => covered.has(hash)).length;
	return {
		seenHunks,
		totalHunks,
		seenChapters: chapters.filter((chapter) => chapter.isSeen).length,
		totalChapters: chapters.length,
		ratio: totalHunks === 0 ? 0 : seenHunks / totalHunks,
	};
}

/** The guide describes a state of the branch that has moved on. */
export function isGuideStale(
	guide: ReviewGuide | null,
	headSha: string,
): boolean {
	return guide !== null && headSha !== "" && guide.headSha !== headSha;
}

/** The review as markdown, for the reviewer with no forge to push it to. */
/** `path:12` for one line, `path:10-14` for a range. */
export function anchorLabel(anchor: {
	path: string;
	line: number;
	startLine?: number;
}): string {
	const range =
		anchor.startLine && anchor.startLine < anchor.line
			? `${anchor.startLine}-${anchor.line}`
			: String(anchor.line);
	return `${anchor.path}:${range}`;
}

export function reviewAsMarkdown(
	state: ReviewState,
	verdict: string,
	body: string,
): string {
	const lines: string[] = [];
	if (body.trim()) lines.push(body.trim(), "");
	lines.push(`Verdict: ${verdict}`, "");
	for (const comment of state.comments) {
		lines.push(`### ${anchorLabel(comment)}`, "", comment.body, "");
	}
	return lines.join("\n").trimEnd();
}
