import { readFile, isBinaryPath, type DiffHunk, type BlameEntry } from '$lib/services/file-service';
import { detectLineEndings, normalizeLineEndings } from './files-indent';

export interface Tab {
  path: string;
  content: string;
  pending: string;
  cursorPos: number;
  scrollTop: number;
  pinned?: boolean;
  lineEndings?: 'LF' | 'CRLF';
}

export interface PersistedTab { path: string; cursorPos: number; scrollTop: number; pinned?: boolean }

export interface PersistedPane {
  tabs: PersistedTab[];
  activeTabIdx: number;
}

export interface PersistedState {
  panes: PersistedPane[];
  expanded: string[];
  splitMode?: boolean;
  splitLeftWidth?: number;
}

export interface PaneTabState {
  tabs: Tab[];
  activeTabIdx: number;
}

export interface InstanceTabState {
  panes: PaneTabState[];
  expanded: Set<string>;
  splitMode: boolean;
  splitLeftWidth: number;
}

export interface PaneDiffState {
  currentDiffHunks: DiffHunk[];
  currentStagedHunks: DiffHunk[];
  currentBlame: Map<number, BlameEntry>;
}

const FILE_STATE_KEY = (id: string) => `cairn:file-state:${id}`;
const RECENT_FILES_KEY = (id: string) => `cairn:recent-files:${id}`;
const RECENT_FILES_LIMIT = 10;

export function persistState(instanceId: string, state: InstanceTabState): void {
  try {
    const data: PersistedState = {
      panes: state.panes.map(p => ({
        tabs: p.tabs.map(t => ({ path: t.path, cursorPos: t.cursorPos, scrollTop: t.scrollTop, pinned: t.pinned })),
        activeTabIdx: p.activeTabIdx,
      })),
      expanded: [...state.expanded],
      splitMode: state.splitMode,
      splitLeftWidth: state.splitLeftWidth,
    };
    localStorage.setItem(FILE_STATE_KEY(instanceId), JSON.stringify(data));
  } catch {}
}

export function readPersistedState(instanceId: string): PersistedState | null {
  try {
    const raw = localStorage.getItem(FILE_STATE_KEY(instanceId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedState & { tabs?: PersistedTab[]; activeTabIdx?: number; tabs2?: PersistedTab[]; activeTabIdx2?: number };
    if (!parsed.panes && parsed.tabs) {
      const panes: PersistedPane[] = [
        { tabs: parsed.tabs, activeTabIdx: parsed.activeTabIdx ?? -1 },
        { tabs: parsed.tabs2 ?? [], activeTabIdx: parsed.activeTabIdx2 ?? -1 },
      ];
      return { panes, expanded: parsed.expanded, splitMode: parsed.splitMode, splitLeftWidth: parsed.splitLeftWidth };
    }
    return parsed;
  } catch { return null; }
}

export function readRecentFiles(instanceId: string): string[] {
  try {
    const raw = localStorage.getItem(RECENT_FILES_KEY(instanceId));
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch { return []; }
}

export function writeRecentFiles(instanceId: string, paths: string[]): void {
  try { localStorage.setItem(RECENT_FILES_KEY(instanceId), JSON.stringify(paths)); } catch {}
}

export function pushRecent(prev: string[], path: string): string[] {
  return [path, ...prev.filter(p => p !== path)].slice(0, RECENT_FILES_LIMIT);
}

async function rehydrateTabList(wtp: string, persistedTabs: PersistedTab[]): Promise<Tab[]> {
  const results = await Promise.all(
    persistedTabs.map(async (p) => {
      if (isBinaryPath(p.path)) return { path: p.path, text: '' };
      try { return { path: p.path, text: await readFile(`${wtp}/${p.path}`) ?? '' }; }
      catch { return null; }
    })
  );
  const valid = results.filter(Boolean) as { path: string; text: string }[];
  return valid.map(r => {
    const saved = persistedTabs.find(p => p.path === r.path)!;
    const le = detectLineEndings(r.text);
    const normalized = normalizeLineEndings(r.text, le);
    return { path: r.path, content: normalized, pending: normalized, cursorPos: saved.cursorPos, scrollTop: saved.scrollTop, pinned: saved.pinned, lineEndings: le };
  });
}

export interface RehydrateResult {
  panes: PaneTabState[];
  expanded: Set<string>;
  splitMode: boolean;
  splitLeftWidth: number;
}

export async function rehydrateFromPersisted(wtp: string, persisted: PersistedState): Promise<RehydrateResult> {
  const rehydratedLists = await Promise.all(
    persisted.panes.map(p => rehydrateTabList(wtp, p.tabs))
  );

  const panes: PaneTabState[] = rehydratedLists.map((tabs, i) => {
    let activeTabIdx = persisted.panes[i].activeTabIdx;
    if (tabs.length === 0) activeTabIdx = -1;
    else if (activeTabIdx >= tabs.length) activeTabIdx = tabs.length - 1;
    else if (activeTabIdx < 0) activeTabIdx = 0;
    return { tabs, activeTabIdx };
  });

  return {
    panes,
    expanded: new Set(persisted.expanded),
    splitMode: persisted.splitMode ?? false,
    splitLeftWidth: persisted.splitLeftWidth ?? 0,
  };
}
