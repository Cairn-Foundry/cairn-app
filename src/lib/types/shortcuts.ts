export type ShortcutId =
	| "quickOpen"
	| "searchFiles"
	| "splitEditor"
	| "fontSizeUp"
	| "fontSizeDown"
	| "fontSizeReset"
	| "toggleLineComment"
	| "toggleBlockComment"
	| "moveLineUp"
	| "moveLineDown"
	| "copyLineDown"
	| "deleteLine"
	| "selectLine"
	| "matchingBracket"
	| "indentMore"
	| "indentLess"
	| "expandSelection"
	// Tab management
	| "closeTab"
	| "reopenClosedTab"
	| "nextTab"
	| "prevTab"
	| "tabHistoryBack"
	| "tabHistoryForward"
	// Find & navigation (editor)
	| "goToLine"
	// Multi-cursor (editor)
	| "addCursorAbove"
	| "addCursorBelow"
	// Editing (editor)
	| "saveFile"
	| "duplicateLine"
	// View (global)
	| "toggleSidebar"
	| "commandPalette"
	| "openSettings"
	// File tree
	| "treeSelectAll"
	| "treeCopy"
	| "treeCut"
	| "treePaste"
	| "treeDelete"
	| "treeRename"
	| "treeNewFile"
	| "treeNewFolder";

export interface ShortcutBinding {
	key: string;
	mod: boolean;
	shift: boolean;
	alt: boolean;
	ctrl: boolean;
}

export interface ShortcutDef {
	id: ShortcutId;
	label: string;
	description: string;
	group: "files" | "editor" | "tabs" | "view" | "tree";
	default: ShortcutBinding;
}

export interface ShortcutConfig {
	id: ShortcutId;
	binding: ShortcutBinding | null;
	enabled: boolean;
}
