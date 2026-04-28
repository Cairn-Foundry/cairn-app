export const EDITOR_DEFAULTS = {
  fontSize: 13,
  lineNumberFontDelta: 1.5,
  autocompleteMaxRendered: 12,
  selectionMatchMinLength: 2,
  contextMenuWidth: 220,
  contextMenuHeight: 320,
  viewportPadding: 8,
} as const;

export const FOLD_MARKERS = { open: '▾', closed: '▸' } as const;
