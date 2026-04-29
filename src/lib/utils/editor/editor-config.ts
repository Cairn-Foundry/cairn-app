export const EDITOR_DEFAULTS = {
	fontSize: 13,
	lineNumberFontDelta: 1.5,
	autocompleteMaxRendered: 12,
	selectionMatchMinLength: 2,
	contextMenuWidth: 220,
	contextMenuHeight: 320,
	viewportPadding: 8,
} as const;

export const FONT_SIZE_MIN = 8;
export const FONT_SIZE_MAX = 32;

export const FOLD_MARKERS = { open: "▾", closed: "▸" } as const;
