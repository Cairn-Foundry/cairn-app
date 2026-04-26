import { writable } from 'svelte/store';
import { getSettings, updateSettings, type CairnSettings } from '$lib/services/settings-service';

const DEFAULT_WORKFLOW_TABS: CairnSettings['workflowTabs'] = [
  { key: 'files',  name: 'Files',  icon: 'folder', enabled: true, order: 0 },
  { key: 'agent',  name: 'Agent',  icon: 'agent',  enabled: true, order: 1 },
  { key: 'review', name: 'Review', icon: 'review', enabled: true, order: 2 },
  { key: 'tests',  name: 'Tests',  icon: 'tests',  enabled: true, order: 3 },
  { key: 'git',    name: 'Git',    icon: 'git',    enabled: true, order: 4 },
  { key: 'cicd',   name: 'CI/CD',  icon: 'ci',     enabled: true, order: 5 },
];

const DEFAULTS: CairnSettings = { treePanelWidth: 220, showMinimap: true, editorFontSize: 13, fontFamily: "'JetBrains Mono', ui-monospace, monospace", splitMode: false, splitLeftWidth: 0, shortcuts: [], theme: 'dark', accentColor: '#6c8eff', workflowTabs: DEFAULT_WORKFLOW_TABS, sidebarPosition: 'left', showWhitespace: false, saveOn: 'blur' };

const { subscribe, set, update } = writable<CairnSettings>(DEFAULTS);

function mergeWithDefaults(base: CairnSettings, override: Partial<CairnSettings>): CairnSettings {
  const result = { ...base };
  for (const key of Object.keys(DEFAULTS) as (keyof CairnSettings)[]) {
    const v = override[key];
    if (v !== undefined && v !== null) (result as any)[key] = v;
  }
  return result;
}

async function load() {
  try {
    set(mergeWithDefaults(DEFAULTS, await getSettings()));
  } catch {}
}

async function save(patch: Partial<CairnSettings>) {
  update((s) => {
    const next = { ...s, ...patch };
    updateSettings(next).then(returned => {
      update(current => mergeWithDefaults(current, returned));
    }).catch(() => {});
    return next;
  });
}

export const settings = { subscribe, load, save };
