<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';
  import CodeEditor from './CodeEditor.svelte';
  import { activeInstance } from '$lib/stores/instance';
  import { readDirTree, readFile, writeFile, langFromPath, isBinaryPath, type FileNode } from '$lib/services/file-service';

  let tree: FileNode[] = [];
  let expanded = new Set<string>();
  let activePath: string | null = null;
  let activeContent: string | null = null;
  let pendingContent: string | null = null;
  let loading = false;
  let loadingFile = false;
  let saving = false;
  let error = '';

  $: worktreePath = $activeInstance?.worktreePath ?? null;

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
      expanded = expanded; // trigger reactivity
      return;
    }

    if (activePath === node.path) return;

    // Auto-save current file before switching
    await flushSave();

    activePath = node.path;
    activeContent = null;
    pendingContent = null;

    if (isBinaryPath(node.path)) return;

    loadingFile = true;
    try {
      const fullPath = `${worktreePath}/${node.path}`;
      activeContent = await readFile(fullPath) ?? '';
      pendingContent = activeContent;
    } catch (e) {
      error = String(e);
    } finally {
      loadingFile = false;
    }
  }

  async function flushSave() {
    if (!activePath || pendingContent === null || pendingContent === activeContent || saving) return;
    saving = true;
    try {
      await writeFile(`${worktreePath}/${activePath}`, pendingContent);
      activeContent = pendingContent;
    } catch (e) {
      error = String(e);
    } finally {
      saving = false;
    }
  }

  function handleChange(value: string) {
    pendingContent = value;
  }

  $: activeLang = (activePath ? langFromPath(activePath) : 'text') as any;
  $: isDirty = pendingContent !== null && pendingContent !== activeContent;

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
    {#if activePath}
      <div class="editor-topbar">
        <Icon name="file" size={13}/>
        <span class="editor-path">
          <span class="editor-dir">{activePath.split('/').slice(0, -1).join('/')}{activePath.includes('/') ? '/' : ''}</span><strong>{activePath.split('/').pop()}</strong>
        </span>
        <div class="spacer"></div>
        {#if isDirty}
          <span class="editor-dirty">●</span>
        {/if}
        {#if saving}
          <span class="editor-saving">saving…</span>
        {/if}
        <span class="editor-lang">{activeLang.toUpperCase()}</span>
      </div>
      <div class="editor-body">
{#if loadingFile}
          <div class="editor-placeholder">Loading…</div>
        {:else if isBinaryPath(activePath)}
          <div class="editor-placeholder">
            <Icon name="file" size={32}/>
            <div>Binary file — preview not available</div>
            <div class="editor-placeholder-path">{activePath}</div>
          </div>
        {:else if activeContent !== null}
          {#key activePath}
            <CodeEditor
              content={activeContent}
              language={activeLang}
              readonly={false}
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

<!-- Recursive tree node -->
{#snippet treeNode(node: FileNode, depth: number)}
  <button
    class="file-tree-item {node.path === activePath ? 'active' : ''}"
    style="padding-left: {12 + depth * 14}px"
    on:click={() => openFile(node)}
  >
    <Icon name={fileIcon(node)} size={13}/>
    <span class="file-tree-name">{node.name}</span>
  </button>
  {#if node.isDir && expanded.has(node.path) && node.children}
    {#each node.children as child}
      {@render treeNode(child, depth + 1)}
    {/each}
  {/if}
{/snippet}

<style>
  .files-layout { display: flex; height: 100%; overflow: hidden; }

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
  .file-tree-item.active { background: var(--accent-weak); color: var(--fg-0); }

  .file-tree-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .files-editor-wrap { flex: 1; display: flex; flex-direction: column; overflow: hidden; }

  .editor-topbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 16px;
    height: 36px;
    border-bottom: 1px solid var(--stroke-0);
    background: var(--bg-1);
    flex-shrink: 0;
    font-size: 12.5px;
  }
  .editor-path { display: flex; align-items: baseline; overflow: hidden; }
  .editor-dir { color: var(--fg-3); white-space: nowrap; }
  .editor-lang {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--fg-3);
    letter-spacing: 0.05em;
    flex-shrink: 0;
  }
  .editor-dirty { color: var(--accent); font-size: 16px; line-height: 1; flex-shrink: 0; }
  .editor-saving { font-size: 11px; color: var(--fg-3); font-family: var(--font-mono); flex-shrink: 0; }

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
