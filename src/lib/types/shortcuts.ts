/** Every bindable command; each id needs a matching entry in SHORTCUT_DEFS (stores/shortcuts.ts). */
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
	| "openFormatting"
	| "goHome"
	| "reloadEditor"
	| "reloadProject"
	// Integrations (global)
	| "createMergeRequest"
	| "openBranchOnForge"
	| "retryLastPipeline"
	// Review guide
	| "reviewNextExcerpt"
	| "reviewPrevExcerpt"
	| "reviewNextChapter"
	| "reviewPrevChapter"
	| "reviewMarkSeen"
	| "reviewComment"
	| "reviewDismiss"
	| "reviewToggleMode";

/** Placeholder key of a binding triggered by a click instead of a keystroke. */
export const MOUSE_KEY = "Click";

/** The modifiers a binding matches on, as carried by a mouse or key event. */
export interface ModifierState {
	shiftKey: boolean;
	altKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
}

/** A single keystroke or click; `mod` is the platform accelerator (Cmd on macOS, Ctrl elsewhere). */
export interface ShortcutBinding {
	key: string;
	mod: boolean;
	shift: boolean;
	alt: boolean;
	ctrl: boolean;
}

/** Static declaration of a command: its label, group and factory-default binding. */
export interface ShortcutDef {
	id: ShortcutId;
	label: string;
	description: string;
	group: "files" | "editor" | "tabs" | "view" | "tree" | "app";
	/** null for a command that ships unbound: rebindable, but no factory keystroke. */
	default: ShortcutBinding | null;
	/** Bound to a mouse click rather than a key: recorded and matched on a click. */
	mouse?: boolean;
	/** Kept out of the command palette. */
	hidden?: boolean;
}

/** A user override of a ShortcutDef; a null binding means the command has been unbound. */
export interface ShortcutConfig {
	id: ShortcutId;
	binding: ShortcutBinding | null;
	enabled: boolean;
}
