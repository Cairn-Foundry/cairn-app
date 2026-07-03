import { Chunk } from "@codemirror/merge";
import {
	type Extension,
	StateEffect,
	StateField,
	Text,
} from "@codemirror/state";
import { type EditorView, GutterMarker, gutter } from "@codemirror/view";

export type DiffKind = "added" | "modified" | "deleted";

/**
 * Payload handed to the click handler when a gutter marker is clicked.
 * `before`/`after` are the HEAD and current content of the chunk, ready to
 * feed a side-by-side diff view. `anchorLine` lets the revert look the chunk
 * up again against the live document.
 */
export interface GutterChunk {
	lineStart: number;
	lineEnd: number;
	anchorLine: number;
	before: string;
	after: string;
}

interface DiffState {
	base: Text;
	chunks: readonly Chunk[];
	lineKinds: Map<number, DiffKind>;
}

// Effect carrying the new base (HEAD) content to diff the live buffer against.
export const setDiffBase = StateEffect.define<string>();

// Bound the diff cost: without a scan limit, a chunk that spans a large, very
// different region (e.g. line-ending mismatch, or a heavily-rewritten file) is
// fully re-diffed on every keystroke - O(n·m), hundreds of ms, freezing the UI.
// `scanLimit` makes the algorithm fall back to a fast, slightly coarser diff for
// such regions. This mirrors @codemirror/merge's own default for merge views.
const DIFF_CONFIG = { scanLimit: 500 };

function textOf(content: string): Text {
	return Text.of(content.length ? content.split("\n") : [""]);
}

function chunkKind(chunk: Chunk): DiffKind {
	if (chunk.fromA === chunk.toA) return "added";
	if (chunk.fromB === chunk.toB) return "deleted";
	return "modified";
}

function chunkLineRange(
	doc: Text,
	chunk: Chunk,
): { start: number; end: number } {
	const start = doc.lineAt(Math.min(chunk.fromB, doc.length)).number;
	if (chunk.fromB === chunk.toB) return { start, end: start };
	const lastPos = Math.min(Math.max(chunk.toB - 1, chunk.fromB), doc.length);
	return { start, end: doc.lineAt(lastPos).number };
}

function chunkCoversLine(doc: Text, chunk: Chunk, line: number): boolean {
	const { start, end } = chunkLineRange(doc, chunk);
	return line >= start && line <= end;
}

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
		return { base: state.doc, chunks: [], lineKinds: new Map() };
	},
	update(value, tr) {
		let { base } = value;
		let baseChanged = false;
		for (const e of tr.effects) {
			if (e.is(setDiffBase)) {
				base = textOf(e.value);
				baseChanged = true;
			}
		}
		if (!baseChanged && !tr.docChanged) return value;

		const chunks = baseChanged
			? Chunk.build(base, tr.state.doc, DIFF_CONFIG)
			: Chunk.updateB(
					value.chunks,
					base,
					tr.state.doc,
					tr.changes,
					DIFF_CONFIG,
				);
		return { base, chunks, lineKinds: buildLineKinds(tr.state.doc, chunks) };
	},
});

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

function chunkPayload(base: Text, doc: Text, chunk: Chunk): GutterChunk {
	const before = base.sliceString(
		chunk.fromA,
		Math.min(chunk.toA, base.length),
	);
	const after = doc.sliceString(chunk.fromB, Math.min(chunk.toB, doc.length));
	const { start, end } = chunkLineRange(doc, chunk);
	return { lineStart: start, lineEnd: end, anchorLine: start, before, after };
}

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

export function setDiffBaseContent(view: EditorView, base: string): void {
	view.dispatch({ effects: setDiffBase.of(base) });
}

/**
 * Revert the chunk covering `line` back to its HEAD content. Returns false if
 * no chunk is there any more (e.g. the user kept typing). The change is a
 * normal edit, so it goes through the usual onChange/save flow and is undoable.
 */
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
