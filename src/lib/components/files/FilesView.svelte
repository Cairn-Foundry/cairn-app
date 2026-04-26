<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
import { get } from 'svelte/store';
  import Icon from '$lib/components/Icon.svelte';
  import CodeEditor from './CodeEditor.svelte';
  import QuickOpen from './QuickOpen.svelte';
  import SearchPanel from './SearchPanel.svelte';
  import CommandPalette from './CommandPalette.svelte';
  import { activeInstance } from '$lib/stores/instance';
  import { activeProjectId } from '$lib/stores/project';
  import { activeScreen } from '$lib/stores/ui';
  import { readDirTree, readFile, writeFile, deletePath, renamePath, createFileOrDir, copyPath, revealInFileManager, openInTerminal, langFromPath, isBinaryPath, gitStatus, gitFileDiff, type FileNode, type GitStatusMap, type DiffHunk } from '$lib/services/file-service';
  import { settings } from '$lib/stores/settings';
  import { shortcuts, activeShortcuts, matchesShortcut, bindingToLabels, SHORTCUT_DEFS } from '$lib/stores/shortcuts';
  import type { EditorState } from '@codemirror/state';

  export let onGoSettings: (() => void) | undefined = undefined;

  interface Tab {
    path: string;
    content: string;
    pending: string;
    cursorPos: number;
    scrollTop: number;
    pinned?: boolean;
    lineEndings?: 'LF' | 'CRLF';
  }

  // ── localStorage persistence ──────────────────────────────────────────────────

  interface PersistedTab { path: string; cursorPos: number; scrollTop: number; pinned?: boolean; }
  interface PersistedState {
    tabs: PersistedTab[];
    activeTabIdx: number;
    expanded: string[];
    tabs2?: PersistedTab[];
    activeTabIdx2?: number;
    splitMode?: boolean;
    splitLeftWidth?: number;
  }

  function persistState(instanceId: string, state: InstanceTabState) {
    try {
      const data: PersistedState = {
        tabs: state.tabs.map(t => ({ path: t.path, cursorPos: t.cursorPos, scrollTop: t.scrollTop, pinned: t.pinned })),
        activeTabIdx: state.activeTabIdx,
        expanded: [...state.expanded],
        tabs2: state.tabs2.map(t => ({ path: t.path, cursorPos: t.cursorPos, scrollTop: t.scrollTop, pinned: t.pinned })),
        activeTabIdx2: state.activeTabIdx2,
        splitMode: state.splitMode,
        splitLeftWidth: state.splitLeftWidth,
      };
      localStorage.setItem(`cairn:file-state:${instanceId}`, JSON.stringify(data));
    } catch {}
  }

  function readPersistedState(instanceId: string): PersistedState | null {
    try {
      const raw = localStorage.getItem(`cairn:file-state:${instanceId}`);
      return raw ? (JSON.parse(raw) as PersistedState) : null;
    } catch { return null; }
  }

  function loadRecentFiles(instanceId: string) {
    try {
      const raw = localStorage.getItem(`cairn:recent-files:${instanceId}`);
      recentFiles = raw ? (JSON.parse(raw) as string[]) : [];
    } catch { recentFiles = []; }
  }

  function pushRecentFile(path: string) {
    if (!currentInstanceId) return;
    const updated = [path, ...recentFiles.filter(p => p !== path)].slice(0, 10);
    recentFiles = updated;
    try { localStorage.setItem(`cairn:recent-files:${currentInstanceId}`, JSON.stringify(updated)); } catch {}
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
      const normalized = le === 'CRLF' ? r.text.replace(/\r\n/g, '\n') : r.text;
      return { path: r.path, content: normalized, pending: normalized, cursorPos: saved.cursorPos, scrollTop: saved.scrollTop, pinned: saved.pinned, lineEndings: le };
    });
  }

  async function rehydrateTabs(wtp: string, persisted: PersistedState) {
    tabs = persisted.tabs.map(p => ({ path: p.path, content: '', pending: '', cursorPos: p.cursorPos, scrollTop: p.scrollTop }));
    activeTabIdx = persisted.activeTabIdx;
    expanded = new Set(persisted.expanded);
    splitMode = persisted.splitMode ?? false;
    splitLeftWidth = persisted.splitLeftWidth ?? 0;

    const [rehydrated, rehydrated2] = await Promise.all([
      rehydrateTabList(wtp, persisted.tabs),
      persisted.tabs2 ? rehydrateTabList(wtp, persisted.tabs2) : Promise.resolve([]),
    ]);

    tabs = rehydrated;
    if (tabs.length === 0) { activeTabIdx = -1; } else if (activeTabIdx >= tabs.length) activeTabIdx = tabs.length - 1;

    tabs2 = rehydrated2;
    activeTabIdx2 = rehydrated2.length === 0 ? -1 : Math.min(persisted.activeTabIdx2 ?? 0, rehydrated2.length - 1);
  }

  interface InstanceTabState {
    tabs: Tab[];
    activeTabIdx: number;
    expanded: Set<string>;
    tabs2: Tab[];
    activeTabIdx2: number;
    splitMode: boolean;
    splitLeftWidth: number;
  }

  const savedState = new Map<string, InstanceTabState>();

  let rawTree: FileNode[] = [];
  let tree: FileNode[] = [];
  let gitStatusMap: GitStatusMap = {};
  let showHidden = false;
  let multiSelected = new Set<string>();

  // ── Pointer-event drag state ──────────────────────────────────────────────────
  let dragSrcNode: FileNode | null = null;
  let dragOverDir: string | null = null;
  let dragActive = false;
  let dragGhostEl: HTMLDivElement | null = null;
  let dragPointerStartX = 0;
  let dragPointerStartY = 0;
  let dragCaptureEl: HTMLElement | null = null;
  let dragJustEnded = false;

  function buildTree(raw: FileNode[], _map: GitStatusMap): FileNode[] {
    return raw;
  }
  let expanded = new Set<string>();
  let tabs: Tab[] = [];
  let activeTabIdx = -1;
  let recentFiles: string[] = [];
  let loading = false;
  let loadingPaths = new Set<string>();
  let saving = false;
  let error = '';
  let editorRef: CodeEditor | undefined;
  let editorStateCache = new Map<string, EditorState>();

  let currentDiffHunks: DiffHunk[] = [];
  let activeDiffHunk: DiffHunk | null = null;

  // ── Split pane ────────────────────────────────────────────────────────────────
  let splitMode = false;
  let focusedPane: 0 | 1 = 0;
  let tabs2: Tab[] = [];
  let activeTabIdx2 = -1;
  let editorRef2: CodeEditor | undefined;
  let editorStateCache2 = new Map<string, EditorState>();
  let cursorLine2 = 1;
  let cursorCol2 = 1;
  let currentDiffHunks2: DiffHunk[] = [];
  let activeDiffHunk2: DiffHunk | null = null;
  let tabsBarEl2: HTMLElement | null = null;
  let isSplitResizing = false;
  let splitResizeStartX = 0;
  let splitResizeStartWidth = 0;
  let splitLeftWidth = 0;
  let leftPaneEl: HTMLElement | null = null;

  $: activeTab2 = tabs2[activeTabIdx2] ?? null;
  $: activeLang2 = (activeTab2 ? langFromPath(activeTab2.path) : 'text') as any;
  $: activeLineEndings2 = activeTab2?.lineEndings ?? 'LF';
  $: isDirty2 = activeTab2 ? activeTab2.pending !== activeTab2.content : false;
  $: activeIndentStyle = activeTab ? detectIndentStyle(activeTab.pending) : null;
  $: activeSpaceSize = (activeTab && activeIndentStyle === 'spaces') ? detectSpaceSize(activeTab.pending) : 2;
  $: activeIndentStyle2 = activeTab2 ? detectIndentStyle(activeTab2.pending) : null;
  $: activeSpaceSize2 = (activeTab2 && activeIndentStyle2 === 'spaces') ? detectSpaceSize(activeTab2.pending) : 2;

  function toggleSplit() {
    splitMode = !splitMode;
    if (!splitMode) {
      tabs2 = [];
      activeTabIdx2 = -1;
      focusedPane = 0;
    }
    if (currentInstanceId) persistState(currentInstanceId, { tabs, activeTabIdx, expanded, tabs2, activeTabIdx2, splitMode, splitLeftWidth });
  }

  function startSplitResize(e: PointerEvent) {
    isSplitResizing = true;
    splitResizeStartX = e.clientX;
    splitResizeStartWidth = leftPaneEl?.getBoundingClientRect().width ?? splitLeftWidth;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onSplitResizeMove(e: PointerEvent) {
    if (!isSplitResizing) return;
    const totalW = leftPaneEl?.parentElement?.getBoundingClientRect().width ?? 800;
    const minW = 120;
    const maxW = totalW - 120 - 3;
    splitLeftWidth = Math.max(minW, Math.min(maxW, splitResizeStartWidth + (e.clientX - splitResizeStartX)));
  }

  function stopSplitResize() {
    if (!isSplitResizing) return;
    isSplitResizing = false;
    if (currentInstanceId) persistState(currentInstanceId, { tabs, activeTabIdx, expanded, tabs2, activeTabIdx2, splitMode, splitLeftWidth });
  }

  function captureEditorState2() {
    if (activeTabIdx2 === -1 || !editorRef2) return;
    const state = editorRef2.getState();
    tabs2[activeTabIdx2].cursorPos = state.cursorPos;
    tabs2[activeTabIdx2].scrollTop = state.scrollTop;
    tabs2 = tabs2;
    const es = editorRef2.getEditorState();
    if (es) editorStateCache2.set(tabs2[activeTabIdx2].path, es);
  }

  async function refreshDiff2(tab: { path: string } | null): Promise<void> {
    activeDiffHunk2 = null;
    if (!tab || !worktreePath) { currentDiffHunks2 = []; return; }
    try {
      const status = gitStatusMap[tab.path];
      if (!status || status === 'deleted') { currentDiffHunks2 = []; return; }
      if (status === 'untracked') {
        const content = tabs2.find(t => t.path === tab.path)?.pending ?? '';
        const lines = content.split('\n');
        currentDiffHunks2 = [{ newStart: 1, newEnd: lines.length, lines: lines.map(l => ({ type: '+' as const, content: l })) }];
        return;
      }
      const result = await gitFileDiff(worktreePath, tab.path);
      currentDiffHunks2 = result.hunks;
    } catch { currentDiffHunks2 = []; }
  }

  async function switchTab2(idx: number) {
    if (idx === activeTabIdx2) return;
    captureEditorState2();
    activeTabIdx2 = idx;
    refreshDiff2(tabs2[idx] ?? null);
  }

  async function closeTab2(idx: number, event: MouseEvent | null) {
    if (event) event.stopPropagation();
    const tab = tabs2[idx];
    if (!tab || tab.pinned) return;
    if (tab.pending !== tab.content && worktreePath) {
      const wc2 = tab.lineEndings === 'CRLF' ? tab.pending.replace(/\n/g, '\r\n') : tab.pending;
      await writeFile(`${worktreePath}/${tab.path}`, wc2);
    }
    editorStateCache2.delete(tab.path);
    const wasActive = idx === activeTabIdx2;
    tabs2 = tabs2.filter((_, i) => i !== idx);
    if (tabs2.length === 0) activeTabIdx2 = -1;
    else if (wasActive) activeTabIdx2 = Math.min(idx, tabs2.length - 1);
    else if (idx < activeTabIdx2) activeTabIdx2 = activeTabIdx2 - 1;
  }

  function handleChange2(value: string) {
    if (activeTabIdx2 === -1) return;
    tabs2[activeTabIdx2].pending = value;
    tabs2 = tabs2;
  }

  async function flushSave2() {
    if (!activeTab2 || !worktreePath) return;
    if (activeTab2.pending === activeTab2.content) return;
    const wasDeleted = gitStatusMap[activeTab2.path] === 'deleted';
    try {
      const writeContent2 = activeTab2.lineEndings === 'CRLF' ? activeTab2.pending.replace(/\n/g, '\r\n') : activeTab2.pending;
      await writeFile(`${worktreePath}/${activeTab2.path}`, writeContent2);
      tabs2[activeTabIdx2].content = activeTab2.pending;
      tabs2 = tabs2;
      if (wasDeleted) await loadTree(worktreePath);
      refreshDiff2(activeTab2);
    } catch (e) { error = String(e); }
  }

  function saveSnapshotToDisk(tabsSnap: Tab[], tabs2Snap: Tab[], wtp: string): void {
    for (const tab of [...tabsSnap, ...tabs2Snap]) {
      if (tab.pending === tab.content) continue;
      const path = tab.path;
      const wc = tab.lineEndings === 'CRLF' ? tab.pending.replace(/\n/g, '\r\n') : tab.pending;
      tab.content = tab.pending; // shared ref — mutates original tabs[i] so saveCurrentState captures clean state
      writeFile(`${wtp}/${path}`, wc).catch(() => {});
    }
  }

  async function openFileInPane2(node: FileNode) {
    if (gitStatusMap[node.path] === 'deleted') return;
    if (node.isDir) {
      if (expanded.has(node.path)) expanded.delete(node.path);
      else expanded.add(node.path);
      expanded = expanded;
      return;
    }
    const existingIdx = tabs2.findIndex(t => t.path === node.path);
    if (existingIdx !== -1) {
      captureEditorState2();
      activeTabIdx2 = existingIdx;
      refreshDiff2({ path: node.path });
      return;
    }
    if (isBinaryPath(node.path)) {
      tabs2 = [...tabs2, { path: node.path, content: '', pending: '', cursorPos: 0, scrollTop: 0 }];
      activeTabIdx2 = tabs2.length - 1;
      currentDiffHunks2 = [];
      return;
    }
    captureEditorState2();
    try {
      const raw2 = await readFile(`${worktreePath}/${node.path}`) ?? '';
      const le2 = detectLineEndings(raw2);
      const text2 = le2 === 'CRLF' ? raw2.replace(/\r\n/g, '\n') : raw2;
      tabs2 = [...tabs2, { path: node.path, content: text2, pending: text2, cursorPos: 0, scrollTop: 0, lineEndings: le2 }];
      activeTabIdx2 = tabs2.length - 1;
      refreshDiff2({ path: node.path });
    } catch (e) { error = String(e); }
  }

  function handleDiffClick(hunk: DiffHunk) {
    activeDiffHunk = activeDiffHunk === hunk ? null : hunk;
  }

  async function loadDiffHunks(tab: { path: string } | null): Promise<void> {
    if (!tab || !worktreePath) { currentDiffHunks = []; return; }
    try {
      const status = gitStatusMap[tab.path];
      if (!status || status === 'deleted') { currentDiffHunks = []; return; }

      if (status === 'untracked') {
        const content = tabs.find(t => t.path === tab.path)?.pending ?? '';
        const lines = content.split('\n');
        currentDiffHunks = [{ newStart: 1, newEnd: lines.length, lines: lines.map(l => ({ type: '+' as const, content: l })) }];
        return;
      }

      const result = await gitFileDiff(worktreePath, tab.path);
      currentDiffHunks = result.hunks;
    } catch {
      currentDiffHunks = [];
    }
  }

  async function refreshDiff(tab: { path: string } | null) {
    activeDiffHunk = null;
    await loadDiffHunks(tab);
  }

  let quickOpenVisible = false;
  let searchPanelByProject: Record<string, boolean> = {};
  let pendingJump: { line: number; col: number } | null = null;

  // ── Closed-tab history (for ⌘⇧T reopen) ────────────────────────────────────
  let closedTabsStack: Tab[] = [];

  // ── Tab navigation history (for ⌘Alt+←/→) ──────────────────────────────────
  let tabNavBack: number[] = [];
  let tabNavForward: number[] = [];
  let tabNavSkip = false;

  // ── Sidebar visibility ───────────────────────────────────────────────────────
  let sidebarHidden = false;

  // ── Command palette ──────────────────────────────────────────────────────────
  let commandPaletteVisible = false;
  export function openCommandPalette() { commandPaletteVisible = true; }

  $: searchPanelOpen = searchPanelByProject[$activeProjectId ?? ''] ?? false;

  function toggleSearchPanel() {
    const id = $activeProjectId ?? '';
    searchPanelByProject = { ...searchPanelByProject, [id]: !searchPanelOpen };
  }
  function closeSearchPanel() {
    const id = $activeProjectId ?? '';
    searchPanelByProject = { ...searchPanelByProject, [id]: false };
  }

  // ── Context menu & inline editing ────────────────────────────────────────────

  interface ContextMenu { x: number; y: number; node: FileNode | null }
  interface EditState { type: 'rename' | 'new-file' | 'new-dir'; node: FileNode | null; parentPath: string; value: string }

  interface FileClipboard { nodes: FileNode[]; srcWorktreePath: string; op: 'copy' | 'cut' }

  let contextMenu: ContextMenu | null = null;
  let editState: EditState | null = null;
  let editValue = '';
  let selectedDir: string = '';
  let fileClipboard: FileClipboard | null = null;

  function focusOnMount(el: HTMLInputElement) {
    tick().then(() => { el.focus(); el.select(); });
  }

  function startEdit(state: EditState) {
    editValue = state.value;
    editState = state;
  }

  let ctxMenuEl: HTMLDivElement | null = null;

  async function openContextMenu(e: MouseEvent, node: FileNode | null) {
    e.preventDefault();
    e.stopPropagation();
    contextMenu = { x: e.clientX, y: e.clientY, node };
    await tick();
    if (!ctxMenuEl || !contextMenu) return;
    const { width, height } = ctxMenuEl.getBoundingClientRect();
    const x = Math.min(e.clientX, window.innerWidth - width - 4);
    const y = Math.min(e.clientY, window.innerHeight - height - 4);
    contextMenu = { ...contextMenu, x, y };
  }

  function closeContextMenu() { contextMenu = null; }

  type ContextAction = 'new-file' | 'new-dir' | 'cut' | 'copy' | 'paste' | 'rename' | 'delete' | 'copy-path' | 'copy-rel-path' | 'reveal' | 'open-terminal';

  function pasteDestName(srcName: string, existingNames: Set<string>): string {
    if (!existingNames.has(srcName)) return srcName;
    const dot = srcName.lastIndexOf('.');
    const [base, ext] = dot > 0 ? [srcName.slice(0, dot), srcName.slice(dot)] : [srcName, ''];
    let candidate = `${base} copy${ext}`;
    let i = 2;
    while (existingNames.has(candidate)) candidate = `${base} copy ${i++}${ext}`;
    return candidate;
  }

  function flattenToNodes(paths: Set<string>): FileNode[] {
    const result: FileNode[] = [];
    function search(nodes: FileNode[]) {
      for (const n of nodes) {
        if (paths.has(n.path)) result.push(n);
        if (n.isDir && n.children) search(n.children);
      }
    }
    search(tree);
    return result;
  }

  function collectFilePaths(nodes: FileNode[]): Set<string> {
    const result = new Set<string>();
    function walk(ns: FileNode[]) {
      for (const n of ns) {
        if (!n.isDir) result.add(n.path);
        if (n.isDir && n.children) walk(n.children);
      }
    }
    walk(nodes);
    return result;
  }

  function flattenVisible(nodes: FileNode[]): FileNode[] {
    const result: FileNode[] = [];
    for (const n of nodes) {
      result.push(n);
      if (n.isDir && n.children && expanded.has(n.path)) result.push(...flattenVisible(n.children));
    }
    return result;
  }

  function isEditorFocused(): boolean {
    const el = document.activeElement;
    if (!el) return false;
    return (
      el.closest('.cm-editor') !== null ||
      el.tagName === 'INPUT' ||
      el.tagName === 'TEXTAREA'
    );
  }

  async function pasteClipboard(clipboard: FileClipboard, targetNode: FileNode | null, wtp: string) {
    const { nodes: srcs, srcWorktreePath, op } = clipboard;
    const targetDir = targetNode?.isDir
      ? targetNode.path
      : targetNode?.path.includes('/')
        ? targetNode.path.split('/').slice(0, -1).join('/')
        : '';
    try {
      for (const src of srcs) {
        const siblings = new Set(
          (targetDir
            ? flattenVisible(tree).find(n => n.path === targetDir)?.children
            : tree
          )?.map(n => n.name) ?? []
        );
        const destName = pasteDestName(src.name, siblings);
        const destRelPath = targetDir ? `${targetDir}/${destName}` : destName;
        const fromAbs = `${srcWorktreePath}/${src.path}`;
        const toAbs = `${wtp}/${destRelPath}`;
        if (op === 'copy') {
          await copyPath(fromAbs, toAbs);
        } else {
          await renamePath(fromAbs, toAbs);
          tabs = tabs.map(t => t.path === src.path ? { ...t, path: destRelPath } : t);
        }
      }
      if (op === 'cut') fileClipboard = null;
      if (targetDir) { expanded.add(targetDir); expanded = expanded; }
      await loadTree(wtp);
    } catch (e) { error = String(e); }
  }

  async function handleContextAction(action: ContextAction) {
    const node = contextMenu?.node ?? null;
    closeContextMenu();

    if (action === 'cut' && node) {
      const srcs = multiSelected.size > 1 && multiSelected.has(node.path)
        ? flattenToNodes(multiSelected)
        : [node];
      fileClipboard = { nodes: srcs, srcWorktreePath: worktreePath ?? '', op: 'cut' };
      return;
    }
    if (action === 'copy' && node) {
      const srcs = multiSelected.size > 1 && multiSelected.has(node.path)
        ? flattenToNodes(multiSelected)
        : [node];
      fileClipboard = { nodes: srcs, srcWorktreePath: worktreePath ?? '', op: 'copy' };
      return;
    }
    if (action === 'paste' && fileClipboard && worktreePath) {
      await pasteClipboard(fileClipboard, node, worktreePath);
      return;
    }
    if (action === 'reveal') {
      const absPath = node ? `${worktreePath}/${node.path}` : (worktreePath ?? '');
      await revealInFileManager(absPath);
      return;
    }
    if (action === 'copy-path') {
      const absPath = node ? `${worktreePath}/${node.path}` : (worktreePath ?? '');
      await navigator.clipboard.writeText(absPath);
      return;
    }
    if (action === 'copy-rel-path') {
      await navigator.clipboard.writeText(node?.path ?? '');
      return;
    }
    if (action === 'open-terminal') {
      const absPath = node ? `${worktreePath}/${node.path}` : (worktreePath ?? '');
      await openInTerminal(absPath);
      return;
    }
    if (action === 'delete' && node) {
      if (!confirm(`Delete "${node.name}"?`)) return;
      try {
        await deletePath(`${worktreePath}/${node.path}`);
        tabs = tabs.filter(t => !t.path.startsWith(node.path));
        if (activeTabIdx >= tabs.length) activeTabIdx = tabs.length - 1;
        if (worktreePath) await loadTree(worktreePath);
      } catch (e) { error = String(e); }
      return;
    }
    if (action === 'rename' && node) {
      startEdit({ type: 'rename', node, parentPath: node.path.includes('/') ? node.path.split('/').slice(0, -1).join('/') : '', value: node.name });
      return;
    }
    const parentPath = node?.isDir ? node.path : (node?.path.includes('/') ? node.path.split('/').slice(0, -1).join('/') : '');
    if (node?.isDir) { expanded.add(node.path); expanded = expanded; }
    startEdit({ type: action as EditState['type'], node: null, parentPath, value: '' });
  }

  async function commitEdit() {
    if (!editState || !editValue.trim() || !worktreePath) { editState = null; return; }
    if (editConflict) return;
    const state = editState;
    const name = editValue.trim();
    editState = null;
    try {
      if (state.type === 'rename' && state.node) {
        const oldRelPath = state.node.path;
        const newRelPath = state.parentPath ? `${state.parentPath}/${name}` : name;
        await renamePath(`${worktreePath}/${oldRelPath}`, `${worktreePath}/${newRelPath}`);
        tabs = tabs.map(t => t.path === oldRelPath ? { ...t, path: newRelPath } : t);
      } else {
        const relPath = state.parentPath ? `${state.parentPath}/${name}` : name;
        await createFileOrDir(`${worktreePath}/${relPath}`, state.type === 'new-dir');
        if (state.type !== 'new-dir') {
          const node: FileNode = { name, path: relPath, isDir: false };
          await openFile(node);
        }
      }
      await loadTree(worktreePath);
    } catch (e) { error = String(e); }
  }

  function cancelEdit() { editState = null; editValue = ''; }

  function getSiblingNames(parentPath: string): Set<string> {
    if (!parentPath) return new Set(tree.map(n => n.name));
    function find(nodes: FileNode[], path: string): FileNode | null {
      for (const n of nodes) {
        if (n.path === path) return n;
        if (n.isDir && n.children) { const f = find(n.children, path); if (f) return f; }
      }
      return null;
    }
    return new Set(find(tree, parentPath)?.children?.map(n => n.name) ?? []);
  }

  $: editConflict = !!editState && !!editValue.trim() && (() => {
    const siblings = new Set([...getSiblingNames(editState!.parentPath)].map(n => n.toLowerCase()));
    const val = editValue.trim().toLowerCase();
    const isSelf = editState!.type === 'rename' && val === editState!.node?.name.toLowerCase();
    return siblings.has(val) && !isSelf;
  })();

  let treeWidth = 220;
  let isResizing = false;
  let resizeStartX = 0;
  let resizeStartWidth = 0;

  function startResize(e: PointerEvent) {
    isResizing = true;
    resizeStartX = e.clientX;
    resizeStartWidth = treeWidth;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onResizeMove(e: PointerEvent) {
    if (!isResizing) return;
    const delta = sidebarRight ? resizeStartX - e.clientX : e.clientX - resizeStartX;
    treeWidth = Math.max(140, Math.min(480, resizeStartWidth + delta));
  }

  function stopResize() {
    if (!isResizing) return;
    isResizing = false;
    settings.save({ treePanelWidth: treeWidth });
  }

  let cursorLine = 1;
  let cursorCol = 1;

  function handleCursorChange(line: number, col: number) {
    cursorLine = line;
    cursorCol = col;
  }

  function detectLineEndings(text: string): 'CRLF' | 'LF' {
    return text.includes('\r\n') ? 'CRLF' : 'LF';
  }

  let gitPollInterval: ReturnType<typeof setInterval> | null = null;

  $: tooltipSearch = `Search (${bindingToLabels($shortcuts.searchFiles).join('')})`;
  $: tooltipSplit  = `Split Editor (${bindingToLabels($shortcuts.splitEditor).join('')})`;

  async function handleGlobalKey(e: KeyboardEvent) {
    if ($activeScreen !== 'workspace') return;
    if (matchesShortcut(e, $activeShortcuts.quickOpen)) {
      e.preventDefault();
      quickOpenVisible = true;
    }
    if (matchesShortcut(e, $activeShortcuts.searchFiles)) {
      e.preventDefault();
      toggleSearchPanel();
    }
    if (matchesShortcut(e, $activeShortcuts.fontSizeUp)) {
      e.preventDefault();
      settings.save({ editorFontSize: Math.min(($settings.editorFontSize ?? 13) + 1, 32) });
    }
    if (matchesShortcut(e, $activeShortcuts.fontSizeDown)) {
      e.preventDefault();
      settings.save({ editorFontSize: Math.max(($settings.editorFontSize ?? 13) - 1, 8) });
    }
    if (matchesShortcut(e, $activeShortcuts.fontSizeReset)) {
      e.preventDefault();
      settings.save({ editorFontSize: 13 });
    }
    if (matchesShortcut(e, $activeShortcuts.splitEditor)) {
      e.preventDefault();
      toggleSplit();
    }
    // ── Tab management ─────────────────────────��────────────────────────────
    if (matchesShortcut(e, $activeShortcuts.closeTab)) {
      e.preventDefault();
      e.stopPropagation();
      const activePane = focusedPane === 1 && splitMode ? 1 : 0;
      if (activePane === 1) closeTab2(activeTabIdx2, null);
      else closeTab(activeTabIdx, null);
    }
    if (matchesShortcut(e, $activeShortcuts.reopenClosedTab)) {
      e.preventDefault();
      reopenClosedTab();
    }
    if (matchesShortcut(e, $activeShortcuts.nextTab)) {
      e.preventDefault();
      if (tabs.length > 1) switchTab((activeTabIdx + 1) % tabs.length);
    }
    if (matchesShortcut(e, $activeShortcuts.prevTab)) {
      e.preventDefault();
      if (tabs.length > 1) switchTab((activeTabIdx - 1 + tabs.length) % tabs.length);
    }
    if (matchesShortcut(e, $activeShortcuts.tabHistoryBack)) {
      e.preventDefault();
      tabHistoryBack();
    }
    if (matchesShortcut(e, $activeShortcuts.tabHistoryForward)) {
      e.preventDefault();
      tabHistoryForward();
    }
    // ── Jump to tab by number (⌘1–⌘9, always active, not configurable) ────
    const IS_MAC_FV = typeof navigator !== 'undefined' && navigator.platform.startsWith('Mac');
    if ((IS_MAC_FV ? e.metaKey : e.ctrlKey) && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) {
      const idx = parseInt(e.key) - 1;
      if (idx < tabs.length) { e.preventDefault(); switchTab(idx); }
    }
    // ── Editing ─────────────────────────────────────────────────────────────
    if (matchesShortcut(e, $activeShortcuts.saveFile)) {
      e.preventDefault();
      if (focusedPane === 1 && splitMode) flushSave2();
      else flushSave();
    }
    // ── View ────────────────────────────────────────────────────────────────
    if (matchesShortcut(e, $activeShortcuts.toggleSidebar)) {
      e.preventDefault();
      sidebarHidden = !sidebarHidden;
    }
    if (matchesShortcut(e, $activeShortcuts.commandPalette)) {
      e.preventDefault();
      commandPaletteVisible = true;
    }
    if (matchesShortcut(e, $activeShortcuts.openSettings)) {
      e.preventDefault();
      onGoSettings?.();
    }
    // ── File tree shortcuts (inactive when editor/input has focus) ───────────
    if (!isEditorFocused()) {
      if (matchesShortcut(e, $activeShortcuts.treeSelectAll)) {
        e.preventDefault();
        multiSelected = new Set(flattenVisible(tree).map(n => n.path));
      }
      if (matchesShortcut(e, $activeShortcuts.treeCopy) && multiSelected.size > 0 && worktreePath) {
        e.preventDefault();
        fileClipboard = { nodes: flattenToNodes(multiSelected), srcWorktreePath: worktreePath, op: 'copy' };
      }
      if (matchesShortcut(e, $activeShortcuts.treeCut) && multiSelected.size > 0 && worktreePath) {
        e.preventDefault();
        fileClipboard = { nodes: flattenToNodes(multiSelected), srcWorktreePath: worktreePath, op: 'cut' };
      }
      if (matchesShortcut(e, $activeShortcuts.treePaste) && fileClipboard && worktreePath) {
        e.preventDefault();
        const targetPath = [...multiSelected][0] ?? null;
        const targetNode = targetPath ? flattenVisible(tree).find(n => n.path === targetPath) ?? null : null;
        await pasteClipboard(fileClipboard, targetNode, worktreePath);
      }
      if (matchesShortcut(e, $activeShortcuts.treeDelete) && multiSelected.size > 0 && worktreePath) {
        e.preventDefault();
        const paths = [...multiSelected];
        const label = paths.length === 1
          ? `"${paths[0].split('/').pop()}"`
          : `${paths.length} items`;
        if (!confirm(`Delete ${label}?`)) return;
        try {
          for (const p of paths) {
            await deletePath(`${worktreePath}/${p}`);
            tabs = tabs.filter(t => !t.path.startsWith(p));
          }
          if (activeTabIdx >= tabs.length) activeTabIdx = tabs.length - 1;
          multiSelected = new Set();
          await loadTree(worktreePath);
        } catch (e2) { error = String(e2); }
      }
      if (matchesShortcut(e, $activeShortcuts.treeRename) && multiSelected.size === 1) {
        e.preventDefault();
        const path = [...multiSelected][0];
        const node = flattenVisible(tree).find(n => n.path === path);
        if (node) startEdit({ type: 'rename', node, parentPath: node.path.includes('/') ? node.path.split('/').slice(0, -1).join('/') : '', value: node.name });
      }
      if (matchesShortcut(e, $activeShortcuts.treeNewFile)) {
        e.preventDefault();
        const parentPath = [...multiSelected].find(p => {
          const n = flattenVisible(tree).find(x => x.path === p);
          return n?.isDir;
        }) ?? selectedDir;
        if (parentPath) { expanded.add(parentPath); expanded = expanded; }
        startEdit({ type: 'new-file', node: null, parentPath, value: '' });
      }
      if (matchesShortcut(e, $activeShortcuts.treeNewFolder)) {
        e.preventDefault();
        const parentPath = [...multiSelected].find(p => {
          const n = flattenVisible(tree).find(x => x.path === p);
          return n?.isDir;
        }) ?? selectedDir;
        if (parentPath) { expanded.add(parentPath); expanded = expanded; }
        startEdit({ type: 'new-dir', node: null, parentPath, value: '' });
      }
    }
  }

  onMount(() => {
    window.addEventListener('keydown', handleGlobalKey, { capture: true });

    gitPollInterval = setInterval(async () => {
      if (!worktreePath) return;
      const updated = await gitStatus(worktreePath).catch(() => null);
      if (updated !== null) {
        gitStatusMap = updated;
        tree = buildTree(rawTree, updated);
      }
    }, 3000);

    let unlistenFocus: (() => void) | null = null;
    import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
      getCurrentWindow().onFocusChanged(({ payload: focused }) => {
        if (focused && worktreePath) loadTree(worktreePath);
        if (!focused && ($settings.saveOn ?? 'blur') === 'windowChange') {
          flushSave();
          flushSave2();
        }
      }).then(unlisten => { unlistenFocus = unlisten; });
    });

    let prevInstId: string | null = null;
    let prevInstWtp: string | null = null;
    const unsubInst = activeInstance.subscribe(inst => {
      const newId = inst?.id ?? null;
      if (prevInstId !== null && prevInstId !== newId && prevInstWtp) {
        if ((get(settings).saveOn ?? 'blur') === 'instanceChange') {
          saveSnapshotToDisk([...tabs], [...tabs2], prevInstWtp);
        }
      }
      prevInstId = newId;
      if (inst?.worktreePath) prevInstWtp = inst.worktreePath;
    });

    let prevProjId: string | null = null;
    const unsubProj = activeProjectId.subscribe(pid => {
      const newPid = pid ?? null;
      if (prevProjId !== null && prevProjId !== newPid && prevInstWtp) {
        if ((get(settings).saveOn ?? 'blur') === 'projectChange') {
          saveSnapshotToDisk([...tabs], [...tabs2], prevInstWtp);
        }
      }
      prevProjId = newPid;
    });

    return () => {
      window.removeEventListener('keydown', handleGlobalKey, { capture: true });
      unlistenFocus?.();
      if (gitPollInterval !== null) clearInterval(gitPollInterval);
      unsubInst();
      unsubProj();
    };
  });

  function quickOpenFile(path: string) {
    const node = { path, name: path.split('/').pop() ?? path, isDir: false };
    if (splitMode && focusedPane === 1) openFileInPane2(node);
    else openFile(node);
  }

  let tabsBarEl: HTMLElement | null = null;
  let dragSrcIndex: number | null = null;
  let insertIndex: number | null = null;
  let didDrag = false;

  let dragSrcIndex2: number | null = null;
  let insertIndex2: number | null = null;
  let didDrag2 = false;

  // ── Tab context menu (pin/close-others) ──────────────────────────────────────
  let tabCtxMenu: { x: number; y: number; idx: number; pane: 0 | 1 } | null = null;

  function openTabCtxMenu(e: MouseEvent, idx: number, pane: 0 | 1) {
    e.preventDefault();
    e.stopPropagation();
    tabCtxMenu = { x: e.clientX, y: e.clientY, idx, pane };
  }

  function closeTabCtxMenu() { tabCtxMenu = null; }

  function sortedByPin(arr: Tab[]): Tab[] {
    return [...arr.filter(t => t.pinned), ...arr.filter(t => !t.pinned)];
  }

  function togglePinTab(idx: number, pane: 0 | 1) {
    if (pane === 0) {
      tabs[idx].pinned = !tabs[idx].pinned;
      const activePath = tabs[activeTabIdx]?.path;
      tabs = sortedByPin(tabs);
      activeTabIdx = activePath ? tabs.findIndex(t => t.path === activePath) : -1;
    } else {
      tabs2[idx].pinned = !tabs2[idx].pinned;
      const activePath = tabs2[activeTabIdx2]?.path;
      tabs2 = sortedByPin(tabs2);
      activeTabIdx2 = activePath ? tabs2.findIndex(t => t.path === activePath) : -1;
    }
    if (currentInstanceId) persistState(currentInstanceId, { tabs, activeTabIdx, expanded, tabs2, activeTabIdx2, splitMode, splitLeftWidth });
    closeTabCtxMenu();
  }

  function closeAllTabs(pane: 0 | 1) {
    if (pane === 0) {
      const kept = tabs.filter(t => t.pinned);
      activeTabIdx = kept.length > 0 ? 0 : -1;
      tabs = kept;
    } else {
      const kept = tabs2.filter(t => t.pinned);
      activeTabIdx2 = kept.length > 0 ? 0 : -1;
      tabs2 = kept;
    }
    closeTabCtxMenu();
  }

  // ── Breadcrumb navigation ─────────────────────────────────────────────────────
  function breadcrumbSegments(path: string): { name: string; path: string }[] {
    const parts = path.split('/');
    return parts.map((name, i) => ({ name, path: parts.slice(0, i + 1).join('/') }));
  }

  function breadcrumbClickDir(dirPath: string) {
    selectedDir = dirPath;
    expanded.add(dirPath);
    expanded = expanded;
  }

  // ── Indent style detection & conversion ──────────────────────────────────────
  function detectIndentStyle(text: string): 'tabs' | 'spaces' | null {
    let tabs = 0, spaces = 0;
    const lines = text.split('\n');
    const limit = Math.min(lines.length, 100);
    for (let i = 0; i < limit; i++) {
      const line = lines[i];
      if (line.startsWith('\t')) tabs++;
      else if (/^  +\S/.test(line)) spaces++;
    }
    if (tabs === 0 && spaces === 0) return null;
    return tabs >= spaces ? 'tabs' : 'spaces';
  }

  function detectSpaceSize(text: string): number {
    const counts: Record<number, number> = {};
    for (const line of text.split('\n')) {
      const m = line.match(/^( +)\S/);
      if (m) { const n = m[1].length; counts[n] = (counts[n] ?? 0) + 1; }
    }
    const sorted = Object.keys(counts).map(Number).sort((a, b) => a - b);
    if (!sorted.length) return 2;
    // pick smallest indent unit ≤ 4
    return sorted.find(n => n <= 4) ?? sorted[0];
  }

  function convertToSpaces(text: string, size: number): string {
    return text.split('\n').map(line => {
      let i = 0;
      while (line[i] === '\t') i++;
      return ' '.repeat(i * size) + line.slice(i);
    }).join('\n');
  }

  function convertToTabs(text: string, size: number): string {
    const sp = ' '.repeat(size);
    return text.split('\n').map(line => {
      let i = 0;
      while (line.slice(i, i + size) === sp) i += size;
      return '\t'.repeat(i / size) + line.slice(i);
    }).join('\n');
  }

  function convertLineEndings(pane: 0 | 1) {
    if (pane === 0) {
      if (activeTabIdx === -1) return;
      tabs[activeTabIdx].lineEndings = tabs[activeTabIdx].lineEndings === 'CRLF' ? 'LF' : 'CRLF';
      tabs = tabs;
    } else {
      if (activeTabIdx2 === -1) return;
      tabs2[activeTabIdx2].lineEndings = tabs2[activeTabIdx2].lineEndings === 'CRLF' ? 'LF' : 'CRLF';
      tabs2 = tabs2;
    }
  }

  function convertIndent(pane: 0 | 1) {
    const tab = pane === 0 ? tabs[activeTabIdx] : tabs2[activeTabIdx2];
    if (!tab) return;
    const style = detectIndentStyle(tab.pending);
    const size = detectSpaceSize(tab.pending);
    const converted = style === 'tabs'
      ? convertToSpaces(tab.pending, Math.max(size, 2))
      : convertToTabs(tab.pending, Math.max(size, 2));
    if (pane === 0) editorRef?.setContent(converted);
    else editorRef2?.setContent(converted);
  }

  $: if (!isResizing) treeWidth = $settings.treePanelWidth;
  $: sidebarRight = $settings.sidebarPosition === 'right';

  $: worktreePath = $activeInstance?.worktreePath ?? null;
  $: activeTab = tabs[activeTabIdx] ?? null;
  $: activeLang = (activeTab ? langFromPath(activeTab.path) : 'text') as any;
  $: activeLineEndings = activeTab?.lineEndings ?? 'LF';
  $: isDirty = activeTab ? activeTab.pending !== activeTab.content : false;
  $: { if (activeTab) { cursorLine = 1; cursorCol = 1; } }

  function saveCurrentState() {
    if (currentInstanceId === null) return;
    captureEditorState();
    captureEditorState2();
    const state = { tabs, activeTabIdx, expanded, tabs2, activeTabIdx2, splitMode, splitLeftWidth };
    savedState.set(currentInstanceId, state);
    persistState(currentInstanceId, state);
  }

  let currentInstanceId: string | null = null;
  $: {
    const id = $activeInstance?.id ?? null;
    const wtp = $activeInstance?.worktreePath ?? null;
    if (id !== currentInstanceId) {
      saveCurrentState();
      currentInstanceId = id;
      if (id !== null) loadRecentFiles(id); else recentFiles = [];
      currentDiffHunks = [];
      activeDiffHunk = null;
      currentDiffHunks2 = [];
      activeDiffHunk2 = null;
      editState = null;
      contextMenu = null;
      if (id !== null && savedState.has(id)) {
        const s = savedState.get(id)!;
        tabs = s.tabs;
        activeTabIdx = s.activeTabIdx;
        expanded = s.expanded;
        tabs2 = s.tabs2;
        activeTabIdx2 = s.activeTabIdx2;
        splitMode = s.splitMode;
        splitLeftWidth = s.splitLeftWidth;
        syncActiveTabToTree();
        refreshDiff(tabs[activeTabIdx] ?? null);
        refreshDiff2(tabs2[activeTabIdx2] ?? null);
      } else if (id !== null && wtp !== null) {
        selectedDir = '';
        const persisted = readPersistedState(id);
        if (persisted) {
          rehydrateTabs(wtp, persisted).then(() => {
            syncActiveTabToTree();
            refreshDiff(tabs[activeTabIdx] ?? null);
            refreshDiff2(tabs2[activeTabIdx2] ?? null);
          });
        } else {
          tabs = [];
          activeTabIdx = -1;
          expanded = new Set();
          tabs2 = [];
          activeTabIdx2 = -1;
          splitMode = false;
          splitLeftWidth = 0;
        }
      } else {
        selectedDir = '';
        tabs = [];
        activeTabIdx = -1;
        expanded = new Set();
        tabs2 = [];
        activeTabIdx2 = -1;
        splitMode = false;
        splitLeftWidth = 0;
      }
    }
  }

  onDestroy(saveCurrentState);

  $: if (worktreePath) {
    loadTree(worktreePath);
  }

  async function loadTree(root: string) {
    loading = true;
    error = '';
    try {
      [rawTree, gitStatusMap] = await Promise.all([
        readDirTree(root, showHidden),
        gitStatus(root).catch(() => ({} as GitStatusMap)),
      ]);
      tree = buildTree(rawTree, gitStatusMap);
      loadDiffHunks(tabs[activeTabIdx] ?? null);
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }

  $: tree = buildTree(rawTree, gitStatusMap);
  $: treeFilePaths = collectFilePaths(rawTree);
  $: cutPaths = fileClipboard?.op === 'cut' ? new Set(fileClipboard.nodes.map(n => n.path)) : new Set<string>();

  async function openFile(node: FileNode) {
    if (splitMode && focusedPane === 1) { await openFileInPane2(node); return; }
    if (gitStatusMap[node.path] === 'deleted') return;
    if (node.isDir) {
      if (expanded.has(node.path)) expanded.delete(node.path);
      else expanded.add(node.path);
      expanded = expanded;
      selectedDir = node.path;
      return;
    }
    selectedDir = node.path.includes('/') ? node.path.split('/').slice(0, -1).join('/') : '';

    const existingIdx = tabs.findIndex(t => t.path === node.path);
    if (existingIdx !== -1) {
      captureEditorState();
      activeTabIdx = existingIdx;
      pushRecentFile(node.path);
      refreshDiff({ path: node.path });
      return;
    }

    if (loadingPaths.has(node.path)) return;

    captureEditorState();
    if (($settings.saveOn ?? 'blur') === 'blur') await flushSave();

    if (isBinaryPath(node.path)) {
      tabs = [...tabs, { path: node.path, content: '', pending: '', cursorPos: 0, scrollTop: 0 }];
      activeTabIdx = tabs.length - 1;
      pushRecentFile(node.path);
      currentDiffHunks = [];
      return;
    }

    loadingPaths.add(node.path);
    loadingPaths = loadingPaths;
    try {
      const fullPath = `${worktreePath}/${node.path}`;
      const raw = await readFile(fullPath) ?? '';
      const le = detectLineEndings(raw);
      const text = le === 'CRLF' ? raw.replace(/\r\n/g, '\n') : raw;
      tabs = [...tabs, { path: node.path, content: text, pending: text, cursorPos: 0, scrollTop: 0, lineEndings: le }];
      activeTabIdx = tabs.length - 1;
      pushRecentFile(node.path);
      refreshDiff({ path: node.path });
    } catch (e) {
      error = String(e);
    } finally {
      loadingPaths.delete(node.path);
      loadingPaths = loadingPaths;
    }
  }

  function captureEditorState() {
    if (activeTabIdx === -1 || !editorRef) return;
    const state = editorRef.getState();
    tabs[activeTabIdx].cursorPos = state.cursorPos;
    tabs[activeTabIdx].scrollTop = state.scrollTop;
    tabs = tabs;
    const es = editorRef.getEditorState();
    if (es) editorStateCache.set(tabs[activeTabIdx].path, es);
  }

  function syncActiveTabToTree() {
    const path = tabs[activeTabIdx]?.path ?? '';
    const parts = path.split('/');
    selectedDir = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
    for (let i = 1; i < parts.length; i++) expanded.add(parts.slice(0, i).join('/'));
    expanded = expanded;
  }

  async function switchTab(idx: number) {
    if (idx === activeTabIdx) return;
    if (!tabNavSkip && activeTabIdx !== -1) {
      tabNavBack = [...tabNavBack, activeTabIdx].slice(-50);
      tabNavForward = [];
    }
    captureEditorState();
    if (($settings.saveOn ?? 'blur') === 'blur') await flushSave();
    activeTabIdx = idx;
    syncActiveTabToTree();
    refreshDiff(tabs[idx] ?? null);
  }

  async function closeTab(idx: number, event: MouseEvent | null) {
    if (event) event.stopPropagation();
    const tab = tabs[idx];
    if (!tab || tab.pinned) return;

    if (tab.pending !== tab.content && worktreePath) {
      const wc = tab.lineEndings === 'CRLF' ? tab.pending.replace(/\n/g, '\r\n') : tab.pending;
      await writeFile(`${worktreePath}/${tab.path}`, wc);
    }

    editorStateCache.delete(tab.path);
    closedTabsStack = [...closedTabsStack, { ...tab }].slice(-20);
    tabNavBack = tabNavBack.map(i => i > idx ? i - 1 : i).filter(i => i !== idx);
    tabNavForward = tabNavForward.map(i => i > idx ? i - 1 : i).filter(i => i !== idx);

    const wasActive = idx === activeTabIdx;
    tabs = tabs.filter((_, i) => i !== idx);

    if (tabs.length === 0) {
      activeTabIdx = -1;
    } else if (wasActive) {
      activeTabIdx = Math.min(idx, tabs.length - 1);
    } else if (idx < activeTabIdx) {
      activeTabIdx = activeTabIdx - 1;
    }
  }

  async function reopenClosedTab() {
    if (closedTabsStack.length === 0 || !worktreePath) return;
    const tab = closedTabsStack[closedTabsStack.length - 1];
    closedTabsStack = closedTabsStack.slice(0, -1);
    if (isBinaryPath(tab.path)) {
      tabs = [...tabs, { ...tab }];
    } else {
      try {
        const text = await readFile(`${worktreePath}/${tab.path}`) ?? tab.pending;
        tabs = [...tabs, { ...tab, content: text, pending: text }];
      } catch {
        tabs = [...tabs, { ...tab }];
      }
    }
    await switchTab(tabs.length - 1);
  }

  async function tabHistoryBack() {
    if (tabNavBack.length === 0) return;
    const target = tabNavBack[tabNavBack.length - 1];
    if (target < 0 || target >= tabs.length) { tabNavBack = tabNavBack.slice(0, -1); return; }
    tabNavBack = tabNavBack.slice(0, -1);
    if (activeTabIdx !== -1) tabNavForward = [...tabNavForward, activeTabIdx];
    tabNavSkip = true;
    await switchTab(target);
    tabNavSkip = false;
  }

  async function tabHistoryForward() {
    if (tabNavForward.length === 0) return;
    const target = tabNavForward[tabNavForward.length - 1];
    if (target < 0 || target >= tabs.length) { tabNavForward = tabNavForward.slice(0, -1); return; }
    tabNavForward = tabNavForward.slice(0, -1);
    if (activeTabIdx !== -1) tabNavBack = [...tabNavBack, activeTabIdx];
    tabNavSkip = true;
    await switchTab(target);
    tabNavSkip = false;
  }

  async function flushSave() {
    if (!activeTab || saving || !worktreePath) return;
    if (activeTab.pending === activeTab.content) return;
    saving = true;
    const wasDeleted = gitStatusMap[activeTab.path] === 'deleted';
    try {
      const writeContent = activeTab.lineEndings === 'CRLF' ? activeTab.pending.replace(/\n/g, '\r\n') : activeTab.pending;
      await writeFile(`${worktreePath}/${activeTab.path}`, writeContent);
      tabs[activeTabIdx].content = activeTab.pending;
      tabs = tabs;
      if (wasDeleted) await loadTree(worktreePath);
      refreshDiff(activeTab);
    } catch (e) {
      error = String(e);
    } finally {
      saving = false;
    }
  }

  function handleChange(value: string) {
    if (activeTabIdx === -1) return;
    tabs[activeTabIdx].pending = value;
    tabs = tabs;
  }

  function computeInsertIndex(clientX: number): number {
    const tabEls = tabsBarEl?.querySelectorAll<HTMLElement>('.file-tab');
    if (!tabEls || tabEls.length === 0) return 0;
    for (let i = 0; i < tabEls.length; i++) {
      const rect = tabEls[i].getBoundingClientRect();
      if (clientX < rect.left + rect.width / 2) return i;
    }
    return tabEls.length;
  }

  function tabPointerDown(e: PointerEvent, idx: number) {
    if ((e.target as Element).closest('button')) return;
    e.preventDefault();
    dragSrcIndex = idx;
    insertIndex = idx;
    didDrag = false;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function tabPointerMove(e: PointerEvent) {
    if (dragSrcIndex === null) return;
    const next = computeInsertIndex(e.clientX);
    if (next !== insertIndex) didDrag = true;
    insertIndex = next;
  }

  function tabPointerUp(e: PointerEvent) {
    if (dragSrcIndex === null || insertIndex === null) return;
    const isNoop = insertIndex === dragSrcIndex || insertIndex === dragSrcIndex + 1;
    if (!isNoop) {
      const newTabs = [...tabs];
      const [moved] = newTabs.splice(dragSrcIndex, 1);
      const adjustedInsert = insertIndex > dragSrcIndex ? insertIndex - 1 : insertIndex;
      newTabs.splice(adjustedInsert, 0, moved);
      const otherPinnedCount = newTabs.filter((_, i) => i !== adjustedInsert && newTabs[i].pinned).length;
      if (adjustedInsert < otherPinnedCount) moved.pinned = true;
      else moved.pinned = false;
      const activePath = tabs[activeTabIdx]?.path;
      const sorted = sortedByPin(newTabs);
      activeTabIdx = activePath ? sorted.findIndex(t => t.path === activePath) : -1;
      tabs = sorted;
    }
    dragSrcIndex = null;
    insertIndex = null;
  }

  function computeInsertIndex2(clientX: number): number {
    const tabEls = tabsBarEl2?.querySelectorAll<HTMLElement>('.file-tab');
    if (!tabEls || tabEls.length === 0) return 0;
    for (let i = 0; i < tabEls.length; i++) {
      const rect = tabEls[i].getBoundingClientRect();
      if (clientX < rect.left + rect.width / 2) return i;
    }
    return tabEls.length;
  }

  function tabPointerDown2(e: PointerEvent, idx: number) {
    if ((e.target as Element).closest('button')) return;
    e.preventDefault();
    dragSrcIndex2 = idx;
    insertIndex2 = idx;
    didDrag2 = false;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function tabPointerMove2(e: PointerEvent) {
    if (dragSrcIndex2 === null) return;
    const next = computeInsertIndex2(e.clientX);
    if (next !== insertIndex2) didDrag2 = true;
    insertIndex2 = next;
  }

  function tabPointerUp2(e: PointerEvent) {
    if (dragSrcIndex2 === null || insertIndex2 === null) return;
    const isNoop = insertIndex2 === dragSrcIndex2 || insertIndex2 === dragSrcIndex2 + 1;
    if (!isNoop) {
      const newTabs = [...tabs2];
      const [moved] = newTabs.splice(dragSrcIndex2, 1);
      const adjustedInsert = insertIndex2 > dragSrcIndex2 ? insertIndex2 - 1 : insertIndex2;
      newTabs.splice(adjustedInsert, 0, moved);
      const otherPinnedCount = newTabs.filter((_, i) => i !== adjustedInsert && newTabs[i].pinned).length;
      if (adjustedInsert < otherPinnedCount) moved.pinned = true;
      else moved.pinned = false;
      const activePath = tabs2[activeTabIdx2]?.path;
      const sorted = sortedByPin(newTabs);
      activeTabIdx2 = activePath ? sorted.findIndex(t => t.path === activePath) : -1;
      tabs2 = sorted;
    }
    dragSrcIndex2 = null;
    insertIndex2 = null;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const GIT_STATUS_PRIORITY = ['staged', 'modified', 'deleted', 'untracked'] as const;

  function nodeGitStatus(node: FileNode): string | null {
    if (!node.isDir) return gitStatusMap[node.path] ?? null;
    const prefix = node.path + '/';
    let best: number = GIT_STATUS_PRIORITY.length;
    for (const [path, status] of Object.entries(gitStatusMap)) {
      if (path.startsWith(prefix) && status !== 'deleted') {
        const idx = GIT_STATUS_PRIORITY.indexOf(status as typeof GIT_STATUS_PRIORITY[number]);
        if (idx !== -1 && idx < best) best = idx;
      }
    }
    return best < GIT_STATUS_PRIORITY.length ? GIT_STATUS_PRIORITY[best] : null;
  }

  let pendingJump2: { line: number; col: number } | null = null;

  async function openFileAtLine(path: string, line: number, col: number) {
    const node = { path, name: path.split('/').pop() ?? path, isDir: false };
    if (splitMode && focusedPane === 1) {
      pendingJump2 = { line, col };
      await openFileInPane2(node);
    } else {
      pendingJump = { line, col };
      await openFile(node);
    }
  }

  $: if (activeTab && pendingJump) {
    const jump = pendingJump;
    pendingJump = null;
    setTimeout(() => editorRef?.jumpTo(jump.line, jump.col), 60);
  }

  $: if (activeTab2 && pendingJump2) {
    const jump = pendingJump2;
    pendingJump2 = null;
    setTimeout(() => editorRef2?.jumpTo(jump.line, jump.col), 60);
  }

  // ── Multi-select ──────────────────────────────────────────────────────────────

  function handleTreeNodeClick(e: MouseEvent, node: FileNode) {
    if (dragJustEnded) { dragJustEnded = false; return; }
    if (e.metaKey || e.ctrlKey || e.shiftKey) {
      const next = new Set(multiSelected);
      if (e.metaKey || e.ctrlKey) {
        if (next.has(node.path)) next.delete(node.path);
        else next.add(node.path);
      } else {
        // ⇧+click: always add
        next.add(node.path);
      }
      multiSelected = next;
      return;
    }
    multiSelected = new Set([node.path]);
    openFile(node);
  }

  // ── Drag-and-drop (pointer-event based, works in WKWebView) ──────────────────

  function getSiblingNamesInDir(dirPath: string): Set<string> {
    if (!dirPath) return new Set(rawTree.map(n => n.name));
    function find(nodes: FileNode[], p: string): FileNode | null {
      for (const n of nodes) {
        if (n.path === p) return n;
        if (n.isDir && n.children) { const f = find(n.children, p); if (f) return f; }
      }
      return null;
    }
    return new Set(find(rawTree, dirPath)?.children?.map(n => n.name) ?? []);
  }

  function resolveDestName(srcPath: string, targetDir: string): string {
    const name = srcPath.split('/').pop()!;
    const srcDir = srcPath.includes('/') ? srcPath.split('/').slice(0, -1).join('/') : '';
    const siblings = getSiblingNamesInDir(targetDir);
    if (srcDir === targetDir) siblings.delete(name);
    return pasteDestName(name, siblings);
  }

  function createDragGhost(label: string) {
    removeDragGhost();
    const el = document.createElement('div');
    el.className = 'drag-ghost';
    el.textContent = label;
    el.style.cssText = 'position:fixed;z-index:9999;pointer-events:none;background:var(--bg-4);color:var(--fg-0);border:1px solid var(--accent);border-radius:4px;padding:3px 8px;font-size:12px;white-space:nowrap;opacity:0.9;';
    document.body.appendChild(el);
    dragGhostEl = el;
  }

  function moveGhost(x: number, y: number) {
    if (!dragGhostEl) return;
    dragGhostEl.style.left = `${x + 12}px`;
    dragGhostEl.style.top = `${y + 12}px`;
  }

  function removeDragGhost() {
    dragGhostEl?.remove();
    dragGhostEl = null;
  }

  function findDropTargetDir(x: number, y: number): string | null {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const btn = (el as HTMLElement).closest('[data-tree-dir]') as HTMLElement | null;
    if (!btn) return null;
    return btn.getAttribute('data-tree-dir') ?? null;
  }

  function onNodePointerDown(e: PointerEvent, node: FileNode) {
    if (gitStatusMap[node.path] === 'deleted') return;
    if (e.button !== 0) return;
    dragSrcNode = node;
    dragActive = false;
    dragPointerStartX = e.clientX;
    dragPointerStartY = e.clientY;
    dragCaptureEl = e.currentTarget as HTMLElement;
    dragCaptureEl.setPointerCapture(e.pointerId);
  }

  function onNodePointerMove(e: PointerEvent) {
    if (!dragSrcNode || !dragCaptureEl) return;
    const dx = e.clientX - dragPointerStartX;
    const dy = e.clientY - dragPointerStartY;
    if (!dragActive && Math.sqrt(dx * dx + dy * dy) < 6) return;

    if (!dragActive) {
      dragActive = true;
      const sources = multiSelected.size > 1 && multiSelected.has(dragSrcNode.path)
        ? `${multiSelected.size} items`
        : dragSrcNode.name;
      createDragGhost(sources);
    }

    moveGhost(e.clientX, e.clientY);

    const targetDirAttr = findDropTargetDir(e.clientX, e.clientY);
    if (targetDirAttr === null) {
      dragOverDir = null;
      return;
    }
    const targetDir = targetDirAttr; // '' = root
    const sources = multiSelected.size > 1 && multiSelected.has(dragSrcNode.path)
      ? [...multiSelected]
      : [dragSrcNode.path];
      
    const invalid = sources.some(s => s === targetDir || targetDir.startsWith(s + '/'));
    dragOverDir = invalid ? null : targetDir;
  }

  async function onNodePointerUp(e: PointerEvent) {
    const src = dragSrcNode;
    const wasActive = dragActive;
    const target = dragOverDir;

    dragSrcNode = null;
    dragActive = false;
    dragOverDir = null;
    dragCaptureEl = null;
    removeDragGhost();

    if (wasActive) dragJustEnded = true;
    if (!wasActive || target === null || !src || !worktreePath) return;

    const sources = multiSelected.size > 1 && multiSelected.has(src.path)
      ? [...multiSelected]
      : [src.path];

    for (const srcPath of sources) {
      const destName = resolveDestName(srcPath, target);
      const destRel = target ? `${target}/${destName}` : destName;
      if (destRel === srcPath) continue;
      try {
        await renamePath(`${worktreePath}/${srcPath}`, `${worktreePath}/${destRel}`);
        tabs = tabs.map(t => t.path === srcPath ? { ...t, path: destRel } : t);
        tabs2 = tabs2.map(t => t.path === srcPath ? { ...t, path: destRel } : t);
      } catch (err) { error = String(err); }
    }
    multiSelected = new Set();
    await loadTree(worktreePath);
  }

  // ── Bulk delete ───────────────────────────────────────────────────────────────

  function isPathDeleted(tabPath: string): boolean {
    for (const p of multiSelected) {
      if (tabPath === p || tabPath.startsWith(p + '/')) return true;
    }
    return false;
  }

  async function bulkDelete() {
    closeContextMenu();
    if (!worktreePath || multiSelected.size === 0) return;
    for (const p of multiSelected) {
      try { await deletePath(`${worktreePath}/${p}`); } catch {}
    }
    const activeWasDeleted = activeTabIdx >= 0 && isPathDeleted(tabs[activeTabIdx]?.path ?? '');
    const activeWasDeleted2 = activeTabIdx2 >= 0 && isPathDeleted(tabs2[activeTabIdx2]?.path ?? '');
    tabs = tabs.filter(t => !isPathDeleted(t.path));
    tabs2 = tabs2.filter(t => !isPathDeleted(t.path));
    if (activeWasDeleted) {
      activeTabIdx = tabs.length > 0 ? 0 : -1;
    } else if (activeTabIdx >= tabs.length) {
      activeTabIdx = tabs.length - 1;
    }
    if (activeWasDeleted2) {
      activeTabIdx2 = tabs2.length > 0 ? 0 : -1;
    } else if (activeTabIdx2 >= tabs2.length) {
      activeTabIdx2 = tabs2.length - 1;
    }
    multiSelected = new Set();
    await loadTree(worktreePath);
  }

  function collectDirPaths(nodes: FileNode[], acc: Set<string>) {
    for (const n of nodes) {
      if (n.isDir) { acc.add(n.path); if (n.children) collectDirPaths(n.children, acc); }
    }
  }

  function collapseAll() { expanded = new Set(); }

  function expandAll() {
    const all = new Set<string>();
    collectDirPaths(tree, all);
    expanded = all;
  }

  function fileIcon(node: FileNode): string {
    if (node.isDir) return expanded.has(node.path) ? 'folder-open' : 'folder';
    const ext = node.name.split('.').pop()?.toLowerCase() ?? '';
    if (['ts','tsx','js','jsx'].includes(ext)) return 'file-code';
    if (['json','yaml','yml','toml'].includes(ext)) return 'file-code';
    if (['md','mdx'].includes(ext)) return 'file';
    return 'file';
  }
</script>

<div class="files-layout" class:sidebar-right={sidebarRight} class:sidebar-hidden={sidebarHidden}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <aside class="files-tree" style="width: {treeWidth}px" on:contextmenu={(e) => openContextMenu(e, null)}>
    <div class="files-tree-header">
      <div class="tree-header-actions">
        <button type="button" class="tree-action-btn" data-tooltip="Collapse All" on:click={(e) => { e.stopPropagation(); collapseAll(); }}>
          <Icon name="collapse-all" size={12}/>
        </button>
        <button type="button" class="tree-action-btn" data-tooltip="Expand All" on:click={(e) => { e.stopPropagation(); expandAll(); }}>
          <Icon name="expand-all" size={12}/>
        </button>
        <button type="button" class="tree-action-btn" data-tooltip="New File" on:click={(e) => { e.stopPropagation(); if (selectedDir) { expanded.add(selectedDir); expanded = expanded; } startEdit({ type: 'new-file', node: null, parentPath: selectedDir, value: '' }); }}>
          <Icon name="file" size={12}/>
        </button>
        <button type="button" class="tree-action-btn" data-tooltip="New Folder" on:click={(e) => { e.stopPropagation(); if (selectedDir) { expanded.add(selectedDir); expanded = expanded; } startEdit({ type: 'new-dir', node: null, parentPath: selectedDir, value: '' }); }}>
          <Icon name="folder" size={12}/>
        </button>
        <button type="button" class="tree-action-btn {searchPanelOpen ? 'active' : ''}" data-tooltip={tooltipSearch} on:click={(e) => { e.stopPropagation(); toggleSearchPanel(); }}>
          <Icon name="search" size={12}/>
        </button>
        <button type="button" class="tree-action-btn" data-tooltip="Refresh" on:click={(e) => { e.stopPropagation(); if (worktreePath) loadTree(worktreePath); }}>
          <Icon name="refresh" size={12}/>
        </button>
        <button type="button" class="tree-action-btn {splitMode ? 'active' : ''}" data-tooltip={tooltipSplit} on:click={(e) => { e.stopPropagation(); toggleSplit(); }}>
          <Icon name="columns" size={12}/>
        </button>
        <button type="button" class="tree-action-btn {showHidden ? 'active' : ''}" data-tooltip="Toggle Hidden Files" on:click={(e) => { e.stopPropagation(); showHidden = !showHidden; if (worktreePath) loadTree(worktreePath); }}>
          <Icon name="eye" size={12}/>
        </button>

      </div>
    </div>

    {#if loading}
      <div class="tree-state">Loading…</div>
    {:else if error}
      <div class="tree-state error">{error}</div>
    {:else if !worktreePath}
      <div class="tree-state">No active instance</div>
    {:else}
      <button
        type="button"
        class="file-tree-item tree-root-row {selectedDir === '' ? 'selected-dir' : ''} {dragOverDir === '' ? 'drag-over' : ''}"
        style="padding-left: 12px"
        data-tree-dir=""
        on:click={() => { selectedDir = ''; multiSelected = new Set(); }}
        on:contextmenu={(e) => openContextMenu(e, null)}
      >
        <Icon name={selectedDir === '' ? 'folder-open' : 'folder'} size={13}/>
        <span class="file-tree-name">/</span>
      </button>
      {#if editState && editState.parentPath === '' && editState.type !== 'rename'}
        {@render inlineInput(0)}
      {/if}
      {#if tree.length === 0 && !editState}
        <div class="tree-state">Empty worktree</div>
      {/if}
      {#each tree as node}
        {@render treeNode(node, 0)}
      {/each}
    {/if}
  </aside>

  <SearchPanel
    {worktreePath}
    hidden={!searchPanelOpen}
    onOpen={openFileAtLine}
    onClose={closeSearchPanel}
  />

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="resize-handle"
    on:pointerdown={startResize}
    on:pointermove={onResizeMove}
    on:pointerup={stopResize}
    on:pointercancel={stopResize}
    role="separator"
    aria-orientation="vertical"
  ></div>

  <div class="files-editor-wrap">
    <!-- ── Pane 1 ─────────────────────────────────────────────────────────── -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="editor-pane {splitMode && focusedPane === 0 ? 'pane-focused' : ''}"
      style={splitMode && splitLeftWidth > 0 ? `width: ${splitLeftWidth}px; flex: none` : 'flex: 1'}
      bind:this={leftPaneEl}
      on:pointerdown={() => { focusedPane = 0; }}
    >
      {#if tabs.length > 0}
        <div class="tabs-bar" role="tablist" bind:this={tabsBarEl}>
          {#each tabs as tab, i}
            {#if dragSrcIndex !== null && insertIndex === i && !(insertIndex === dragSrcIndex || insertIndex === dragSrcIndex + 1)}
              <div class="drop-indicator"></div>
            {/if}
            {#if i > 0 && tab.pinned === false && tabs[i - 1]?.pinned === true}
              <div class="tab-pin-separator"></div>
            {/if}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="file-tab {i === activeTabIdx ? 'tab-active' : ''} {dragSrcIndex === i ? 'tab-dragging' : ''} {gitStatusMap[tab.path] === 'deleted' ? 'tab-deleted' : ''} {tab.pinned ? 'tab-pinned' : ''}"
              role="tab"
              aria-selected={i === activeTabIdx}
              tabindex="0"
              on:pointerdown={(e) => tabPointerDown(e, i)}
              on:pointermove={tabPointerMove}
              on:pointerup={tabPointerUp}
              on:click={() => { if (!didDrag) switchTab(i); didDrag = false; }}
              on:keydown={(e) => e.key === 'Enter' && switchTab(i)}
              on:contextmenu={(e) => openTabCtxMenu(e, i, 0)}
            >
              {#if tab.pinned}<span class="tab-pin"><Icon name="pin" size={9}/></span>{/if}
              <span class="tab-name">{tab.path.split('/').pop()}</span>
              {#if tab.pending !== tab.content}<span class="tab-dot">●</span>{/if}
              {#if tab.pinned}
                <button type="button" class="tab-close" on:click={(e) => { e.stopPropagation(); togglePinTab(i, 0); }} aria-label="Unpin tab" title="Unpin tab">
                  <Icon name="x" size={11}/>
                </button>
              {:else}
                <button type="button" class="tab-close" on:click={(e) => closeTab(i, e)} aria-label="Close tab">
                  <Icon name="x" size={11}/>
                </button>
              {/if}
            </div>
          {/each}
          {#if dragSrcIndex !== null && insertIndex === tabs.length && insertIndex !== dragSrcIndex + 1}
            <div class="drop-indicator"></div>
          {/if}
        </div>
      {/if}

      {#if activeTab}
        {@const segs1 = breadcrumbSegments(activeTab.path)}
        <div class="editor-topbar">
          <Icon name="file" size={13}/>
          <nav class="editor-breadcrumb" aria-label="File path">
            {#each segs1 as seg, i (i)}
              {#if i > 0}<span class="breadcrumb-sep">/</span>{/if}
              {#if i < segs1.length - 1}
                <button type="button" class="breadcrumb-seg" on:click={() => breadcrumbClickDir(seg.path)}>{seg.name}</button>
              {:else}
                <span class="breadcrumb-seg breadcrumb-file">{seg.name}</span>
              {/if}
            {/each}
          </nav>
        </div>
        <div class="editor-body">
          {#if loadingPaths.has(activeTab.path)}
            <div class="editor-placeholder">Loading…</div>
          {:else if isBinaryPath(activeTab.path)}
            <div class="editor-placeholder">
              <Icon name="file" size={32}/>
              <div>Binary file — preview not available</div>
              <div class="editor-placeholder-path">{activeTab.path}</div>
            </div>
          {:else}
            {#key activeTab.path}
              <CodeEditor
                bind:this={editorRef}
                content={activeTab.pending}
                language={activeLang}
                readonly={false}
                minimapEnabled={$settings.showMinimap ?? true}
                fontSize={$settings.editorFontSize ?? 13}
                showWhitespace={$settings.showWhitespace ?? false}
                initialCursorPos={activeTab.cursorPos}
                initialScrollTop={activeTab.scrollTop}
                savedState={editorStateCache.get(activeTab.path) ?? null}
                diffHunks={currentDiffHunks}
                onDiffClick={handleDiffClick}
                onChange={handleChange}
                onBlur={($settings.saveOn ?? 'blur') === 'blur' ? flushSave : undefined}
                onCursorChange={handleCursorChange}
              />
            {/key}
          {/if}
        </div>
        {#if activeDiffHunk}
          <div class="diff-peek">
            <div class="diff-peek-header">
              <span class="diff-peek-title">Changes — lines {activeDiffHunk.newStart}–{activeDiffHunk.newEnd}</span>
              <button class="diff-peek-close" on:click={() => activeDiffHunk = null} aria-label="Close diff">✕</button>
            </div>
            <div class="diff-peek-body">
              {#each activeDiffHunk.lines as line}
                <div class="diff-peek-line {line.type === '+' ? 'diff-peek-add' : line.type === '-' ? 'diff-peek-del' : 'diff-peek-ctx'}">
                  <span class="diff-peek-sign">{line.type === ' ' ? '' : line.type}</span>
                  <span class="diff-peek-content">{line.content}</span>
                </div>
              {/each}
            </div>
          </div>
        {/if}
        <div class="editor-statusbar">
          <span class="statusbar-item">{cursorLine}:{cursorCol}</span>
          <span class="statusbar-sep">|</span>
          <span class="statusbar-item">{activeLang.toUpperCase()}</span>
          <span class="statusbar-sep">|</span>
          <button class="statusbar-item statusbar-btn" on:click={() => convertLineEndings(0)} title="Convert line endings">{activeLineEndings}</button>
          <span class="statusbar-sep">|</span>
          {#if activeIndentStyle !== null}
            <button class="statusbar-item statusbar-btn" on:click={() => convertIndent(0)} title="Convert indent style">{activeIndentStyle === 'tabs' ? 'Tabs' : `Spaces: ${activeSpaceSize}`}</button>
            <span class="statusbar-sep">|</span>
          {/if}
          <span class="statusbar-item">UTF-8</span>
          <span class="statusbar-sep">|</span>
          <button class="statusbar-item statusbar-btn {$settings.showWhitespace ? 'statusbar-active' : ''}" on:click={() => settings.save({ showWhitespace: !($settings.showWhitespace ?? false) })} title="Toggle whitespace rendering">¶</button>
          {#if isDirty}<span class="statusbar-sep">|</span><span class="statusbar-item statusbar-dirty">●&nbsp;unsaved</span>{/if}
          {#if saving}<span class="statusbar-sep">|</span><span class="statusbar-item statusbar-saving">saving…</span>{/if}
        </div>
      {:else}
        <div class="editor-placeholder">
          <Icon name="file" size={32}/>
          <div>Select a file to edit</div>
          {#if recentFiles.filter(p => treeFilePaths.has(p)).length > 0}
            <div class="recent-files">
              <div class="recent-files-label">Recent</div>
              {#each recentFiles.filter(p => treeFilePaths.has(p)) as path}
                <button
                  type="button"
                  class="recent-file-btn"
                  on:click={() => openFile({ path, name: path.split('/').pop() ?? path, isDir: false })}
                  title={path}
                >
                  <Icon name="file" size={12}/>
                  <span class="recent-file-name">{path.split('/').pop()}</span>
                  <span class="recent-file-dir">{path.includes('/') ? path.split('/').slice(0, -1).join('/') : ''}</span>
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>

    {#if splitMode}
      <!-- ── Split resize handle ──────────────────────────────────────────── -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="split-resize-handle"
        on:pointerdown={startSplitResize}
        on:pointermove={onSplitResizeMove}
        on:pointerup={stopSplitResize}
        on:pointercancel={stopSplitResize}
        role="separator"
        aria-orientation="vertical"
      ></div>

      <!-- ── Pane 2 ────────────────────────────────────────────────────────── -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="editor-pane {focusedPane === 1 ? 'pane-focused' : ''}"
        style="flex: 1"
        on:pointerdown={() => { focusedPane = 1; }}
      >
        {#if tabs2.length > 0}
          <div class="tabs-bar" role="tablist" bind:this={tabsBarEl2}>
            {#each tabs2 as tab, i}
              {#if dragSrcIndex2 !== null && insertIndex2 === i && !(insertIndex2 === dragSrcIndex2 || insertIndex2 === dragSrcIndex2 + 1)}
                <div class="drop-indicator"></div>
              {/if}
              {#if i > 0 && tab.pinned === false && tabs2[i - 1]?.pinned === true}
                <div class="tab-pin-separator"></div>
              {/if}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="file-tab {i === activeTabIdx2 ? 'tab-active' : ''} {dragSrcIndex2 === i ? 'tab-dragging' : ''} {gitStatusMap[tab.path] === 'deleted' ? 'tab-deleted' : ''} {tab.pinned ? 'tab-pinned' : ''}"
                role="tab"
                aria-selected={i === activeTabIdx2}
                tabindex="0"
                on:pointerdown={(e) => tabPointerDown2(e, i)}
                on:pointermove={tabPointerMove2}
                on:pointerup={tabPointerUp2}
                on:click={() => { if (!didDrag2) switchTab2(i); didDrag2 = false; }}
                on:keydown={(e) => e.key === 'Enter' && switchTab2(i)}
                on:contextmenu={(e) => openTabCtxMenu(e, i, 1)}
              >
                {#if tab.pinned}<span class="tab-pin"><Icon name="pin" size={9}/></span>{/if}
                <span class="tab-name">{tab.path.split('/').pop()}</span>
                {#if tab.pending !== tab.content}<span class="tab-dot">●</span>{/if}
                {#if tab.pinned}
                  <button type="button" class="tab-close" on:click={(e) => { e.stopPropagation(); togglePinTab(i, 1); }} aria-label="Unpin tab" title="Unpin tab">
                    <Icon name="x" size={11}/>
                  </button>
                {:else}
                  <button type="button" class="tab-close" on:click={(e) => closeTab2(i, e)} aria-label="Close tab">
                    <Icon name="x" size={11}/>
                  </button>
                {/if}
              </div>
            {/each}
            {#if dragSrcIndex2 !== null && insertIndex2 === tabs2.length && insertIndex2 !== dragSrcIndex2 + 1}
              <div class="drop-indicator"></div>
            {/if}
          </div>
        {/if}

        {#if activeTab2}
          {@const segs2 = breadcrumbSegments(activeTab2.path)}
          <div class="editor-topbar">
            <Icon name="file" size={13}/>
            <nav class="editor-breadcrumb" aria-label="File path">
              {#each segs2 as seg, i (i)}
                {#if i > 0}<span class="breadcrumb-sep">/</span>{/if}
                {#if i < segs2.length - 1}
                  <button type="button" class="breadcrumb-seg" on:click={() => breadcrumbClickDir(seg.path)}>{seg.name}</button>
                {:else}
                  <span class="breadcrumb-seg breadcrumb-file">{seg.name}</span>
                {/if}
              {/each}
            </nav>
          </div>
          <div class="editor-body">
            {#if isBinaryPath(activeTab2.path)}
              <div class="editor-placeholder">
                <Icon name="file" size={32}/>
                <div>Binary file — preview not available</div>
                <div class="editor-placeholder-path">{activeTab2.path}</div>
              </div>
            {:else}
              {#key activeTab2.path}
                <CodeEditor
                  bind:this={editorRef2}
                  content={activeTab2.pending}
                  language={activeLang2}
                  readonly={false}
                  minimapEnabled={$settings.showMinimap ?? true}
                  fontSize={$settings.editorFontSize ?? 13}
                  showWhitespace={$settings.showWhitespace ?? false}
                  initialCursorPos={activeTab2.cursorPos}
                  initialScrollTop={activeTab2.scrollTop}
                  savedState={editorStateCache2.get(activeTab2.path) ?? null}
                  diffHunks={currentDiffHunks2}
                  onDiffClick={(hunk) => { activeDiffHunk2 = activeDiffHunk2 === hunk ? null : hunk; }}
                  onChange={handleChange2}
                  onBlur={($settings.saveOn ?? 'blur') === 'blur' ? flushSave2 : undefined}
                  onCursorChange={(l, c) => { cursorLine2 = l; cursorCol2 = c; }}
                />
              {/key}
            {/if}
          </div>
          {#if activeDiffHunk2}
            <div class="diff-peek">
              <div class="diff-peek-header">
                <span class="diff-peek-title">Changes — lines {activeDiffHunk2.newStart}–{activeDiffHunk2.newEnd}</span>
                <button class="diff-peek-close" on:click={() => activeDiffHunk2 = null} aria-label="Close diff">✕</button>
              </div>
              <div class="diff-peek-body">
                {#each activeDiffHunk2.lines as line}
                  <div class="diff-peek-line {line.type === '+' ? 'diff-peek-add' : line.type === '-' ? 'diff-peek-del' : 'diff-peek-ctx'}">
                    <span class="diff-peek-sign">{line.type === ' ' ? '' : line.type}</span>
                    <span class="diff-peek-content">{line.content}</span>
                  </div>
                {/each}
              </div>
            </div>
          {/if}
          <div class="editor-statusbar">
            <span class="statusbar-item">{cursorLine2}:{cursorCol2}</span>
            <span class="statusbar-sep">|</span>
            <span class="statusbar-item">{activeLang2.toUpperCase()}</span>
            <span class="statusbar-sep">|</span>
            <button class="statusbar-item statusbar-btn" on:click={() => convertLineEndings(1)} title="Convert line endings">{activeLineEndings2}</button>
            <span class="statusbar-sep">|</span>
            {#if activeIndentStyle2 !== null}
              <button class="statusbar-item statusbar-btn" on:click={() => convertIndent(1)} title="Convert indent style">{activeIndentStyle2 === 'tabs' ? 'Tabs' : `Spaces: ${activeSpaceSize2}`}</button>
              <span class="statusbar-sep">|</span>
            {/if}
            <span class="statusbar-item">UTF-8</span>
            {#if isDirty2}<span class="statusbar-sep">|</span><span class="statusbar-item statusbar-dirty">●&nbsp;unsaved</span>{/if}
          </div>
        {:else}
          <div class="editor-placeholder">
            <Icon name="file" size={32}/>
            <div>Open a file in this pane</div>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>

{#if quickOpenVisible}
  <QuickOpen tree={tree} onOpen={quickOpenFile} onClose={() => { quickOpenVisible = false; }} />
{/if}

{#if commandPaletteVisible}
  <CommandPalette
    shortcuts={$shortcuts}
    shortcutDefs={SHORTCUT_DEFS}
    onClose={() => { commandPaletteVisible = false; }}
    onAction={(id) => {
      commandPaletteVisible = false;
      switch (id) {
        case 'quickOpen': quickOpenVisible = true; break;
        case 'searchFiles': toggleSearchPanel(); break;
        case 'splitEditor': toggleSplit(); break;
        case 'toggleSidebar': sidebarHidden = !sidebarHidden; break;
        case 'openSettings': onGoSettings?.(); break;
        case 'closeTab': closeTab(activeTabIdx, null); break;
        case 'reopenClosedTab': reopenClosedTab(); break;
        case 'nextTab': if (tabs.length > 1) switchTab((activeTabIdx + 1) % tabs.length); break;
        case 'prevTab': if (tabs.length > 1) switchTab((activeTabIdx - 1 + tabs.length) % tabs.length); break;
        case 'tabHistoryBack': tabHistoryBack(); break;
        case 'tabHistoryForward': tabHistoryForward(); break;
        case 'saveFile': flushSave(); break;
        case 'fontSizeUp': settings.save({ editorFontSize: Math.min(($settings.editorFontSize ?? 13) + 1, 32) }); break;
        case 'fontSizeDown': settings.save({ editorFontSize: Math.max(($settings.editorFontSize ?? 13) - 1, 8) }); break;
        case 'fontSizeReset': settings.save({ editorFontSize: 13 }); break;
      }
    }}
  />
{/if}

{#if tabCtxMenu}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="ctx-backdrop" on:mousedown={closeTabCtxMenu}></div>
  <div class="ctx-menu" style="left: {tabCtxMenu.x}px; top: {tabCtxMenu.y}px">
    <button type="button" class="ctx-item" on:click={() => togglePinTab(tabCtxMenu!.idx, tabCtxMenu!.pane)}>
      <Icon name="pin" size={13}/> {(tabCtxMenu.pane === 0 ? tabs : tabs2)[tabCtxMenu.idx]?.pinned ? 'Unpin Tab' : 'Pin Tab'}
    </button>
    <div class="ctx-sep"></div>
    <button type="button" class="ctx-item" on:click={() => { const m = tabCtxMenu!; closeTabCtxMenu(); if (m.pane === 0) closeTab(m.idx, null); else closeTab2(m.idx, null); }}>
      Close Tab
    </button>
    <button type="button" class="ctx-item" on:click={() => closeAllTabs(tabCtxMenu!.pane)}>
      Close All Tabs
    </button>
  </div>
{/if}

{#if contextMenu}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="ctx-backdrop" on:mousedown={closeContextMenu}></div>
  <div class="ctx-menu" bind:this={ctxMenuEl} style="left: {contextMenu.x}px; top: {contextMenu.y}px">
    {#if contextMenu.node === null || contextMenu.node.isDir}
      <button type="button" class="ctx-item" on:click={() => handleContextAction('new-file')}>
        <Icon name="file" size={13}/> New File
      </button>
      <button type="button" class="ctx-item" on:click={() => handleContextAction('new-dir')}>
        <Icon name="folder" size={13}/> New Folder
      </button>
      <div class="ctx-sep"></div>
    {/if}
    {#if contextMenu.node !== null}
      <button type="button" class="ctx-item" on:click={() => handleContextAction('cut')}>
        <Icon name="scissors" size={13}/> Cut
      </button>
      <button type="button" class="ctx-item" on:click={() => handleContextAction('copy')}>
        <Icon name="copy" size={13}/> Copy
      </button>
    {/if}
    <button type="button" class="ctx-item" disabled={!fileClipboard} on:click={() => handleContextAction('paste')}>
      <Icon name="clipboard" size={13}/> Paste
    </button>
    {#if multiSelected.size > 1}
      <div class="ctx-sep"></div>
      <button type="button" class="ctx-item ctx-item-danger" on:click={bulkDelete}>
        <Icon name="trash" size={13}/> Delete {multiSelected.size} items
      </button>
    {/if}
    <div class="ctx-sep"></div>
    <button type="button" class="ctx-item" on:click={() => handleContextAction('copy-path')}>
      <Icon name="copy" size={13}/> Copy Path
    </button>
    {#if contextMenu.node !== null}
      <button type="button" class="ctx-item" on:click={() => handleContextAction('copy-rel-path')}>
        <Icon name="copy" size={13}/> Copy Relative Path
      </button>
      <div class="ctx-sep"></div>
      <button type="button" class="ctx-item" on:click={() => handleContextAction('rename')}>
        <Icon name="edit" size={13}/> Rename
      </button>
      <button type="button" class="ctx-item ctx-item-danger" on:click={() => handleContextAction('delete')}>
        <Icon name="trash" size={13}/> Delete
      </button>
    {/if}
    <div class="ctx-sep"></div>
    <button type="button" class="ctx-item" on:click={() => handleContextAction('reveal')}>
      <Icon name="folder" size={13}/> Reveal in Finder
    </button>
    <button type="button" class="ctx-item" on:click={() => handleContextAction('open-terminal')}>
      <Icon name="terminal" size={13}/> Open in Terminal
    </button>
  </div>
{/if}

<!-- Recursive tree node -->
{#snippet treeNode(node: FileNode, depth: number)}
  {#if editState?.type === 'rename' && editState.node?.path === node.path}
    <div class="file-tree-item file-tree-edit" style="padding-left: {12 + depth * 14}px">
      <Icon name={fileIcon(node)} size={13}/>
      <input
        use:focusOnMount
        bind:value={editValue}
        class="tree-edit-input {editConflict ? 'input-conflict' : ''}"
        on:keydown={(e) => { if (e.key === 'Enter') commitEdit(); else if (e.key === 'Escape') cancelEdit(); }}
        on:blur={cancelEdit}
      />
    </div>
  {:else}
    <button
      type="button"
      class="file-tree-item {tabs.some(t => t.path === node.path) ? 'open' : ''} {activeTab?.path === node.path ? 'active' : ''} {loadingPaths.has(node.path) ? 'loading' : ''} {node.isDir && node.path === selectedDir ? 'selected-dir' : ''} {contextMenu?.node?.path === node.path ? 'ctx-target' : ''} {nodeGitStatus(node) ? 'git-' + nodeGitStatus(node) : ''} {multiSelected.has(node.path) ? 'multi-selected' : ''} {node.isDir && dragOverDir === node.path ? 'drag-over' : ''} {cutPaths.has(node.path) ? 'file-cut' : ''}"
      style="padding-left: {12 + depth * 14}px"
      data-tree-dir={node.isDir ? node.path : undefined}
      on:click={(e) => handleTreeNodeClick(e, node)}
      on:contextmenu={(e) => openContextMenu(e, node)}
      on:pointerdown={(e) => onNodePointerDown(e, node)}
      on:pointermove={onNodePointerMove}
      on:pointerup={onNodePointerUp}
      on:pointercancel={() => { dragSrcNode = null; dragActive = false; dragOverDir = null; dragCaptureEl = null; removeDragGhost(); }}
    >
      <Icon name={fileIcon(node)} size={13}/>
      <span class="file-tree-name">{node.name}</span>
      {#if tabs.some(t => t.path === node.path && t.pending !== t.content) || tabs2.some(t => t.path === node.path && t.pending !== t.content)}
        <span class="tab-dot">●</span>
      {/if}
      {#if loadingPaths.has(node.path)}
        <span class="tree-loading-dot">…</span>
      {/if}
    </button>
  {/if}
  {#if node.isDir && expanded.has(node.path) && node.children}
    {#if editState && editState.parentPath === node.path && editState.type !== 'rename'}
      {@render inlineInput(depth + 1)}
    {/if}
    {#each node.children as child}
      {@render treeNode(child, depth + 1)}
    {/each}
  {/if}
{/snippet}

{#snippet inlineInput(depth: number)}
  <div class="file-tree-item file-tree-edit" style="padding-left: {12 + depth * 14}px">
    <Icon name={editState?.type === 'new-dir' ? 'folder' : 'file'} size={13} />
    <input
      use:focusOnMount
      bind:value={editValue}
      placeholder={editState?.type === 'new-dir' ? 'folder name' : 'file name'}
      class="tree-edit-input {editConflict ? 'input-conflict' : ''}"
      on:keydown={(e) => { if (e.key === 'Enter') commitEdit(); else if (e.key === 'Escape') cancelEdit(); }}
      on:blur={cancelEdit}
    />
  </div>
{/snippet}

<style>
  .files-layout { display: flex; flex: 1; min-height: 0; overflow: hidden; }
  .files-layout.sidebar-right { flex-direction: row-reverse; }
  .files-layout.sidebar-right .files-tree { border-right: none; border-left: 1px solid var(--stroke-0); }
  .files-layout.sidebar-hidden .files-tree { display: none; }
  .files-layout.sidebar-hidden .resize-handle { display: none; }

  /* ── File tree ───────────────────────────────────────────────── */

  .files-tree {
    flex-shrink: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 0 0 8px;
    background: var(--bg-1);
    border-right: 1px solid var(--stroke-0);
  }

  .resize-handle {
    width: 3px;
    flex-shrink: 0;
    cursor: col-resize;
    background: var(--stroke-0);
    transition: background 0.15s;
    position: relative;
    z-index: 1;
  }
  .resize-handle:hover,
  .resize-handle:active { background: var(--accent); }

  .files-tree-header {
    display: flex;
    align-items: center;
    padding: 4px 6px;
    border-bottom: 1px solid var(--stroke-0);
  }

  .tree-state {
    padding: 12px 14px;
    font-size: 12px;
    color: var(--fg-3);
  }
  .tree-state.error { color: var(--danger); }

  .file-tree-item {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    padding-top: 4px;
    padding-bottom: 4px;
    padding-right: 12px;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    color: var(--fg-2);
    font-size: 12.5px;
    font-family: var(--font-ui);
  }
  .file-tree-item:hover,
  .file-tree-item.ctx-target { background: var(--bg-4); color: var(--fg-0); }
  .file-tree-item.open { color: var(--fg-1); }
  .file-tree-item.active { background: var(--accent-weak); color: var(--fg-0); }
  .file-tree-item.selected-dir { background: var(--bg-3); color: var(--fg-0); box-shadow: inset 2px 0 0 var(--accent); }
  .file-tree-item.loading { opacity: 0.6; }

  .file-tree-item.git-modified .file-tree-name { color: var(--warning); }
  .file-tree-item.git-untracked .file-tree-name { color: var(--success); }
  .file-tree-item.git-deleted .file-tree-name { color: var(--danger); text-decoration: line-through; opacity: 0.7; }
  .file-tree-item.git-deleted { cursor: default; }
  .file-tree-item.git-staged .file-tree-name { color: var(--accent); }
  .file-tree-item.multi-selected { background: var(--accent-weak); color: var(--fg-0); }
  .file-tree-item.file-cut { opacity: 0.45; }
  .file-tree-item.file-cut .file-tree-name { text-decoration: underline dashed; text-underline-offset: 3px; }
  .file-tree-item.drag-over { background: var(--accent-weak); box-shadow: inset 0 0 0 1px var(--accent); }

  button.file-tree-item :global(*) { pointer-events: none; }
  .file-tree-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tree-loading-dot { font-size: 11px; color: var(--fg-3); font-family: var(--font-mono); }

  /* ── Editor wrap ─────────────────────────────────────────────── */

  .files-editor-wrap { flex: 1; display: flex; flex-direction: row; overflow: hidden; }

  .editor-pane { display: flex; flex-direction: column; overflow: hidden; min-width: 0; }
  .editor-pane.pane-focused { box-shadow: inset 0 0 0 1px var(--accent-line); }

  .split-resize-handle {
    width: 3px;
    flex-shrink: 0;
    cursor: col-resize;
    background: var(--stroke-0);
    transition: background 0.15s;
  }
  .split-resize-handle:hover,
  .split-resize-handle:active { background: var(--accent); }

  /* ── Tab bar ─────────────────────────────────────────────────── */

  .tabs-bar {
    display: flex;
    align-items: stretch;
    flex-shrink: 0;
    overflow-x: auto;
    border-bottom: 1px solid var(--stroke-0);
    background: var(--bg-1);
    scrollbar-width: thin;
    scrollbar-color: var(--stroke-1) transparent;
  }
  .tabs-bar::-webkit-scrollbar { height: 4px; }
  .tabs-bar::-webkit-scrollbar-track { background: transparent; }
  .tabs-bar::-webkit-scrollbar-thumb { background: var(--stroke-1); border-radius: 2px; }

  .file-tab {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 0 10px 0 12px;
    height: 34px;
    border: none;
    border-right: 1px solid var(--stroke-0);
    background: none;
    color: var(--fg-3);
    font-size: 12px;
    font-family: var(--font-ui);
    cursor: grab;
    white-space: nowrap;
    flex-shrink: 0;
    user-select: none;
  }
  .file-tab:hover { background: var(--bg-4); color: var(--fg-1); }
  .file-tab:active { cursor: grabbing; }
  .file-tab.tab-active {
    background: var(--bg-0);
    color: var(--fg-0);
    border-bottom: 2px solid var(--accent);
  }
  .file-tab.tab-dragging { opacity: 0.4; cursor: grabbing; }
  .file-tab.tab-deleted .tab-name { text-decoration: line-through; color: var(--danger); opacity: 0.7; }
  .file-tab.tab-pinned { border-left: 2px solid var(--accent); }

  .tab-name { max-width: 140px; overflow: hidden; text-overflow: ellipsis; }

  .tab-pin {
    font-size: 9px;
    opacity: 0.6;
    flex-shrink: 0;
    line-height: 1;
  }
  .tab-dot { color: var(--accent); font-size: 10px; line-height: 1; }

  .tab-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border: none;
    background: none;
    border-radius: 3px;
    cursor: pointer;
    color: inherit;
    opacity: 0;
    padding: 0;
    flex-shrink: 0;
  }
  .file-tab:hover .tab-close,
  .file-tab.tab-active .tab-close { opacity: 0.6; }
  .tab-close:hover { background: var(--bg-4); opacity: 1 !important; }

  .drop-indicator {
    width: 2px;
    align-self: stretch;
    background: var(--accent);
    border-radius: 1px;
    margin: 4px 1px;
    pointer-events: none;
    flex-shrink: 0;
  }

  .tab-pin-separator {
    width: 1px;
    align-self: stretch;
    background: var(--border, rgba(255,255,255,0.12));
    margin: 4px 2px;
    flex-shrink: 0;
    pointer-events: none;
  }

  /* ── Editor topbar & breadcrumb ─────────────────────────────── */

  .editor-topbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 16px;
    height: 34px;
    border-bottom: 1px solid var(--stroke-0);
    background: var(--bg-2);
    flex-shrink: 0;
    font-size: 12px;
    overflow: hidden;
  }

  .editor-breadcrumb {
    display: flex;
    align-items: center;
    gap: 1px;
    overflow: hidden;
    flex: 1;
    font-family: var(--font-ui);
    font-size: 12px;
  }

  .breadcrumb-sep {
    color: var(--fg-4);
    padding: 0 1px;
    font-size: 11px;
    flex-shrink: 0;
  }

  .breadcrumb-seg {
    background: none;
    border: none;
    color: var(--fg-3);
    font: inherit;
    cursor: pointer;
    padding: 1px 3px;
    border-radius: 3px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 140px;
    flex-shrink: 1;
  }
  .breadcrumb-seg:hover { background: var(--bg-4); color: var(--fg-1); }

  .breadcrumb-file {
    color: var(--fg-0);
    font-weight: 600;
    padding: 1px 3px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 200px;
    flex-shrink: 0;
  }
  .editor-body { flex: 1; overflow: hidden; position: relative; }

  /* ── Diff peek panel ────────────────────────────────────────── */

  .diff-peek {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    max-height: 220px;
    border-top: 1px solid var(--stroke-1);
    background: var(--bg-0);
  }

  .diff-peek-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 5px 14px;
    border-bottom: 1px solid var(--stroke-0);
    flex-shrink: 0;
  }

  .diff-peek-title {
    font-family: var(--font-ui);
    font-size: 11px;
    color: var(--fg-3);
    letter-spacing: 0.02em;
  }

  .diff-peek-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border: none;
    background: none;
    border-radius: 3px;
    cursor: pointer;
    color: var(--fg-3);
    padding: 0;
  }
  .diff-peek-close:hover { background: var(--bg-4); color: var(--fg-0); }

  .diff-peek-body {
    overflow-y: auto;
    overflow-x: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--stroke-1) transparent;
    padding: 4px 0;
  }

  .diff-peek-line {
    display: flex;
    align-items: baseline;
    padding: 0 14px;
    line-height: 1.65;
    white-space: pre;
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .diff-peek-add { background: var(--success-weak); }
  .diff-peek-del { background: var(--danger-weak); }

  .diff-peek-sign {
    width: 14px;
    flex-shrink: 0;
    user-select: none;
    font-weight: 600;
  }
  .diff-peek-add .diff-peek-sign { color: var(--success); }
  .diff-peek-del .diff-peek-sign { color: var(--danger); }
  .diff-peek-ctx .diff-peek-sign { color: transparent; }

  .diff-peek-content { color: var(--fg-1); }
  .diff-peek-add .diff-peek-content { color: var(--fg-0); }
  .diff-peek-del .diff-peek-content { color: var(--fg-0); }

  /* ── Status bar ──────────────────────────────────────────────── */

  .editor-statusbar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 12px;
    height: 22px;
    border-top: 1px solid var(--stroke-0);
    background: var(--bg-1);
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-3);
  }

  .statusbar-item { white-space: nowrap; }
  .statusbar-sep { color: var(--fg-4); }
  .statusbar-dirty { color: var(--accent); }
  .statusbar-saving { color: var(--fg-3); font-style: italic; }

  .statusbar-btn {
    background: none;
    border: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
    padding: 0 2px;
    border-radius: 2px;
    white-space: nowrap;
  }
  .statusbar-btn:hover { background: var(--bg-4); color: var(--fg-1); }
  .statusbar-active { color: var(--accent); }

  .editor-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 12px;
    color: var(--fg-3);
    font-size: 13px;
  }
  .editor-placeholder-path {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-4);
  }

  .recent-files {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 1px;
    margin-top: 8px;
    width: 280px;
    max-width: 100%;
  }
  .recent-files-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--fg-4);
    padding: 0 6px 4px;
  }
  .recent-file-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    border-radius: 4px;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--fg-2);
    font-size: 12px;
    text-align: left;
    min-width: 0;
  }
  .recent-file-btn:hover { background: var(--bg-2); color: var(--fg-0); }
  .recent-file-name {
    font-family: var(--font-mono);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex-shrink: 0;
    max-width: 140px;
  }
  .recent-file-dir {
    font-size: 10px;
    color: var(--fg-4);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
  }

  /* ── Tree header actions ─────────────────────────────────────────── */

  .tree-root-row { box-shadow: 0 1px 0 var(--stroke-0); margin-bottom: 2px; }
  .tree-header-actions {
    display: flex;
    gap: 2px;
    flex: 1;
    justify-content: center;
  }
  .tree-action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border: none;
    background: none;
    border-radius: 3px;
    cursor: pointer;
    color: var(--fg-3);
    padding: 0;
    position: relative;
  }
  .tree-action-btn:hover { background: var(--bg-4); color: var(--fg-0); }
  .tree-action-btn.active { color: var(--accent); }

  .tree-action-btn[data-tooltip]::after {
    content: attr(data-tooltip);
    position: absolute;
    top: calc(100% + 5px);
    left: 50%;
    transform: translateX(-50%);
    background: var(--bg-3);
    border: 1px solid var(--stroke-1);
    color: var(--fg-1);
    font-family: var(--font-ui);
    font-size: 11px;
    white-space: nowrap;
    padding: 3px 7px;
    border-radius: 4px;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.1s;
    z-index: 200;
  }
  .tree-action-btn[data-tooltip]:hover::after {
    opacity: 1;
  }

  /* ── Inline edit ─────────────────────────────────────────────────── */

  .file-tree-edit { cursor: default; pointer-events: none; }
  .tree-edit-input {
    flex: 1;
    background: var(--bg-3);
    border: 1px solid var(--accent);
    border-radius: 3px;
    color: var(--fg-0);
    font-size: 12.5px;
    font-family: var(--font-ui);
    padding: 1px 4px;
    outline: none;
    min-width: 0;
    pointer-events: all;
  }
  .tree-edit-input.input-conflict {
    border-color: oklch(0.70 0.18 15);
    background: oklch(0.18 0.06 15);
    color: oklch(0.88 0.14 15);
  }

  /* ── Context menu ────────────────────────────────────────────────── */

  .ctx-backdrop {
    position: fixed;
    inset: 0;
    z-index: 9998;
  }
  .ctx-menu {
    position: fixed;
    z-index: 9999;
    background: var(--bg-2);
    border: 1px solid var(--stroke-1);
    border-radius: 6px;
    padding: 4px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4);
    min-width: 148px;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .ctx-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 10px;
    border: none;
    background: none;
    border-radius: 4px;
    cursor: pointer;
    color: var(--fg-1);
    font-size: 12.5px;
    font-family: var(--font-ui);
    text-align: left;
    width: 100%;
  }
  .ctx-item:hover { background: var(--bg-4); color: var(--fg-0); }
  .ctx-item:disabled { opacity: 0.35; cursor: default; }
  .ctx-item:disabled:hover { background: none; color: var(--fg-1); }
  .ctx-item-danger { color: oklch(0.72 0.18 15); }
  .ctx-item-danger:hover { background: oklch(0.22 0.08 15); color: oklch(0.85 0.18 15); }
  .ctx-sep { height: 1px; background: var(--stroke-0); margin: 3px 0; }

</style>
