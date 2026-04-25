import { invoke } from '@tauri-apps/api/core';
import type { ShortcutId, ShortcutBinding } from '$lib/types/shortcuts';
import type { WorkflowStep } from '$lib/types/instance';

export interface WorkflowTabConfig {
  key: WorkflowStep;
  name: string;
  icon: string;
  enabled: boolean;
  order: number;
}

export interface CairnSettings {
  treePanelWidth: number;
  showMinimap: boolean;
  editorFontSize: number;
  fontFamily: string;
  splitMode: boolean;
  splitLeftWidth: number;
  shortcuts: Partial<Record<ShortcutId, ShortcutBinding>>;
  disabledShortcuts: ShortcutId[];
  theme: 'dark' | 'light' | 'high-contrast';
  accentColor: string;
  workflowTabs: WorkflowTabConfig[];
}

export function getSettings(): Promise<CairnSettings> {
  return invoke<CairnSettings>('get_settings');
}

export function updateSettings(settings: CairnSettings): Promise<CairnSettings> {
  return invoke<CairnSettings>('update_settings', { settings });
}
