<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import CodeEditor from './CodeEditor.svelte';
  import QuickOpen from './QuickOpen.svelte';
  import { activeInstance } from '$lib/stores/instance';
  import { readDirTree, readFile, writeFile, deletePath, renamePath, createFileOrDir, copyPath, revealInFileManager, openInTerminal, langFromPath, isBinaryPath, gitStatus, type FileNode, type GitStatusMap } from '$lib/services/file-service';
  import { settings } from '$lib/stores/settings';

  interface Tab {
    path: string;
    content: string;
    pending: string;
    cursorPos: number;
    scrollTop: number;
  }

  interface InstanceTabState {
    tabs: Tab[];
    activeTabIdx: number;
    expanded: Set<string>;
  }

  // ── localStorage persistence ──────────────────────────────────────────────────

  interface PersistedTab { path: string; cursorPos: number; scrollTop: number; }
  interface PersistedState { tabs: PersistedTab[]; activeTabIdx: number; expanded: string[]; }

  function persistState(instanceId: string, state: InstanceTabState) {
    try {
      const data: PersistedState = {
        tabs: state.tabs.map(t => ({ path: t.path, cursorPos: t.cursorPos, scrollTop: t.scrollTop })),
        activeTabIdx: state.activeTabIdx,
        expanded: [...state.expanded],
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

  async function rehydrateTabs(wtp: string, persisted: PersistedState) {
    tabs = persisted.tabs.map(p => ({ path: p.path, content: '', pending: '', cursorPos: p.cursorPos, scrollTop: p.scrollTop }));
    activeTabIdx = persisted.activeTabIdx;
    expanded = new Set(persisted.expanded);

    const results = await Promise.all(
      persisted.tabs.map(async (p) => {
        if (isBinaryPath(p.path)) return { path: p.path, text: '' };
        try { return { path: p.path, text: await readFile(`${wtp}/${p.path}`) ?? '' }; }
        catch { return null; }
      })
    );

    const valid = results.filter(Boolean) as { path: string; text: string }[];
    tabs = valid.map(r => {
      const saved = persisted.tabs.find(p => p.path === r.path)!;
      return { path: r.path, content: r.text, pending: r.text, cursorPos: saved.cursorPos, scrollTop: saved.scrollTop };
    });
    if (tabs.length === 0) { activeTabIdx = -1; return; }
    if (activeTabIdx >= tabs.length) activeTabIdx = tabs.length - 1;
  }

  const savedState = new Map<string, InstanceTabState>();

  let tree: FileNode[] = [];
  let gitStatusMap: GitStatusMap = {};
  let expanded = new Set<string>();
  let tabs: Tab[] = [];
  let activeTabIdx = -1;
  let loading = false;
  let loadingPaths = new Set<string>();
  let saving = false;
  let error = '';
  let editorRef: CodeEditor | undefined;

  let quickOpenVisible = false;

  // ── Context menu & inline editing ────────────────────────────────────────────

  interface ContextMenu { x: number; y: number; node: FileNode | null }
  interface EditState { type: 'rename' | 'new-file' | 'new-dir'; node: FileNode | null; parentPath: string; value: string }

  interface FileClipboard { node: FileNode; srcWorktreePath: string; op: 'copy' | 'cut' }

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

  async function handleContextAction(action: ContextAction) {
    const node = contextMenu?.node ?? null;
    closeContextMenu();

    if (action === 'cut' && node) {
      fileClipboard = { node, srcWorktreePath: worktreePath ?? '', op: 'cut' };
      return;
    }
    if (action === 'copy' && node) {
      fileClipboard = { node, srcWorktreePath: worktreePath ?? '', op: 'copy' };
      return;
    }
    if (action === 'paste' && fileClipboard && worktreePath) {
      const { node: src, srcWorktreePath, op } = fileClipboard;
      const targetDir = node?.isDir ? node.path : (node?.path.includes('/') ? node.path.split('/').slice(0, -1).join('/') : '');
      const siblings = new Set(
        (targetDir ? tree.find(n => n.path === targetDir)?.children : tree)?.map(n => n.name) ?? []
      );
      const destName = pasteDestName(src.name, siblings);
      const destRelPath = targetDir ? `${targetDir}/${destName}` : destName;
      const fromAbs = `${srcWorktreePath}/${src.path}`;
      const toAbs = `${worktreePath}/${destRelPath}`;
      try {
        if (op === 'copy') {
          await copyPath(fromAbs, toAbs);
        } else {
          await renamePath(fromAbs, toAbs);
          tabs = tabs.map(t => t.path === src.path ? { ...t, path: destRelPath } : t);
          fileClipboard = null;
        }
        if (targetDir) { expanded.add(targetDir); expanded = expanded; }
        await loadTree(worktreePath);
      } catch (e) { error = String(e); }
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

  function cancelEdit() { editState = null; }

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
    treeWidth = Math.max(140, Math.min(480, resizeStartWidth + (e.clientX - resizeStartX)));
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

  onMount(() => {
    function handleGlobalKey(e: KeyboardEvent) {
      if (e.key === 'p' && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
        e.preventDefault();
        quickOpenVisible = true;
      }
    }
    window.addEventListener('keydown', handleGlobalKey);
    return () => window.removeEventListener('keydown', handleGlobalKey);
  });

  function quickOpenFile(path: string) {
    openFile({ path, name: path.split('/').pop() ?? path, isDir: false });
  }

  let tabsBarEl: HTMLElement | null = null;
  let dragSrcIndex: number | null = null;
  let insertIndex: number | null = null;
  let didDrag = false;

  $: if (!isResizing) treeWidth = $settings.treePanelWidth;

  $: worktreePath = $activeInstance?.worktreePath ?? null;
  $: activeTab = tabs[activeTabIdx] ?? null;
  $: activeLang = (activeTab ? langFromPath(activeTab.path) : 'text') as any;
  $: activeLineEndings = activeTab ? detectLineEndings(activeTab.pending) : 'LF';
  $: isDirty = activeTab ? activeTab.pending !== activeTab.content : false;
  $: { if (activeTab) { cursorLine = 1; cursorCol = 1; } }

  function saveCurrentState() {
    if (currentInstanceId === null) return;
    captureEditorState();
    const state = { tabs, activeTabIdx, expanded };
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
      editState = null;
      contextMenu = null;
      if (id !== null && savedState.has(id)) {
        const s = savedState.get(id)!;
        tabs = s.tabs;
        activeTabIdx = s.activeTabIdx;
        expanded = s.expanded;
        syncActiveTabToTree();
      } else if (id !== null && wtp !== null) {
        selectedDir = '';
        const persisted = readPersistedState(id);
        if (persisted) {
          rehydrateTabs(wtp, persisted).then(() => syncActiveTabToTree());
        } else {
          tabs = [];
          activeTabIdx = -1;
          expanded = new Set();
        }
      } else {
        selectedDir = '';
        tabs = [];
        activeTabIdx = -1;
        expanded = new Set();
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
      [tree, gitStatusMap] = await Promise.all([
        readDirTree(root),
        gitStatus(root).catch(() => ({} as GitStatusMap)),
      ]);
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }

  async function openFile(node: FileNode) {
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
      return;
    }

    if (loadingPaths.has(node.path)) return;

    captureEditorState();
    await flushSave();

    if (isBinaryPath(node.path)) {
      tabs = [...tabs, { path: node.path, content: '', pending: '', cursorPos: 0, scrollTop: 0 }];
      activeTabIdx = tabs.length - 1;
      return;
    }

    loadingPaths.add(node.path);
    loadingPaths = loadingPaths;
    try {
      const fullPath = `${worktreePath}/${node.path}`;
      const text = await readFile(fullPath) ?? '';
      tabs = [...tabs, { path: node.path, content: text, pending: text, cursorPos: 0, scrollTop: 0 }];
      activeTabIdx = tabs.length - 1;
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
    captureEditorState();
    await flushSave();
    activeTabIdx = idx;
    syncActiveTabToTree();
  }

  async function closeTab(idx: number, event: MouseEvent) {
    event.stopPropagation();
    const tab = tabs[idx];
    if (!tab) return;

    if (tab.pending !== tab.content && worktreePath) {
      await writeFile(`${worktreePath}/${tab.path}`, tab.pending);
    }

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

  async function flushSave() {
    if (!activeTab || activeTab.pending === activeTab.content || saving || !worktreePath) return;
    saving = true;
    try {
      await writeFile(`${worktreePath}/${activeTab.path}`, activeTab.pending);
      tabs[activeTabIdx].content = activeTab.pending;
      tabs = tabs;
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
      // Find where the active tab ended up
      const activePath = tabs[activeTabIdx]?.path;
      activeTabIdx = activePath ? newTabs.findIndex(t => t.path === activePath) : -1;
      tabs = newTabs;
    }
    dragSrcIndex = null;
    insertIndex = null;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const GIT_STATUS_PRIORITY = ['staged', 'modified', 'deleted', 'untracked'] as const;

  function nodeGitStatus(node: FileNode): string | null {
    if (!node.isDir) return gitStatusMap[node.path] ?? null;
    const prefix = node.path + '/';
    let best: number = GIT_STATUS_PRIORITY.length;
    for (const [path, status] of Object.entries(gitStatusMap)) {
      if (path.startsWith(prefix)) {
        const idx = GIT_STATUS_PRIORITY.indexOf(status as typeof GIT_STATUS_PRIORITY[number]);
        if (idx !== -1 && idx < best) best = idx;
      }
    }
    return best < GIT_STATUS_PRIORITY.length ? GIT_STATUS_PRIORITY[best] : null;
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

<div class="files-layout">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <aside class="files-tree" style="width: {treeWidth}px" on:contextmenu={(e) => openContextMenu(e, null)}>
    <div class="files-tree-header">
      <Icon name="folder" size={12}/>
      <span class="tree-header-title">{$activeInstance ? $activeInstance.ticket.id : 'No instance'}</span>
      <div class="tree-header-actions">
        <button type="button" class="tree-action-btn" title="New File" on:click={(e) => { e.stopPropagation(); if (selectedDir) { expanded.add(selectedDir); expanded = expanded; } startEdit({ type: 'new-file', node: null, parentPath: selectedDir, value: '' }); }}>
          <Icon name="file" size={12}/>
        </button>
        <button type="button" class="tree-action-btn" title="New Folder" on:click={(e) => { e.stopPropagation(); if (selectedDir) { expanded.add(selectedDir); expanded = expanded; } startEdit({ type: 'new-dir', node: null, parentPath: selectedDir, value: '' }); }}>
          <Icon name="folder" size={12}/>
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
        class="file-tree-item tree-root-row {selectedDir === '' ? 'selected-dir' : ''}"
        style="padding-left: 12px"
        on:click={() => { selectedDir = ''; }}
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
    {#if tabs.length > 0}
      <div class="tabs-bar" role="tablist" bind:this={tabsBarEl}>
        {#each tabs as tab, i}
          {#if dragSrcIndex !== null && insertIndex === i && !(insertIndex === dragSrcIndex || insertIndex === dragSrcIndex + 1)}
            <div class="drop-indicator"></div>
          {/if}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="file-tab {i === activeTabIdx ? 'tab-active' : ''} {dragSrcIndex === i ? 'tab-dragging' : ''}"
            role="tab"
            aria-selected={i === activeTabIdx}
            tabindex="0"
            on:pointerdown={(e) => tabPointerDown(e, i)}
            on:pointermove={tabPointerMove}
            on:pointerup={tabPointerUp}
            on:click={() => { if (!didDrag) switchTab(i); didDrag = false; }}
            on:keydown={(e) => e.key === 'Enter' && switchTab(i)}
          >
            <span class="tab-name">{tab.path.split('/').pop()}</span>
            {#if tab.pending !== tab.content}
              <span class="tab-dot">●</span>
            {/if}
            <button type="button" class="tab-close" on:click={(e) => closeTab(i, e)} aria-label="Close tab">
              <Icon name="x" size={11}/>
            </button>
          </div>
        {/each}
        {#if dragSrcIndex !== null && insertIndex === tabs.length && insertIndex !== dragSrcIndex + 1}
          <div class="drop-indicator"></div>
        {/if}
      </div>
    {/if}

    {#if activeTab}
      <div class="editor-topbar">
        <Icon name="file" size={13}/>
        <span class="editor-path">
          <span class="editor-dir">{activeTab.path.split('/').slice(0, -1).join('/')}{activeTab.path.includes('/') ? '/' : ''}</span><strong>{activeTab.path.split('/').pop()}</strong>
        </span>
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
              content={activeTab.content}
              language={activeLang}
              readonly={false}
              initialCursorPos={activeTab.cursorPos}
              initialScrollTop={activeTab.scrollTop}
              onChange={handleChange}
              onBlur={flushSave}
              onCursorChange={handleCursorChange}
            />
          {/key}
        {/if}
      </div>
      <div class="editor-statusbar">
        <span class="statusbar-item">{cursorLine}:{cursorCol}</span>
        <span class="statusbar-sep">|</span>
        <span class="statusbar-item">{activeLang.toUpperCase()}</span>
        <span class="statusbar-sep">|</span>
        <span class="statusbar-item">{activeLineEndings}</span>
        <span class="statusbar-sep">|</span>
        <span class="statusbar-item">UTF-8</span>
        {#if isDirty}
          <span class="statusbar-sep">|</span>
          <span class="statusbar-item statusbar-dirty">●&nbsp;unsaved</span>
        {/if}
        {#if saving}
          <span class="statusbar-sep">|</span>
          <span class="statusbar-item statusbar-saving">saving…</span>
        {/if}
      </div>
    {:else}
      <div class="editor-placeholder">
        <Icon name="file" size={32}/>
        <div>Select a file to edit</div>
      </div>
    {/if}
  </div>
</div>

{#if quickOpenVisible}
  <QuickOpen tree={tree} onOpen={quickOpenFile} onClose={() => { quickOpenVisible = false; }} />
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
        class="tree-edit-input"
        on:keydown={(e) => { if (e.key === 'Enter') commitEdit(); else if (e.key === 'Escape') cancelEdit(); }}
        on:blur={cancelEdit}
      />
    </div>
  {:else}
    <button
      type="button"
      class="file-tree-item {tabs.some(t => t.path === node.path) ? 'open' : ''} {activeTab?.path === node.path ? 'active' : ''} {loadingPaths.has(node.path) ? 'loading' : ''} {node.isDir && node.path === selectedDir ? 'selected-dir' : ''} {contextMenu?.node?.path === node.path ? 'ctx-target' : ''} {nodeGitStatus(node) ? 'git-' + nodeGitStatus(node) : ''}"
      style="padding-left: {12 + depth * 14}px"
      on:click={() => openFile(node)}
      on:contextmenu={(e) => openContextMenu(e, node)}
    >
      <Icon name={fileIcon(node)} size={13}/>
      <span class="file-tree-name">{node.name}</span>
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
      class="tree-edit-input"
      on:keydown={(e) => { if (e.key === 'Enter') commitEdit(); else if (e.key === 'Escape') cancelEdit(); }}
      on:blur={cancelEdit}
    />
  </div>
{/snippet}

<style>
  .files-layout { display: flex; flex: 1; min-height: 0; overflow: hidden; }

  /* ── File tree ───────────────────────────────────────────────── */

  .files-tree {
    flex-shrink: 0;
    overflow-y: auto;
    padding: 8px 0;
    background: var(--bg-1);
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
    gap: 6px;
    padding: 6px 14px 10px;
    font-size: 10px;
    font-family: var(--font-mono);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--fg-3);
  }

  .tree-state {
    padding: 12px 14px;
    font-size: 12px;
    color: var(--fg-3);
  }
  .tree-state.error { color: oklch(0.70 0.18 15); }

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

  .file-tree-item.git-modified .file-tree-name { color: oklch(81.824% 0.15379 73.092); }
  .file-tree-item.git-untracked .file-tree-name { color: oklch(88.84% 0.22143 145.482); }
  .file-tree-item.git-deleted .file-tree-name { color: oklch(0.70 0.18 15); }
  .file-tree-item.git-staged .file-tree-name { color: oklch(75.595% 0.13163 248.231); }

  .file-tree-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tree-loading-dot { font-size: 11px; color: var(--fg-3); font-family: var(--font-mono); }

  /* ── Editor wrap ─────────────────────────────────────────────── */

  .files-editor-wrap { flex: 1; display: flex; flex-direction: column; overflow: hidden; }

  /* ── Tab bar ─────────────────────────────────────────────────── */

  .tabs-bar {
    display: flex;
    align-items: stretch;
    flex-shrink: 0;
    overflow-x: auto;
    border-bottom: 1px solid var(--stroke-0);
    background: var(--bg-1);
    scrollbar-width: none;
  }
  .tabs-bar::-webkit-scrollbar { display: none; }

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
    background: oklch(0.16 0.008 70);
    color: var(--fg-0);
    border-bottom: 2px solid var(--accent);
  }
  .file-tab.tab-dragging { opacity: 0.4; cursor: grabbing; }

  .tab-name { max-width: 140px; overflow: hidden; text-overflow: ellipsis; }
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

  /* ── Editor topbar ───────────────────────────────────────────── */

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
  }
  .editor-path { display: flex; align-items: baseline; overflow: hidden; flex: 1; }
  .editor-dir { color: var(--fg-3); white-space: nowrap; font-size: 11.5px; }
  .editor-body { flex: 1; overflow: hidden; position: relative; }

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

  /* ── Tree header actions ─────────────────────────────────────────── */

  .files-tree-header { position: relative; }
  .tree-header-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .tree-root-row { box-shadow: 0 1px 0 var(--stroke-0); margin-bottom: 2px; }
  .tree-header-actions {
    display: flex;
    gap: 2px;
    margin-left: auto;
    opacity: 0;
    transition: opacity 0.1s;
  }
  .files-tree-header:hover .tree-header-actions { opacity: 1; }
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
  }
  .tree-action-btn:hover { background: var(--bg-4); color: var(--fg-0); }

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

  /* ── Context menu ────────────────────────────────────────────────── */

  .ctx-backdrop {
    position: fixed;
    inset: 0;
    z-index: 99;
  }
  .ctx-menu {
    position: fixed;
    z-index: 100;
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
