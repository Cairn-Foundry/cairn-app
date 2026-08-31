/**
 * WYSIWYG for a standalone `.mmd` file: the whole document is one diagram, so
 * it renders in place of the source, zoomable and pannable like the diagrams
 * embedded in a markdown file.
 *
 * The file opens on its diagram and reveals the source as soon as the user
 * clicks into it - there is no separate preview pane, same as markdown.
 */

import { type Extension, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";

import { MermaidWidget, wysiwygTheme } from "./editor-markdown-wysiwyg";

interface MermaidDocState {
	revealed: boolean;
	deco: DecorationSet;
}

function build(source: string, revealed: boolean): MermaidDocState {
	const deco =
		revealed || !source.trim()
			? Decoration.none
			: Decoration.set([
					Decoration.replace({
						widget: new MermaidWidget(source),
						block: true,
					}).range(0, source.length),
				]);
	return { revealed, deco };
}

const mermaidDocField = StateField.define<MermaidDocState>({
	create(state) {
		return build(state.doc.toString(), false);
	},
	update(value, tr) {
		// A user selection is the signal to edit; a doc change alone (an
		// external reload, a format-on-save) must not pop the source open.
		const revealed = value.revealed || Boolean(tr.selection);
		if (revealed === value.revealed && !tr.docChanged) return value;
		return build(tr.state.doc.toString(), revealed);
	},
	provide: (field) => EditorView.decorations.from(field, (s) => s.deco),
});

/** The `.mmd` counterpart of `buildMarkdownWysiwyg`. */
export function buildMermaidDoc(): Extension {
	return [mermaidDocField, wysiwygTheme];
}
