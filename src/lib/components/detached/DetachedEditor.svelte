<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * The editor of a detached window: one pane of tabs that can come from several
   * projects and from outside any project. Each tab carries its own scope, and
   * everything the main editor does per worktree - language server, formatter,
   * git gutter and blame, the save guard, the watcher - is done here per tab.
   *
   * The window closes itself once its last tab is gone.
   */
  import { onDestroy, onMount, tick } from 'svelte';
  import { Text, type EditorState } from '@codemirror/state';
  import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
  import { getCurrentWebview } from '@tauri-apps/api/webview';
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n';
  import EditorPane from '$lib/components/files/EditorPane.svelte';
  import CodeEditor from '$lib/components/files/CodeEditor.svelte';
  import SaveConflict from '$lib/components/files/SaveConflict.svelte';
  import ReferencesPanel, { type ReferencesResult } from '$lib/components/files/ReferencesPanel.svelte';
  import { settings } from '$lib/stores/settings';
  import { activeShortcuts, matchesShortcut } from '$lib/stores/shortcuts';
  import { projects } from '$lib/stores/project';
  import { formatOnSave, formatting as formattingStore } from '$lib/stores/formatting';
  import { lspDiagnostics } from '$lib/stores/language-server';
  import {
    type LspDiagnostic, type LspDocRef, type LspTextEdit,
    lspDefinition, lspDidChange, lspFormat, lspImplementation, lspReferences, lspRename,
  } from '$lib/services/lsp-service';
  import { formatDocument, type StyleSet } from '$lib/services/formatting-service';
  import { stageFile } from '$lib/services/git-service';
  import {
    gitStatus, isBinaryPath, isWriteConflict, langFromPath, readFile, readFileVersioned, writeFile,
    type BlameEntry, type GitStatusMap,
  } from '$lib/services/file-service';
  import { onFsChanged, unwatchWorktree, watchDirs } from '$lib/services/fs-watch-service';
  import {
    MAIN_WINDOW, focusFileOwner, onRevealFile, onSaveAll, onTabsReceived, openEditorWindow,
    syncWindowFiles, takeWindowTabs, transferTabs, type OpenFile,
  } from '$lib/services/editor-window-service';
  import { LSP_FORMATTER_ID } from '$lib/utils/formatting/resolve';
  import { languageIdForPath } from '$lib/utils/languages/servers';
  import { applyEditsToText } from '$lib/utils/editor/editor-lsp';
  import { findHeadingLine } from '$lib/utils/editor/editor-markdown-wysiwyg';
  import type { GutterChunk } from '$lib/utils/editor/editor-diff-gutter';
  import { EDITOR_DEFAULTS, FONT_SIZE_MAX, FONT_SIZE_MIN } from '$lib/utils/editor/editor-config';
  import { EDITOR_JUMP_READY_TIMEOUT_MS, EDITOR_JUMP_RETRY_MS } from '$lib/utils/timing';
  import { IS_MAC } from '$lib/utils/platform';
  import { draggableRegion } from '$lib/utils/window-drag';
  import { docFromString, indentStyleOf, isDirty, spaceSizeOf, type LspContentChange } from '$lib/utils/files/document-model';
  import { LspDocSync } from '$lib/utils/files/lsp-doc-sync';
  import { loadPaneBase } from '$lib/utils/files/files-diff';
  import { convertToSpaces, convertToTabs, detectIndentStyle, detectLineEndings, detectSpaceSize, normalizeLineEndings } from '$lib/utils/files/files-indent';
  import { absolutePathOf, basename, isExternalPath, isUnder, parentPathOf, pathWithinWorktree } from '$lib/utils/files/files-tree';
  import { applyTabReorder, computeTabInsertIndex, sortedByPin } from '$lib/utils/files/files-tab-drag';
  import { resolveTabClose } from '$lib/utils/files/files-tab-close';
  import { hasConflictMarkers } from '$lib/utils/git/conflict-markers';
  import { diskContentOf, readTabFile, writeTab } from '$lib/utils/files/tab-io';
  import { payloadToTab, tabToPayload, type ScopedTab, type TabPayload, type TabScope } from '$lib/utils/files/tab-transfer';
  import { claimDroppedTabs, dragTabNatively, dropTabOutside, isOutsideViewport, usesNativeDrag } from '$lib/utils/files/tab-window-drag';

  const NO_DIAGNOSTICS: LspDiagnostic[] = [];
  const NO_LOADING = new Set<string>();
  const TAB_DRAG_THRESHOLD = 6;
  const appWindow = getCurrentWebviewWindow();

  let tabs: ScopedTab[] = [];
  let activeIdx = -1;
  let editorRef: CodeEditor | undefined;
  let tabsBarEl: HTMLElement | null = null;
  const editorStateCache = new Map<string, EditorState>();
  let cursorLine = 1;
  let cursorCol = 1;
  let baseContent: string | null = null;
  let currentBlame = new Map<number, BlameEntry>();
  let activeChunk: GutterChunk | null = null;
  let saving = false;
  let isFormatting = false;
  let error = '';
  let binaryReloadToken = 0;
  let statusByRoot = new Map<string, GitStatusMap>();
  let isClosing = false;

  $: activeTab = tabs[activeIdx] ?? null;
  $: activeRoot = activeTab?.scope?.worktreePath ?? null;
  $: gitStatusMap = activeRoot ? (statusByRoot.get(activeRoot) ?? {}) : {};
  $: activeLang = (activeTab ? langFromPath(activeTab.path) : 'text') as any;
  $: activeIndentStyle = activeTab ? indentStyleOf(activeTab.savedDoc) : null;
  $: activeSpaceSize = activeTab && activeIndentStyle === 'spaces' ? spaceSizeOf(activeTab.savedDoc) : 2;
  $: isActiveDirty = activeTab ? isDirty(activeTab) : false;
  $: currentLineBlame = currentBlame.get(cursorLine) ?? null;
  $: lspDocDiagnostics = activeTab && lspDoc ? ($lspDiagnostics[activeTab.key] ?? NO_DIAGNOSTICS) : NO_DIAGNOSTICS;

  function projectName(tab: ScopedTab): string | undefined {
    if (!tab.scope) return undefined;
    return $projects.find(p => p.id === tab.scope?.projectId)?.name;
  }

  /**
   * A keystroke reassigns the tab it changed, and doing that per key would
   * re-run every reactive block of this component before the frame paints.
   */
  let invalidation = 0;
  function invalidate() {
    if (invalidation) return;
    invalidation = requestAnimationFrame(() => {
      invalidation = 0;
      tabs = tabs;
    });
  }

  // -- Tabs -----------------------------------------------------------------------

  function captureEditorState() {
    const tab = tabs[activeIdx];
    if (!tab || !editorRef) return;
    const state = editorRef.getState();
    tab.cursorPos = state.cursorPos;
    tab.scrollTop = state.scrollTop;
    const es = editorRef.getEditorState();
    if (es) editorStateCache.set(tab.key, es);
  }

  function activate(idx: number) {
    if (idx === activeIdx) return;
    captureEditorState();
    activeIdx = idx;
    activeChunk = null;
    cursorLine = 1;
    cursorCol = 1;
    tabs = tabs;
  }

  /** Adds tabs that arrived from another window, or brings forward the ones already here. */
  function adopt(payloads: TabPayload[]) {
    if (payloads.length === 0) return;
    captureEditorState();
    for (const payload of payloads) {
      const existing = tabs.findIndex(t => t.key === payload.absPath);
      if (existing !== -1) {
        activeIdx = existing;
        continue;
      }
      tabs = [...tabs, payloadToTab(payload, payload.scope?.worktreePath ?? null)];
      activeIdx = tabs.length - 1;
      if (payload.scope) {
        void formattingStore.loadProject(payload.scope.projectId);
        void refreshStatus(payload.scope.worktreePath);
      }
    }
    tabs = sortedByPin(tabs);
    const activeKey = payloads[payloads.length - 1].absPath;
    activeIdx = tabs.findIndex(t => t.key === activeKey);
  }

  /** The scope a file opened from this window belongs to: the one of a tab from the same worktree. */
  function scopeForPath(absolute: string): TabScope | null {
    for (const tab of tabs) {
      if (tab.scope && isUnder(absolute, tab.scope.worktreePath)) return tab.scope;
    }
    return null;
  }

  /** Opens a file of the machine in this window, unless another window already holds it. */
  async function openAbsolute(absolute: string): Promise<boolean> {
    const existing = tabs.findIndex(t => t.key === absolute && !t.diskSnapshot);
    if (existing !== -1) {
      activate(existing);
      return true;
    }
    if (await focusFileOwner(absolute).catch(() => null)) return false;
    const scope = scopeForPath(absolute);
    const root = scope?.worktreePath ?? null;
    const base = { key: absolute, scope, path: pathWithinWorktree(absolute, root), cursorPos: 0, scrollTop: 0, lastUsedAt: Date.now() };
    captureEditorState();
    if (isBinaryPath(absolute)) {
      tabs = [...tabs, { ...base, doc: Text.empty, savedDoc: Text.empty }];
    } else {
      try {
        const read = await readTabFile(absolute);
        tabs = [...tabs, { ...base, doc: read.doc, savedDoc: read.doc, lineEndings: read.lineEndings, version: read.version }];
      } catch (e) {
        error = String(e);
        return false;
      }
    }
    activeIdx = tabs.length - 1;
    return true;
  }

  /** Forgets a tab that left this window, and closes the window once it holds nothing. */
  function dropTab(tab: ScopedTab) {
    const idx = tabs.indexOf(tab);
    if (idx === -1) return;
    editorStateCache.delete(tab.key);
    const previous = activeIdx;
    tabs = tabs.filter((_, j) => j !== idx);
    activeIdx = resolveTabClose(previous, idx, tabs.length).activeTabIdx;
    if (!tab.diskSnapshot && !tabs.some(t => t.key === tab.key)) lsp.close(tab.key);
    if (tabs.length === 0) void closeWindow();
  }

  /** Closes a tab; unsaved edits are written first, and a refused write keeps the tab on the conflict modal. */
  async function closeTab(idx: number) {
    const tab = tabs[idx];
    if (!tab || tab.pinned) return;
    if (isDirty(tab) && !tab.diskSnapshot) {
      const content = diskContentOf(tab);
      const written = await writeTab(tab, content, tab.key).catch((e) => {
        error = String(e);
        return null;
      });
      if (!written) return;
      if (!written.written) {
        tab.conflicted = true;
        activate(idx);
        conflict = { tab, content, deleted: written.deleted, doc: tab.doc };
        tabs = tabs;
        return;
      }
    }
    dropTab(tab);
  }

  function closeOthers(idx: number) {
    const kept = tabs[idx];
    for (const tab of [...tabs]) if (tab !== kept && !tab.pinned) void closeTab(tabs.indexOf(tab));
  }

  function closeAll() {
    for (const tab of [...tabs]) if (!tab.pinned) void closeTab(tabs.indexOf(tab));
  }

  function togglePin(idx: number) {
    const tab = tabs[idx];
    if (!tab) return;
    tab.pinned = !tab.pinned;
    const activeKey = tabs[activeIdx]?.key;
    tabs = sortedByPin(tabs);
    activeIdx = tabs.findIndex(t => t.key === activeKey);
  }

  function payloadOf(tab: ScopedTab): TabPayload {
    if (tabs[activeIdx] === tab) captureEditorState();
    return tabToPayload(tab, tab.scope);
  }

  async function moveToMain(idx: number) {
    const tab = tabs[idx];
    if (!tab || tab.diskSnapshot) return;
    try {
      await transferTabs(MAIN_WINDOW, [payloadOf(tab)]);
    } catch (e) {
      error = String(e);
      return;
    }
    dropTab(tab);
  }

  async function moveToNewWindow(idx: number) {
    const tab = tabs[idx];
    if (!tab || tab.diskSnapshot || tabs.length < 2) return;
    try {
      await openEditorWindow([payloadOf(tab)]);
    } catch (e) {
      error = String(e);
      return;
    }
    dropTab(tab);
  }

  function handleChange(doc: Text, changes: LspContentChange[]) {
    const tab = tabs[activeIdx];
    if (!tab || tab.diskSnapshot) return;
    tab.doc = doc;
    lsp.change(tab.key, changes);
    invalidate();
  }

  function handleCursorChange(line: number, col: number) {
    cursorLine = line;
    cursorCol = col;
  }

  // -- Git ------------------------------------------------------------------------

  async function refreshStatus(root: string) {
    const status = await gitStatus(root).catch(() => null);
    if (status === null) return;
    statusByRoot.set(root, status);
    statusByRoot = statusByRoot;
  }

  /**
   * Git events come in bursts, and on Linux every write to `.git/index` is one
   * of them - including the ones git makes itself while answering a status or a
   * blame. Reloading on each would feed the loop, so the status is refreshed at
   * most once a second per worktree, and the gutter only when the active file's
   * status actually moved: the same rule the main editor follows.
   */
  const GIT_REFRESH_MIN_INTERVAL_MS = 1000;
  const gitRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function scheduleGitRefresh(root: string) {
    if (gitRefreshTimers.has(root)) return;
    gitRefreshTimers.set(root, setTimeout(async () => {
      gitRefreshTimers.delete(root);
      const path = tabs[activeIdx]?.path;
      const before = path ? statusByRoot.get(root)?.[path] : undefined;
      await refreshStatus(root);
      if (activeRoot !== root || !path || tabs[activeIdx]?.path !== path) return;
      if (statusByRoot.get(root)?.[path] !== before) void refreshDiff();
    }, GIT_REFRESH_MIN_INTERVAL_MS));
  }

  let diffRequest = 0;
  /** Loads the gutter base and the blame of the active tab, dropping the answer if the tab moved on. */
  async function refreshDiff() {
    const tab = tabs[activeIdx] ?? null;
    const request = ++diffRequest;
    activeChunk = null;
    baseContent = null;
    currentBlame = new Map();
    const root = tab?.scope?.worktreePath ?? null;
    if (!tab || !root || tab.diskSnapshot || isExternalPath(tab.path) || isBinaryPath(tab.path)) return;
    if (!statusByRoot.has(root)) await refreshStatus(root);
    const result = await loadPaneBase(root, tab.path, statusByRoot.get(root)?.[tab.path]).catch(() => null);
    if (request !== diffRequest || !result) return;
    baseContent = result.baseContent;
    currentBlame = result.currentBlame;
  }

  let diffedKey: string | null = null;
  $: if ((activeTab?.key ?? null) !== diffedKey) {
    diffedKey = activeTab?.key ?? null;
    void refreshDiff();
  }

  async function revertActiveChunk() {
    if (!activeChunk) return;
    editorRef?.revertChunkAt(activeChunk.anchorLine);
    activeChunk = null;
    await flushSave();
  }

  // -- Saving ---------------------------------------------------------------------

  /** A write the user still has to arbitrate: the file moved on disk since the tab read it. */
  let conflict: { tab: ScopedTab; content: string; deleted: boolean; doc: Text } | null = null;

  async function flushSave() {
    const tab = tabs[activeIdx] ?? null;
    if (!tab || saving || tab.diskSnapshot || !isDirty(tab)) return;
    saving = true;
    const root = tab.scope?.worktreePath ?? null;
    const status = root ? statusByRoot.get(root)?.[tab.path] : undefined;
    const hadMarkers = hasConflictMarkers(tab.savedDoc.toString());
    try {
      // The conflict is settled before anything touches the buffer, so a user
      // who picks "Cancel" is not left with a reformatted document.
      const guard = await writeFile(tab.key, '', tab.version ?? null, true);
      if (isWriteConflict(guard)) {
        tab.conflicted = true;
        conflict = { tab, content: diskContentOf(tab), deleted: guard.actualVersion === null, doc: tab.doc };
        return;
      }
      if (tab.scope && $formatOnSave(tab.scope.projectId)) {
        await runFormatDocument(true).catch(() => {});
        await tick();
      }
      const doc = tab.doc;
      const content = diskContentOf(tab);
      const written = await writeTab(tab, content, tab.key);
      if (!written.written) {
        tab.conflicted = true;
        conflict = { tab, content, deleted: written.deleted, doc };
        return;
      }
      tab.savedDoc = doc;
      lsp.saved(tab.key, doc.toString());
      if (root) {
        if (status === 'conflicted' && hadMarkers && !hasConflictMarkers(doc.toString())) {
          await stageFile(root, tab.path).catch(() => {});
        }
        await refreshStatus(root);
        void refreshDiff();
      }
    } catch (e) {
      error = String(e);
    } finally {
      saving = false;
      tabs = tabs;
    }
  }

  /** Re-runs a refused write with no mtime guard: the user asked for their version to win. */
  async function overwriteConflict() {
    const c = conflict;
    conflict = null;
    if (!c) return;
    try {
      const outcome = await writeFile(c.tab.key, c.content, null);
      c.tab.savedDoc = c.doc;
      c.tab.conflicted = false;
      if (!isWriteConflict(outcome)) c.tab.version = outcome.version;
      tabs = tabs;
    } catch (e) {
      error = String(e);
    }
  }

  /** Opens what is on disk in a tab beside the conflicting one, leaving both versions intact. */
  async function openDiskVersion() {
    const c = conflict;
    conflict = null;
    if (!c) return;
    const read = await readTabFile(c.tab.key).catch(() => null);
    if (!read) return;
    captureEditorState();
    tabs = [...tabs, {
      key: `${c.tab.key}#disk`,
      scope: c.tab.scope,
      path: c.tab.path,
      doc: read.doc,
      savedDoc: read.doc,
      cursorPos: 0,
      scrollTop: 0,
      lineEndings: read.lineEndings,
      version: read.version,
      diskSnapshot: true,
      lastUsedAt: Date.now(),
    }];
    activeIdx = tabs.length - 1;
  }

  /** Writes every unsaved tab, for the app closing: a file that moved stays unsaved and flagged. */
  async function saveAll(): Promise<boolean> {
    let isAllSaved = true;
    for (const tab of tabs) {
      if (tab.diskSnapshot || !isDirty(tab)) continue;
      const doc = tab.doc;
      try {
        const written = await writeTab(tab, diskContentOf(tab), tab.key);
        if (written.written) tab.savedDoc = doc;
        else {
          tab.conflicted = true;
          isAllSaved = false;
        }
      } catch {
        isAllSaved = false;
      }
    }
    tabs = tabs;
    return isAllSaved;
  }

  // -- Language servers ------------------------------------------------------------

  const lsp = new LspDocSync();
  let lspDoc: LspDocRef | null = null;
  let syncedLspKey: string | null = null;

  $: if ((activeTab?.key ?? null) !== syncedLspKey) {
    syncedLspKey = activeTab?.key ?? null;
    void syncLspDoc();
  }

  async function syncLspDoc() {
    const tab = tabs[activeIdx] ?? null;
    lspDoc = null;
    const root = tab?.scope?.worktreePath ?? null;
    if (!tab || !root || tab.diskSnapshot || isExternalPath(tab.path)) return;
    const doc = await lsp.open(root, tab.key, languageIdForPath(tab.key) ?? 'plaintext', () => tab.doc.toString());
    if (tabs[activeIdx] !== tab) return;
    lspDoc = doc;
  }

  // -- Navigation -----------------------------------------------------------------

  let pendingJump: { key: string; line: number; col: number; anchor: string | null } | null = null;

  $: if (pendingJump && activeTab?.key === pendingJump.key) {
    const jump = pendingJump;
    pendingJump = null;
    scheduleJump(jump);
  }

  function scheduleJump(jump: { key: string; line: number; col: number; anchor: string | null }) {
    const deadline = Date.now() + EDITOR_JUMP_READY_TIMEOUT_MS;
    const attempt = () => {
      const tab = tabs[activeIdx];
      if (tab?.key !== jump.key) return;
      const line = jump.anchor ? (findHeadingLine(tab.savedDoc.toString(), jump.anchor) ?? jump.line) : jump.line;
      if (editorRef?.jumpTo(line, jump.col, tab.path)) return;
      if (Date.now() < deadline) setTimeout(attempt, EDITOR_JUMP_RETRY_MS);
    };
    attempt();
  }

  /** A path from a link, a definition or the references panel: absolute, or relative to the active tab's worktree. */
  function resolvePath(path: string): string | null {
    if (isExternalPath(path)) return path;
    return activeRoot ? `${activeRoot}/${path}` : null;
  }

  async function openAt(path: string, line: number, col: number, anchor: string | null = null) {
    const absolute = resolvePath(path);
    if (!absolute) return;
    pendingJump = { key: absolute, line, col, anchor };
    if (!(await openAbsolute(absolute))) pendingJump = null;
  }

  async function runGoToDefinition() {
    const position = editorRef?.getLspPosition();
    if (!lspDoc || !position) return;
    const [first] = await lspDefinition(lspDoc, position).catch(() => []);
    if (first) await openAt(first.path, first.line + 1, first.character + 1);
  }

  let isReferencesOpen = false;
  let referencesResult: ReferencesResult | null = null;
  let referencesLoading = false;
  let referencesError = '';
  let referencesToken = 0;

  async function runFindReferences() {
    const position = editorRef?.getLspPosition();
    if (!lspDoc || !position) return;
    const doc = lspDoc;
    const symbol = editorRef?.getWordAtCursor() ?? '';
    const token = ++referencesToken;
    isReferencesOpen = true;
    referencesLoading = true;
    referencesError = '';
    referencesResult = { symbol, definitions: [], implementations: [], references: [] };
    const [definitions, implementations, references] = await Promise.all([
      lspDefinition(doc, position).catch(() => []),
      lspImplementation(doc, position).catch(() => []),
      lspReferences(doc, position, false).catch((e) => { referencesError = String(e); return []; }),
    ]);
    if (token !== referencesToken) return;
    referencesResult = { symbol, definitions, implementations, references };
    referencesLoading = false;
  }

  // -- Rename & format -------------------------------------------------------------

  let renamePrompt: { doc: LspDocRef; position: { line: number; character: number }; value: string } | null = null;

  function startRenameSymbol() {
    const position = editorRef?.getLspPosition();
    if (!lspDoc || !position) return;
    renamePrompt = { doc: lspDoc, position, value: editorRef?.getWordAtCursor() ?? '' };
  }

  /**
   * An open tab is edited in place and left dirty; only a file this window does
   * not show goes through the disk. Same reasoning as the main editor: the
   * server computed its offsets against the buffer, not against the file.
   */
  async function commitRename() {
    if (!renamePrompt || !renamePrompt.value.trim()) return;
    const { doc, position, value } = renamePrompt;
    renamePrompt = null;
    let fileEdits: Awaited<ReturnType<typeof lspRename>>;
    try {
      fileEdits = await lspRename(doc, position, value.trim());
    } catch (e) {
      error = String(e);
      return;
    }
    const failed: string[] = [];
    for (const fileEdit of fileEdits) {
      const open = tabs.filter(tab => tab.key === fileEdit.path && !tab.diskSnapshot);
      try {
        const updated = open.length > 0
          ? applyEditsToText(open[0].doc.toString(), fileEdit.edits)
          : await editOnDisk(fileEdit.path, fileEdit.edits);
        if (updated === null) continue;
        const updatedDoc = docFromString(updated);
        for (const tab of open) tab.doc = updatedDoc;
        const openDoc = lsp.get(fileEdit.path);
        if (openDoc) await lspDidChange(openDoc, [{ text: updated }]).catch(() => {});
      } catch {
        failed.push(fileEdit.path);
      }
    }
    tabs = tabs;
    if (failed.length > 0) error = (t('languageServers.renameFailed') as (files: string) => string)(failed.join(', '));
  }

  async function editOnDisk(path: string, edits: LspTextEdit[]): Promise<string | null> {
    const current = await readFile(path);
    if (current === null) return null;
    const updated = applyEditsToText(current, edits);
    await writeFile(path, updated);
    return updated;
  }

  /** The project's own formatter first, then the language server; same order as the main editor. */
  async function runFormatDocument(quiet = false) {
    const tab = tabs[activeIdx];
    if (!tab || tab.diskSnapshot) return;
    isFormatting = true;
    try {
      let configured: StyleSet | null = null;
      const root = tab.scope?.worktreePath ?? null;
      if (root) {
        try {
          const outcome = await formatDocument({
            projectId: tab.scope?.projectId ?? null,
            worktree: root,
            path: tab.key,
            content: tab.doc.toString(),
          });
          if (outcome.formatterId && outcome.formatterId !== LSP_FORMATTER_ID) {
            if (outcome.changed) editorRef?.applyFormattedText(outcome.text);
            return;
          }
          configured = outcome.style;
        } catch (e) {
          error = String(e);
          return;
        }
      }
      const text = tab.doc.toString();
      const detected = detectIndentStyle(text);
      const size = Number(configured?.indentSize);
      const edits = lspDoc
        ? await lspFormat(
            lspDoc,
            Number.isFinite(size) && size > 0 ? size : detected === 'spaces' ? detectSpaceSize(text) : 2,
            configured ? configured.indentStyle !== 'tab' : detected !== 'tabs',
          ).catch(() => null)
        : null;
      if (edits && edits.length > 0) editorRef?.applyTextEdits(edits);
      else if (edits === null && root && !quiet) error = t('files.noFormatter') as string;
    } finally {
      isFormatting = false;
    }
  }

  function convertLineEndings() {
    const tab = tabs[activeIdx];
    if (!tab) return;
    tab.lineEndings = tab.lineEndings === 'CRLF' ? 'LF' : 'CRLF';
    tabs = tabs;
  }

  function convertIndent() {
    const tab = tabs[activeIdx];
    if (!tab) return;
    const text = tab.doc.toString();
    const size = Math.max(detectSpaceSize(text), 2);
    editorRef?.setContent(detectIndentStyle(text) === 'tabs' ? convertToSpaces(text, size) : convertToTabs(text, size));
  }

  function bumpFontSize(delta: number) {
    const next = $settings.editorFontSize + delta;
    void settings.save({ editorFontSize: Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, next)) });
  }

  // -- Watching the files ------------------------------------------------------------

  /**
   * Each worktree this window shows is watched on the directories of its tabs,
   * under this window's own name: the main window's set for the same worktree
   * is kept alongside, not replaced.
   */
  let watchedKey = '';
  let watchedRoots = new Set<string>();
  $: syncWatches(tabs.map(tab => `${tab.scope?.worktreePath ?? ''}\t${tab.key}`).join('\n'));

  function syncWatches(key: string) {
    if (key === watchedKey) return;
    watchedKey = key;
    const dirsByRoot = new Map<string, Set<string>>();
    for (const tab of tabs) {
      const root = tab.scope?.worktreePath;
      if (!root || tab.diskSnapshot) continue;
      const dirs = dirsByRoot.get(root) ?? new Set<string>();
      dirs.add(parentPathOf(tab.key));
      dirsByRoot.set(root, dirs);
    }
    for (const [root, dirs] of dirsByRoot) void watchDirs(root, [...dirs]).catch(() => {});
    for (const root of watchedRoots) if (!dirsByRoot.has(root)) void unwatchWorktree(root).catch(() => {});
    watchedRoots = new Set(dirsByRoot.keys());
  }

  /** Re-reads the tabs of a worktree that moved on disk; a tab with unsaved edits keeps them. */
  async function reloadFromDisk(root: string) {
    let hasChanged = false;
    for (const tab of tabs) {
      if (tab.scope?.worktreePath !== root || tab.diskSnapshot) continue;
      if (isBinaryPath(tab.path)) {
        binaryReloadToken++;
        continue;
      }
      try {
        const read = await readFileVersioned(tab.key);
        if (read.text === null) continue;
        const lineEndings = detectLineEndings(read.text);
        const text = normalizeLineEndings(read.text, lineEndings);
        // A dirty tab keeps its edits; it only adopts the stamp when the disk
        // still holds what it last saved, so its next save is not a false conflict.
        if (isDirty(tab)) {
          if (text === tab.savedDoc.toString()) tab.version = read.version;
          continue;
        }
        tab.version = read.version;
        if (text === tab.savedDoc.toString()) continue;
        tab.doc = tab.savedDoc = docFromString(text);
        tab.lineEndings = lineEndings;
        editorStateCache.delete(tab.key);
        hasChanged = true;
      } catch {}
    }
    if (hasChanged) tabs = tabs;
  }

  // -- Registry ---------------------------------------------------------------------

  let syncedFiles = '';
  $: syncOpenFiles(tabs);

  function syncOpenFiles(current: ScopedTab[]) {
    const files: OpenFile[] = current
      .filter(tab => !tab.diskSnapshot)
      .map(tab => ({ path: tab.key, isDirty: isDirty(tab) }));
    const key = JSON.stringify(files);
    if (key === syncedFiles) return;
    syncedFiles = key;
    void syncWindowFiles(files).catch(() => {});
  }

  let shownTitle = '';
  $: syncTitle(activeTab ? `${basename(activeTab.path)} - Cairn Foundry` : 'Cairn Foundry');

  function syncTitle(title: string) {
    if (title === shownTitle) return;
    shownTitle = title;
    void appWindow.setTitle(title).catch(() => {});
  }

  async function closeWindow() {
    if (isClosing) return;
    isClosing = true;
    await appWindow.destroy();
  }

  // -- Tab drag -----------------------------------------------------------------------

  let dragSrcIndex: number | null = null;
  let insertIndex: number | null = null;
  let didDrag = false;
  let dragActive = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let isNativeTabDrag = false;
  void usesNativeDrag().then((native) => { isNativeTabDrag = native; });

  function resetTabDrag() {
    dragSrcIndex = null;
    insertIndex = null;
    dragActive = false;
    didDrag = true;
    document.body.classList.remove('dragging');
  }

  function tabPointerDown(e: PointerEvent, idx: number) {
    if ((e.target as Element).closest('button')) return;
    e.preventDefault();
    dragSrcIndex = idx;
    insertIndex = idx;
    didDrag = false;
    dragActive = false;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function tabPointerMove(e: PointerEvent) {
    if (dragSrcIndex === null) return;
    if (!dragActive) {
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      if (dx * dx + dy * dy < TAB_DRAG_THRESHOLD * TAB_DRAG_THRESHOLD) return;
      dragActive = true;
      document.body.classList.add('dragging');
    }
    if (isOutsideViewport(e)) {
      insertIndex = null;
      if (!isNativeTabDrag) return;
      const tab = tabs[dragSrcIndex];
      try { (e.currentTarget as HTMLElement | null)?.releasePointerCapture(e.pointerId); } catch {}
      resetTabDrag();
      if (!tab || tab.diskSnapshot) return;
      void dragTabNatively(payloadOf(tab)).then(
        (outcome) => { if (outcome === 'moved') dropTab(tab); },
        (err) => { error = String(err); },
      );
      return;
    }
    insertIndex = computeTabInsertIndex(tabsBarEl, e.clientX);
    didDrag = true;
  }

  async function tabPointerUp(e: PointerEvent) {
    if (dragSrcIndex === null) return;
    if (dragActive && isOutsideViewport(e)) {
      const tab = tabs[dragSrcIndex];
      resetTabDrag();
      if (!tab || tab.diskSnapshot) return;
      const outcome = await dropTabOutside(payloadOf(tab), e).catch((err) => {
        error = String(err);
        return 'stayed' as const;
      });
      if (outcome === 'moved') dropTab(tab);
      return;
    }
    if (dragActive && insertIndex !== null) {
      const result = applyTabReorder(tabs, activeIdx, dragSrcIndex, insertIndex);
      tabs = result.tabs as ScopedTab[];
      activeIdx = result.activeIdx;
    }
    dragSrcIndex = null;
    insertIndex = null;
    dragActive = false;
    document.body.classList.remove('dragging');
  }

  // -- Context menu ---------------------------------------------------------------------

  let tabMenu: { x: number; y: number; idx: number } | null = null;

  function openTabMenu(e: MouseEvent, idx: number) {
    e.preventDefault();
    e.stopPropagation();
    tabMenu = { x: Math.min(e.clientX, window.innerWidth - 240), y: Math.min(e.clientY, window.innerHeight - 300), idx };
  }

  function menuAction(action: (idx: number) => void | Promise<void>) {
    const menu = tabMenu;
    tabMenu = null;
    if (menu) void action(menu.idx);
  }

  async function copyPath(idx: number, isAbsolute: boolean) {
    const tab = tabs[idx];
    if (tab) await navigator.clipboard.writeText(isAbsolute ? tab.key.replace(/#disk$/, '') : tab.path);
  }

  // -- Keyboard ------------------------------------------------------------------------

  function handleKey(e: KeyboardEvent) {
    const sc = $activeShortcuts;
    const run = (fn: () => void) => { e.preventDefault(); e.stopPropagation(); fn(); };
    if (matchesShortcut(e, sc.saveFile)) return run(() => void flushSave());
    if (matchesShortcut(e, sc.closeTab)) return run(() => void closeTab(activeIdx));
    if (matchesShortcut(e, sc.nextTab) && tabs.length > 1) return run(() => activate((activeIdx + 1) % tabs.length));
    if (matchesShortcut(e, sc.prevTab) && tabs.length > 1) return run(() => activate((activeIdx - 1 + tabs.length) % tabs.length));
    if (matchesShortcut(e, sc.detachTab)) return run(() => void moveToNewWindow(activeIdx));
    if (matchesShortcut(e, sc.formatDocument)) return run(() => void runFormatDocument());
    if (matchesShortcut(e, sc.renameSymbol)) return run(startRenameSymbol);
    if (matchesShortcut(e, sc.fontSizeUp)) return run(() => bumpFontSize(+1));
    if (matchesShortcut(e, sc.fontSizeDown)) return run(() => bumpFontSize(-1));
    if (matchesShortcut(e, sc.fontSizeReset)) return run(() => void settings.save({ editorFontSize: EDITOR_DEFAULTS.fontSize }));
    if ((IS_MAC ? e.metaKey : e.ctrlKey) && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) {
      const idx = parseInt(e.key, 10) - 1;
      if (idx < tabs.length) run(() => activate(idx));
    }
  }

  // -- Lifecycle -------------------------------------------------------------------------

  const unlisteners: Array<() => void> = [];
  let isDisposed = false;
  function keep(off: Promise<() => void>) {
    void off.then((unlisten) => {
      if (isDisposed) unlisten();
      else unlisteners.push(unlisten);
    }).catch(() => {});
  }

  onMount(() => {
    window.addEventListener('keydown', handleKey, { capture: true });
    void takeWindowTabs().then((payloads) => {
      adopt(payloads);
      if (tabs.length === 0) void closeWindow();
    });
    keep(onTabsReceived(({ tabs: received }) => {
      adopt(received);
      void appWindow.setFocus().catch(() => {});
    }));
    keep(onRevealFile((path) => {
      const idx = tabs.findIndex(t => t.key === path);
      if (idx !== -1) activate(idx);
    }));
    keep(onSaveAll(() => { void saveAll(); }));
    keep(onFsChanged(({ worktree, gitOnly }) => {
      if (!watchedRoots.has(worktree)) return;
      if (!gitOnly) void reloadFromDisk(worktree);
      scheduleGitRefresh(worktree);
    }));
    keep(getCurrentWebview().onDragDropEvent(async ({ payload }) => {
      if (payload.type !== 'drop') return;
      const { tabs: received, files } = await claimDroppedTabs(payload.paths);
      adopt(received);
      for (const file of files) await openAbsolute(file);
    }));
    // Closing this window writes its unsaved tabs, like closing them one by one
    // would. A file that moved on disk keeps the window open on its conflict.
    keep(appWindow.onCloseRequested(async (event) => {
      if (isClosing) return;
      if (await saveAll()) return;
      event.preventDefault();
      const idx = tabs.findIndex(tab => tab.conflicted && !tab.diskSnapshot);
      if (idx === -1) return;
      activate(idx);
      const tab = tabs[idx];
      conflict = { tab, content: diskContentOf(tab), deleted: false, doc: tab.doc };
    }));
  });

  onDestroy(() => {
    isDisposed = true;
    window.removeEventListener('keydown', handleKey, { capture: true });
    for (const unlisten of unlisteners) unlisten();
    if (invalidation) cancelAnimationFrame(invalidation);
    for (const timer of gitRefreshTimers.values()) clearTimeout(timer);
    lsp.closeAll();
  });
</script>

{#if IS_MAC}
  <!-- The overlay title bar leaves the window no chrome to be moved by: this strip is it. -->
  <div class="detached-titlebar" data-tauri-drag-region use:draggableRegion>
    <span class="detached-title">{shownTitle}</span>
  </div>
{/if}
<div class="detached-layout" class:has-titlebar={IS_MAC}>
  <ReferencesPanel
    worktreePath={activeRoot}
    hidden={!isReferencesOpen}
    loading={referencesLoading}
    error={referencesError}
    result={referencesResult}
    onOpen={(path, line, col) => void openAt(path, line, col)}
    onClose={() => { isReferencesOpen = false; }}
  />
  <div class="detached-editor">
    {#if error}
      <div class="detached-error selectable" role="alert">
        <Icon name="alert" size={12}/>
        <span>{error}</span>
        <button type="button" class="error-dismiss" aria-label={t('common.close') as string} on:click={() => { error = ''; }}>
          <Icon name="x" size={11}/>
        </button>
      </div>
    {/if}
    <EditorPane
      paneStyle="flex: 1"
      bind:tabsBarEl
      bind:editorRef
      {tabs}
      activeTabIdx={activeIdx}
      {activeTab}
      {gitStatusMap}
      loadingPaths={NO_LOADING}
      {dragSrcIndex}
      {insertIndex}
      {didDrag}
      {dragActive}
      editorState={activeTab ? (editorStateCache.get(activeTab.key) ?? null) : null}
      {activeLang}
      activeLineEndings={activeTab?.lineEndings ?? 'LF'}
      {activeIndentStyle}
      {activeSpaceSize}
      isDirty={isActiveDirty}
      {saving}
      {cursorLine}
      {cursorCol}
      {currentLineBlame}
      {baseContent}
      {activeChunk}
      worktreePath={activeRoot}
      {binaryReloadToken}
      placeholderText=""
      tabKey={(tab) => (tab as ScopedTab).key}
      tabHint={(tab) => projectName(tab as ScopedTab)}
      activeDocPath={activeTab && !activeTab.diskSnapshot ? activeTab.key : null}
      onMoveTab={activeTab && !activeTab.diskSnapshot ? () => void moveToMain(activeIdx) : undefined}
      moveTabLabel={t('files.moveToMainWindow') as string}
      moveTabIcon="back"
      onPaneFocus={() => {}}
      onTabPointerDown={tabPointerDown}
      onTabPointerMove={tabPointerMove}
      onTabPointerUp={tabPointerUp}
      onTabClick={(idx) => { if (!didDrag) activate(idx); didDrag = false; }}
      onTabContextMenu={openTabMenu}
      onTabClose={(idx, e) => { e.stopPropagation(); void closeTab(idx); }}
      onTabUnpin={togglePin}
      onBreadcrumbClick={() => {}}
      onChange={handleChange}
      onBlur={$settings.saveOn === 'blur' ? () => void flushSave() : undefined}
      onCursorChange={handleCursorChange}
      onGoToDefinition={() => void runGoToDefinition()}
      onFindReferences={() => void runFindReferences()}
      onRenameSymbol={startRenameSymbol}
      onFormatDocument={() => void runFormatDocument()}
      onChunkClick={(chunk) => { activeChunk = chunk; }}
      onRevertChunk={revertActiveChunk}
      onCloseHunk={() => { activeChunk = null; }}
      onConvertLineEndings={convertLineEndings}
      onConvertIndent={convertIndent}
      onToggleWhitespace={() => void settings.save({ showWhitespace: !$settings.showWhitespace })}
      onOpenRecent={() => {}}
      onOpenLink={(path, anchor) => void openAt(path, 1, 1, anchor)}
      {lspDoc}
      formatting={isFormatting}
      lspDiagnostics={lspDocDiagnostics}
    />
  </div>
</div>

{#if conflict}
  <SaveConflict
    path={conflict.tab.path}
    deleted={conflict.deleted}
    on:overwrite={overwriteConflict}
    on:openDisk={openDiskVersion}
    on:cancel={() => { conflict = null; }}
  />
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

{#if tabMenu}
  {@const menuTab = tabs[tabMenu.idx]}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="ctx-backdrop" on:mousedown={() => { tabMenu = null; }}></div>
  <div class="ctx-menu" style="left: {tabMenu.x}px; top: {tabMenu.y}px">
    <button type="button" class="ctx-item" on:click={() => menuAction(togglePin)}>
      <Icon name="pin" size={13}/> {menuTab?.pinned ? t('files.tabContextMenu.unpinTab') : t('files.tabContextMenu.pinTab')}
    </button>
    <div class="ctx-sep"></div>
    <button type="button" class="ctx-item" on:click={() => menuAction(closeTab)}>
      <Icon name="x" size={13}/> {t('files.tabContextMenu.closeTab')}
    </button>
    <button type="button" class="ctx-item" on:click={() => menuAction(closeOthers)}>
      <Icon name="x" size={13}/> {t('files.tabContextMenu.closeOthers')}
    </button>
    <button type="button" class="ctx-item" on:click={() => menuAction(closeAll)}>
      <Icon name="x" size={13}/> {t('files.tabContextMenu.closeAll')}
    </button>
    {#if menuTab && !menuTab.diskSnapshot}
      <div class="ctx-sep"></div>
      <button type="button" class="ctx-item" on:click={() => menuAction(moveToMain)}>
        <Icon name="back" size={13}/> {t('files.tabContextMenu.moveToMainWindow')}
      </button>
      <button type="button" class="ctx-item" disabled={tabs.length < 2} on:click={() => menuAction(moveToNewWindow)}>
        <Icon name="external" size={13}/> {t('files.tabContextMenu.openInNewWindow')}
      </button>
    {/if}
    <div class="ctx-sep"></div>
    {#if menuTab && !isExternalPath(menuTab.path)}
      <button type="button" class="ctx-item" on:click={() => menuAction((idx) => copyPath(idx, false))}>
        <Icon name="copy" size={13}/> {t('files.tabContextMenu.copyRelativePath')}
      </button>
    {/if}
    <button type="button" class="ctx-item" on:click={() => menuAction((idx) => copyPath(idx, true))}>
      <Icon name="copy" size={13}/> {t('files.tabContextMenu.copyAbsolutePath')}
    </button>
  </div>
{/if}

<style>
  .detached-titlebar {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 28px;
    padding: 0 80px;
    border-bottom: 1px solid var(--stroke-0);
    background: var(--bg-1);
  }
  .detached-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--fg-2);
    font-size: 12px;
    pointer-events: none;
  }
  .detached-layout {
    display: flex;
    height: calc(100vh - var(--titlebar-h, 0px));
    margin-top: var(--titlebar-h, 0px);
    min-height: 0;
    overflow: hidden;
    background: var(--bg-0);
  }
  .detached-layout.has-titlebar { height: calc(100vh - 28px); }
  .detached-editor {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .detached-editor :global(.editor-pane) { flex: 1; }

  .detached-error {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border-bottom: 1px solid var(--stroke-0);
    background: var(--bg-2);
    color: var(--danger);
    font-size: 12px;
  }
  .detached-error span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .error-dismiss {
    display: inline-flex;
    border: none;
    background: none;
    color: inherit;
    cursor: pointer;
    padding: 2px;
    border-radius: var(--r-sm);
  }
  .error-dismiss:hover { background: var(--bg-4); }

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

  .ctx-backdrop { position: fixed; inset: 0; z-index: 9998; }
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
  .ctx-sep { height: 1px; background: var(--stroke-0); margin: 3px 0; }
</style>
