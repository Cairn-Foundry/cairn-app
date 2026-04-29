import { t } from '$lib/i18n';

export const DEFAULT_ACCENT = '#6c8eff';

export const ACCENT_PRESETS: { label: string; color: string }[] = [
  { label: t('settings.appearance.accentColors.blue')   as string, color: DEFAULT_ACCENT },
  { label: t('settings.appearance.accentColors.purple') as string, color: '#a855f7' },
  { label: t('settings.appearance.accentColors.pink')   as string, color: '#ec4899' },
  { label: t('settings.appearance.accentColors.red')    as string, color: '#ef4444' },
  { label: t('settings.appearance.accentColors.orange') as string, color: '#f97316' },
  { label: t('settings.appearance.accentColors.yellow') as string, color: '#eab308' },
  { label: t('settings.appearance.accentColors.green')  as string, color: '#22c55e' },
  { label: t('settings.appearance.accentColors.teal')   as string, color: '#14b8a6' },
  { label: t('settings.appearance.accentColors.cyan')   as string, color: '#06b6d4' },
];

// Font names are proper typeface names — not translated.
export const FONT_OPTIONS: { label: string; stack: string; sample: string }[] = [
  { label: 'JetBrains Mono', stack: "'JetBrains Mono', ui-monospace, monospace", sample: 'Ag01' },
  { label: 'Fira Code',      stack: "'Fira Code', ui-monospace, monospace",      sample: 'Ag01' },
  { label: 'System Mono',    stack: 'ui-monospace, monospace',                   sample: 'Ag01' },
  { label: 'Menlo',          stack: 'Menlo, ui-monospace, monospace',            sample: 'Ag01' },
  { label: 'Monaco',         stack: 'Monaco, ui-monospace, monospace',           sample: 'Ag01' },
  { label: 'Consolas',       stack: 'Consolas, ui-monospace, monospace',         sample: 'Ag01' },
  { label: 'Courier New',    stack: "'Courier New', monospace",                  sample: 'Ag01' },
];

type SaveOnValue = 'blur' | 'windowChange' | 'projectChange' | 'instanceChange' | 'manual';

export const SAVE_ON_OPTIONS: { value: SaveOnValue; label: string; desc: string }[] = (
  ['blur', 'windowChange', 'projectChange', 'instanceChange', 'manual'] as SaveOnValue[]
).map((value) => ({
  value,
  label: t(`settings.editor.saveOnOptions.${value}.label`) as string,
  desc:  t(`settings.editor.saveOnOptions.${value}.desc`)  as string,
}));

export const MODIFIER_KEYS = new Set(['Meta', 'Control', 'Shift', 'Alt', 'CapsLock', 'OS']);

export const PROJECT_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444',
  '#f97316', '#eab308', '#22c55e', '#06b6d4',
];
