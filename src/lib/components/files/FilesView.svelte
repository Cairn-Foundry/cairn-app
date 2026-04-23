<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import CodeEditor from './CodeEditor.svelte';
  import QuickOpen from './QuickOpen.svelte';
  import { activeInstance } from '$lib/stores/instance';
  import { readDirTree, readFile, writeFile, langFromPath, isBinaryPath, type FileNode } from '$lib/services/file-service';

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
  let expanded = new Set<string>();
  let tabs: Tab[] = [];
  let activeTabIdx = -1;
  let loading = false;
  let loadingPaths = new Set<string>();
  let saving = false;
  let error = '';
  let editorRef: CodeEditor | undefined;

  let quickOpenVisible = false;

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

  $: worktreePath = $activeInstance?.worktreePath ?? null;
  $: activeTab = tabs[activeTabIdx] ?? null;
  $: activeLang = (activeTab ? langFromPath(activeTab.path) : 'text') as any;

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
      if (id !== null && savedState.has(id)) {
        const s = savedState.get(id)!;
        tabs = s.tabs;
        activeTabIdx = s.activeTabIdx;
        expanded = s.expanded;
      } else if (id !== null && wtp !== null) {
        const persisted = readPersistedState(id);
        if (persisted) {
          rehydrateTabs(wtp, persisted);
        } else {
          tabs = [];
          activeTabIdx = -1;
          expanded = new Set();
        }
      } else {
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
      tree = await readDirTree(root);
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
      return;
    }

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

  async function switchTab(idx: number) {
    if (idx === activeTabIdx) return;
    captureEditorState();
    await flushSave();
    activeTabIdx = idx;
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
  <aside class="files-tree">
    <div class="files-tree-header">
      <Icon name="folder" size={12}/>
      <span>{$activeInstance ? $activeInstance.ticket.id : 'No instance'}</span>
    </div>

    {#if loading}
      <div class="tree-state">Loading…</div>
    {:else if error}
      <div class="tree-state error">{error}</div>
    {:else if tree.length === 0 && worktreePath}
      <div class="tree-state">Empty worktree</div>
    {:else if !worktreePath}
      <div class="tree-state">No active instance</div>
    {:else}
      {#each tree as node}
        {@render treeNode(node, 0)}
      {/each}
    {/if}
  </aside>

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
        <div class="spacer"></div>
        {#if saving}
          <span class="editor-saving">saving…</span>
        {/if}
        <span class="editor-lang">{activeLang.toUpperCase()}</span>
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
            />
          {/key}
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

<!-- Recursive tree node -->
{#snippet treeNode(node: FileNode, depth: number)}
  <button
    type="button"
    class="file-tree-item {tabs.some(t => t.path === node.path) ? 'open' : ''} {activeTab?.path === node.path ? 'active' : ''} {loadingPaths.has(node.path) ? 'loading' : ''}"
    style="padding-left: {12 + depth * 14}px"
    on:click={() => openFile(node)}
  >
    <Icon name={fileIcon(node)} size={13}/>
    <span class="file-tree-name">{node.name}</span>
    {#if loadingPaths.has(node.path)}
      <span class="tree-loading-dot">…</span>
    {/if}
  </button>
  {#if node.isDir && expanded.has(node.path) && node.children}
    {#each node.children as child}
      {@render treeNode(child, depth + 1)}
    {/each}
  {/if}
{/snippet}

<style>
  .files-layout { display: flex; height: 100%; overflow: hidden; }

  /* ── File tree ───────────────────────────────────────────────── */

  .files-tree {
    width: 220px;
    flex-shrink: 0;
    border-right: 1px solid var(--stroke-0);
    overflow-y: auto;
    padding: 8px 0;
    background: var(--bg-1);
  }

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
  .file-tree-item:hover { background: var(--bg-4); color: var(--fg-0); }
  .file-tree-item.open { color: var(--fg-1); }
  .file-tree-item.active { background: var(--accent-weak); color: var(--fg-0); }
  .file-tree-item.loading { opacity: 0.6; }

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
  .editor-path { display: flex; align-items: baseline; overflow: hidden; }
  .editor-dir { color: var(--fg-3); white-space: nowrap; font-size: 11.5px; }
  .editor-lang {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--fg-3);
    letter-spacing: 0.05em;
    flex-shrink: 0;
  }
  .editor-saving { font-size: 11px; color: var(--fg-3); font-family: var(--font-mono); flex-shrink: 0; }
  .spacer { flex: 1; }

  .editor-body { flex: 1; overflow: hidden; position: relative; }

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
</style>
