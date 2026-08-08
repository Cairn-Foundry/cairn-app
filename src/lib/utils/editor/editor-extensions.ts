import {
	addCursorAbove,
	addCursorBelow,
	copyLineDown,
	cursorMatchingBracket,
	deleteLine,
	indentLess,
	indentMore,
	moveLineDown,
	moveLineUp,
	selectLine,
	selectParentSyntax,
	toggleBlockComment,
	toggleComment,
} from "@codemirror/commands";
import { gotoLine } from "@codemirror/search";
import type { Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { showMinimap } from "@replit/codemirror-minimap";
import { toCmKey } from "$lib/stores/shortcuts";
import type { ShortcutBinding, ShortcutId } from "$lib/types/shortcuts";
import { EDITOR_DEFAULTS } from "./editor-config";

export function buildFontSizeTheme(size: number): Extension {
	return EditorView.theme({
		"&": { fontSize: `${size}px` },
		".cm-lineNumbers .cm-gutterElement": {
			fontSize: `${size - EDITOR_DEFAULTS.lineNumberFontDelta}px`,
		},
	});
}

export function buildMinimap(
	enabled: boolean,
	diffGutter?: Record<number, string>,
): Extension {
	if (!enabled) return [];
	return showMinimap.of({
		create: () => ({ dom: document.createElement("div") }),
		displayText: "blocks",
		showOverlay: "always",
		gutters: diffGutter ? [diffGutter] : undefined,
	});
}

function duplicateLineStay(view: EditorView): boolean {
	const { state } = view;
	const changes = state.changeByRange((range) => {
		const line = state.doc.lineAt(range.from);
		return {
			changes: { from: line.to, to: line.to, insert: `\n${line.text}` },
			range,
		};
	});
	view.dispatch(
		state.update(changes, { scrollIntoView: true, userEvent: "input" }),
	);
	return true;
}

export const SHORTCUT_COMMANDS: {
	id: ShortcutId;
	run: (view: EditorView) => boolean;
}[] = [
	{ id: "toggleLineComment", run: toggleComment },
	{ id: "toggleBlockComment", run: toggleBlockComment },
	{ id: "moveLineUp", run: moveLineUp },
	{ id: "moveLineDown", run: moveLineDown },
	{ id: "copyLineDown", run: copyLineDown },
	{ id: "deleteLine", run: deleteLine },
	{ id: "selectLine", run: selectLine },
	{ id: "matchingBracket", run: cursorMatchingBracket },
	{ id: "indentMore", run: indentMore },
	{ id: "indentLess", run: indentLess },
	{ id: "expandSelection", run: selectParentSyntax },
	{ id: "goToLine", run: gotoLine },
	{ id: "addCursorAbove", run: addCursorAbove },
	{ id: "addCursorBelow", run: addCursorBelow },
	{ id: "duplicateLine", run: duplicateLineStay },
];

export function buildShortcutKeymap(
	bindings: Record<ShortcutId, ShortcutBinding | null>,
): Extension {
	return keymap.of(
		SHORTCUT_COMMANDS.filter((d) => bindings[d.id] !== null).map((d) => ({
			key: toCmKey(bindings[d.id] as ShortcutBinding),
			run: d.run,
		})),
	);
}
