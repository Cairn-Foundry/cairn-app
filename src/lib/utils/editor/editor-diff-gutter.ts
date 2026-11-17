// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Chunk } from "@codemirror/merge";
import {
	type EditorState,
	type Extension,
	StateEffect,
	StateField,
	Text,
} from "@codemirror/state";
import { type EditorView, GutterMarker, gutter } from "@codemirror/view";

// The git diff gutter: the baseline is held in a StateField and re-diffed
// incrementally, so every keystroke updates the markers without a full rescan.

/** How a line differs from the baseline. */
export type DiffKind = "added" | "modified" | "deleted";

/** One changed hunk, with both sides, as handed to the click handler. */
export interface GutterChunk {
	lineStart: number;
	lineEnd: number;
	anchorLine: number;
	before: string;
	after: string;
}

/** `lineKinds` is derived from `chunks`; it exists so the gutter is a lookup. */
interface DiffState {
	base: Text;
	hasBase: boolean;
	rawChunks: readonly Chunk[];
	chunks: readonly Chunk[];
	lineKinds: Map<number, DiffKind>;
}

/** Sets the baseline to diff against, replacing any previous one. */
export const setDiffBase = StateEffect.define<string>();

/** Drops the baseline: an untracked or ignored file has nothing to compare to. */
export const clearDiffBase = StateEffect.define<null>();

const DIFF_CONFIG = { scanLimit: 500 };

/** An empty string is one empty line, not zero lines, or the diff misaligns. */
function textOf(content: string): Text {
	return Text.of(content.length ? content.split("\n") : [""]);
}

/** Empty on the base side means added, empty on the doc side means deleted. */
function chunkKind(chunk: Chunk): DiffKind {
	if (chunk.fromA === chunk.toA) return "added";
	if (chunk.fromB === chunk.toB) return "deleted";
	return "modified";
}

/** The chunk's line span in the document, `toB` being exclusive. */
function chunkLineRange(
	doc: Text,
	chunk: Chunk,
): { start: number; end: number } {
	const start = doc.lineAt(Math.min(chunk.fromB, doc.length)).number;
	if (chunk.fromB === chunk.toB) return { start, end: start };
	const lastPos = Math.min(Math.max(chunk.toB - 1, chunk.fromB), doc.length);
	return { start, end: doc.lineAt(lastPos).number };
}

/** Whether a 1-based line number falls inside the chunk. */
function chunkCoversLine(doc: Text, chunk: Chunk, line: number): boolean {
	const { start, end } = chunkLineRange(doc, chunk);
	return line >= start && line <= end;
}

function indentOf(text: string): number {
	return text.length - text.trimStart().length;
}

function isBlank(text: string): boolean {
	return text.trim().length === 0;
}

function lineTextOrBlank(doc: Text, line: number): string {
	return line >= 1 && line <= doc.lines ? doc.line(line).text : "";
}

/** Git prefers a hunk that starts after a blank line and ends before one. */
function slideScore(
	doc: Text,
	startLine: number,
	lineCount: number,
	firstText: string,
): number {
	const before = lineTextOrBlank(doc, startLine - 1);
	const after = lineTextOrBlank(doc, startLine + lineCount);
	let score = 0;
	if (isBlank(before)) score += 4;
	if (isBlank(after)) score += 2;
	if (!isBlank(after) && indentOf(after) < indentOf(firstText)) score += 1;
	return score;
}

/**
 * A pure addition or deletion among identical lines is valid at several
 * positions; git settles on one with its indent heuristic, CodeMirror on the
 * first it meets. Slides the chunk to the position git would report.
 */
function slideChunk(base: Text, doc: Text, chunk: Chunk): Chunk {
	const isAdded = chunk.fromA === chunk.toA;
	const isDeleted = chunk.fromB === chunk.toB;
	if (isAdded === isDeleted) return chunk;
	if (chunk.fromA > base.length || chunk.fromB > doc.length) return chunk;
	if (base.lineAt(chunk.fromA).from !== chunk.fromA) return chunk;
	if (doc.lineAt(chunk.fromB).from !== chunk.fromB) return chunk;

	const side = isAdded ? doc : base;
	const sideFrom = isAdded ? chunk.fromB : chunk.fromA;
	const sideTo = isAdded ? chunk.toB : chunk.toA;
	const first = side.lineAt(sideFrom).number;
	const last = side.lineAt(Math.min(sideTo - 1, side.length)).number;
	const count = last - first + 1;

	let maxDown = 0;
	while (
		last + maxDown + 1 <= side.lines &&
		side.line(first + maxDown).text === side.line(last + maxDown + 1).text
	) {
		maxDown++;
	}
	let maxUp = 0;
	while (
		first - maxUp - 1 >= 1 &&
		side.line(last - maxUp).text === side.line(first - maxUp - 1).text
	) {
		maxUp++;
	}
	const aAnchor = base.lineAt(chunk.fromA).number;
	const bAnchor = doc.lineAt(chunk.fromB).number;
	const lowest = Math.max(-maxUp, 1 - (isAdded ? aAnchor : bAnchor));
	const highest = Math.min(
		maxDown,
		(isAdded ? base.lines - aAnchor : doc.lines - bAnchor) + 1,
	);
	if (lowest === 0 && highest === 0) return chunk;

	let bestShift = 0;
	let bestScore = -1;
	for (let shift = lowest; shift <= highest; shift++) {
		const score = slideScore(
			doc,
			bAnchor + shift,
			isAdded ? count : 0,
			side.line(first + shift).text,
		);
		if (score >= bestScore) {
			bestScore = score;
			bestShift = shift;
		}
	}
	if (bestShift === 0) return chunk;

	const aStart = aAnchor + bestShift;
	const bStart = bAnchor + bestShift;
	const fromA = lineStartOrEnd(base, aStart);
	const fromB = lineStartOrEnd(doc, bStart);
	const toA = isAdded ? fromA : base.line(aStart + count - 1).to + 1;
	const toB = isAdded ? doc.line(bStart + count - 1).to + 1 : fromB;
	return new Chunk(chunk.changes, fromA, toA, fromB, toB, chunk.precise);
}

function lineStartOrEnd(text: Text, line: number): number {
	return line > text.lines ? text.length : text.line(line).from;
}

function slideChunks(
	base: Text,
	doc: Text,
	chunks: readonly Chunk[],
): readonly Chunk[] {
	return chunks.map((chunk) => slideChunk(base, doc, chunk));
}

/** A deletion has no lines of its own, so it marks the single line it sits at. */
function buildLineKinds(
	doc: Text,
	chunks: readonly Chunk[],
): Map<number, DiffKind> {
	const map = new Map<number, DiffKind>();
	for (const chunk of chunks) {
		const kind = chunkKind(chunk);
		const { start, end } = chunkLineRange(doc, chunk);
		if (kind === "deleted") {
			if (!map.has(start)) map.set(start, "deleted");
		} else {
			for (let line = start; line <= end; line++) map.set(line, kind);
		}
	}
	return map;
}

const diffField = StateField.define<DiffState>({
	create(state) {
		return {
			base: state.doc,
			hasBase: false,
			rawChunks: [],
			chunks: [],
			lineKinds: new Map(),
		};
	},
	update(value, tr) {
		let { base, hasBase } = value;
		let baseChanged = false;
		let cleared = false;
		for (const e of tr.effects) {
			if (e.is(setDiffBase)) {
				base = textOf(e.value);
				hasBase = true;
				baseChanged = true;
			}
			if (e.is(clearDiffBase)) {
				hasBase = false;
				cleared = true;
			}
		}
		if (cleared) {
			return {
				base,
				hasBase: false,
				rawChunks: [],
				chunks: [],
				lineKinds: new Map(),
			};
		}
		if (!baseChanged && !tr.docChanged) return value;

		if (!hasBase) {
			return {
				base,
				hasBase,
				rawChunks: [],
				chunks: [],
				lineKinds: new Map(),
			};
		}

		const rawChunks = baseChanged
			? Chunk.build(base, tr.state.doc, DIFF_CONFIG)
			: Chunk.updateB(
					value.rawChunks,
					base,
					tr.state.doc,
					tr.changes,
					DIFF_CONFIG,
				);
		const chunks = slideChunks(base, tr.state.doc, rawChunks);
		return {
			base,
			hasBase,
			rawChunks,
			chunks,
			lineKinds: buildLineKinds(tr.state.doc, chunks),
		};
	},
});

/** The current markers, empty when the gutter extension is not installed. */
export function diffLineKinds(state: EditorState): Map<number, DiffKind> {
	return state.field(diffField, false)?.lineKinds ?? new Map();
}

/** The line span of every change, in document order. */
function changeRanges(state: EditorState): { start: number; end: number }[] {
	const field = state.field(diffField, false);
	if (!field) return [];
	return field.chunks
		.map((chunk) => chunkLineRange(state.doc, chunk))
		.sort((a, b) => a.start - b.start);
}

/** The first line of every change, in document order. */
export function changedLines(state: EditorState): number[] {
	return changeRanges(state).map((range) => range.start);
}

/** The rank, from 0, of the change `line` sits in. Null outside every change. */
export function changeIndexAtLine(
	state: EditorState,
	line: number,
): number | null {
	const index = changeRanges(state).findIndex(
		(range) => line >= range.start && line <= range.end,
	);
	return index === -1 ? null : index;
}

/**
 * The change that follows `line`, wrapping back to the first one once past the
 * last. Null when the file holds no change.
 */
export function nextChangedLine(
	state: EditorState,
	line: number,
): number | null {
	const lines = changedLines(state);
	return lines.find((l) => l > line) ?? lines[0] ?? null;
}

/** The change that precedes `line`, wrapping to the last one. */
export function previousChangedLine(
	state: EditorState,
	line: number,
): number | null {
	const lines = changedLines(state);
	for (let i = lines.length - 1; i >= 0; i--) {
		if (lines[i] < line) return lines[i];
	}
	return lines.at(-1) ?? null;
}

class DiffMarker extends GutterMarker {
	constructor(readonly kind: DiffKind) {
		super();
	}
	toDOM() {
		const el = document.createElement("div");
		el.className = `cm-diff-marker cm-diff-${this.kind}`;
		return el;
	}
}

/** Materializes both sides of a chunk as text, for the revert popup. */
function chunkPayload(base: Text, doc: Text, chunk: Chunk): GutterChunk {
	const before = base.sliceString(
		chunk.fromA,
		Math.min(chunk.toA, base.length),
	);
	const after = doc.sliceString(chunk.fromB, Math.min(chunk.toB, doc.length));
	const { start, end } = chunkLineRange(doc, chunk);
	return { lineStart: start, lineEnd: end, anchorLine: start, before, after };
}

/** A block widget swallows several lines: modified wins, then added, then deleted. */
function kindOverRange(
	doc: Text,
	lineKinds: Map<number, DiffKind>,
	from: number,
	to: number,
): DiffKind | undefined {
	const first = doc.lineAt(from).number;
	const last = doc.lineAt(Math.min(to, doc.length)).number;
	let found: DiffKind | undefined;
	for (let ln = first; ln <= last; ln++) {
		const kind = lineKinds.get(ln);
		if (kind === "modified") return kind;
		if (kind === "added" || (kind && !found)) found = kind;
	}
	return found;
}

/** The gutter plus the state it reads; a click reports the chunk it hit. */
export function buildDiffGutter(opts: {
	onChunkClick?: (chunk: GutterChunk) => void;
}): Extension {
	return [
		diffField,
		gutter({
			class: "cm-diff-gutter",
			lineMarker(view, line) {
				const ln = view.state.doc.lineAt(line.from).number;
				const kind = view.state.field(diffField).lineKinds.get(ln);
				return kind ? new DiffMarker(kind) : null;
			},
			widgetMarker(view, _widget, block) {
				const kind = kindOverRange(
					view.state.doc,
					view.state.field(diffField).lineKinds,
					block.from,
					block.to,
				);
				return kind ? new DiffMarker(kind) : null;
			},
			lineMarkerChange: (update) =>
				update.startState.field(diffField) !== update.state.field(diffField),
			initialSpacer: () => new DiffMarker("added"),
			domEventHandlers: {
				mousedown(view, line) {
					const doc = view.state.doc;
					const { base, chunks, lineKinds } = view.state.field(diffField);
					if (!kindOverRange(doc, lineKinds, line.from, line.to)) return false;
					const first = doc.lineAt(line.from).number;
					const last = doc.lineAt(Math.min(line.to, doc.length)).number;
					const chunk = chunks.find((c) => {
						const range = chunkLineRange(doc, c);
						return range.start <= last && range.end >= first;
					});
					if (!chunk) return false;
					opts.onChunkClick?.(chunkPayload(base, doc, chunk));
					return true;
				},
			},
		}),
	];
}

/** Restores the baseline text of the chunk at `line`; false when there is none. */
export function revertChunkAtLine(view: EditorView, line: number): boolean {
	const doc = view.state.doc;
	const { base, chunks } = view.state.field(diffField);
	const chunk = chunks.find((c) => chunkCoversLine(doc, c, line));
	if (!chunk) return false;
	const insert = base.sliceString(
		chunk.fromA,
		Math.min(chunk.toA, base.length),
	);
	view.dispatch({
		changes: {
			from: chunk.fromB,
			to: Math.min(chunk.toB, doc.length),
			insert,
		},
		userEvent: "revert",
	});
	return true;
}
