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
	// Language server (editor)
	| "goToDefinition"
	| "findReferences"
	| "renameSymbol"
	| "formatDocument"
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
	| "treeNewFolder"
	// Application (global)
	| "toggleFullscreen"
	| "toggleTools"
	| "openTerminal"
	| "openCommands"
	| "openEnv"
	| "goHome"
	| "reloadEditor"
	| "reloadProject";

export const MOUSE_KEY = "Click";

/** The modifiers a binding matches on, as carried by a mouse or key event. */
export interface ModifierState {
	shiftKey: boolean;
	altKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
}

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
	group: "files" | "editor" | "tabs" | "view" | "tree" | "app";
	default: ShortcutBinding;
	/** Bound to a mouse click rather than a key: recorded and matched on a click. */
	mouse?: boolean;
	/** Kept out of the command palette. */
	hidden?: boolean;
}

export interface ShortcutConfig {
	id: ShortcutId;
	binding: ShortcutBinding | null;
	enabled: boolean;
}
