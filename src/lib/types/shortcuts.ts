export type ShortcutId =
  | 'quickOpen'
  | 'searchFiles'
  | 'splitEditor'
  | 'fontSizeUp'
  | 'fontSizeDown'
  | 'fontSizeReset'
  | 'toggleLineComment'
  | 'toggleBlockComment'
  | 'moveLineUp'
  | 'moveLineDown'
  | 'copyLineDown'
  | 'deleteLine'
  | 'selectLine'
  | 'matchingBracket'
  | 'indentMore'
  | 'indentLess'
  | 'expandSelection';

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
  group: 'files' | 'editor';
  default: ShortcutBinding;
}

export interface ShortcutConfig {
  id: ShortcutId;
  binding: ShortcutBinding | null;
  enabled: boolean;
}
