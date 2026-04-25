import { invoke } from '@tauri-apps/api/core';

export interface CairnSettings {
  treePanelWidth: number;
  showMinimap: boolean;
  editorFontSize: number;
  splitMode: boolean;
  splitLeftWidth: number;
}

export function getSettings(): Promise<CairnSettings> {
  return invoke<CairnSettings>('get_settings');
}

export function updateSettings(settings: CairnSettings): Promise<CairnSettings> {
  return invoke<CairnSettings>('update_settings', { settings });
}
