<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
import { get } from 'svelte/store';
  import Icon from '$lib/components/Icon.svelte';
  import CodeEditor from './CodeEditor.svelte';
  import QuickOpen from './QuickOpen.svelte';
  import SearchPanel from './SearchPanel.svelte';
  import CommandPalette from './CommandPalette.svelte';
  import EditorPane from './EditorPane.svelte';
  import { activeInstance } from '$lib/stores/instance';
  import { activeProjectId } from '$lib/stores/project';
  import { activeScreen } from '$lib/stores/ui';
  import { readDirTree, readFile, writeFile, deletePath, renamePath, createFileOrDir, copyPath, revealInFileManager, openInTerminal, langFromPath, isBinaryPath, gitStatus, gitFileAtCommit, type FileNode, type GitStatusMap, type DiffHunk, type BlameEntry } from '$lib/services/file-service';
  import { settings } from '$lib/stores/settings';
  import { shortcuts, activeShortcuts, matchesShortcut, bindingToLabels, SHORTCUT_DEFS } from '$lib/stores/shortcuts';
  import type { EditorState } from '@codemirror/state';
  import {
    type Tab,
    type PersistedState,
    type InstanceTabState,
    persistState,
    readPersistedState,
    readRecentFiles,
    writeRecentFiles,
    pushRecent,
    rehydrateFromPersisted,
  } from '$lib/utils/files/files-persistence';
  import {
    detectLineEndings,
    detectIndentStyle,
    detectSpaceSize,
    convertToSpaces,
    convertToTabs,
  } from '$lib/utils/files/files-indent';
  import {
    flattenVisible,
    flattenToNodes,
    collectFilePaths,
    collectDirPaths,
    getSiblingNames,
    nodeGitStatus,
    fileIcon as fileIconFor,
    pasteDestName,
    resolveDestName,
    parentPathOf,
  } from '$lib/utils/files/files-tree';
  import {
    loadPaneDiff,
    emptyDiffState,
    buildRevertedContent,
  } from '$lib/utils/files/files-diff';
  import {
    computeTabInsertIndex,
    sortedByPin,
    applyTabReorder,
  } from '$lib/utils/files/files-tab-drag';
  import {
    createDragGhost,
    moveGhost,
    removeDragGhost,
    findDropTargetDir,
  } from '$lib/utils/files/files-drag-ghost';

  export let onGoSettings: (() => void) | undefined = undefined;

  interface BlamePopup {
    entry: BlameEntry;
    filePath: string;
    oldContent: string | null;
    newContent: string | null;
    loadingDiff: boolean;
    error: string | null;
  }

  interface PaneState {
    tabs: Tab[];
    activeTabIdx: number;
    saving: boolean;
    currentDiffHunks: DiffHunk[];
    currentStagedHunks: DiffHunk[];
    currentBlame: Map<number, BlameEntry>;
    activeDiffHunk: DiffHunk | null;
    revertPending: boolean;
    reverting: boolean;
    dragSrcIndex: number | null;
    insertIndex: number | null;
    didDrag: boolean;
    rootEl: HTMLElement | null;
    tabsBarEl: HTMLElement | null;
    editorRef: CodeEditor | undefined;
    editorStateCache: Map<string, EditorState>;
  }

  function makePane(): PaneState {
    return {
      tabs: [],
      activeTabIdx: -1,
      saving: false,
      currentDiffHunks: [],
      currentStagedHunks: [],
      currentBlame: new Map(),
      activeDiffHunk: null,
      revertPending: false,
      reverting: false,
      dragSrcIndex: null,
      insertIndex: null,
      didDrag: false,
      rootEl: null,
      tabsBarEl: null,
      editorRef: undefined,
      editorStateCache: new Map(),
    };
  }

  let panes: PaneState[] = [makePane(), makePane()];
  let cursorLines: number[] = [1, 1];
  let cursorCols: number[] = [1, 1];
  let blamePopups: (BlamePopup | null)[] = [null, null];
  let pendingJumps: ({ line: number; col: number } | null)[] = [null, null];

  function loadRecentFiles(instanceId: string) {
    recentFiles = readRecentFiles(instanceId);
  }

  function pushRecentFile(path: string) {
    if (!currentInstanceId) return;
    const updated = pushRecent(recentFiles, path);
    recentFiles = updated;
    writeRecentFiles(currentInstanceId, updated);
  }

  function snapshotInstanceState(): InstanceTabState {
    return {
      panes: panes.map(p => ({ tabs: p.tabs, activeTabIdx: p.activeTabIdx })),
      expanded,
      splitMode,
      splitLeftWidth,
    };
  }

  async function rehydrateTabs(wtp: string, persisted: PersistedState) {
    panes = persisted.panes.map((pp, i) => {
      const base = makePane();
      base.tabs = pp.tabs.map(p => ({ path: p.path, content: '', pending: '', cursorPos: p.cursorPos, scrollTop: p.scrollTop }));
      base.activeTabIdx = pp.activeTabIdx;
      return base;
    });
    expanded = new Set(persisted.expanded);
    splitMode = persisted.splitMode ?? false;
    splitLeftWidth = persisted.splitLeftWidth ?? 0;

    const result = await rehydrateFromPersisted(wtp, persisted);
    panes = panes.map((pane, i) => {
      const r = result.panes[i];
      if (!r) return pane;
      return { ...pane, tabs: r.tabs, activeTabIdx: r.activeTabIdx };
    });
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
  let dragPointerStartX = 0;
  let dragPointerStartY = 0;
  let dragCaptureEl: HTMLElement | null = null;
  let dragJustEnded = false;

  function buildTree(raw: FileNode[], _map: GitStatusMap): FileNode[] {
    return raw;
  }
  let expanded = new Set<string>();
  let recentFiles: string[] = [];
  let loading = false;
  let loadingPaths = new Set<string>();
  let error = '';

  // ── Split pane ────────────────────────────────────────────────────────────────
  let splitMode = false;
  let focusedPane: 0 | 1 = 0;
  let isSplitResizing = false;
  let splitResizeStartX = 0;
  let splitResizeStartWidth = 0;
  let splitLeftWidth = 0;

  $: activeTabs = panes.map(p => p.tabs[p.activeTabIdx] ?? null);
  $: activeLangs = activeTabs.map(t => (t ? langFromPath(t.path) : 'text') as any);
  $: activeLineEndingsArr = activeTabs.map(t => t?.lineEndings ?? 'LF');
  $: isDirtyArr = activeTabs.map(t => t ? t.pending !== t.content : false);
  $: activeIndentStyles = activeTabs.map(t => t ? detectIndentStyle(t.pending) : null);
  $: activeSpaceSizes = activeTabs.map((t, i) => (t && activeIndentStyles[i] === 'spaces') ? detectSpaceSize(t.pending) : 2);
  $: currentLineBlames = panes.map((p, i) => p.currentBlame.get(cursorLines[i]) ?? null);

  function toggleSplit() {
    splitMode = !splitMode;
    if (!splitMode) {
      panes[1] = makePane();
      panes = panes;
      focusedPane = 0;
    }
    if (currentInstanceId) persistState(currentInstanceId, snapshotInstanceState());
  }

  function startSplitResize(e: PointerEvent) {
    isSplitResizing = true;
    splitResizeStartX = e.clientX;
    splitResizeStartWidth = panes[0].rootEl?.getBoundingClientRect().width ?? splitLeftWidth;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onSplitResizeMove(e: PointerEvent) {
    if (!isSplitResizing) return;
    const totalW = panes[0].rootEl?.parentElement?.getBoundingClientRect().width ?? 800;
    const minW = 120;
    const maxW = totalW - 120 - 3;
    splitLeftWidth = Math.max(minW, Math.min(maxW, splitResizeStartWidth + (e.clientX - splitResizeStartX)));
  }

  function stopSplitResize() {
    if (!isSplitResizing) return;
    isSplitResizing = false;
    if (currentInstanceId) persistState(currentInstanceId, snapshotInstanceState());
  }

  function captureEditorState(i: number) {
    const pane = panes[i];
    if (pane.activeTabIdx === -1 || !pane.editorRef) return;
    const state = pane.editorRef.getState();
    pane.tabs[pane.activeTabIdx].cursorPos = state.cursorPos;
    pane.tabs[pane.activeTabIdx].scrollTop = state.scrollTop;
    const es = pane.editorRef.getEditorState();
    if (es) pane.editorStateCache.set(pane.tabs[pane.activeTabIdx].path, es);
    panes = panes;
  }

  async function loadDiffHunks(i: number, tab: { path: string } | null): Promise<void> {
    const pane = panes[i];
    if (!tab || !worktreePath) {
      const empty = emptyDiffState();
      pane.currentDiffHunks = empty.currentDiffHunks;
      pane.currentStagedHunks = empty.currentStagedHunks;
      pane.currentBlame = empty.currentBlame;
      panes = panes;
      return;
    }
    try {
      const status = gitStatusMap[tab.path];
      const pending = pane.tabs.find(t => t.path === tab.path)?.pending ?? '';
      const result = await loadPaneDiff(worktreePath, tab.path, status, pending);
      pane.currentDiffHunks = result.currentDiffHunks;
      pane.currentStagedHunks = result.currentStagedHunks;
      pane.currentBlame = result.currentBlame;
    } catch {
      const empty = emptyDiffState();
      pane.currentDiffHunks = empty.currentDiffHunks;
      pane.currentStagedHunks = empty.currentStagedHunks;
      pane.currentBlame = empty.currentBlame;
    }
    panes = panes;
  }

  async function refreshDiff(i: number, tab: { path: string } | null) {
    panes[i].activeDiffHunk = null;
    panes = panes;
    await loadDiffHunks(i, tab);
  }

  async function switchTab(i: number, idx: number) {
    const pane = panes[i];
    if (idx === pane.activeTabIdx) return;
    if (i === 0 && !tabNavSkip && pane.activeTabIdx !== -1) {
      tabNavBack = [...tabNavBack, pane.activeTabIdx].slice(-50);
      tabNavForward = [];
    }
    captureEditorState(i);
    if (i === 0 && ($settings.saveOn ?? 'blur') === 'blur') await flushSave(0);
    panes[i].activeTabIdx = idx;
    panes = panes;
    if (i === 0) syncActiveTabToTree();
    refreshDiff(i, panes[i].tabs[idx] ?? null);
  }

  async function closeTab(i: number, idx: number, event: MouseEvent | null) {
    if (event) event.stopPropagation();
    const pane = panes[i];
    const tab = pane.tabs[idx];
    if (!tab || tab.pinned) return;

    if (tab.pending !== tab.content && worktreePath) {
      const wc = tab.lineEndings === 'CRLF' ? tab.pending.replace(/\n/g, '\r\n') : tab.pending;
      await writeFile(`${worktreePath}/${tab.path}`, wc);
    }

    pane.editorStateCache.delete(tab.path);
    if (i === 0) {
      closedTabsStack = [...closedTabsStack, { ...tab }].slice(-20);
      tabNavBack = tabNavBack.map(j => j > idx ? j - 1 : j).filter(j => j !== idx);
      tabNavForward = tabNavForward.map(j => j > idx ? j - 1 : j).filter(j => j !== idx);
    }

    const wasActive = idx === pane.activeTabIdx;
    pane.tabs = pane.tabs.filter((_, j) => j !== idx);

    if (pane.tabs.length === 0) {
      pane.activeTabIdx = -1;
    } else if (wasActive) {
      pane.activeTabIdx = Math.min(idx, pane.tabs.length - 1);
    } else if (idx < pane.activeTabIdx) {
      pane.activeTabIdx = pane.activeTabIdx - 1;
    }
    panes = panes;
  }

  function handleChange(i: number, value: string) {
    const pane = panes[i];
    if (pane.activeTabIdx === -1) return;
    const changedPath = pane.tabs[pane.activeTabIdx].path;
    pane.tabs[pane.activeTabIdx].pending = value;
    for (let j = 0; j < panes.length; j++) {
      if (j === i) continue;
      for (const tab of panes[j].tabs) {
        if (tab.path === changedPath && tab.pending !== value) tab.pending = value;
      }
    }
    panes = panes;
  }

  async function flushSave(i: number) {
    const pane = panes[i];
    const tab = pane.tabs[pane.activeTabIdx] ?? null;
    if (!tab || pane.saving || !worktreePath) return;
    if (tab.pending === tab.content) return;
    pane.saving = true;
    panes = panes;
    const wasDeleted = gitStatusMap[tab.path] === 'deleted';
    try {
      const writeContent = tab.lineEndings === 'CRLF' ? tab.pending.replace(/\n/g, '\r\n') : tab.pending;
      await writeFile(`${worktreePath}/${tab.path}`, writeContent);
      pane.tabs[pane.activeTabIdx].content = tab.pending;
      panes = panes;
      if (wasDeleted) await loadTree(worktreePath);
      refreshDiff(i, tab);
    } catch (e) {
      error = String(e);
    } finally {
      pane.saving = false;
      panes = panes;
    }
  }

  function saveSnapshotToDisk(snapshots: Tab[][], wtp: string): void {
    for (const tab of snapshots.flat()) {
      if (tab.pending === tab.content) continue;
      const path = tab.path;
      const wc = tab.lineEndings === 'CRLF' ? tab.pending.replace(/\n/g, '\r\n') : tab.pending;
      tab.content = tab.pending; // shared ref — mutates original tabs[i] so saveCurrentState captures clean state
      writeFile(`${wtp}/${path}`, wc).catch(() => {});
    }
  }

  async function openFileInPane(i: number, node: FileNode) {
    if (gitStatusMap[node.path] === 'deleted') return;
    if (node.isDir) {
      if (expanded.has(node.path)) expanded.delete(node.path);
      else expanded.add(node.path);
      expanded = expanded;
      if (i === 0) selectedDir = node.path;
      return;
    }
    const pane = panes[i];
    const existingIdx = pane.tabs.findIndex(t => t.path === node.path);
    if (existingIdx !== -1) {
      captureEditorState(i);
      pane.activeTabIdx = existingIdx;
      panes = panes;
      if (i === 0) pushRecentFile(node.path);
      refreshDiff(i, { path: node.path });
      return;
    }
    if (isBinaryPath(node.path)) {
      pane.tabs = [...pane.tabs, { path: node.path, content: '', pending: '', cursorPos: 0, scrollTop: 0 }];
      pane.activeTabIdx = pane.tabs.length - 1;
      pane.currentDiffHunks = []; pane.currentStagedHunks = []; pane.currentBlame = new Map();
      panes = panes;
      if (i === 0) pushRecentFile(node.path);
      return;
    }
    captureEditorState(i);
    try {
      const raw2 = await readFile(`${worktreePath}/${node.path}`) ?? '';
      const le2 = detectLineEndings(raw2);
      const text2 = le2 === 'CRLF' ? raw2.replace(/\r\n/g, '\n') : raw2;
      pane.tabs = [...pane.tabs, { path: node.path, content: text2, pending: text2, cursorPos: 0, scrollTop: 0, lineEndings: le2 }];
      pane.activeTabIdx = pane.tabs.length - 1;
      panes = panes;
      if (i === 0) pushRecentFile(node.path);
      refreshDiff(i, { path: node.path });
    } catch (e) { error = String(e); }
  }

  function handleDiffClick(i: number, hunk: DiffHunk) {
    panes[i].activeDiffHunk = panes[i].activeDiffHunk === hunk ? null : hunk;
    panes[i].revertPending = false;
    panes = panes;
  }

  async function revertHunk(hunk: DiffHunk, i: number): Promise<void> {
    const pane = panes[i];
    const tab = pane.tabs[pane.activeTabIdx] ?? null;
    if (!worktreePath || !tab) return;
    pane.reverting = true;
    panes = panes;
    try {
      const newContent = buildRevertedContent(tab.pending, hunk);
      const writeContent = tab.lineEndings === 'CRLF' ? newContent.replace(/\n/g, '\r\n') : newContent;
      await writeFile(`${worktreePath}/${tab.path}`, writeContent);

      pane.tabs[pane.activeTabIdx].content = newContent;
      pane.tabs[pane.activeTabIdx].pending = newContent;
      pane.activeDiffHunk = null;
      pane.revertPending = false;
      panes = panes;

      const updated = await gitStatus(worktreePath).catch(() => null);
      if (updated !== null) { gitStatusMap = updated; tree = buildTree(rawTree, updated); }
      await refreshDiff(i, tab);
    } finally {
      panes[i].reverting = false;
      panes = panes;
    }
  }

  let quickOpenVisible = false;
  let searchPanelByProject: Record<string, boolean> = {};

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
            ? flattenVisible(tree, expanded).find(n => n.path === targetDir)?.children
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
          panes[0].tabs = panes[0].tabs.map(t => t.path === src.path ? { ...t, path: destRelPath } : t);
          panes = panes;
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
        ? flattenToNodes(tree, multiSelected)
        : [node];
      fileClipboard = { nodes: srcs, srcWorktreePath: worktreePath ?? '', op: 'cut' };
      return;
    }
    if (action === 'copy' && node) {
      const srcs = multiSelected.size > 1 && multiSelected.has(node.path)
        ? flattenToNodes(tree, multiSelected)
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
        panes[0].tabs = panes[0].tabs.filter(t => !t.path.startsWith(node.path));
        if (panes[0].activeTabIdx >= panes[0].tabs.length) panes[0].activeTabIdx = panes[0].tabs.length - 1;
        panes = panes;
        if (worktreePath) await loadTree(worktreePath);
      } catch (e) { error = String(e); }
      return;
    }
    if (action === 'rename' && node) {
      startEdit({ type: 'rename', node, parentPath: parentPathOf(node.path), value: node.name });
      return;
    }
    const parentPath = node?.isDir ? node.path : parentPathOf(node?.path ?? '');
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
        panes[0].tabs = panes[0].tabs.map(t => t.path === oldRelPath ? { ...t, path: newRelPath } : t);
        panes = panes;
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

  $: editConflict = !!editState && !!editValue.trim() && (() => {
    const siblings = new Set([...getSiblingNames(tree, editState!.parentPath)].map(n => n.toLowerCase()));
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

  function handleCursorChange(i: number, line: number, col: number) {
    cursorLines[i] = line;
    cursorCols[i] = col;
    panes = panes;
  }

  async function openBlamePopup(entry: BlameEntry, filePath: string, paneIdx: 0 | 1) {
    const popup: BlamePopup = { entry, filePath, oldContent: null, newContent: null, loadingDiff: true, error: null };
    blamePopups[paneIdx] = popup;
    panes = panes;
    try {
      const [newContent, oldContent] = await Promise.all([
        worktreePath ? gitFileAtCommit(worktreePath, entry.hash, filePath) : Promise.resolve(''),
        worktreePath ? gitFileAtCommit(worktreePath, `${entry.hash}^`, filePath).catch(() => '') : Promise.resolve(''),
      ]);
      popup.newContent = newContent;
      popup.oldContent = oldContent;
      popup.loadingDiff = false;
      blamePopups[paneIdx] = { ...popup };
      panes = panes;
    } catch (e) {
      popup.loadingDiff = false;
      popup.error = e instanceof Error ? e.message : 'Failed to load diff';
      blamePopups[paneIdx] = { ...popup };
      panes = panes;
    }
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
    // ── Tab management ─────────────────────────────────────────────────────
    if (matchesShortcut(e, $activeShortcuts.closeTab)) {
      e.preventDefault();
      e.stopPropagation();
      const activePane = focusedPane === 1 && splitMode ? 1 : 0;
      closeTab(activePane, panes[activePane].activeTabIdx, null);
    }
    if (matchesShortcut(e, $activeShortcuts.reopenClosedTab)) {
      e.preventDefault();
      reopenClosedTab();
    }
    if (matchesShortcut(e, $activeShortcuts.nextTab)) {
      e.preventDefault();
      const tabs0 = panes[0].tabs;
      if (tabs0.length > 1) switchTab(0, (panes[0].activeTabIdx + 1) % tabs0.length);
    }
    if (matchesShortcut(e, $activeShortcuts.prevTab)) {
      e.preventDefault();
      const tabs0 = panes[0].tabs;
      if (tabs0.length > 1) switchTab(0, (panes[0].activeTabIdx - 1 + tabs0.length) % tabs0.length);
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
      if (idx < panes[0].tabs.length) { e.preventDefault(); switchTab(0, idx); }
    }
    // ── Editing ─────────────────────────────────────────────────────────────
    if (matchesShortcut(e, $activeShortcuts.saveFile)) {
      e.preventDefault();
      flushSave(focusedPane === 1 && splitMode ? 1 : 0);
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
        multiSelected = new Set(flattenVisible(tree, expanded).map(n => n.path));
      }
      if (matchesShortcut(e, $activeShortcuts.treeCopy) && multiSelected.size > 0 && worktreePath) {
        e.preventDefault();
        fileClipboard = { nodes: flattenToNodes(tree, multiSelected), srcWorktreePath: worktreePath, op: 'copy' };
      }
      if (matchesShortcut(e, $activeShortcuts.treeCut) && multiSelected.size > 0 && worktreePath) {
        e.preventDefault();
        fileClipboard = { nodes: flattenToNodes(tree, multiSelected), srcWorktreePath: worktreePath, op: 'cut' };
      }
      if (matchesShortcut(e, $activeShortcuts.treePaste) && fileClipboard && worktreePath) {
        e.preventDefault();
        const targetPath = [...multiSelected][0] ?? null;
        const targetNode = targetPath ? flattenVisible(tree, expanded).find(n => n.path === targetPath) ?? null : null;
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
            panes[0].tabs = panes[0].tabs.filter(t => !t.path.startsWith(p));
          }
          if (panes[0].activeTabIdx >= panes[0].tabs.length) panes[0].activeTabIdx = panes[0].tabs.length - 1;
          panes = panes;
          multiSelected = new Set();
          await loadTree(worktreePath);
        } catch (e2) { error = String(e2); }
      }
      if (matchesShortcut(e, $activeShortcuts.treeRename) && multiSelected.size === 1) {
        e.preventDefault();
        const path = [...multiSelected][0];
        const node = flattenVisible(tree, expanded).find(n => n.path === path);
        if (node) startEdit({ type: 'rename', node, parentPath: parentPathOf(node.path), value: node.name });
      }
      if (matchesShortcut(e, $activeShortcuts.treeNewFile)) {
        e.preventDefault();
        const parentPath = [...multiSelected].find(p => {
          const n = flattenVisible(tree, expanded).find(x => x.path === p);
          return n?.isDir;
        }) ?? selectedDir;
        if (parentPath) { expanded.add(parentPath); expanded = expanded; }
        startEdit({ type: 'new-file', node: null, parentPath, value: '' });
      }
      if (matchesShortcut(e, $activeShortcuts.treeNewFolder)) {
        e.preventDefault();
        const parentPath = [...multiSelected].find(p => {
          const n = flattenVisible(tree, expanded).find(x => x.path === p);
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
          for (let i = 0; i < panes.length; i++) flushSave(i);
        }
      }).then(unlisten => { unlistenFocus = unlisten; });
    });

    let prevInstId: string | null = null;
    let prevInstWtp: string | null = null;
    const unsubInst = activeInstance.subscribe(inst => {
      const newId = inst?.id ?? null;
      if (prevInstId !== null && prevInstId !== newId && prevInstWtp) {
        if ((get(settings).saveOn ?? 'blur') === 'instanceChange') {
          saveSnapshotToDisk(panes.map(p => [...p.tabs]), prevInstWtp);
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
          saveSnapshotToDisk(panes.map(p => [...p.tabs]), prevInstWtp);
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
    if (splitMode && focusedPane === 1) openFileInPane(1, node);
    else openFile(node);
  }

  // ── Tab context menu (pin/close-others) ──────────────────────────────────────
  let tabCtxMenu: { x: number; y: number; idx: number; pane: 0 | 1 } | null = null;

  function openTabCtxMenu(e: MouseEvent, idx: number, pane: 0 | 1) {
    e.preventDefault();
    e.stopPropagation();
    tabCtxMenu = { x: e.clientX, y: e.clientY, idx, pane };
  }

  function closeTabCtxMenu() { tabCtxMenu = null; }

  function togglePinTab(idx: number, paneIdx: 0 | 1) {
    const pane = panes[paneIdx];
    pane.tabs[idx].pinned = !pane.tabs[idx].pinned;
    const activePath = pane.tabs[pane.activeTabIdx]?.path;
    pane.tabs = sortedByPin(pane.tabs);
    pane.activeTabIdx = activePath ? pane.tabs.findIndex(t => t.path === activePath) : -1;
    panes = panes;
    if (currentInstanceId) persistState(currentInstanceId, snapshotInstanceState());
    closeTabCtxMenu();
  }

  function closeAllTabs(paneIdx: 0 | 1) {
    const pane = panes[paneIdx];
    const kept = pane.tabs.filter(t => t.pinned);
    pane.activeTabIdx = kept.length > 0 ? 0 : -1;
    pane.tabs = kept;
    panes = panes;
    closeTabCtxMenu();
  }

  function closeOtherTabs(idx: number, paneIdx: 0 | 1) {
    const pane = panes[paneIdx];
    const current = pane.tabs[idx];
    const kept = pane.tabs.filter((t, j) => j === idx || t.pinned);
    pane.tabs = kept;
    pane.activeTabIdx = kept.indexOf(current);
    panes = panes;
    if (currentInstanceId) persistState(currentInstanceId, snapshotInstanceState());
    closeTabCtxMenu();
  }

  function revealTabInTree(idx: number, paneIdx: 0 | 1) {
    const path = panes[paneIdx].tabs[idx]?.path ?? '';
    if (!path) { closeTabCtxMenu(); return; }
    const parts = path.split('/');
    selectedDir = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
    for (let i = 1; i < parts.length; i++) expanded.add(parts.slice(0, i).join('/'));
    expanded = expanded;
    closeTabCtxMenu();
  }

  async function copyTabPath(idx: number, paneIdx: 0 | 1, absolute: boolean) {
    const path = panes[paneIdx].tabs[idx]?.path ?? '';
    const text = absolute && worktreePath ? `${worktreePath}/${path}` : path;
    await navigator.clipboard.writeText(text);
    closeTabCtxMenu();
  }

  function breadcrumbClickDir(dirPath: string) {
    selectedDir = dirPath;
    expanded.add(dirPath);
    expanded = expanded;
  }


  function convertLineEndings(paneIdx: 0 | 1) {
    const pane = panes[paneIdx];
    if (pane.activeTabIdx === -1) return;
    pane.tabs[pane.activeTabIdx].lineEndings = pane.tabs[pane.activeTabIdx].lineEndings === 'CRLF' ? 'LF' : 'CRLF';
    panes = panes;
  }

  function convertIndent(paneIdx: 0 | 1) {
    const pane = panes[paneIdx];
    const tab = pane.tabs[pane.activeTabIdx];
    if (!tab) return;
    const style = detectIndentStyle(tab.pending);
    const size = detectSpaceSize(tab.pending);
    const converted = style === 'tabs'
      ? convertToSpaces(tab.pending, Math.max(size, 2))
      : convertToTabs(tab.pending, Math.max(size, 2));
    pane.editorRef?.setContent(converted);
  }

  $: if (!isResizing) treeWidth = $settings.treePanelWidth;
  $: sidebarRight = $settings.sidebarPosition === 'right';

  $: worktreePath = $activeInstance?.worktreePath ?? null;
  $: { if (activeTabs[0]) { cursorLines[0] = 1; cursorCols[0] = 1; blamePopups[0] = null; } }
  $: { if (activeTabs[1]) { blamePopups[1] = null; } }

  function saveCurrentState() {
    if (currentInstanceId === null) return;
    captureEditorState(0);
    captureEditorState(1);
    const state = snapshotInstanceState();
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
      panes = panes.map(() => makePane());
      editState = null;
      contextMenu = null;
      if (id !== null && savedState.has(id)) {
        const s = savedState.get(id)!;
        panes = s.panes.map((sp, i) => {
          const base = makePane();
          base.tabs = sp.tabs;
          base.activeTabIdx = sp.activeTabIdx;
          return base;
        });
        expanded = s.expanded;
        splitMode = s.splitMode;
        splitLeftWidth = s.splitLeftWidth;
        syncActiveTabToTree();
        refreshDiff(0, panes[0].tabs[panes[0].activeTabIdx] ?? null);
        refreshDiff(1, panes[1].tabs[panes[1].activeTabIdx] ?? null);
      } else if (id !== null && wtp !== null) {
        selectedDir = '';
        const persisted = readPersistedState(id);
        if (persisted) {
          rehydrateTabs(wtp, persisted).then(() => {
            syncActiveTabToTree();
            refreshDiff(0, panes[0].tabs[panes[0].activeTabIdx] ?? null);
            refreshDiff(1, panes[1].tabs[panes[1].activeTabIdx] ?? null);
          });
        } else {
          panes = [makePane(), makePane()];
          expanded = new Set();
          splitMode = false;
          splitLeftWidth = 0;
        }
      } else {
        selectedDir = '';
        panes = [makePane(), makePane()];
        expanded = new Set();
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
      loadDiffHunks(0, panes[0].tabs[panes[0].activeTabIdx] ?? null);
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
    if (splitMode && focusedPane === 1) { await openFileInPane(1, node); return; }
    if (gitStatusMap[node.path] === 'deleted') return;
    if (node.isDir) {
      if (expanded.has(node.path)) expanded.delete(node.path);
      else expanded.add(node.path);
      expanded = expanded;
      selectedDir = node.path;
      return;
    }
    selectedDir = node.path.includes('/') ? node.path.split('/').slice(0, -1).join('/') : '';

    const pane = panes[0];
    const existingIdx = pane.tabs.findIndex(t => t.path === node.path);
    if (existingIdx !== -1) {
      captureEditorState(0);
      pane.activeTabIdx = existingIdx;
      panes = panes;
      pushRecentFile(node.path);
      refreshDiff(0, { path: node.path });
      return;
    }

    if (loadingPaths.has(node.path)) return;

    captureEditorState(0);
    if (($settings.saveOn ?? 'blur') === 'blur') await flushSave(0);

    if (isBinaryPath(node.path)) {
      pane.tabs = [...pane.tabs, { path: node.path, content: '', pending: '', cursorPos: 0, scrollTop: 0 }];
      pane.activeTabIdx = pane.tabs.length - 1;
      pane.currentDiffHunks = []; pane.currentStagedHunks = []; pane.currentBlame = new Map();
      panes = panes;
      pushRecentFile(node.path);
      return;
    }

    loadingPaths.add(node.path);
    loadingPaths = loadingPaths;
    try {
      const fullPath = `${worktreePath}/${node.path}`;
      const raw = await readFile(fullPath) ?? '';
      const le = detectLineEndings(raw);
      const text = le === 'CRLF' ? raw.replace(/\r\n/g, '\n') : raw;
      pane.tabs = [...pane.tabs, { path: node.path, content: text, pending: text, cursorPos: 0, scrollTop: 0, lineEndings: le }];
      pane.activeTabIdx = pane.tabs.length - 1;
      panes = panes;
      pushRecentFile(node.path);
      refreshDiff(0, { path: node.path });
    } catch (e) {
      error = String(e);
    } finally {
      loadingPaths.delete(node.path);
      loadingPaths = loadingPaths;
    }
  }

  function syncActiveTabToTree() {
    const path = panes[0].tabs[panes[0].activeTabIdx]?.path ?? '';
    const parts = path.split('/');
    selectedDir = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
    for (let i = 1; i < parts.length; i++) expanded.add(parts.slice(0, i).join('/'));
    expanded = expanded;
  }

  async function reopenClosedTab() {
    if (closedTabsStack.length === 0 || !worktreePath) return;
    const tab = closedTabsStack[closedTabsStack.length - 1];
    closedTabsStack = closedTabsStack.slice(0, -1);
    const pane = panes[0];
    if (isBinaryPath(tab.path)) {
      pane.tabs = [...pane.tabs, { ...tab }];
    } else {
      try {
        const text = await readFile(`${worktreePath}/${tab.path}`) ?? tab.pending;
        pane.tabs = [...pane.tabs, { ...tab, content: text, pending: text }];
      } catch {
        pane.tabs = [...pane.tabs, { ...tab }];
      }
    }
    panes = panes;
    await switchTab(0, pane.tabs.length - 1);
  }

  async function tabHistoryBack() {
    if (tabNavBack.length === 0) return;
    const target = tabNavBack[tabNavBack.length - 1];
    if (target < 0 || target >= panes[0].tabs.length) { tabNavBack = tabNavBack.slice(0, -1); return; }
    tabNavBack = tabNavBack.slice(0, -1);
    if (panes[0].activeTabIdx !== -1) tabNavForward = [...tabNavForward, panes[0].activeTabIdx];
    tabNavSkip = true;
    await switchTab(0, target);
    tabNavSkip = false;
  }

  async function tabHistoryForward() {
    if (tabNavForward.length === 0) return;
    const target = tabNavForward[tabNavForward.length - 1];
    if (target < 0 || target >= panes[0].tabs.length) { tabNavForward = tabNavForward.slice(0, -1); return; }
    tabNavForward = tabNavForward.slice(0, -1);
    if (panes[0].activeTabIdx !== -1) tabNavBack = [...tabNavBack, panes[0].activeTabIdx];
    tabNavSkip = true;
    await switchTab(0, target);
    tabNavSkip = false;
  }

  function tabPointerDown(e: PointerEvent, i: number, idx: number) {
    if ((e.target as Element).closest('button')) return;
    e.preventDefault();
    panes[i].dragSrcIndex = idx;
    panes[i].insertIndex = idx;
    panes[i].didDrag = false;
    panes = panes;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function tabPointerMove(e: PointerEvent, i: number) {
    const pane = panes[i];
    if (pane.dragSrcIndex === null) return;
    const next = computeTabInsertIndex(pane.tabsBarEl, e.clientX);
    if (next !== pane.insertIndex) pane.didDrag = true;
    pane.insertIndex = next;
    panes = panes;
  }

  function tabPointerUp(_e: PointerEvent, i: number) {
    const pane = panes[i];
    if (pane.dragSrcIndex === null || pane.insertIndex === null) return;
    const result = applyTabReorder(pane.tabs, pane.activeTabIdx, pane.dragSrcIndex, pane.insertIndex);
    pane.tabs = result.tabs;
    pane.activeTabIdx = result.activeIdx;
    pane.dragSrcIndex = null;
    pane.insertIndex = null;
    panes = panes;
  }

  async function openFileAtLine(path: string, line: number, col: number) {
    const node = { path, name: path.split('/').pop() ?? path, isDir: false };
    const targetPane = splitMode && focusedPane === 1 ? 1 : 0;
    pendingJumps[targetPane] = { line, col };
    if (targetPane === 1) await openFileInPane(1, node);
    else await openFile(node);
  }

  $: for (let i = 0; i < panes.length; i++) {
    if (activeTabs[i] && pendingJumps[i]) {
      const idx = i;
      const jump = pendingJumps[i]!;
      pendingJumps[i] = null;
      setTimeout(() => panes[idx].editorRef?.jumpTo(jump.line, jump.col), 60);
    }
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
      const destName = resolveDestName(rawTree, srcPath, target);
      const destRel = target ? `${target}/${destName}` : destName;
      if (destRel === srcPath) continue;
      try {
        await renamePath(`${worktreePath}/${srcPath}`, `${worktreePath}/${destRel}`);
        for (const pane of panes) {
          pane.tabs = pane.tabs.map(t => t.path === srcPath ? { ...t, path: destRel } : t);
        }
        panes = panes;
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
    for (const pane of panes) {
      const activeWasDeleted = pane.activeTabIdx >= 0 && isPathDeleted(pane.tabs[pane.activeTabIdx]?.path ?? '');
      pane.tabs = pane.tabs.filter(t => !isPathDeleted(t.path));
      if (activeWasDeleted) {
        pane.activeTabIdx = pane.tabs.length > 0 ? 0 : -1;
      } else if (pane.activeTabIdx >= pane.tabs.length) {
        pane.activeTabIdx = pane.tabs.length - 1;
      }
    }
    panes = panes;
    multiSelected = new Set();
    await loadTree(worktreePath);
  }

  function collapseAll() { expanded = new Set(); }

  function expandAll() {
    const all = new Set<string>();
    collectDirPaths(tree, all);
    expanded = all;
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
    {#each panes as pane, i}
      {#if i === 0 || splitMode}
        {#if i === 1}
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
        {/if}
        <EditorPane
          paneClass={(splitMode && focusedPane === i) ? 'pane-focused' : ''}
          paneStyle={i === 0 && splitMode && splitLeftWidth > 0 ? `width: ${splitLeftWidth}px; flex: none` : 'flex: 1'}
          bind:rootEl={pane.rootEl}
          bind:tabsBarEl={pane.tabsBarEl}
          bind:editorRef={pane.editorRef}
          tabs={pane.tabs}
          activeTabIdx={pane.activeTabIdx}
          activeTab={activeTabs[i]}
          gitStatusMap={gitStatusMap}
          loadingPaths={loadingPaths}
          dragSrcIndex={pane.dragSrcIndex}
          insertIndex={pane.insertIndex}
          didDrag={pane.didDrag}
          editorState={activeTabs[i] ? (pane.editorStateCache.get(activeTabs[i]!.path) ?? null) : null}
          activeLang={activeLangs[i]}
          activeLineEndings={activeLineEndingsArr[i]}
          activeIndentStyle={activeIndentStyles[i]}
          activeSpaceSize={activeSpaceSizes[i]}
          isDirty={isDirtyArr[i]}
          saving={pane.saving}
          cursorLine={cursorLines[i]}
          cursorCol={cursorCols[i]}
          currentLineBlame={currentLineBlames[i]}
          currentDiffHunks={pane.currentDiffHunks}
          currentStagedHunks={pane.currentStagedHunks}
          activeDiffHunk={pane.activeDiffHunk}
          revertPending={pane.revertPending}
          reverting={pane.reverting}
          blamePopup={blamePopups[i]}
          recentFiles={recentFiles}
          treeFilePaths={treeFilePaths}
          placeholderText="Select a file to edit"
          showRecentFiles={true}
          onPaneFocus={() => { focusedPane = i as 0 | 1; }}
          onTabPointerDown={(e, idx) => tabPointerDown(e, i, idx)}
          onTabPointerMove={(e) => tabPointerMove(e, i)}
          onTabPointerUp={(e) => tabPointerUp(e, i)}
          onTabClick={(idx) => { if (!pane.didDrag) switchTab(i, idx); pane.didDrag = false; panes = panes; }}
          onTabContextMenu={(e, idx) => openTabCtxMenu(e, idx, i as 0 | 1)}
          onTabClose={(idx, e) => closeTab(i, idx, e)}
          onTabUnpin={(idx) => togglePinTab(idx, i as 0 | 1)}
          onBreadcrumbClick={breadcrumbClickDir}
          onChange={(value) => handleChange(i, value)}
          onBlur={($settings.saveOn ?? 'blur') === 'blur' ? () => flushSave(i) : undefined}
          onCursorChange={(l, c) => handleCursorChange(i, l, c)}
          onDiffClick={(hunk) => handleDiffClick(i, hunk)}
          onConvertLineEndings={() => convertLineEndings(i as 0 | 1)}
          onConvertIndent={() => convertIndent(i as 0 | 1)}
          onToggleWhitespace={() => settings.save({ showWhitespace: !($settings.showWhitespace ?? false) })}
          onRevertConfirm={(hunk) => revertHunk(hunk, i)}
          onRevertRequest={() => { panes[i].revertPending = true; panes = panes; }}
          onRevertCancel={() => { panes[i].revertPending = false; panes = panes; }}
          onCloseDiffPeek={() => { panes[i].activeDiffHunk = null; panes[i].revertPending = false; panes = panes; }}
          onCloseBlamePopup={() => { blamePopups[i] = null; panes[i].activeDiffHunk = null; panes[i].revertPending = false; panes = panes; }}
          onOpenBlamePopup={(entry, filePath) => openBlamePopup(entry, filePath, i as 0 | 1)}
          onOpenRecent={(node) => openFileInPane(i, node)}
        />
      {/if}
    {/each}
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
        case 'closeTab': closeTab(0, panes[0].activeTabIdx, null); break;
        case 'reopenClosedTab': reopenClosedTab(); break;
        case 'nextTab': if (panes[0].tabs.length > 1) switchTab(0, (panes[0].activeTabIdx + 1) % panes[0].tabs.length); break;
        case 'prevTab': if (panes[0].tabs.length > 1) switchTab(0, (panes[0].activeTabIdx - 1 + panes[0].tabs.length) % panes[0].tabs.length); break;
        case 'tabHistoryBack': tabHistoryBack(); break;
        case 'tabHistoryForward': tabHistoryForward(); break;
        case 'saveFile': flushSave(0); break;
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
      <Icon name="pin" size={13}/> {panes[tabCtxMenu.pane].tabs[tabCtxMenu.idx]?.pinned ? 'Unpin Tab' : 'Pin Tab'}
    </button>
    <div class="ctx-sep"></div>
    <button type="button" class="ctx-item" on:click={() => { const m = tabCtxMenu!; closeTabCtxMenu(); closeTab(m.pane, m.idx, null); }}>
      <Icon name="x" size={13}/> Close Tab
    </button>
    <button type="button" class="ctx-item" on:click={() => closeOtherTabs(tabCtxMenu!.idx, tabCtxMenu!.pane)}>
      <Icon name="x" size={13}/> Close Others
    </button>
    <button type="button" class="ctx-item" on:click={() => closeAllTabs(tabCtxMenu!.pane)}>
      <Icon name="x" size={13}/> Close All Tabs
    </button>
    <div class="ctx-sep"></div>
    <button type="button" class="ctx-item" on:click={() => revealTabInTree(tabCtxMenu!.idx, tabCtxMenu!.pane)}>
      <Icon name="folder" size={13}/> Reveal in Tree
    </button>
    <div class="ctx-sep"></div>
    <button type="button" class="ctx-item" on:click={() => copyTabPath(tabCtxMenu!.idx, tabCtxMenu!.pane, false)}>
      <Icon name="copy" size={13}/> Copy Relative Path
    </button>
    <button type="button" class="ctx-item" on:click={() => copyTabPath(tabCtxMenu!.idx, tabCtxMenu!.pane, true)}>
      <Icon name="copy" size={13}/> Copy Absolute Path
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
      <Icon name={fileIconFor(node, expanded)} size={13}/>
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
      class="file-tree-item {panes[0].tabs.some(t => t.path === node.path) ? 'open' : ''} {activeTabs[0]?.path === node.path ? 'active' : ''} {loadingPaths.has(node.path) ? 'loading' : ''} {node.isDir && node.path === selectedDir ? 'selected-dir' : ''} {contextMenu?.node?.path === node.path ? 'ctx-target' : ''} {nodeGitStatus(node, gitStatusMap) ? 'git-' + nodeGitStatus(node, gitStatusMap) : ''} {multiSelected.has(node.path) ? 'multi-selected' : ''} {node.isDir && dragOverDir === node.path ? 'drag-over' : ''} {cutPaths.has(node.path) ? 'file-cut' : ''}"
      style="padding-left: {12 + depth * 14}px"
      data-tree-dir={node.isDir ? node.path : undefined}
      on:click={(e) => handleTreeNodeClick(e, node)}
      on:contextmenu={(e) => openContextMenu(e, node)}
      on:pointerdown={(e) => onNodePointerDown(e, node)}
      on:pointermove={onNodePointerMove}
      on:pointerup={onNodePointerUp}
      on:pointercancel={() => { dragSrcNode = null; dragActive = false; dragOverDir = null; dragCaptureEl = null; removeDragGhost(); }}
    >
      <Icon name={fileIconFor(node, expanded)} size={13}/>
      <span class="file-tree-name">{node.name}</span>
      {#if panes.some(p => p.tabs.some(t => t.path === node.path && t.pending !== t.content))}
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


  .split-resize-handle {
    width: 3px;
    flex-shrink: 0;
    cursor: col-resize;
    background: var(--stroke-0);
    transition: background 0.15s;
  }
  .split-resize-handle:hover,
  .split-resize-handle:active { background: var(--accent); }

  .tab-dot { color: var(--accent); font-size: 10px; line-height: 1; }

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
