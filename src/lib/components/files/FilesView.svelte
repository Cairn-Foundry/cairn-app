<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
import { get } from 'svelte/store';
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n';
  import CodeEditor from './CodeEditor.svelte';
  import SearchPanel from './SearchPanel.svelte';
  import ReferencesPanel, { type ReferencesResult } from './ReferencesPanel.svelte';
  import EditorPane from './EditorPane.svelte';
  import FileTreeView from './FileTreeView.svelte';
  import { activeInstance } from '$lib/stores/instance';
  import { activeProjectId } from '$lib/stores/project';
  import { activeScreen, activeStep, quickOpenVisible, commandPaletteVisible, referencesPanelOpen, referencesQuery } from '$lib/stores/ui';
  import {
    type LspDiagnostic, type LspDocRef, type LspTextEdit,
    lspDefinition, lspDidChange, lspDidClose, lspDidOpen, lspDidSave,
    lspFormat, lspImplementation, lspReferences, lspRename,
  } from '$lib/services/lsp-service';
  import { formatDocument, type StyleSet } from '$lib/services/formatting-service';
  import { LSP_FORMATTER_ID } from '$lib/utils/formatting/resolve';
  import { formatOnSave } from '$lib/stores/formatting';
  import InstallProgress from '$lib/components/InstallProgress.svelte';
  import { cancelLanguageServerCommand, installLanguageServer, COMMAND_CANCELLED } from '$lib/services/lsp-service';
  import {
    clearDiagnosticsFor, clearManagerOutput, ensureDocument, managerOutput, languageServerInfos,
    lspDiagnostics, refreshLanguageServers, setServerEnabled, shouldSuggestFor,
    dismissServerSuggestion,
  } from '$lib/stores/language-server';
  import { languageIdForPath } from '$lib/utils/languages/servers';
  import { applyEditsToText } from '$lib/utils/editor/editor-lsp';
  import { LSP_CHANGE_DEBOUNCE_MS } from '$lib/utils/timing';
  import { readDirTree, listDirNames, readFile, writeFile, deletePath, renamePath, createFileOrDir, copyPath, revealInFileManager, openInTerminal, langFromPath, isBinaryPath, gitStatus, type FileNode, type GitStatusMap, type BlameEntry } from '$lib/services/file-service';
  import { git, refreshStatus as refreshGitStore, stageFile as stageGitFile } from '$lib/stores/git';
  import { hasConflictMarkers } from '$lib/utils/git/conflict-markers';
  import { settings } from '$lib/stores/settings';
  import { shortcuts, activeShortcuts, matchesShortcut, bindingToLabels, SHORTCUT_DEFS } from '$lib/stores/shortcuts';
  import type { EditorState } from '@codemirror/state';
  import {
    type Tab,
    type PersistedState,
    type InstanceTabState,
    saveEditorState,
    loadEditorState,
    pushRecent,
    rehydrateFromPersisted,
  } from '$lib/utils/files/files-persistence';
  import {
    detectLineEndings,
    normalizeLineEndings,
    denormalizeLineEndings,
    detectIndentStyle,
    detectSpaceSize,
    convertToSpaces,
    convertToTabs,
  } from '$lib/utils/files/files-indent';
  import {
    flattenVisible,
    flattenToNodes,
    collectFilePaths,
    pasteDestName,
    resolveDestName,
    parentPathOf,
    basename,
    isExternalPath,
    absolutePathOf,
    pathWithinWorktree,
  } from '$lib/utils/files/files-tree';
  import {
    osDropPoint,
    resolvePaneDrop,
    toWorktreeRelative,
    type PaneBox,
    type PaneDrop,
  } from '$lib/utils/files/files-editor-drop';
  import { loadPaneBase } from '$lib/utils/files/files-diff';
  import type { GutterChunk } from '$lib/utils/editor/editor-diff-gutter';
  import { findHeadingLine } from '$lib/utils/editor/editor-markdown-wysiwyg';
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
  import { EDITOR_JUMP_DELAY_MS } from '$lib/utils/timing';
  import { EDITOR_DEFAULTS, FONT_SIZE_MIN, FONT_SIZE_MAX } from '$lib/utils/editor/editor-config';
  import { makeFilesKeyHandler } from '$lib/utils/files/use-files-shortcuts';

  export let onGoSettings: (() => void) | undefined = undefined;
  export let onGoLanguageServers: (() => void) | undefined = undefined;

  interface PaneState {
    tabs: Tab[];
    activeTabIdx: number;
    saving: boolean;
    baseContent: string | null;
    currentBlame: Map<number, BlameEntry>;
    activeChunk: GutterChunk | null;
    dragSrcIndex: number | null;
    insertIndex: number | null;
    didDrag: boolean;
    dragActive: boolean;
    dragStartX: number;
    dragStartY: number;
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
      baseContent: null,
      currentBlame: new Map(),
      activeChunk: null,
      dragSrcIndex: null,
      insertIndex: null,
      didDrag: false,
      dragActive: false,
      dragStartX: 0,
      dragStartY: 0,
      rootEl: null,
      tabsBarEl: null,
      editorRef: undefined,
      editorStateCache: new Map(),
    };
  }

  let panes: PaneState[] = [makePane(), makePane()];
  let cursorLines: number[] = [1, 1];
  let cursorCols: number[] = [1, 1];
  let pendingJumps: ({ line: number; col: number; anchor?: string | null } | null)[] = [null, null];

  function pushRecentFile(path: string) {
    if (!currentInstanceId || !currentProjectId) return;
    const updated = pushRecent(recentFiles, path);
    recentFiles = updated;
    captureEditorState(0);
    captureEditorState(1);
    saveEditorState(currentProjectId, currentInstanceId, snapshotInstanceState(), updated);
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
  let gitStatusWorktree: string | null = null;
  let showIgnored = false;
  let multiSelected = new Set<string>();

  // -- Pointer-event drag state --------------------------------------------------
  let dragSrcNode: FileNode | null = null;
  let dragOverDir: string | null = null;
  let dragActive = false;
  let dragPointerStartX = 0;
  let dragPointerStartY = 0;
  let dragCaptureEl: HTMLElement | null = null;
  let dragJustEnded = false;
  let dragOverPane: PaneDrop | null = null;
  let editorWrapEl: HTMLElement | null = null;

  function paneBoxes(): (PaneBox | null)[] {
    const els = editorWrapEl
      ? Array.from(editorWrapEl.querySelectorAll('.editor-pane'))
      : [];
    return [0, 1].map(i => els[i]?.getBoundingClientRect() ?? null);
  }

  function paneDropAt(x: number, y: number): PaneDrop | null {
    return resolvePaneDrop(paneBoxes(), splitMode, x, y);
  }

  function paneDropHint(drop: PaneDrop | null, i: number): 'none' | 'pane' | 'split' {
    if (!drop) return 'none';
    if (drop.openSplit) return i === 0 ? 'split' : 'none';
    return drop.pane === i ? 'pane' : 'none';
  }

  $: paneDropHints = [paneDropHint(dragOverPane, 0), paneDropHint(dragOverPane, 1)];

  function treeDropDirAt(x: number, y: number): string | null {
    const dir = findDropTargetDir(x, y);
    if (dir !== null) return dir;
    const el = document.elementFromPoint(x, y);
    return el?.closest('.files-tree-scroll') ? '' : null;
  }

  async function importOsFiles(paths: string[], targetDir: string) {
    if (!worktreePath) return;
    for (const absolute of paths) {
      const destName = resolveDestName(rawTree, absolute, targetDir);
      const destRel = targetDir ? `${targetDir}/${destName}` : destName;
      try {
        await copyPath(absolute, `${worktreePath}/${destRel}`);
      } catch (err) { error = String(err); }
    }
    if (targetDir) { expanded.add(targetDir); expanded = expanded; }
    await loadTree(worktreePath);
  }

  async function handleOsFileDrop(paths: string[], x: number, y: number) {
    const treeDir = treeDropDirAt(x, y);
    if (treeDir !== null) {
      dragOverDir = null;
      dragOverPane = null;
      await importOsFiles(paths, treeDir);
      return;
    }
    const drop = paneDropAt(x, y);
    dragOverPane = null;
    if (!drop) return;
    for (const absolute of paths) {
      await dropFileInPane(toWorktreeRelative(absolute, worktreePath) ?? absolute, drop);
    }
  }

  async function dropFileInPane(path: string, drop: PaneDrop) {
    const node = { path, name: basename(path), isDir: false };
    if (drop.openSplit && !splitMode) {
      splitMode = true;
      await tick();
    }
    focusedPane = drop.pane;
    await openFileInPane(drop.pane, node);
    if (currentInstanceId && currentProjectId) {
      saveEditorState(currentProjectId, currentInstanceId, snapshotInstanceState(), recentFiles);
    }
  }

  let expanded = new Set<string>();
  let recentFiles: string[] = [];
  let loading = false;
  let loadingPaths = new Set<string>();
  let error = '';

  // -- Split pane ----------------------------------------------------------------
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
    if (currentInstanceId && currentProjectId) saveEditorState(currentProjectId, currentInstanceId, snapshotInstanceState(), recentFiles);
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
    splitLeftWidth = Math.round(Math.max(minW, Math.min(maxW, splitResizeStartWidth + (e.clientX - splitResizeStartX))));
  }

  function stopSplitResize() {
    if (!isSplitResizing) return;
    isSplitResizing = false;
    if (currentInstanceId && currentProjectId) saveEditorState(currentProjectId, currentInstanceId, snapshotInstanceState(), recentFiles);
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

  async function loadPaneBaseFor(i: number, tab: { path: string } | null): Promise<void> {
    const pane = panes[i];
    if (!tab || !worktreePath || isExternalPath(tab.path)) {
      pane.baseContent = null;
      pane.currentBlame = new Map();
      panes = panes;
      return;
    }
    if (gitStatusWorktree !== worktreePath) {
      pane.baseContent = null;
      pane.currentBlame = new Map();
      panes = panes;
      return;
    }
    const reqWorktree = worktreePath;
    const reqPath = tab.path;
    let result: { baseContent: string | null; currentBlame: Map<number, BlameEntry> };
    try {
      result = await loadPaneBase(reqWorktree, reqPath, gitStatusMap[reqPath]);
    } catch {
      result = { baseContent: null, currentBlame: new Map() };
    }
    const cur = panes[i];
    if (!cur || worktreePath !== reqWorktree) return;
    if (cur.tabs[cur.activeTabIdx]?.path !== reqPath) return;
    cur.baseContent = result.baseContent;
    cur.currentBlame = result.currentBlame;
    panes = panes;
  }

  async function refreshDiff(i: number, tab: { path: string } | null) {
    panes[i].activeChunk = null;
    panes[i].baseContent = null;
    panes = panes;
    await loadPaneBaseFor(i, tab);
  }

  function handleChunkClick(i: number, chunk: GutterChunk) {
    panes[i].activeChunk = chunk;
    panes = panes;
  }

  async function revertActiveChunk(i: number) {
    const pane = panes[i];
    if (!pane.activeChunk) return;
    pane.editorRef?.revertChunkAt(pane.activeChunk.anchorLine);
    pane.activeChunk = null;
    panes = panes;
    await flushSave(i);
  }

  async function switchTab(i: number, idx: number) {
    const pane = panes[i];
    if (idx === pane.activeTabIdx) return;
    if (i === 0 && !tabNavSkip && pane.activeTabIdx !== -1) {
      tabNavBack = [...tabNavBack, pane.activeTabIdx].slice(-50);
      tabNavForward = [];
    }
    captureEditorState(i);
    if (i === 0 && ($settings.saveOn) === 'blur') await flushSave(0);
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
      const wc = denormalizeLineEndings(tab.pending, tab.lineEndings ?? 'LF');
      await writeFile(absolutePathOf(tab.path, worktreePath), wc);
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
    notifyLspClosed(tab.path);
  }

  function handleChange(i: number, value: string) {
    const pane = panes[i];
    if (pane.activeTabIdx === -1) return;
    const changedPath = pane.tabs[pane.activeTabIdx].path;
    pane.tabs[pane.activeTabIdx].pending = value;
    scheduleLspChange(changedPath, value);
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
    const wasConflicted = gitStatusMap[tab.path] === 'conflicted';
    const hadMarkers = hasConflictMarkers(tab.content);
    try {
      // Formatting happens before the write, so what lands on disk and what the
      // editor shows are the same text. A formatter that fails leaves the
      // document alone: a save must never be lost to a broken config.
      // Split view: only the focused pane is formatted, because that is the one
      // `runFormatDocument` acts on. Formatting the other pane's document here
      // would apply one pane's text to the other.
      if (i === focusedPane && $formatOnSave($activeProjectId ?? null)) {
        await runFormatDocument(true).catch(() => {});
        await tick();
      }
      const current = pane.tabs[pane.activeTabIdx] ?? tab;
      const writeContent = denormalizeLineEndings(current.pending, current.lineEndings ?? 'LF');
      await writeFile(absolutePathOf(tab.path, worktreePath), writeContent);
      pane.tabs[pane.activeTabIdx].content = current.pending;
      panes = panes;
      notifyLspSaved(tab.path, current.pending);
      if (wasDeleted) await loadTree(worktreePath);
      if (wasConflicted && hadMarkers && !hasConflictMarkers(current.pending)) {
        await stageGitFile(tab.path).catch(() => {});
      }
      const updatedStatus = await gitStatus(worktreePath).catch(() => null);
      if (updatedStatus !== null) { gitStatusMap = updatedStatus; tree = rawTree; }
      void refreshGitStore(true);
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
      const wc = denormalizeLineEndings(tab.pending, tab.lineEndings ?? 'LF');
      tab.content = tab.pending; // shared ref - mutates original tabs[i] so saveCurrentState captures clean state
      writeFile(absolutePathOf(path, wtp), wc).catch(() => {});
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
      pane.baseContent = ''; pane.currentBlame = new Map();
      panes = panes;
      if (i === 0) pushRecentFile(node.path);
      return;
    }
    captureEditorState(i);
    try {
      const raw2 = await readFile(absolutePathOf(node.path, worktreePath)) ?? '';
      const le2 = detectLineEndings(raw2);
      const text2 = normalizeLineEndings(raw2, le2);
      pane.tabs = [...pane.tabs, { path: node.path, content: text2, pending: text2, cursorPos: 0, scrollTop: 0, lineEndings: le2 }];
      pane.activeTabIdx = pane.tabs.length - 1;
      panes = panes;
      if (i === 0) pushRecentFile(node.path);
      refreshDiff(i, { path: node.path });
    } catch (e) { error = String(e); }
  }

  // -- Language servers ----------------------------------------------------------

  const NO_DIAGNOSTICS: LspDiagnostic[] = [];

  let lspDocs: (LspDocRef | null)[] = [null, null];
  const lspChangeTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const openLspDocs = new Map<string, LspDocRef>();

  function absoluteOf(path: string): string | null {
    return worktreePath && !isExternalPath(path) ? absolutePathOf(path, worktreePath) : null;
  }

  /**
   * Lazy start plus `didOpen`, run whenever a pane shows another file. The
   * whole chain is a no-op for a file no enabled server covers.
   */
  async function syncLspDoc(i: number) {
    const tab = panes[i].tabs[panes[i].activeTabIdx] ?? null;
    const wtp = worktreePath;
    const absolute = tab ? absoluteOf(tab.path) : null;
    // Dropped before the await: starting a server takes seconds, and until it
    // answers the pane must not still point at the file it stopped showing.
    lspDocs[i] = null;
    lspDocs = lspDocs;
    if (!tab || !wtp || !absolute) return;
    const doc = await ensureDocument(wtp, absolute);
    if (panes[i].tabs[panes[i].activeTabIdx]?.path !== tab.path) return;
    lspDocs[i] = doc;
    lspDocs = lspDocs;
    if (!doc) return;
    openLspDocs.set(absolute, doc);
    await lspDidOpen(doc, languageIdForPath(absolute) ?? 'plaintext', tab.pending).catch(() => {});
  }

  /**
   * Keyed by the file the text comes from, never by the pane that showed it:
   * a pane changes document while a server is still starting, and a change
   * attributed to the slot rather than to the file lands in the wrong buffer.
   */
  function scheduleLspChange(path: string, text: string) {
    const absolute = absoluteOf(path);
    const doc = absolute ? openLspDocs.get(absolute) : null;
    if (!doc) return;
    const timer = lspChangeTimers.get(doc.path);
    if (timer) clearTimeout(timer);
    lspChangeTimers.set(doc.path, setTimeout(() => {
      lspChangeTimers.delete(doc.path);
      lspDidChange(doc, text).catch(() => {});
    }, LSP_CHANGE_DEBOUNCE_MS));
  }

  function notifyLspSaved(path: string, text: string) {
    const absolute = absoluteOf(path);
    const doc = absolute ? openLspDocs.get(absolute) : null;
    if (doc) lspDidSave(doc, text).catch(() => {});
  }

  function notifyLspClosed(path: string) {
    const absolute = absoluteOf(path);
    if (!absolute) return;
    if (panes.some(p => p.tabs.some(t => t.path === path))) return;
    const doc = openLspDocs.get(absolute);
    if (!doc) return;
    const timer = lspChangeTimers.get(doc.path);
    if (timer) { clearTimeout(timer); lspChangeTimers.delete(doc.path); }
    openLspDocs.delete(absolute);
    clearDiagnosticsFor(absolute);
    lspDidClose(doc).catch(() => {});
  }

  $: activeAbsolutePaths = panes.map(p => {
    const tab = p.tabs[p.activeTabIdx];
    return tab ? absoluteOf(tab.path) : null;
  });
  $: paneDiagnostics = activeAbsolutePaths.map(
    path => (path ? ($lspDiagnostics[path] ?? NO_DIAGNOSTICS) : NO_DIAGNOSTICS),
  );

  async function syncLspDocs() {
    await Promise.all([syncLspDoc(0), syncLspDoc(1)]);
  }

  /**
   * `panes` is reassigned on every keystroke, so the sync has to key on the
   * paths themselves: reacting to the array would restart a server per letter.
   */
  let syncedLspPaths = '';
  $: if (activeAbsolutePaths.join('|') !== syncedLspPaths) {
    syncedLspPaths = activeAbsolutePaths.join('|');
    void syncLspDocs();
  }

  // -- Suggestion bar -------------------------------------------------------------

  let sessionDismissed = new Set<string>();

  $: suggestedServer = (() => {
    const tab = activeTabs[0];
    if (!tab || $activeStep !== 'files') return null;
    const def = shouldSuggestFor(tab.path, $settings);
    return def && !sessionDismissed.has(def.id) ? def : null;
  })();

  let suggestionBusy = false;
  let suggestionBusySince = 0;
  let suggestionError = '';

  $: suggestedInfo = suggestedServer
    ? ($languageServerInfos.find(s => s.id === suggestedServer.id) ?? null)
    : null;
  $: suggestedInstaller = suggestedInfo?.installOptions.find(o => o.available) ?? null;

  /**
   * The binary is already there: turning the server on is all it takes. When it
   * is missing, the same button installs it first - on this click, never before.
   */
  async function enableSuggestedServer(id: string) {
    suggestionError = '';
    if (suggestedInfo && suggestedInfo.binaryPath === null) {
      if (!suggestedInstaller) { onGoLanguageServers?.(); return; }
      suggestionBusy = true;
      suggestionBusySince = Date.now();
      clearManagerOutput(id);
      try {
        await installLanguageServer(id, suggestedInstaller.manager);
        await refreshLanguageServers(worktreePath);
      } catch (e) {
        if (String(e) !== COMMAND_CANCELLED) suggestionError = String(e);
        return;
      } finally {
        suggestionBusy = false;
        clearManagerOutput(id);
      }
    }
    setServerEnabled(id, true);
  }

  function dismissForNow(id: string) {
    sessionDismissed = new Set([...sessionDismissed, id]);
  }

  // -- References panel -----------------------------------------------------------

  let referencesResult: ReferencesResult | null = null;
  let referencesLoading = false;
  let referencesError = '';
  let referencesToken = 0;

  function focusedDoc(): { doc: LspDocRef; pane: PaneState } | null {
    const pane = panes[focusedPane];
    const doc = lspDocs[focusedPane];
    return doc ? { doc, pane } : null;
  }

  interface ReferencesQuery { path: string; line: number; character: number; symbol: string }

  function parseReferencesQuery(raw: string): ReferencesQuery | null {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as ReferencesQuery;
      return typeof parsed?.path === 'string' ? parsed : null;
    } catch {
      return null;
    }
  }

  async function lookupReferences(doc: LspDocRef, query: ReferencesQuery) {
    const position = { line: query.line, character: query.character };
    const token = ++referencesToken;
    $referencesPanelOpen = true;
    referencesLoading = true;
    referencesError = '';
    referencesResult = { symbol: query.symbol, definitions: [], implementations: [], references: [] };

    const [definitions, implementations, references] = await Promise.all([
      lspDefinition(doc, position).catch(() => []),
      lspImplementation(doc, position).catch(() => []),
      lspReferences(doc, position, false).catch((e) => { referencesError = String(e); return []; }),
    ]);
    if (token !== referencesToken) return;
    referencesResult = { symbol: query.symbol, definitions, implementations, references };
    referencesLoading = false;
  }

  async function runFindReferences() {
    const target = focusedDoc();
    if (!target) return;
    const position = target.pane.editorRef?.getLspPosition();
    if (!position) return;

    const query: ReferencesQuery = {
      path: pathWithinWorktree(target.doc.path, worktreePath),
      line: position.line,
      character: position.character,
      symbol: target.pane.editorRef?.getWordAtCursor() ?? '',
    };
    $referencesQuery = JSON.stringify(query);
    await lookupReferences(target.doc, query);
  }

  /**
   * The panel reopens on the lookup it was showing. The file it points at does
   * not have to be open: the document is ensured from its path, so a restart
   * that restores an empty editor still answers the same question.
   */
  async function replayReferences() {
    const query = parseReferencesQuery($referencesQuery);
    if (!query || !worktreePath || isExternalPath(query.path)) return;
    const doc = await ensureDocument(worktreePath, absolutePathOf(query.path, worktreePath));
    if (!doc) return;
    await lookupReferences(doc, query);
  }

  let replayedReferencesFor = '';
  $: if (worktreePath && $referencesPanelOpen && replayedReferencesFor !== worktreePath) {
    replayedReferencesFor = worktreePath;
    if (!referencesResult) void replayReferences();
  }

  async function runGoToDefinition() {
    const target = focusedDoc();
    if (!target) return;
    const position = target.pane.editorRef?.getLspPosition();
    if (!position) return;
    const [first] = await lspDefinition(target.doc, position).catch(() => []);
    if (!first) return;
    await openFileAtLine(
      pathWithinWorktree(first.path, worktreePath),
      first.line + 1,
      first.character + 1,
    );
  }

  // -- Rename & format ------------------------------------------------------------

  let renamePrompt: { doc: LspDocRef; position: { line: number; character: number }; value: string } | null = null;

  function startRenameSymbol() {
    const target = focusedDoc();
    if (!target) return;
    const position = target.pane.editorRef?.getLspPosition();
    if (!position) return;
    renamePrompt = { doc: target.doc, position, value: target.pane.editorRef?.getWordAtCursor() ?? '' };
  }

  /** The tabs showing a file, whichever pane they sit in. */
  function tabsForAbsolute(absolute: string): Tab[] {
    const relative = pathWithinWorktree(absolute, worktreePath);
    return panes.flatMap(p => p.tabs.filter(t => t.path === relative || t.path === absolute));
  }

  /** Applies edits to a file no tab is showing. Null when it cannot be read. */
  async function editOnDisk(path: string, edits: LspTextEdit[]): Promise<string | null> {
    const current = await readFile(path);
    if (current === null) return null;
    const updated = applyEditsToText(current, edits);
    await writeFile(path, updated);
    return updated;
  }

  /**
   * A rename lands on the text the server computed its edits against, which is
   * the buffer - not what is on disk. Reading the file back for a tab with
   * unsaved changes would apply those offsets to the wrong text, write the
   * result, and then lose the unsaved work to the reload. So an open tab is
   * edited in place and left dirty for the user to save or undo, and only a
   * file nobody has open goes through the disk.
   */
  async function commitRename() {
    if (!renamePrompt || !renamePrompt.value.trim() || !worktreePath) return;
    const { doc, position, value } = renamePrompt;
    renamePrompt = null;

    let fileEdits: Awaited<ReturnType<typeof lspRename>>;
    try {
      fileEdits = await lspRename(doc, position, value.trim());
    } catch (e) {
      error = String(e);
      return;
    }
    if (fileEdits.length === 0) return;

    const failed: string[] = [];
    let touchedDisk = false;
    for (const fileEdit of fileEdits) {
      const tabs = tabsForAbsolute(fileEdit.path);
      try {
        const updated = tabs.length > 0
          ? applyEditsToText(tabs[0].pending, fileEdit.edits)
          : await editOnDisk(fileEdit.path, fileEdit.edits);
        if (updated === null) continue;
        for (const tab of tabs) tab.pending = updated;
        touchedDisk ||= tabs.length === 0;

        const openDoc = openLspDocs.get(fileEdit.path);
        if (openDoc) await lspDidChange(openDoc, updated).catch(() => {});
      } catch {
        failed.push(pathWithinWorktree(fileEdit.path, worktreePath));
      }
    }

    panes = panes;
    if (touchedDisk) await loadTree(worktreePath);
    if (failed.length > 0) {
      error = (t('languageServers.renameFailed') as (files: string) => string)(failed.join(', '));
    }
  }

  let formattingPanes = [false, false];

  /**
   * The project's own formatter first, so the result matches what the repository
   * produces; the language server only when no binary could be reached. A
   * formatter that errors is reported rather than silently falling through -
   * a broken config the user can see is worth more than a silent no-op.
   */
  async function runFormatDocument(quiet = false) {
    // The open document is what is formatted, not the language server's view of
    // it. Asking `focusedDoc()` first made the whole command depend on a server
    // having attached, so a file no server claims could not be formatted at all
    // - even by a formatter installed and ready to do it.
    const pane = panes[focusedPane];
    const tab = pane?.tabs[pane.activeTabIdx];
    if (!tab) return;
    const doc = lspDocs[focusedPane];
    const i = focusedPane;
    formattingPanes[i] = true;
    formattingPanes = formattingPanes;
    try {
      let configured: StyleSet | null = null;
      if (worktreePath) {
        try {
          const outcome = await formatDocument({
            projectId: $activeProjectId ?? null,
            worktree: worktreePath,
            path: `${worktreePath}/${tab.path}`,
            content: tab.pending,
          });
          if (outcome.formatterId && outcome.formatterId !== LSP_FORMATTER_ID) {
            if (outcome.changed) pane.editorRef?.applyFormattedText(outcome.text);
            return;
          }
          configured = outcome.style;
        } catch (e) {
          error = String(e);
          return;
        }
      }

      // No binary could be reached. The language server is asked next, and it is
      // held to the project's own indentation rather than to whatever the file
      // happens to use - a document formatted against the wrong setting is what
      // reads as "the setting does nothing".
      const detected = detectIndentStyle(tab.pending);
      const size = Number(configured?.indentSize);
      const edits = doc
        ? await lspFormat(
            doc,
            Number.isFinite(size) && size > 0
              ? size
              : detected === 'spaces'
                ? detectSpaceSize(tab.pending)
                : 2,
            configured
              ? configured.indentStyle !== 'tab'
              : detected !== 'tabs',
          ).catch(() => null)
        : null;
      if (edits && edits.length > 0) {
        pane.editorRef?.applyTextEdits(edits);
      } else if (edits === null && worktreePath && !quiet) {
        // No formatter binary and no language server: nothing formatted this
        // document. Silence here reads as "the command is broken", so the
        // reason is named instead - but only when the user asked for it, never
        // on every save of a file nothing can format.
        error = t('files.noFormatter') as string;
      }
    } finally {
      formattingPanes[i] = false;
      formattingPanes = formattingPanes;
    }
  }

  let searchPanelByProject = new Map<string, boolean>();

  // -- Closed-tab history (for ⌘⇧T reopen) ------------------------------------
  let closedTabsStack: Tab[] = [];

  // -- Tab navigation history (for ⌘Alt+←/→) ----------------------------------
  let tabNavBack: number[] = [];
  let tabNavForward: number[] = [];
  let tabNavSkip = false;

  // -- Sidebar visibility -------------------------------------------------------
  let sidebarHidden = false;

  // -- Command palette ----------------------------------------------------------
  export function openCommandPalette() { commandPaletteVisible.set(true); }
  export function openQuickOpen() { $quickOpenVisible = true; }
  export function getTree(): FileNode[] { return tree; }
  export function openFileByPath(path: string) { quickOpenFile(path); }

  export function revealDirectory(path: string) {
    sidebarHidden = false;
    const parts = path.split('/');
    for (let i = 1; i <= parts.length; i++) expanded.add(parts.slice(0, i).join('/'));
    expanded = expanded;
    selectedDir = path;
    multiSelected = new Set([path]);
  }

  export async function reloadProject(): Promise<void> {
    if (!worktreePath) return;
    await loadTree(worktreePath);
    await reloadOpenFiles();
  }

  export async function reloadFileByPath(path: string): Promise<void> {
    if (!worktreePath) return;
    try {
      const raw = await readFile(absolutePathOf(path, worktreePath)) ?? '';
      const le = detectLineEndings(raw);
      const text = normalizeLineEndings(raw, le);
      for (const pane of panes) {
        for (const tab of pane.tabs) {
          if (tab.path === path) {
            tab.content = text;
            tab.pending = text;
            if (le) tab.lineEndings = le;
          }
        }
      }
      panes = panes;
    } catch {
      // File may not exist after discard; leave tabs as-is
    }
  }

  export async function reloadOpenFiles(): Promise<void> {
    if (!worktreePath) return;
    const paths = new Set<string>();
    for (const pane of panes) for (const tab of pane.tabs) paths.add(tab.path);
    for (const path of paths) {
      let text: string;
      try {
        const raw = await readFile(absolutePathOf(path, worktreePath)) ?? '';
        const le = detectLineEndings(raw);
        text = normalizeLineEndings(raw, le);
        for (const pane of panes) {
          for (const tab of pane.tabs) {
            if (tab.path === path && tab.content !== text) {
              tab.content = text;
              tab.pending = text;
              if (le) tab.lineEndings = le;
            }
          }
        }
      } catch {
        // File may no longer exist; leave that tab as-is
      }
    }
    panes = panes;
    await Promise.all(
      panes.map((p, i) => loadPaneBaseFor(i, p.tabs[p.activeTabIdx] ?? null)),
    );
    if ($referencesPanelOpen) await replayReferences();
  }

  $: searchPanelOpen = $activeProjectId ? (searchPanelByProject.get($activeProjectId) ?? false) : false;

  function toggleSearchPanel() {
    const id = $activeProjectId;
    if (!id) return;
    const next = new Map(searchPanelByProject);
    next.set(id, !searchPanelOpen);
    searchPanelByProject = next;
  }
  function closeSearchPanel() {
    const id = $activeProjectId;
    if (!id) return;
    const next = new Map(searchPanelByProject);
    next.set(id, false);
    searchPanelByProject = next;
  }

  // -- Context menu & inline editing --------------------------------------------

  interface ContextMenu { x: number; y: number; node: FileNode | null }
  interface EditState { type: 'rename' | 'new-file' | 'new-dir'; node: FileNode | null; parentPath: string; value: string }

  interface FileClipboard { nodes: FileNode[]; srcWorktreePath: string; op: 'copy' | 'cut' }

  let contextMenu: ContextMenu | null = null;
  let editState: EditState | null = null;
  let editValue = '';
  let selectedDir: string = '';
  let fileClipboard: FileClipboard | null = null;

  let editSiblingNames = new Set<string>();

  async function startEdit(state: EditState) {
    editValue = state.value;
    editState = state;
    editSiblingNames = new Set();
    if (worktreePath) {
      const dir = state.parentPath ? `${worktreePath}/${state.parentPath}` : worktreePath;
      const names = await listDirNames(dir).catch(() => []);
      editSiblingNames = new Set(names.map(n => n.toLowerCase()));
    }
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

  type ContextAction = 'new-file' | 'new-dir' | 'cut' | 'copy' | 'paste' | 'rename' | 'delete' | 'copy-path' | 'copy-rel-path' | 'reveal' | 'open-terminal' | 'format';

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
        ? parentPathOf(targetNode.path)
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

    const collectSrcs = (n: FileNode) =>
      multiSelected.size > 1 && multiSelected.has(n.path)
        ? flattenToNodes(tree, multiSelected)
        : [n];
    const absOf = (n: FileNode | null) => n ? `${worktreePath}/${n.path}` : (worktreePath ?? '');

    const dispatch: Record<ContextAction, () => void | Promise<void>> = {
      'cut': () => { if (node) fileClipboard = { nodes: collectSrcs(node), srcWorktreePath: worktreePath ?? '', op: 'cut' }; },
      'copy': () => { if (node) fileClipboard = { nodes: collectSrcs(node), srcWorktreePath: worktreePath ?? '', op: 'copy' }; },
      'paste': async () => { if (fileClipboard && worktreePath) await pasteClipboard(fileClipboard, node, worktreePath); },
      'reveal': async () => { await revealInFileManager(absOf(node)); },
      'copy-path': async () => { await navigator.clipboard.writeText(absOf(node)); },
      'copy-rel-path': async () => { await navigator.clipboard.writeText(node?.path ?? ''); },
      'open-terminal': async () => { await openInTerminal(absOf(node)); },
      'format': async () => {
        if (!node || node.isDir) return;
        await openFile(node);
        await tick();
        await syncLspDocs();
        await runFormatDocument();
      },
      'delete': async () => {
        if (!node) return;
        if (!confirm((t('files.contextMenu.deleteConfirm') as (name: string) => string)(node.name))) return;
        try {
          await deletePath(`${worktreePath}/${node.path}`);
          panes[0].tabs = panes[0].tabs.filter(t => !t.path.startsWith(node.path));
          if (panes[0].activeTabIdx >= panes[0].tabs.length) panes[0].activeTabIdx = panes[0].tabs.length - 1;
          panes = panes;
          if (worktreePath) await loadTree(worktreePath);
        } catch (e) { error = String(e); }
      },
      'rename': () => {
        if (!node) return;
        startEdit({ type: 'rename', node, parentPath: parentPathOf(node.path), value: node.name });
      },
      'new-file': () => {
        const parentPath = node?.isDir ? node.path : parentPathOf(node?.path ?? '');
        if (node?.isDir) { expanded.add(node.path); expanded = expanded; }
        startEdit({ type: 'new-file', node: null, parentPath, value: '' });
      },
      'new-dir': () => {
        const parentPath = node?.isDir ? node.path : parentPathOf(node?.path ?? '');
        if (node?.isDir) { expanded.add(node.path); expanded = expanded; }
        startEdit({ type: 'new-dir', node: null, parentPath, value: '' });
      },
    };
    await dispatch[action]();
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
    const val = editValue.trim().toLowerCase();
    const isSelf = editState!.type === 'rename' && val === editState!.node?.name.toLowerCase();
    return editSiblingNames.has(val) && !isSelf;
  })();

  let treeWidth = 220;
  let treeMinWidth = 140;
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
    treeWidth = Math.round(Math.max(treeMinWidth, Math.min(480, resizeStartWidth + delta)));
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

  $: tooltipSearch = `Search (${bindingToLabels($shortcuts.searchFiles).join('')})`;
  $: tooltipSplit  = `Split Editor (${bindingToLabels($shortcuts.splitEditor).join('')})`;

  function bumpFontSize(delta: number) {
    const next = $settings.editorFontSize + delta;
    settings.save({ editorFontSize: Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, next)) });
  }
  function resetFontSize() {
    settings.save({ editorFontSize: EDITOR_DEFAULTS.fontSize });
  }

  const FILES_STEP_ACTIONS = new Set([
    'searchFiles', 'splitEditor', 'toggleSidebar', 'closeTab', 'reopenClosedTab',
    'nextTab', 'prevTab', 'tabHistoryBack', 'tabHistoryForward', 'saveFile',
    'toggleLineComment', 'toggleBlockComment', 'moveLineUp', 'moveLineDown',
    'copyLineDown', 'deleteLine', 'selectLine', 'matchingBracket', 'indentMore',
    'indentLess', 'expandSelection', 'goToLine', 'addCursorAbove', 'addCursorBelow',
    'duplicateLine', 'treeSelectAll', 'treeCopy', 'treeCut', 'treePaste',
    'treeDelete', 'treeRename', 'treeNewFile', 'treeNewFolder',
    'reloadEditor', 'reloadProject',
    'renameSymbol', 'formatDocument',
  ]);

  export async function executeAction(id: string) {
    if (FILES_STEP_ACTIONS.has(id)) activeStep.set('files');
    switch (id) {
      case 'quickOpen':         $quickOpenVisible = true; break;
      case 'searchFiles':       toggleSearchPanel(); break;
      case 'splitEditor':       toggleSplit(); break;
      case 'toggleSidebar':     sidebarHidden = !sidebarHidden; break;
      case 'openSettings':      onGoSettings?.(); break;
      case 'closeTab':          closeTab(0, panes[0].activeTabIdx, null); break;
      case 'reopenClosedTab':   await reopenClosedTab(); break;
      case 'nextTab':           if (panes[0].tabs.length > 1) await switchTab(0, (panes[0].activeTabIdx + 1) % panes[0].tabs.length); break;
      case 'prevTab':           if (panes[0].tabs.length > 1) await switchTab(0, (panes[0].activeTabIdx - 1 + panes[0].tabs.length) % panes[0].tabs.length); break;
      case 'tabHistoryBack':    await tabHistoryBack(); break;
      case 'tabHistoryForward': await tabHistoryForward(); break;
      case 'saveFile':          await flushSave(0); break;
      case 'fontSizeUp':        bumpFontSize(+1); break;
      case 'fontSizeDown':      bumpFontSize(-1); break;
      case 'fontSizeReset':     resetFontSize(); break;
      case 'commandPalette':    commandPaletteVisible.set(true); break;
      case 'renameSymbol':      startRenameSymbol(); break;
      case 'formatDocument':    await runFormatDocument(); break;
      case 'reloadEditor':      await reloadOpenFiles(); break;
      case 'reloadProject':     await reloadProject(); break;
      case 'treeSelectAll':
        multiSelected = new Set(flattenVisible(tree, expanded).map(n => n.path));
        break;
      case 'treeCopy':
        if (multiSelected.size > 0 && worktreePath)
          fileClipboard = { nodes: flattenToNodes(tree, multiSelected), srcWorktreePath: worktreePath, op: 'copy' };
        break;
      case 'treeCut':
        if (multiSelected.size > 0 && worktreePath)
          fileClipboard = { nodes: flattenToNodes(tree, multiSelected), srcWorktreePath: worktreePath, op: 'cut' };
        break;
      case 'treePaste': {
        const targetPath = [...multiSelected][0] ?? null;
        const targetNode = targetPath ? (flattenVisible(tree, expanded).find(n => n.path === targetPath) ?? null) : null;
        if (fileClipboard && worktreePath) await pasteClipboard(fileClipboard, targetNode, worktreePath);
        break;
      }
      case 'treeDelete': {
        if (multiSelected.size > 0) {
          const paths = [...multiSelected];
          const label = paths.length === 1 ? `"${basename(paths[0])}"` : `${paths.length} items`;
          if (confirm(`Delete ${label}?`)) await bulkDelete();
        }
        break;
      }
      case 'treeRename':
        if (multiSelected.size === 1) {
          const path = [...multiSelected][0];
          const node = flattenVisible(tree, expanded).find(n => n.path === path);
          if (node) startEdit({ type: 'rename', node, parentPath: parentPathOf(node.path), value: node.name });
        }
        break;
      case 'treeNewFile': {
        const parentPath = [...multiSelected].find(p => flattenVisible(tree, expanded).find(x => x.path === p)?.isDir) ?? selectedDir;
        if (parentPath) { expanded.add(parentPath); expanded = expanded; }
        startEdit({ type: 'new-file', node: null, parentPath, value: '' });
        break;
      }
      case 'treeNewFolder': {
        const parentPath = [...multiSelected].find(p => flattenVisible(tree, expanded).find(x => x.path === p)?.isDir) ?? selectedDir;
        if (parentPath) { expanded.add(parentPath); expanded = expanded; }
        startEdit({ type: 'new-dir', node: null, parentPath, value: '' });
        break;
      }
      default:
        panes[focusedPane].editorRef?.runEditorCommand(id);
        break;
    }
  }

  const handleGlobalKey = makeFilesKeyHandler({
    getActiveShortcuts: () => $activeShortcuts,
    isWorkspaceActive: () => $activeScreen === 'workspace',
    isEditorFocused,
    getFocusedPane: () => focusedPane,
    getSplitMode: () => splitMode,
    getActiveTabIdxFor: (i) => panes[i].activeTabIdx,
    getTabsLengthFor: (i) => panes[i].tabs.length,
    getTree: () => tree,
    getExpanded: () => expanded,
    getMultiSelected: () => multiSelected,
    setMultiSelected: (next) => { multiSelected = next; },
    getSelectedDir: () => selectedDir,
    getWorktreePath: () => worktreePath,
    getFileClipboard: () => fileClipboard,
    setFileClipboard: (cb) => { fileClipboard = cb; },
    toggleSearchPanel,
    toggleSplit,
    toggleSidebar: () => { sidebarHidden = !sidebarHidden; },
    bumpFontSize,
    resetFontSize,
    openCommandPalette: () => { commandPaletteVisible.set(true); },
    openQuickOpen: () => { $quickOpenVisible = true; },
    openSettings: () => onGoSettings?.(),
    saveActivePane: (i) => { flushSave(i); },
    closeActiveTab: (i) => closeTab(i, panes[i].activeTabIdx, null),
    reopenClosedTab,
    switchTab,
    tabHistoryBack,
    tabHistoryForward,
    renameSymbol: startRenameSymbol,
    formatDocument: () => { void runFormatDocument(); },
    pasteClipboard,
    deleteAtPaths: async (paths: string[]) => {
      if (!worktreePath) return;
      try {
        for (const pPath of paths) {
          await deletePath(`${worktreePath}/${pPath}`);
          panes[0].tabs = panes[0].tabs.filter(t => !t.path.startsWith(pPath));
        }
        if (panes[0].activeTabIdx >= panes[0].tabs.length) panes[0].activeTabIdx = panes[0].tabs.length - 1;
        panes = panes;
        multiSelected = new Set();
        await loadTree(worktreePath);
      } catch (e2) { error = String(e2); }
    },
    startEdit,
    expandDir: (path: string) => { expanded.add(path); expanded = expanded; },
  });

  onMount(() => {
    window.addEventListener('keydown', handleGlobalKey, { capture: true });

    let unlistenFocus: (() => void) | null = null;
    import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
      getCurrentWindow().onFocusChanged(({ payload: focused }) => {
        if (focused && worktreePath) {
          loadTree(worktreePath, { silent: true });
          void reloadOpenFilesFromDisk();
        }
        if (!focused && ($settings.saveOn) === 'windowChange') {
          for (let i = 0; i < panes.length; i++) flushSave(i);
        }
      }).then(unlisten => { unlistenFocus = unlisten; });
    });

    let unlistenOsDrop: (() => void) | null = null;
    let osDropDisposed = false;
    import('@tauri-apps/api/webview').then(({ getCurrentWebview }) => {
      getCurrentWebview().onDragDropEvent(({ payload }) => {
        if ($activeStep !== 'files') return;
        if (payload.type === 'leave') { dragOverPane = null; dragOverDir = null; return; }
        const { x, y } = osDropPoint(
          payload.position,
          { width: window.innerWidth, height: window.innerHeight },
          window.devicePixelRatio || 1,
        );
        if (payload.type !== 'drop') {
          const treeDir = treeDropDirAt(x, y);
          dragOverDir = treeDir;
          dragOverPane = treeDir === null ? paneDropAt(x, y) : null;
          return;
        }
        void handleOsFileDrop(payload.paths, x, y);
      }).then(unlisten => {
        if (osDropDisposed) unlisten();
        else unlistenOsDrop = unlisten;
      });
    });

    let prevInstId: string | null = null;
    let prevInstWtp: string | null = null;
    const unsubInst = activeInstance.subscribe(inst => {
      const newId = inst?.id ?? null;
      if (prevInstId !== null && prevInstId !== newId && prevInstWtp) {
        if ((get(settings).saveOn) === 'instanceChange') {
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
        if ((get(settings).saveOn) === 'projectChange') {
          saveSnapshotToDisk(panes.map(p => [...p.tabs]), prevInstWtp);
        }
      }
      prevProjId = newPid;
    });

    return () => {
      window.removeEventListener('keydown', handleGlobalKey, { capture: true });
      unlistenFocus?.();
      osDropDisposed = true;
      unlistenOsDrop?.();
      unsubInst();
      unsubProj();
    };
  });

  function quickOpenFile(path: string) {
    const node = { path, name: basename(path), isDir: false };
    if (splitMode && focusedPane === 1) openFileInPane(1, node);
    else openFile(node);
  }

  // -- Tab context menu (pin/close-others) --------------------------------------
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
    if (currentInstanceId && currentProjectId) saveEditorState(currentProjectId, currentInstanceId, snapshotInstanceState(), recentFiles);
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
    if (currentInstanceId && currentProjectId) saveEditorState(currentProjectId, currentInstanceId, snapshotInstanceState(), recentFiles);
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
    const text = absolute && (worktreePath || isExternalPath(path)) ? absolutePathOf(path, worktreePath) : path;
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
  // Guarded on the path: the statement also re-runs on every cursor move (the
  // move touches `panes`, which rebuilds `activeTabs`), and an unguarded reset
  // would drag the caret position back to 1:1 right after each move.
  let lastCursorResetPath: string | null = null;
  $: resetCursorOnTabChange(activeTabs[0]?.path ?? null);

  function resetCursorOnTabChange(path: string | null) {
    if (path === lastCursorResetPath) return;
    lastCursorResetPath = path;
    if (path === null) return;
    cursorLines[0] = 1;
    cursorCols[0] = 1;
  }

  function saveCurrentState() {
    if (currentInstanceId === null || currentProjectId === null) return;
    captureEditorState(0);
    captureEditorState(1);
    const state = snapshotInstanceState();
    savedState.set(`${currentProjectId}:${currentInstanceId}`, state);
    saveEditorState(currentProjectId, currentInstanceId, state, recentFiles);
  }

  let currentInstanceId: string | null = null;
  let currentProjectId: string | null = null;
  let currentScope: string | null = null;
  $: {
    const id = $activeInstance?.id ?? null;
    const wtp = $activeInstance?.worktreePath ?? null;
    const pid = $activeProjectId;
    const scope = pid && id ? `${pid}:${id}` : null;
    if (scope !== currentScope) {
      saveCurrentState();
      currentInstanceId = id;
      currentProjectId = pid;
      currentScope = scope;
      recentFiles = [];
      panes = panes.map(() => makePane());
      editState = null;
      contextMenu = null;
      if (scope !== null && savedState.has(scope)) {
        const s = savedState.get(scope)!;
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
      } else if (id !== null && wtp !== null && pid !== null) {
        selectedDir = '';
        loadEditorState(pid, id).then(({ persisted, recentFiles: rf }) => {
          recentFiles = rf;
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
        });
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

  /**
   * Walking a repository is the slowest step of a worktree change, so the last
   * trees stay around: coming back to a project paints from the cache at once
   * and the walk runs silently behind it. Bounded, because a cached tree holds
   * every path of a repository.
   */
  const TREE_CACHE_MAX = 8;
  const treeCache = new Map<string, { tree: FileNode[]; status: GitStatusMap }>();

  function cacheTree(root: string) {
    treeCache.delete(root);
    treeCache.set(root, { tree: rawTree, status: gitStatusMap });
    for (const oldest of treeCache.keys()) {
      if (treeCache.size <= TREE_CACHE_MAX) break;
      treeCache.delete(oldest);
    }
  }

  $: if (worktreePath) showWorktree(worktreePath);

  function showWorktree(root: string) {
    const cached = treeCache.get(root);
    if (cached) {
      rawTree = cached.tree;
      tree = cached.tree;
      gitStatusMap = cached.status;
      gitStatusWorktree = root;
      void loadTree(root, { silent: true });
      return;
    }
    rawTree = [];
    tree = [];
    gitStatusMap = {};
    gitStatusWorktree = null;
    void loadTree(root);
  }

  async function loadTree(root: string, opts?: { silent?: boolean }) {
    const silent = opts?.silent === true && rawTree.length > 0;
    if (!silent) loading = true;
    error = '';
    try {
      const [loadedTree, loadedStatus] = await Promise.all([
        readDirTree(root, showIgnored),
        gitStatus(root).catch(() => ({} as GitStatusMap)),
      ]);
      if (worktreePath !== root) return;
      rawTree = loadedTree;
      gitStatusMap = loadedStatus;
      tree = rawTree;
      gitStatusWorktree = root;
      cacheTree(root);
      void refreshGitStore(true);
      loadPaneBaseFor(0, panes[0].tabs[panes[0].activeTabIdx] ?? null);
      loadPaneBaseFor(1, panes[1].tabs[panes[1].activeTabIdx] ?? null);
    } catch (e) {
      error = String(e);
    } finally {
      if (!silent && worktreePath === root) loading = false;
    }
  }

  async function reloadOpenFilesFromDisk() {
    if (!worktreePath) return;
    let changed = false;
    for (const pane of panes) {
      for (const tab of pane.tabs) {
        if (isBinaryPath(tab.path)) continue;
        if (tab.pending !== tab.content) continue;
        try {
          const raw = await readFile(absolutePathOf(tab.path, worktreePath));
          if (raw === null) continue;
          const le = detectLineEndings(raw);
          const text = normalizeLineEndings(raw, le);
          if (text === tab.content) continue;
          tab.content = text;
          tab.pending = text;
          tab.lineEndings = le;
          pane.editorStateCache.delete(tab.path);
          changed = true;
        } catch {}
      }
    }
    if (changed) panes = panes;
  }

  $: tree = rawTree;
  $: adoptStoreStatus($git.statusWorktree, $git.status);

  /** The tree colours follow the store's status rather than a poll of its own. */
  function adoptStoreStatus(statusWorktree: string | null, status: GitStatusMap) {
    if (!statusWorktree || statusWorktree !== worktreePath) return;
    gitStatusMap = status;
    gitStatusWorktree = statusWorktree;
    const cached = treeCache.get(statusWorktree);
    if (cached) cached.status = status;
  }

  $: treeFilePaths = collectFilePaths(rawTree);
  $: cutPaths = fileClipboard?.op === 'cut' ? new Set(fileClipboard.nodes.map(n => n.path)) : new Set<string>();

  $: openTabPaths = new Set(panes[0].tabs.map(t => t.path));
  $: activeTabPath = activeTabs[0]?.path ?? null;
  $: if (activeTabPath) syncActiveTabToTree();
  $: dirtyTabPaths = new Set(panes.flatMap(pn => pn.tabs.filter(t => t.pending !== t.content).map(t => t.path)));
  $: contextMenuTargetPath = contextMenu?.node?.path ?? null;


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
    selectedDir = parentPathOf(node.path);

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
    if (($settings.saveOn) === 'blur') await flushSave(0);

    if (isBinaryPath(node.path)) {
      pane.tabs = [...pane.tabs, { path: node.path, content: '', pending: '', cursorPos: 0, scrollTop: 0 }];
      pane.activeTabIdx = pane.tabs.length - 1;
      pane.baseContent = ''; pane.currentBlame = new Map();
      panes = panes;
      pushRecentFile(node.path);
      return;
    }

    loadingPaths.add(node.path);
    loadingPaths = loadingPaths;
    try {
      const fullPath = absolutePathOf(node.path, worktreePath);
      const raw = await readFile(fullPath) ?? '';
      const le = detectLineEndings(raw);
      const text = normalizeLineEndings(raw, le);
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

  /** Middle click: the tab is appended but the editor stays on the file being read. */
  async function openFileInBackground(node: FileNode) {
    const i = splitMode && focusedPane === 1 ? 1 : 0;
    const pane = panes[i];
    if (pane.activeTabIdx === -1) { await openFileInPane(i, node); return; }
    if (gitStatusMap[node.path] === 'deleted') return;
    if (pane.tabs.some(t => t.path === node.path)) return;
    if (loadingPaths.has(node.path)) return;

    if (isBinaryPath(node.path)) {
      pane.tabs = [...pane.tabs, { path: node.path, content: '', pending: '', cursorPos: 0, scrollTop: 0 }];
      panes = panes;
      if (i === 0) pushRecentFile(node.path);
      return;
    }

    loadingPaths.add(node.path);
    loadingPaths = loadingPaths;
    try {
      const raw = await readFile(absolutePathOf(node.path, worktreePath)) ?? '';
      const le = detectLineEndings(raw);
      const text = normalizeLineEndings(raw, le);
      pane.tabs = [...pane.tabs, { path: node.path, content: text, pending: text, cursorPos: 0, scrollTop: 0, lineEndings: le }];
      panes = panes;
      if (i === 0) pushRecentFile(node.path);
    } catch (e) {
      error = String(e);
    } finally {
      loadingPaths.delete(node.path);
      loadingPaths = loadingPaths;
    }
  }

  function syncActiveTabToTree() {
    const path = panes[0].tabs[panes[0].activeTabIdx]?.path ?? '';
    if (isExternalPath(path)) return;
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
        const text = await readFile(absolutePathOf(tab.path, worktreePath)) ?? tab.pending;
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

  const TAB_DRAG_THRESHOLD = 6;

  function tabPointerDown(e: PointerEvent, i: number, idx: number) {
    if ((e.target as Element).closest('button')) return;
    e.preventDefault();
    panes[i].dragSrcIndex = idx;
    panes[i].insertIndex = idx;
    panes[i].didDrag = false;
    panes[i].dragActive = false;
    panes[i].dragStartX = e.clientX;
    panes[i].dragStartY = e.clientY;
    panes = panes;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function tabPointerMove(e: PointerEvent, i: number) {
    const pane = panes[i];
    if (pane.dragSrcIndex === null) return;
    if (!pane.dragActive) {
      const dx = e.clientX - pane.dragStartX;
      const dy = e.clientY - pane.dragStartY;
      if (dx * dx + dy * dy < TAB_DRAG_THRESHOLD * TAB_DRAG_THRESHOLD) return;
      pane.dragActive = true;
      document.body.classList.add('dragging');
    }

    const barBottom = pane.tabsBarEl?.getBoundingClientRect().bottom ?? 0;
    const drop = paneDropAt(e.clientX, e.clientY);
    const movesPane = drop && (drop.pane !== i || (drop.openSplit && e.clientY > barBottom));
    dragOverPane = movesPane ? drop : null;

    pane.insertIndex = computeTabInsertIndex(pane.tabsBarEl, e.clientX);
    pane.didDrag = true;
    panes = panes;
  }

  async function tabPointerUp(_e: PointerEvent, i: number) {
    const pane = panes[i];
    const paneTarget = dragOverPane;
    dragOverPane = null;
    if (pane.dragSrcIndex === null || pane.insertIndex === null) return;

    if (pane.dragActive && paneTarget) {
      const movedIdx = pane.dragSrcIndex;
      const moved = pane.tabs[movedIdx];
      pane.dragSrcIndex = null;
      pane.insertIndex = null;
      pane.dragActive = false;
      document.body.classList.remove('dragging');
      panes = panes;
      if (moved && !moved.pinned) {
        await closeTab(i, movedIdx, null);
        await dropFileInPane(moved.path, paneTarget);
      }
      return;
    }

    if (pane.dragActive) {
      const result = applyTabReorder(pane.tabs, pane.activeTabIdx, pane.dragSrcIndex, pane.insertIndex);
      pane.tabs = result.tabs;
      pane.activeTabIdx = result.activeIdx;
    }
    pane.dragSrcIndex = null;
    pane.insertIndex = null;
    pane.dragActive = false;
    document.body.classList.remove('dragging');
    panes = panes;
  }

  async function openFileAtLine(path: string, line: number, col: number) {
    const node = { path, name: basename(path), isDir: false };
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
      // An anchor only resolves once the target file content is loaded.
      const line = jump.anchor
        ? findHeadingLine(activeTabs[idx]?.content ?? '', jump.anchor) ?? jump.line
        : jump.line;
      setTimeout(() => panes[idx].editorRef?.jumpTo(line, jump.col), EDITOR_JUMP_DELAY_MS);
    }
  }

  // Shift-click on a markdown link pointing at another file of the project.
  async function openMarkdownLink(paneIndex: number, path: string, anchor: string | null) {
    const node = { path, name: basename(path), isDir: false };
    if (anchor) pendingJumps[paneIndex] = { line: 1, col: 1, anchor };
    if (paneIndex === 1) await openFileInPane(1, node);
    else await openFile(node);
  }

  // -- Multi-select --------------------------------------------------------------

  function handleTreeNodeAuxClick(e: MouseEvent, node: FileNode) {
    if (e.button !== 1 || node.isDir) return;
    e.preventDefault();
    openFileInBackground(node);
  }

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

  // -- Drag-and-drop (pointer-event based, works in WKWebView) ------------------

  function onNodePointerDown(e: PointerEvent, node: FileNode) {
    if (gitStatusMap[node.path] === 'deleted') return;
    if (e.button !== 0) return;
    dragSrcNode = node;
    dragActive = false;
    dragPointerStartX = e.clientX;
    dragPointerStartY = e.clientY;
    dragCaptureEl = e.currentTarget as HTMLElement;
    dragCaptureEl.setPointerCapture(e.pointerId);

    window.addEventListener('pointermove', onNodePointerMove);
    window.addEventListener('pointerup', onNodePointerUp);
    window.addEventListener('pointercancel', endNodeDrag);
  }

  function detachNodeDragListeners() {
    window.removeEventListener('pointermove', onNodePointerMove);
    window.removeEventListener('pointerup', onNodePointerUp);
    window.removeEventListener('pointercancel', endNodeDrag);
  }

  function endNodeDrag() {
    detachNodeDragListeners();
    dragSrcNode = null;
    dragActive = false;
    dragOverDir = null;
    dragOverPane = null;
    dragCaptureEl = null;
    removeDragGhost();
    document.body.classList.remove('dragging');
  }

  function onNodePointerMove(e: PointerEvent) {
    if (!dragSrcNode || !dragCaptureEl) return;
    const dx = e.clientX - dragPointerStartX;
    const dy = e.clientY - dragPointerStartY;
    if (!dragActive && Math.sqrt(dx * dx + dy * dy) < 6) return;

    if (!dragActive) {
      dragActive = true;
      document.body.classList.add('dragging');
      const sources = multiSelected.size > 1 && multiSelected.has(dragSrcNode.path)
        ? `${multiSelected.size} items`
        : dragSrcNode.name;
      createDragGhost(sources);
    }

    moveGhost(e.clientX, e.clientY);

    if (!dragSrcNode.isDir) {
      const drop = paneDropAt(e.clientX, e.clientY);
      if (drop) {
        dragOverPane = drop;
        dragOverDir = null;
        return;
      }
    }
    dragOverPane = null;

    const targetDirAttr = findDropTargetDir(e.clientX, e.clientY);
    const sources = multiSelected.size > 1 && multiSelected.has(dragSrcNode.path)
      ? [...multiSelected]
      : [dragSrcNode.path];

    if (targetDirAttr === null) {
      const pointedEl = document.elementFromPoint(e.clientX, e.clientY);
      const treeScrollEl = pointedEl?.closest('.files-tree-scroll');
      const wouldMove = sources.some(s => s.includes('/'));
      dragOverDir = treeScrollEl && wouldMove ? '' : null;
      return;
    }
    const targetDir = targetDirAttr; // '' = root

    const invalid = sources.some(s => s === targetDir || targetDir.startsWith(s + '/'));
    dragOverDir = invalid ? null : targetDir;
  }

  async function onNodePointerUp(e: PointerEvent) {
    const src = dragSrcNode;
    const wasActive = dragActive;
    const target = dragOverDir;
    const paneTarget = dragOverPane;

    endNodeDrag();

    if (wasActive) dragJustEnded = true;
    if (!wasActive || !src || !worktreePath) return;

    if (paneTarget) {
      multiSelected = new Set();
      await dropFileInPane(src.path, paneTarget);
      return;
    }

    if (target === null) return;

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

  // -- Bulk delete ---------------------------------------------------------------

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

</script>

<div class="files-layout" class:sidebar-right={sidebarRight} class:sidebar-hidden={sidebarHidden}>
  <FileTreeView
    {treeWidth}
    {treeMinWidth}
    {searchPanelOpen}
    {splitMode}
    {showIgnored}
    {tooltipSearch}
    {tooltipSplit}
    onMinWidthChange={(w) => { treeMinWidth = w; }}
    onCollapseAll={collapseAll}
    onNewFileTopLevel={() => { if (selectedDir) { expanded.add(selectedDir); expanded = expanded; } startEdit({ type: 'new-file', node: null, parentPath: selectedDir, value: '' }); }}
    onNewFolderTopLevel={() => { if (selectedDir) { expanded.add(selectedDir); expanded = expanded; } startEdit({ type: 'new-dir', node: null, parentPath: selectedDir, value: '' }); }}
    onToggleSearchPanel={toggleSearchPanel}
    onRefresh={() => { if (worktreePath) loadTree(worktreePath); }}
    onToggleSplit={toggleSplit}
    onToggleIgnored={() => { showIgnored = !showIgnored; if (worktreePath) loadTree(worktreePath); }}
    {loading}
    {error}
    {worktreePath}
    {tree}
    {expanded}
    {selectedDir}
    {multiSelected}
    {dragOverDir}
    {cutPaths}
    {gitStatusMap}
    {loadingPaths}
    {editState}
    {editValue}
    {editConflict}
    {contextMenuTargetPath}
    {openTabPaths}
    {activeTabPath}
    {dirtyTabPaths}
    onRootClick={() => { selectedDir = ''; multiSelected = new Set(); }}
    onNodeClick={handleTreeNodeClick}
    onNodeAuxClick={handleTreeNodeAuxClick}
    onContextMenu={openContextMenu}
    onNodePointerDown={onNodePointerDown}
    onNodePointerMove={onNodePointerMove}
    onNodePointerUp={onNodePointerUp}
    onNodePointerCancel={endNodeDrag}
    onCommitEdit={commitEdit}
    onCancelEdit={cancelEdit}
    onEditValueChange={(v) => { editValue = v; }}
    onEmptyAreaClick={() => { selectedDir = ''; multiSelected = new Set(); }}
  />

  <SearchPanel
    {worktreePath}
    hidden={!searchPanelOpen}
    onOpen={openFileAtLine}
    onClose={closeSearchPanel}
  />

  <ReferencesPanel
    {worktreePath}
    hidden={!$referencesPanelOpen}
    loading={referencesLoading}
    error={referencesError}
    result={referencesResult}
    onOpen={openFileAtLine}
    onClose={() => { $referencesPanelOpen = false; }}
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

  <div class="files-editor-wrap" bind:this={editorWrapEl}>
    {#each panes as pane, i}
      {#if i === 0 || splitMode}
        {#if i === 1}
          <!-- -- Split resize handle -------------------------------------------- -->
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
          dropHint={paneDropHints[i]}
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
          dragActive={pane.dragActive}
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
          baseContent={pane.baseContent}
          activeChunk={pane.activeChunk}
          recentFiles={recentFiles}
          treeFilePaths={treeFilePaths}
          worktreePath={worktreePath}
          placeholderText={t('files.selectFileToEdit') as string}
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
          onBlur={($settings.saveOn) === 'blur' ? () => flushSave(i) : undefined}
          onCursorChange={(l, c) => handleCursorChange(i, l, c)}
          onGoToDefinition={() => { focusedPane = i as 0 | 1; void runGoToDefinition(); }}
          onFindReferences={() => { focusedPane = i as 0 | 1; void runFindReferences(); }}
          onRenameSymbol={() => { focusedPane = i as 0 | 1; startRenameSymbol(); }}
          onFormatDocument={() => { focusedPane = i as 0 | 1; void runFormatDocument(); }}
          onChunkClick={(chunk) => handleChunkClick(i, chunk)}
          onRevertChunk={() => revertActiveChunk(i)}
          onCloseHunk={() => { panes[i].activeChunk = null; panes = panes; }}
          onConvertLineEndings={() => convertLineEndings(i as 0 | 1)}
          onConvertIndent={() => convertIndent(i as 0 | 1)}
          onToggleWhitespace={() => settings.save({ showWhitespace: !($settings.showWhitespace) })}
          onOpenRecent={(node) => openFileInPane(i, node)}
          onOpenLink={(path, anchor) => openMarkdownLink(i, path, anchor)}
          lspDoc={lspDocs[i]}
          formatting={formattingPanes[i]}
          lspDiagnostics={paneDiagnostics[i]}
        />
      {/if}
    {/each}
  </div>
</div>

{#if suggestedServer}
  {@const needsInstall = suggestedInfo?.binaryPath === null}
  <div class="lsp-toast" role="status">
    <div class="head">
      <Icon name="server" size={13}/>
      <span class="title">{t('languageServers.suggestionTitle')}</span>
    </div>
    <div class="text">
      {(t('languageServers.suggestion') as (name: string) => string)(suggestedServer.name)}
    </div>
    {#if suggestionError}
      <div class="detail danger selectable">{suggestionError}</div>
    {:else if needsInstall}
      <div class="detail selectable">
        {suggestedInstaller ? suggestedInstaller.command : t('languageServers.noManagerAvailable')}
      </div>
    {/if}
    {#if suggestionBusy}
      <div class="lsp-toast-progress">
        <InstallProgress
          line={$managerOutput[suggestedServer.id] ?? ''}
          startedAt={suggestionBusySince}
          onCancel={() => cancelLanguageServerCommand(suggestedServer.id)}
        />
      </div>
    {:else}
      <button
        type="button"
        class="btn primary lsp-toast-primary"
        on:click={() => enableSuggestedServer(suggestedServer.id)}
      >
        {needsInstall
          ? (suggestedInstaller ? t('languageServers.installAndEnable') : t('languageServers.seeHowToInstall'))
          : t('languageServers.enable')}
      </button>
      <div class="lsp-toast-dismiss">
        <button type="button" class="btn ghost" on:click={() => dismissForNow(suggestedServer.id)}>
          {t('languageServers.notNow')}
        </button>
        <button type="button" class="btn ghost" on:click={() => dismissServerSuggestion(suggestedServer.id)}>
          {t('languageServers.neverSuggest')}
        </button>
      </div>
    {/if}
  </div>
{/if}

{#if renamePrompt}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="ctx-backdrop" on:mousedown={() => { renamePrompt = null; }}></div>
  <div class="rename-dialog">
    <div class="rename-title">{t('languageServers.renameTitle')}</div>
    <!-- svelte-ignore a11y_autofocus -->
    <input
      class="rename-input selectable"
      autofocus
      spellcheck="false"
      bind:value={renamePrompt.value}
      on:keydown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); void commitRename(); }
        if (e.key === 'Escape') { e.preventDefault(); renamePrompt = null; }
      }}
    />
    <div class="rename-actions">
      <button type="button" class="btn" on:click={() => { renamePrompt = null; }}>{t('common.cancel')}</button>
      <button type="button" class="btn primary" on:click={() => void commitRename()}>{t('languageServers.renameApply')}</button>
    </div>
  </div>
{/if}


{#if tabCtxMenu}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="ctx-backdrop" on:mousedown={closeTabCtxMenu}></div>
  <div class="ctx-menu" style="left: {tabCtxMenu.x}px; top: {tabCtxMenu.y}px">
    <button type="button" class="ctx-item" on:click={() => togglePinTab(tabCtxMenu!.idx, tabCtxMenu!.pane)}>
      <Icon name="pin" size={13}/> {panes[tabCtxMenu.pane].tabs[tabCtxMenu.idx]?.pinned ? t('files.tabContextMenu.unpinTab') : t('files.tabContextMenu.pinTab')}
    </button>
    <div class="ctx-sep"></div>
    <button type="button" class="ctx-item" on:click={() => { const m = tabCtxMenu!; closeTabCtxMenu(); closeTab(m.pane, m.idx, null); }}>
      <Icon name="x" size={13}/> {t('files.tabContextMenu.closeTab')}
    </button>
    <button type="button" class="ctx-item" on:click={() => closeOtherTabs(tabCtxMenu!.idx, tabCtxMenu!.pane)}>
      <Icon name="x" size={13}/> {t('files.tabContextMenu.closeOthers')}
    </button>
    <button type="button" class="ctx-item" on:click={() => closeAllTabs(tabCtxMenu!.pane)}>
      <Icon name="x" size={13}/> {t('files.tabContextMenu.closeAll')}
    </button>
    <div class="ctx-sep"></div>
    <button type="button" class="ctx-item" on:click={() => revealTabInTree(tabCtxMenu!.idx, tabCtxMenu!.pane)}>
      <Icon name="folder" size={13}/> {t('files.tabContextMenu.revealInTree')}
    </button>
    <div class="ctx-sep"></div>
    <button type="button" class="ctx-item" on:click={() => copyTabPath(tabCtxMenu!.idx, tabCtxMenu!.pane, false)}>
      <Icon name="copy" size={13}/> {t('files.tabContextMenu.copyRelativePath')}
    </button>
    <button type="button" class="ctx-item" on:click={() => copyTabPath(tabCtxMenu!.idx, tabCtxMenu!.pane, true)}>
      <Icon name="copy" size={13}/> {t('files.tabContextMenu.copyAbsolutePath')}
    </button>
  </div>
{/if}

{#if contextMenu}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="ctx-backdrop" on:mousedown={closeContextMenu}></div>
  <div class="ctx-menu" bind:this={ctxMenuEl} style="left: {contextMenu.x}px; top: {contextMenu.y}px">
    {#if contextMenu.node === null || contextMenu.node.isDir}
      <button type="button" class="ctx-item" on:click={() => handleContextAction('new-file')}>
        <Icon name="file" size={13}/> {t('files.contextMenu.newFile')}
      </button>
      <button type="button" class="ctx-item" on:click={() => handleContextAction('new-dir')}>
        <Icon name="folder" size={13}/> {t('files.contextMenu.newFolder')}
      </button>
      <div class="ctx-sep"></div>
    {/if}
    {#if contextMenu.node !== null}
      <button type="button" class="ctx-item" on:click={() => handleContextAction('cut')}>
        <Icon name="scissors" size={13}/> {t('files.contextMenu.cut')}
      </button>
      <button type="button" class="ctx-item" on:click={() => handleContextAction('copy')}>
        <Icon name="copy" size={13}/> {t('common.copy')}
      </button>
    {/if}
    <button type="button" class="ctx-item" disabled={!fileClipboard} on:click={() => handleContextAction('paste')}>
      <Icon name="clipboard" size={13}/> {t('files.contextMenu.paste')}
    </button>
    <div class="ctx-sep"></div>
    <button type="button" class="ctx-item" on:click={() => handleContextAction('copy-path')}>
      <Icon name="copy" size={13}/> {t('files.contextMenu.copyPath')}
    </button>
    {#if contextMenu.node !== null}
      <button type="button" class="ctx-item" on:click={() => handleContextAction('copy-rel-path')}>
        <Icon name="copy" size={13}/> {t('files.contextMenu.copyRelativePath')}
      </button>
      {#if !contextMenu.node.isDir}
        <div class="ctx-sep"></div>
        <button type="button" class="ctx-item" on:click={() => handleContextAction('format')}>
          <Icon name="edit" size={13}/> {t('files.contextMenu.formatDocument')}
        </button>
      {/if}
      <div class="ctx-sep"></div>
      <button type="button" class="ctx-item" on:click={() => handleContextAction('rename')}>
        <Icon name="edit" size={13}/> {t('files.contextMenu.rename')}
      </button>
      <button type="button" class="ctx-item ctx-item-danger" on:click={() => handleContextAction('delete')}>
        <Icon name="trash" size={13}/> {t('common.delete')}
      </button>
      {#if multiSelected.size > 1}
        <button type="button" class="ctx-item ctx-item-danger" on:click={bulkDelete}>
          <Icon name="trash" size={13}/> {(t('files.contextMenu.deleteItems') as (n: number) => string)(multiSelected.size)}
        </button>
      {/if}
    {/if}
    <div class="ctx-sep"></div>
    <button type="button" class="ctx-item" on:click={() => handleContextAction('reveal')}>
      <Icon name="folder" size={13}/> {t('common.reveal')}
    </button>
    <button type="button" class="ctx-item" on:click={() => handleContextAction('open-terminal')}>
      <Icon name="terminal" size={13}/> {t('files.contextMenu.openInTerminal')}
    </button>
  </div>
{/if}


<style>
  .files-layout { display: flex; flex: 1; min-height: 0; overflow: hidden; }
  .files-layout.sidebar-right { flex-direction: row-reverse; }
  .files-layout.sidebar-hidden :global(.files-tree) { display: none; }
  .files-layout.sidebar-hidden .resize-handle { display: none; }
  .files-layout.sidebar-right :global(.files-tree) { border-right: none; border-left: 1px solid var(--stroke-0); }

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

  /* -- Editor wrap ----------------------------------------------- */

  .files-editor-wrap { flex: 1; display: flex; flex-direction: row; overflow: hidden; }

  /* -- Language server toast ------------------------------------------ */

  /* Stays until it is answered: a suggestion that vanishes on a timer is a
     suggestion the user never had a chance to take. */
  .lsp-toast {
    position: fixed;
    right: 14px;
    bottom: 14px;
    z-index: 500;
    width: 300px;
    padding: 12px;
    background: var(--bg-2);
    border: 1px solid var(--accent-line);
    border-radius: var(--r-md);
    box-shadow: 0 20px 60px oklch(0 0 0 / 0.5);
    animation: pop .2s;
  }
  .lsp-toast .head {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--accent);
  }
  .lsp-toast .title {
    font-size: 11px;
    font-weight: 600;
    line-height: 1.3;
  }
  .lsp-toast .text {
    margin-top: 5px;
    font-size: 12.5px;
    color: var(--fg-0);
    line-height: 1.45;
  }
  .lsp-toast .detail {
    margin-top: 5px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-2);
    overflow-wrap: anywhere;
  }
  .lsp-toast .detail.danger { color: var(--danger); }
  .lsp-toast-primary {
    width: 100%;
    justify-content: center;
    margin-top: 10px;
  }
  .lsp-toast-progress { margin-top: 10px; }
  .lsp-toast-dismiss {
    display: flex;
    justify-content: space-between;
    gap: 6px;
    margin-top: 4px;
  }

  /* -- Rename dialog --------------------------------------------------- */

  .rename-dialog {
    position: fixed;
    top: 30%;
    left: 50%;
    transform: translateX(-50%);
    z-index: 9999;
    width: 320px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px;
    background: var(--bg-2);
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-md);
    box-shadow: 0 8px 32px rgba(0,0,0,0.45);
  }
  .rename-title { font-size: 12px; color: var(--fg-3); }
  .rename-input {
    height: 30px;
    padding: 0 8px;
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-sm);
    background: var(--bg-1);
    color: var(--fg-0);
    font-family: var(--font-mono);
    font-size: 12.5px;
    outline: none;
  }
  .rename-input:focus { border-color: var(--accent); }
  .rename-actions { display: flex; justify-content: flex-end; gap: 8px; }

  .split-resize-handle {
    width: 3px;
    flex-shrink: 0;
    cursor: col-resize;
    background: var(--stroke-0);
    transition: background 0.15s;
  }
  .split-resize-handle:hover,
  .split-resize-handle:active { background: var(--accent); }

  /* -- Context menu -------------------------------------------------- */

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
