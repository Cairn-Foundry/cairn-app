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
			return { base, hasBase: false, chunks: [], lineKinds: new Map() };
		}
		if (!baseChanged && !tr.docChanged) return value;

		if (!hasBase) {
			return { base, hasBase, chunks: [], lineKinds: new Map() };
		}

		const chunks = baseChanged
			? Chunk.build(base, tr.state.doc, DIFF_CONFIG)
			: Chunk.updateB(
					value.chunks,
					base,
					tr.state.doc,
					tr.changes,
					DIFF_CONFIG,
				);
		return {
			base,
			hasBase,
			chunks,
			lineKinds: buildLineKinds(tr.state.doc, chunks),
		};
	},
});

/** The current markers, empty when the gutter extension is not installed. */
export function diffLineKinds(state: EditorState): Map<number, DiffKind> {
	return state.field(diffField, false)?.lineKinds ?? new Map();
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
			lineMarkerChange: (update) =>
				update.startState.field(diffField) !== update.state.field(diffField),
			initialSpacer: () => new DiffMarker("added"),
			domEventHandlers: {
				mousedown(view, line) {
					const doc = view.state.doc;
					const ln = doc.lineAt(line.from).number;
					const { base, chunks, lineKinds } = view.state.field(diffField);
					if (!lineKinds.has(ln)) return false;
					const chunk = chunks.find((c) => chunkCoversLine(doc, c, ln));
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
