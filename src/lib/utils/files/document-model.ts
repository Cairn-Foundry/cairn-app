import type { ChangeSet } from "@codemirror/state";
import { Text } from "@codemirror/state";
import { detectIndentStyle, detectSpaceSize } from "./files-indent";

// The document model of a tab: the buffer and the disk content are CodeMirror
// `Text` values, immutable and shared with the editor view that shows them.
// A keystroke hands the pane the view's own `Text` - no copy, no O(n)
// compare - and "dirty" is a structural equality the rope answers quickly.

export interface DocumentState {
	doc: Text;
	savedDoc: Text;
}

export function docFromString(text: string): Text {
	return Text.of(text.split("\n"));
}

export function isDirty(tab: DocumentState): boolean {
	return tab.doc !== tab.savedDoc && !tab.doc.eq(tab.savedDoc);
}

/** LSP text edit as `textDocument/didChange` takes it; no range means the whole document. */
export interface LspContentChange {
	range?: {
		start: { line: number; character: number };
		end: { line: number; character: number };
	};
	text: string;
}

function lspPosition(doc: Text, offset: number) {
	const line = doc.lineAt(offset);
	return { line: line.number - 1, character: offset - line.from };
}

/**
 * The incremental edits of a transaction, in the order a server must apply
 * them: a change set lists its pieces in ascending positions of the old
 * document, so applying the last one first keeps every earlier range valid.
 */
export function lspChangesOf(
	startDoc: Text,
	changes: ChangeSet,
): LspContentChange[] {
	const out: LspContentChange[] = [];
	changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
		out.push({
			range: {
				start: lspPosition(startDoc, fromA),
				end: lspPosition(startDoc, toA),
			},
			text: inserted.toString(),
		});
	});
	return out.reverse();
}

// Indent detection reads the first hundred lines; keyed on the `Text` object
// so a status bar re-rendered on every keystroke asks once per document.
const indentStyles = new WeakMap<Text, "tabs" | "spaces" | null>();
const spaceSizes = new WeakMap<Text, number>();

export function indentStyleOf(doc: Text): "tabs" | "spaces" | null {
	let style = indentStyles.get(doc);
	if (style === undefined) {
		style = detectIndentStyle(doc.sliceString(0, Math.min(doc.length, 20_000)));
		indentStyles.set(doc, style);
	}
	return style;
}

export function spaceSizeOf(doc: Text): number {
	let size = spaceSizes.get(doc);
	if (size === undefined) {
		size = detectSpaceSize(doc.sliceString(0, Math.min(doc.length, 20_000)));
		spaceSizes.set(doc, size);
	}
	return size;
}
