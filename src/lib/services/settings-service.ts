import { invoke } from '@tauri-apps/api/core';
import type { ShortcutId, ShortcutBinding } from '$lib/types/shortcuts';

export interface CairnSettings {
  treePanelWidth: number;
  showMinimap: boolean;
  editorFontSize: number;
  splitMode: boolean;
  splitLeftWidth: number;
  shortcuts: Partial<Record<ShortcutId, ShortcutBinding>>;
  disabledShortcuts: ShortcutId[];
}

export function getSettings(): Promise<CairnSettings> {
  return invoke<CairnSettings>('get_settings');
}

export function updateSettings(settings: CairnSettings): Promise<CairnSettings> {
  return invoke<CairnSettings>('update_settings', { settings });
}
