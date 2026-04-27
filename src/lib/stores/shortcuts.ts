import { derived } from 'svelte/store';
import { settings } from '$lib/stores/settings';
import type { ShortcutId, ShortcutBinding, ShortcutDef } from '$lib/types/shortcuts';

export const SHORTCUT_DEFS: ShortcutDef[] = [
  // ── Files group ────────────────────────────────────────────────────────────
  {
    id: 'quickOpen',
    label: 'Quick open file',
    description: 'Open a file by name in the current project',
    group: 'files',
    default: { key: 'p', mod: true, shift: false, alt: false, ctrl: false },
  },
  {
    id: 'searchFiles',
    label: 'Search in files',
    description: 'Full-text search across all project files',
    group: 'files',
    default: { key: 'f', mod: true, shift: true, alt: false, ctrl: false },
  },
  {
    id: 'splitEditor',
    label: 'Toggle split editor',
    description: 'Split the editor into two side-by-side panes',
    group: 'files',
    default: { key: '\\', mod: true, shift: false, alt: false, ctrl: false },
  },
  {
    id: 'fontSizeUp',
    label: 'Increase font size',
    description: 'Increase the editor font size by 1 px',
    group: 'files',
    default: { key: '=', mod: true, shift: false, alt: false, ctrl: false },
  },
  {
    id: 'fontSizeDown',
    label: 'Decrease font size',
    description: 'Decrease the editor font size by 1 px',
    group: 'files',
    default: { key: '-', mod: true, shift: false, alt: false, ctrl: false },
  },
  {
    id: 'fontSizeReset',
    label: 'Reset font size',
    description: 'Reset the editor font size to the default (13 px)',
    group: 'files',
    default: { key: '0', mod: true, shift: false, alt: false, ctrl: false },
  },
  // ── Editor group ───────────────────────────────────────────────────────────
  {
    id: 'toggleLineComment',
    label: 'Toggle line comment',
    description: 'Comment or uncomment the current line',
    group: 'editor',
    default: { key: '/', mod: true, shift: false, alt: false, ctrl: false },
  },
  {
    id: 'toggleBlockComment',
    label: 'Toggle block comment',
    description: 'Wrap the selection in a block comment',
    group: 'editor',
    default: { key: 'a', mod: false, shift: true, alt: true, ctrl: false },
  },
  {
    id: 'moveLineUp',
    label: 'Move line up',
    description: 'Move the current line up',
    group: 'editor',
    default: { key: 'ArrowUp', mod: false, shift: false, alt: true, ctrl: false },
  },
  {
    id: 'moveLineDown',
    label: 'Move line down',
    description: 'Move the current line down',
    group: 'editor',
    default: { key: 'ArrowDown', mod: false, shift: false, alt: true, ctrl: false },
  },
  {
    id: 'copyLineDown',
    label: 'Copy line down',
    description: 'Duplicate the current line below',
    group: 'editor',
    default: { key: 'ArrowDown', mod: false, shift: true, alt: true, ctrl: false },
  },
  {
    id: 'deleteLine',
    label: 'Delete line',
    description: 'Delete the current line',
    group: 'editor',
    default: { key: 'k', mod: true, shift: true, alt: false, ctrl: false },
  },
  {
    id: 'selectLine',
    label: 'Select line',
    description: 'Select the entire current line',
    group: 'editor',
    default: { key: 'l', mod: true, shift: false, alt: false, ctrl: false },
  },
  {
    id: 'matchingBracket',
    label: 'Jump to matching bracket',
    description: 'Move the cursor to the matching bracket',
    group: 'editor',
    default: { key: 'm', mod: false, shift: false, alt: false, ctrl: true },
  },
  {
    id: 'indentMore',
    label: 'Indent more',
    description: 'Increase indentation of the current line',
    group: 'editor',
    default: { key: ']', mod: true, shift: false, alt: false, ctrl: false },
  },
  {
    id: 'indentLess',
    label: 'Indent less',
    description: 'Decrease indentation of the current line',
    group: 'editor',
    default: { key: '[', mod: true, shift: false, alt: false, ctrl: false },
  },
  {
    id: 'expandSelection',
    label: 'Expand selection',
    description: 'Expand selection to the parent syntax node',
    group: 'editor',
    default: { key: 'ArrowRight', mod: false, shift: true, alt: true, ctrl: false },
  },
  // ── Tabs group ─────────────────────────────────────────────────────────────
  {
    id: 'closeTab',
    label: 'Close tab',
    description: 'Close the active editor tab',
    group: 'tabs',
    default: { key: 'w', mod: true, shift: false, alt: false, ctrl: false },
  },
  {
    id: 'reopenClosedTab',
    label: 'Reopen closed tab',
    description: 'Reopen the last closed tab',
    group: 'tabs',
    default: { key: 't', mod: true, shift: true, alt: false, ctrl: false },
  },
  {
    id: 'nextTab',
    label: 'Next tab',
    description: 'Cycle to the next open tab',
    group: 'tabs',
    default: { key: 'Tab', mod: false, shift: false, alt: false, ctrl: true },
  },
  {
    id: 'prevTab',
    label: 'Previous tab',
    description: 'Cycle to the previous open tab',
    group: 'tabs',
    default: { key: 'Tab', mod: false, shift: true, alt: false, ctrl: true },
  },
  {
    id: 'tabHistoryBack',
    label: 'Tab history back',
    description: 'Navigate to the previously focused tab',
    group: 'tabs',
    default: { key: 'ArrowLeft', mod: true, shift: false, alt: true, ctrl: false },
  },
  {
    id: 'tabHistoryForward',
    label: 'Tab history forward',
    description: 'Navigate forward in tab history',
    group: 'tabs',
    default: { key: 'ArrowRight', mod: true, shift: false, alt: true, ctrl: false },
  },
  // ── View group ─────────────────────────────────────────────────────────────
  {
    id: 'toggleSidebar',
    label: 'Toggle sidebar',
    description: 'Show or hide the file tree sidebar',
    group: 'view',
    default: { key: 'b', mod: true, shift: false, alt: false, ctrl: false },
  },
  {
    id: 'commandPalette',
    label: 'Command palette',
    description: 'Open the command palette to search all actions',
    group: 'view',
    default: { key: 'p', mod: true, shift: true, alt: false, ctrl: false },
  },
  {
    id: 'openSettings',
    label: 'Open settings',
    description: 'Open the settings panel',
    group: 'view',
    default: { key: ',', mod: true, shift: false, alt: false, ctrl: false },
  },
  // ── Editor (additional) ────────────────────────────────────────────────────
  {
    id: 'goToLine',
    label: 'Go to line',
    description: 'Jump to a specific line number',
    group: 'editor',
    default: { key: 'g', mod: false, shift: false, alt: false, ctrl: true },
  },
  {
    id: 'addCursorAbove',
    label: 'Add cursor above',
    description: 'Add an additional cursor on the line above',
    group: 'editor',
    default: { key: 'ArrowUp', mod: true, shift: false, alt: true, ctrl: false },
  },
  {
    id: 'addCursorBelow',
    label: 'Add cursor below',
    description: 'Add an additional cursor on the line below',
    group: 'editor',
    default: { key: 'ArrowDown', mod: true, shift: false, alt: true, ctrl: false },
  },
  {
    id: 'saveFile',
    label: 'Save file',
    description: 'Explicitly save the active file',
    group: 'editor',
    default: { key: 's', mod: true, shift: false, alt: false, ctrl: false },
  },
  {
    id: 'duplicateLine',
    label: 'Duplicate line',
    description: 'Duplicate the current line, cursor stays on original',
    group: 'editor',
    default: { key: 'd', mod: true, shift: true, alt: false, ctrl: false },
  },
  // ── File tree group ────────────────────────────────────────────────────────
  {
    id: 'treeSelectAll',
    label: 'Select all in tree',
    description: 'Select every visible file and folder in the file tree',
    group: 'tree',
    default: { key: 'a', mod: true, shift: false, alt: false, ctrl: false },
  },
  {
    id: 'treeCopy',
    label: 'Copy file(s)',
    description: 'Copy the selected file(s) to the clipboard',
    group: 'tree',
    default: { key: 'c', mod: true, shift: false, alt: false, ctrl: false },
  },
  {
    id: 'treeCut',
    label: 'Cut file(s)',
    description: 'Cut the selected file(s) to the clipboard',
    group: 'tree',
    default: { key: 'x', mod: true, shift: false, alt: false, ctrl: false },
  },
  {
    id: 'treePaste',
    label: 'Paste file(s)',
    description: 'Paste clipboard file(s) into the selected or active directory',
    group: 'tree',
    default: { key: 'v', mod: true, shift: false, alt: false, ctrl: false },
  },
  {
    id: 'treeDelete',
    label: 'Delete file(s)',
    description: 'Delete the selected file(s) and folder(s)',
    group: 'tree',
    default: { key: 'Backspace', mod: true, shift: false, alt: false, ctrl: false },
  },
  {
    id: 'treeRename',
    label: 'Rename file',
    description: 'Rename the selected file or folder',
    group: 'tree',
    default: { key: 'Enter', mod: false, shift: false, alt: false, ctrl: false },
  },
  {
    id: 'treeNewFile',
    label: 'New file',
    description: 'Create a new file in the active directory',
    group: 'tree',
    default: { key: 'n', mod: true, shift: false, alt: false, ctrl: false },
  },
  {
    id: 'treeNewFolder',
    label: 'New folder',
    description: 'Create a new folder in the active directory',
    group: 'tree',
    default: { key: 'n', mod: true, shift: true, alt: false, ctrl: false },
  },
];

export const shortcuts = derived(settings, ($s) => {
  const configMap = new Map(($s.shortcuts ?? []).map(c => [c.id, c]));
  const result = {} as Record<ShortcutId, ShortcutBinding>;
  for (const def of SHORTCUT_DEFS) {
    result[def.id] = configMap.get(def.id)?.binding ?? { ...def.default };
  }
  return result;
});

export const activeShortcuts = derived(settings, ($s) => {
  const configMap = new Map(($s.shortcuts ?? []).map(c => [c.id, c]));
  const result = {} as Record<ShortcutId, ShortcutBinding | null>;
  for (const def of SHORTCUT_DEFS) {
    const config = configMap.get(def.id);
    result[def.id] = config && !config.enabled ? null : (config?.binding ?? { ...def.default });
  }
  return result;
});

const IS_MAC = typeof navigator !== 'undefined' && navigator.platform.startsWith('Mac');

export function matchesShortcut(e: KeyboardEvent, b: ShortcutBinding | null): boolean {
  if (!b) return false;
  const modActive = IS_MAC ? e.metaKey : e.ctrlKey;
  return (
    e.key.toLowerCase() === b.key.toLowerCase() &&
    modActive === b.mod &&
    e.shiftKey === b.shift &&
    e.altKey === b.alt &&
    e.ctrlKey === b.ctrl
  );
}

export function toCmKey(b: ShortcutBinding): string {
  const parts: string[] = [];
  if (b.mod)   parts.push('Mod');
  if (b.ctrl)  parts.push('Ctrl');
  if (b.shift) parts.push('Shift');
  if (b.alt)   parts.push('Alt');
  parts.push(b.key);
  return parts.join('-');
}

const KEY_LABELS: Record<string, string> = {
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Escape: 'Esc', Backspace: '⌫', Delete: 'Del', Enter: '↩', Tab: '⇥',
  ' ': 'Space',
};

export function bindingToLabels(b: ShortcutBinding, mac = IS_MAC): string[] {
  const labels: string[] = [];
  if (b.mod)             labels.push(mac ? '⌘' : 'Ctrl');
  if (b.ctrl && !b.mod)  labels.push('Ctrl');
  if (b.shift)           labels.push('⇧');
  if (b.alt)             labels.push(mac ? '⌥' : 'Alt');
  labels.push(KEY_LABELS[b.key] ?? b.key.toUpperCase());
  return labels;
}

export function bindingKey(b: ShortcutBinding): string {
  return `${b.mod ? 1 : 0}${b.shift ? 1 : 0}${b.alt ? 1 : 0}${b.ctrl ? 1 : 0}:${b.key.toLowerCase()}`;
}
