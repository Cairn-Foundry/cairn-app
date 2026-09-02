// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

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
import { EditorView, keymap, ViewPlugin } from "@codemirror/view";
import { showMinimap } from "@replit/codemirror-minimap";
import { toCmKey } from "$lib/stores/shortcuts";
import type { ShortcutBinding, ShortcutId } from "$lib/types/shortcuts";
import { EDITOR_DEFAULTS } from "./editor-config";

// The CodeMirror extensions that are not a feature of their own: font sizing,
// the minimap and its two fixes, and the editing keymap.

/** Line numbers are set slightly smaller than the code they number. */
const fontSizeThemes = new Map<number, Extension>();

export function buildFontSizeTheme(size: number): Extension {
	const cached = fontSizeThemes.get(size);
	if (cached) return cached;
	const built = buildFontSizeThemeUncached(size);
	fontSizeThemes.set(size, built);
	return built;
}

function buildFontSizeThemeUncached(size: number): Extension {
	return EditorView.theme({
		"&": { fontSize: `${size}px` },
		".cm-lineNumbers .cm-gutterElement": {
			fontSize: `${size - EDITOR_DEFAULTS.lineNumberFontDelta}px`,
		},
	});
}

/**
 * The plugin draws the viewport box at 0.2 opacity, which reads as nothing at
 * all over a dense minimap.
 */
const minimapOverlayTheme = EditorView.theme({
	".cm-minimap-overlay-container .cm-minimap-overlay": {
		background: "var(--accent)",
		opacity: "0.22",
		borderRadius: "2px",
		boxSizing: "border-box",
	},
	".cm-minimap-overlay-container .cm-minimap-overlay:hover": {
		opacity: "0.34",
	},
	".cm-minimap-overlay-container.cm-minimap-overlay-active .cm-minimap-overlay":
		{
			opacity: "0.4",
		},
});

/**
 * The plugin never calls preventDefault on its own mousedown, so dragging the
 * viewport box - or clicking elsewhere on the minimap to jump - also reaches
 * CodeMirror's own selection handling underneath (a same-phase, same-target
 * listener) and starts a text selection at the same time. Caught here in the
 * capture phase, ahead of both handlers, the same way the completion menu's
 * own wheel handler keeps its gesture off the editor scroller.
 */
const minimapMousedownGuard = ViewPlugin.fromClass(
	class {
		private onMouseDown: (event: MouseEvent) => void;

		constructor(private view: EditorView) {
			this.onMouseDown = (event) => {
				const target = event.target as Element | null;
				if (!target?.closest(".cm-minimap-gutter")) return;
				event.preventDefault();
			};
			view.dom.addEventListener("mousedown", this.onMouseDown, {
				capture: true,
			});
		}

		destroy() {
			this.view.dom.removeEventListener("mousedown", this.onMouseDown, true);
		}
	},
);

/** The minimap plus its two corrections; nothing at all when disabled. */
export function buildMinimap(
	enabled: boolean,
	diffGutter?: Record<number, string>,
): Extension {
	if (!enabled) return [];
	return [
		showMinimap.of({
			create: () => ({ dom: document.createElement("div") }),
			displayText: "blocks",
			showOverlay: "always",
			gutters: diffGutter ? [diffGutter] : undefined,
		}),
		minimapOverlayTheme,
		minimapMousedownGuard,
	];
}

/** Read-only diff views: no current line highlight, the selection is the markers. */
export const noActiveLineTheme: Extension = EditorView.theme({
	".cm-activeLine": { backgroundColor: "transparent !important" },
	".cm-activeLineGutter": { backgroundColor: "transparent !important" },
});

/** An inline diff grows with its content instead of scrolling inside a fixed box. */
export const inlineDiffTheme: Extension = EditorView.theme({
	"&": { height: "auto" },
	".cm-scroller": { overflow: "visible" },
	".cm-activeLine": { backgroundColor: "transparent !important" },
	".cm-activeLineGutter": { backgroundColor: "transparent !important" },
});

/** Line numbers are chrome, not content: dragging over them must not select them. */
export const unselectableGutters: Extension = EditorView.theme({
	".cm-gutters": { userSelect: "none", "-webkit-user-select": "none" },
});

/** Duplicates the line but leaves the caret where it was, unlike `copyLineDown`. */
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

/** The editing commands a shortcut can be bound to. */
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

/** Binds the commands the user actually kept; an unbound id gets no key. */
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
