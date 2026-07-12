<script lang="ts">
  import { tick } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n';
  import type { FileNode, GitStatusMap } from '$lib/services/file-service';
  import { fileIcon as fileIconFor, nodeGitStatus, parentPathOf } from '$lib/utils/files/files-tree';

  interface EditState { type: 'rename' | 'new-file' | 'new-dir'; node: FileNode | null; parentPath: string; value: string }

  // -- Sidebar header state/actions -----------------------------------------
  export let treeWidth: number;
  export let searchPanelOpen: boolean;
  export let splitMode: boolean;
  export let showHidden: boolean;
  export let tooltipSearch: string;
  export let tooltipSplit: string;

  export let onCollapseAll: () => void;
  export let onExpandAll: () => void;
  export let onNewFileTopLevel: () => void;
  export let onNewFolderTopLevel: () => void;
  export let onToggleSearchPanel: () => void;
  export let onRefresh: () => void;
  export let onToggleSplit: () => void;
  export let onToggleHidden: () => void;

  // -- Tree state -----------------------------------------------------------
  export let loading: boolean;
  export let error: string;
  export let worktreePath: string | null;
  export let tree: FileNode[];
  export let expanded: Set<string>;
  export let selectedDir: string;
  export let multiSelected: Set<string>;
  export let dragOverDir: string | null;
  export let cutPaths: Set<string>;
  export let gitStatusMap: GitStatusMap;
  export let loadingPaths: Set<string>;
  export let editState: EditState | null;
  export let editValue: string;
  export let editConflict: boolean;
  export let contextMenuTargetPath: string | null;
  export let openTabPaths: Set<string>;
  export let activeTabPath: string | null;
  export let dirtyTabPaths: Set<string>;

  // -- Tree callbacks -------------------------------------------------------
  export let onRootClick: () => void;
  export let onNodeClick: (e: MouseEvent, node: FileNode) => void;
  export let onContextMenu: (e: MouseEvent, node: FileNode | null) => void;
  export let onNodePointerDown: (e: PointerEvent, node: FileNode) => void;
  export let onNodePointerMove: (e: PointerEvent) => void;
  export let onNodePointerUp: (e: PointerEvent) => void;
  export let onNodePointerCancel: () => void;
  export let onCommitEdit: () => void;
  export let onCancelEdit: () => void;
  export let onEditValueChange: (value: string) => void;
  export let onEmptyAreaClick: () => void;

  let scrollEl: HTMLElement | null = null;

  function focusOnMount(el: HTMLInputElement) {
    tick().then(() => { el.focus(); el.select(); });
  }

  $: revealActiveInTree(activeTabPath);

  function revealActiveInTree(path: string | null) {
    if (!path) return;
    tick().then(() => {
      const el = scrollEl?.querySelector(`[data-tree-path="${CSS.escape(path)}"]`);
      el?.scrollIntoView({ block: 'nearest' });
    });
  }

  function handleEditKey(e: KeyboardEvent) {
    if (e.key === 'Enter') onCommitEdit();
    else if (e.key === 'Escape') onCancelEdit();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<aside class="files-tree" style="width: {treeWidth}px" on:contextmenu={(e) => onContextMenu(e, null)}>
  {#if worktreePath}
  <div class="files-tree-header">
    <div class="tree-header-actions">
      <button type="button" class="tree-action-btn" data-tooltip={t('files.treeTooltips.collapseAll') as string} on:click={(e) => { e.stopPropagation(); onCollapseAll(); }}>
        <Icon name="collapse-all" size={12}/>
      </button>
      <button type="button" class="tree-action-btn" data-tooltip={t('files.treeTooltips.expandAll') as string} on:click={(e) => { e.stopPropagation(); onExpandAll(); }}>
        <Icon name="expand-all" size={12}/>
      </button>
      <button type="button" class="tree-action-btn" data-tooltip={t('files.treeTooltips.newFile') as string} on:click={(e) => { e.stopPropagation(); onNewFileTopLevel(); }}>
        <Icon name="file" size={12}/>
      </button>
      <button type="button" class="tree-action-btn" data-tooltip={t('files.treeTooltips.newFolder') as string} on:click={(e) => { e.stopPropagation(); onNewFolderTopLevel(); }}>
        <Icon name="folder" size={12}/>
      </button>
      <button type="button" class="tree-action-btn {searchPanelOpen ? 'active' : ''}" data-tooltip={tooltipSearch} on:click={(e) => { e.stopPropagation(); onToggleSearchPanel(); }}>
        <Icon name="search" size={12}/>
      </button>
      <button type="button" class="tree-action-btn" data-tooltip={t('files.treeTooltips.refresh') as string} on:click={(e) => { e.stopPropagation(); onRefresh(); }}>
        <Icon name="refresh" size={12}/>
      </button>
      <button type="button" class="tree-action-btn {splitMode ? 'active' : ''}" data-tooltip={tooltipSplit} on:click={(e) => { e.stopPropagation(); onToggleSplit(); }}>
        <Icon name="columns" size={12}/>
      </button>
      <button type="button" class="tree-action-btn {showHidden ? 'active' : ''}" data-tooltip={t('files.treeTooltips.toggleHidden') as string} on:click={(e) => { e.stopPropagation(); onToggleHidden(); }}>
        <Icon name="eye" size={12}/>
      </button>
    </div>
  </div>
  {/if}

  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="files-tree-scroll" bind:this={scrollEl} on:click={(e) => { if (e.target === e.currentTarget) onEmptyAreaClick(); }}>
    {#if loading}
      <div class="tree-state">{t('files.treeLoading')}</div>
    {:else if error}
      <div class="tree-state error">{error}</div>
    {:else if !worktreePath}
      <div class="tree-state">{t('files.treeNoInstance')}</div>
    {:else}
      <button
        type="button"
        class="file-tree-item tree-root-row {selectedDir === '' ? 'selected-dir' : ''} {dragOverDir === '' ? 'drag-over' : ''}"
        style="padding-left: 12px"
        data-tree-dir=""
        on:click={onRootClick}
        on:contextmenu={(e) => onContextMenu(e, null)}
      >
        <Icon name={selectedDir === '' ? 'folder-open' : 'folder'} size={13}/>
        <span class="file-tree-name">/</span>
      </button>
      {#if editState && editState.parentPath === '' && editState.type !== 'rename'}
        {@render inlineInput(0)}
      {/if}
      {#if tree.length === 0 && !editState}
        <div class="tree-state">{t('files.treeEmpty')}</div>
      {/if}
      {#each tree as node}
        {@render treeNode(node, 0)}
      {/each}
    {/if}
  </div>
</aside>

{#snippet treeNode(node: FileNode, depth: number)}
  {#if editState?.type === 'rename' && editState.node?.path === node.path}
    <div class="file-tree-item file-tree-edit" style="padding-left: {12 + depth * 14}px">
      <Icon name={fileIconFor(node, expanded)} size={13}/>
      <input
        use:focusOnMount
        value={editValue}
        on:input={(e) => onEditValueChange((e.currentTarget as HTMLInputElement).value)}
        class="tree-edit-input {editConflict ? 'input-conflict' : ''}"
        on:keydown={handleEditKey}
        on:blur={onCancelEdit}
      />
    </div>
  {:else}
    {@const status = nodeGitStatus(node, gitStatusMap)}
    <button
      type="button"
      class="file-tree-item {openTabPaths.has(node.path) ? 'open' : ''} {activeTabPath === node.path ? 'active' : ''} {loadingPaths.has(node.path) ? 'loading' : ''} {node.isDir && node.path === selectedDir ? 'selected-dir' : ''} {contextMenuTargetPath === node.path ? 'ctx-target' : ''} {status ? 'git-' + status : ''} {multiSelected.has(node.path) ? 'multi-selected' : ''} {node.isDir && dragOverDir === node.path ? 'drag-over' : ''} {cutPaths.has(node.path) ? 'file-cut' : ''}"
      style="padding-left: {12 + depth * 14}px"
      data-tree-path={node.path}
      data-tree-dir={node.isDir ? node.path : undefined}
      data-tree-parent={!node.isDir ? parentPathOf(node.path) : undefined}
      on:click={(e) => onNodeClick(e, node)}
      on:contextmenu={(e) => onContextMenu(e, node)}
      on:pointerdown={(e) => onNodePointerDown(e, node)}
      on:pointermove={onNodePointerMove}
      on:pointerup={onNodePointerUp}
      on:pointercancel={onNodePointerCancel}
    >
      <Icon name={fileIconFor(node, expanded)} size={13}/>
      <span class="file-tree-name">{node.name}</span>
      {#if dirtyTabPaths.has(node.path)}
        <span class="tab-dot">●</span>
      {/if}
      {#if loadingPaths.has(node.path)}
        <span class="tree-loading-dot">...</span>
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
      value={editValue}
      on:input={(e) => onEditValueChange((e.currentTarget as HTMLInputElement).value)}
      placeholder={editState?.type === 'new-dir' ? t('files.folderNamePlaceholder') as string : t('files.fileNamePlaceholder') as string}
      class="tree-edit-input {editConflict ? 'input-conflict' : ''}"
      on:keydown={handleEditKey}
      on:blur={onCancelEdit}
    />
  </div>
{/snippet}

<style>
  .files-tree {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg-1);
    border-right: 1px solid var(--stroke-0);
  }

  .files-tree-header {
    display: flex;
    align-items: center;
    padding: 4px 6px;
    border-bottom: 1px solid var(--stroke-0);
    flex-shrink: 0;
    position: relative;
    z-index: 50;
    overflow: visible;
  }

  .files-tree-scroll {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 0 0 8px;
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
    left: 0;
    transform: none;
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
  .tree-action-btn[data-tooltip]:hover::after { opacity: 1; }
  .tree-action-btn[data-tooltip]:hover::after { opacity: 1; }

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

  .tab-dot { color: var(--accent); font-size: 10px; line-height: 1; }
</style>
