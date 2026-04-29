import { SHORTCUT_DEFS } from '$lib/stores/shortcuts';

export type SettingsTab = 'general' | 'appearance' | 'editor' | 'shortcuts' | 'project';

export interface SettingEntry {
  label: string;
  desc: string;
  tab: SettingsTab;
  group: string;
}

const STATIC_SETTINGS: SettingEntry[] = [
  { label: 'AI provider',           desc: 'Agent Bridge driver',                     tab: 'general',    group: 'General' },
  { label: 'Default branch',        desc: 'Base for new worktrees',                  tab: 'general',    group: 'General' },
  { label: 'Worktree location',     desc: 'Where git worktrees are created',         tab: 'general',    group: 'General' },
  { label: 'Format on stage',       desc: 'Auto-format before staging',              tab: 'general',    group: 'General' },
  { label: 'Theme',                 desc: 'Dark, Light, or High contrast',           tab: 'appearance', group: 'Theme' },
  { label: 'Accent color',          desc: 'Highlight color across the UI',           tab: 'appearance', group: 'Accent color' },
  { label: 'Font family',           desc: 'Monospace font for code editor',          tab: 'appearance', group: 'Font' },
  { label: 'Sidebar position',      desc: 'File explorer left or right of editor',   tab: 'editor',     group: 'Layout' },
  { label: 'File tree panel width', desc: 'Width of file explorer sidebar in px',    tab: 'editor',     group: 'Layout' },
  { label: 'Font size',             desc: 'Base font size for the code editor',      tab: 'editor',     group: 'Code editor' },
  { label: 'Show minimap',          desc: 'Scrollbar overview panel in code editor', tab: 'editor',     group: 'Code editor' },
  { label: 'Workflow tabs',         desc: 'Reorder and show/hide workspace tabs',    tab: 'project',    group: 'Workflow tabs' },
];

const SHORTCUT_GROUP_LABELS: Record<string, string> = {
  files: 'Files',
  editor: 'Code Editor',
  tabs: 'Tabs',
  view: 'View',
  tree: 'File Tree',
};

export const SETTINGS_REGISTRY: SettingEntry[] = [
  ...STATIC_SETTINGS,
  ...SHORTCUT_DEFS.map(d => ({
    label: d.label,
    desc: d.description,
    tab: 'shortcuts' as SettingsTab,
    group: SHORTCUT_GROUP_LABELS[d.group] ?? 'Other',
  })),
];

export function searchSettings(query: string): SettingEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return SETTINGS_REGISTRY.filter(e =>
    e.label.toLowerCase().includes(q) || e.desc.toLowerCase().includes(q)
  );
}
