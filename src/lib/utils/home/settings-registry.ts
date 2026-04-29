import { SHORTCUT_DEFS, SHORTCUT_GROUP_LABELS } from '$lib/stores/shortcuts';
import { t } from '$lib/i18n';

export type SettingsTab = 'general' | 'appearance' | 'editor' | 'shortcuts' | 'project' | 'languages';

export interface SettingEntry {
  label: string;
  desc: string;
  tab: SettingsTab;
  group: string;
}

const s = t as (k: string) => string;

const STATIC_SETTINGS: SettingEntry[] = [
  { label: s('settings.general.rows.aiProvider.label'),       desc: s('settings.general.rows.aiProvider.desc'),       tab: 'general',    group: s('settings.general.groupTitle') },
  { label: s('settings.general.rows.defaultBranch.label'),    desc: s('settings.general.rows.defaultBranch.desc'),    tab: 'general',    group: s('settings.general.groupTitle') },
  { label: s('settings.general.rows.worktreeLocation.label'), desc: s('settings.general.rows.worktreeLocation.desc'), tab: 'general',    group: s('settings.general.groupTitle') },
  { label: s('settings.general.rows.formatOnStage.label'),    desc: s('settings.general.rows.formatOnStage.desc'),    tab: 'general',    group: s('settings.general.groupTitle') },
  { label: s('settings.appearance.themeGroup'),               desc: s('settings.appearance.themeDesc'),               tab: 'appearance', group: s('settings.appearance.themeGroup') },
  { label: s('settings.appearance.accentGroup'),              desc: s('settings.appearance.accentDesc'),              tab: 'appearance', group: s('settings.appearance.accentGroup') },
  { label: s('settings.appearance.fontGroup'),                desc: s('settings.appearance.fontDesc'),                tab: 'appearance', group: s('settings.appearance.fontGroup') },
  { label: s('settings.editor.sidebarPosition'),              desc: s('settings.editor.sidebarPositionDesc'),         tab: 'editor',     group: s('settings.editor.layoutGroup') },
  { label: s('settings.editor.treePanelWidth'),               desc: s('settings.editor.treePanelWidthDesc'),          tab: 'editor',     group: s('settings.editor.layoutGroup') },
  { label: s('settings.editor.fontSize'),                     desc: s('settings.editor.fontSizeDesc'),                tab: 'editor',     group: s('settings.editor.codeEditorGroup') },
  { label: s('settings.editor.showMinimap'),                  desc: s('settings.editor.showMinimapDesc'),             tab: 'editor',     group: s('settings.editor.codeEditorGroup') },
  { label: s('settings.project.workflowTabsGroup'),           desc: s('settings.project.workflowTabsHint'),           tab: 'project',    group: s('settings.project.workflowTabsGroup') },
  { label: s('settings.languages.groupTitle'),                desc: s('settings.languages.desc'),                     tab: 'languages',  group: s('settings.languages.groupTitle') },
];

export const SETTINGS_REGISTRY: SettingEntry[] = [
  ...STATIC_SETTINGS,
  ...SHORTCUT_DEFS.map(d => ({
    label: d.label,
    desc: d.description,
    tab: 'shortcuts' as SettingsTab,
    group: SHORTCUT_GROUP_LABELS[d.group] ?? s('settings.shortcuts.groupFallback'),
  })),
];

export function searchSettings(query: string): SettingEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return SETTINGS_REGISTRY.filter(e =>
    e.label.toLowerCase().includes(q) || e.desc.toLowerCase().includes(q)
  );
}
