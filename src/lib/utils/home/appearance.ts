export const ACCENT_PRESETS: { label: string; color: string }[] = [
  { label: 'Blue',   color: '#6c8eff' },
  { label: 'Purple', color: '#a855f7' },
  { label: 'Pink',   color: '#ec4899' },
  { label: 'Red',    color: '#ef4444' },
  { label: 'Orange', color: '#f97316' },
  { label: 'Yellow', color: '#eab308' },
  { label: 'Green',  color: '#22c55e' },
  { label: 'Teal',   color: '#14b8a6' },
  { label: 'Cyan',   color: '#06b6d4' },
];

export const FONT_OPTIONS: { label: string; stack: string; sample: string }[] = [
  { label: 'JetBrains Mono', stack: "'JetBrains Mono', ui-monospace, monospace", sample: 'Ag01' },
  { label: 'Fira Code',      stack: "'Fira Code', ui-monospace, monospace",      sample: 'Ag01' },
  { label: 'System Mono',    stack: 'ui-monospace, monospace',                   sample: 'Ag01' },
  { label: 'Menlo',          stack: 'Menlo, ui-monospace, monospace',            sample: 'Ag01' },
  { label: 'Monaco',         stack: 'Monaco, ui-monospace, monospace',           sample: 'Ag01' },
  { label: 'Consolas',       stack: 'Consolas, ui-monospace, monospace',         sample: 'Ag01' },
  { label: 'Courier New',    stack: "'Courier New', monospace",                  sample: 'Ag01' },
];

export const SAVE_ON_OPTIONS: { value: string; label: string; desc: string }[] = [
  { value: 'blur',           label: 'Focus change',    desc: 'Save when editor loses focus' },
  { value: 'windowChange',   label: 'Window blur',     desc: 'Save when app window loses focus' },
  { value: 'projectChange',  label: 'Project change',  desc: 'Save when switching projects' },
  { value: 'instanceChange', label: 'Instance change', desc: 'Save when switching instances' },
  { value: 'manual',         label: 'Manual',          desc: 'Save only on ⌘S' },
];

export const MODIFIER_KEYS = new Set(['Meta', 'Control', 'Shift', 'Alt', 'CapsLock', 'OS']);
