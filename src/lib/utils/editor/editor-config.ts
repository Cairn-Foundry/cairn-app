/** Editor sizing constants shared by the CodeMirror setup and its chrome. */
export const EDITOR_DEFAULTS = {
	fontSize: 13,
	lineNumberFontDelta: 1.5,
	selectionMatchMinLength: 2,
	contextMenuWidth: 220,
	contextMenuHeight: 440,
	viewportPadding: 8,
} as const;

/** Bounds for the user-adjustable editor font size. */
export const FONT_SIZE_MIN = 8;
export const FONT_SIZE_MAX = 32;

/** The triangles drawn in the fold gutter. */
export const FOLD_MARKERS = { open: "▾", closed: "▸" } as const;
