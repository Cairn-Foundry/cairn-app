import { writable } from 'svelte/store';
import { getSettings, updateSettings, type CairnSettings } from '$lib/services/settings-service';

const DEFAULTS: CairnSettings = { treePanelWidth: 220, showMinimap: true, editorFontSize: 13, splitMode: false, splitLeftWidth: 0 };

const { subscribe, set, update } = writable<CairnSettings>(DEFAULTS);

async function load() {
  try {
    set(await getSettings());
  } catch {}
}

async function save(patch: Partial<CairnSettings>) {
  update((s) => {
    const next = { ...s, ...patch };
    updateSettings(next).then(set).catch(() => {});
    return next;
  });
}

export const settings = { subscribe, load, save };
