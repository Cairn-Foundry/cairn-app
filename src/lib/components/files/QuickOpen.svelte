<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import type { FileNode } from '$lib/services/file-service';
  import { flattenTreeFilePaths, scorePathMatch } from '$lib/utils/files/files-search';
  import { basename, parentPathOf } from '$lib/utils/files/files-tree';

  interface Props {
    tree: FileNode[];
    onOpen: (path: string) => void;
    onClose: () => void;
  }

  let { tree, onOpen, onClose }: Props = $props();

  let query = $state('');
  let selectedIdx = $state(0);
  let inputEl: HTMLInputElement | undefined;

  const allFiles = $derived(flattenTreeFilePaths(tree));

  const results = $derived(
    allFiles
      .map(path => ({ path, s: scorePathMatch(path, query) }))
      .filter(x => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 50)
      .map(x => x.path)
  );

  $effect(() => {
    selectedIdx = 0;
  });

  function commit(path: string) {
    onOpen(path);
    onClose();
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); selectedIdx = Math.min(selectedIdx + 1, results.length - 1); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); selectedIdx = Math.max(selectedIdx - 1, 0); return; }
    if (e.key === 'Enter' && results[selectedIdx]) { commit(results[selectedIdx]); return; }
  }

  onMount(() => inputEl?.focus());

</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onclick={onClose} onkeydown={handleKey}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="panel" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
    <div class="search-row">
      <Icon name="search" size={14}/>
      <input
        bind:this={inputEl}
        bind:value={query}
        placeholder="Go to file…"
        class="search-input"
        onkeydown={handleKey}
        autocomplete="off"
        spellcheck="false"
      />
      <kbd class="esc-hint">esc</kbd>
    </div>

    {#if results.length > 0}
      <ul class="results-list" role="listbox">
        {#each results as path, i}
          <li
            class="result-item {i === selectedIdx ? 'selected' : ''}"
            role="option"
            aria-selected={i === selectedIdx}
            onclick={() => commit(path)}
            onmousemove={() => { selectedIdx = i; }}
            onkeydown={(e) => e.key === 'Enter' && commit(path)}
          >
            <Icon name="file" size={12}/>
            <span class="result-name">{basename(path)}</span>
            <span class="result-dir">{parentPathOf(path)}</span>
          </li>
        {/each}
      </ul>
    {:else if query}
      <div class="no-results">No files match "{query}"</div>
    {/if}
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: rgba(0,0,0,0.45);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 80px;
  }

  .panel {
    width: 540px;
    max-width: 90vw;
    background: var(--bg-2);
    border: 1px solid var(--stroke-1, var(--stroke-0));
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 24px 64px rgba(0,0,0,0.5);
  }

  .search-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--stroke-0);
    color: var(--fg-3);
  }

  .search-input {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    font-size: 14px;
    font-family: var(--font-ui);
    color: var(--fg-0);
  }
  .search-input::placeholder { color: var(--fg-4, var(--fg-3)); }

  .esc-hint {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--fg-3);
    background: var(--bg-4);
    border: 1px solid var(--stroke-0);
    border-radius: 3px;
    padding: 1px 5px;
    flex-shrink: 0;
  }

  .results-list {
    list-style: none;
    margin: 0;
    padding: 4px 0;
    max-height: 360px;
    overflow-y: auto;
    scrollbar-width: thin;
  }

  .result-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 14px;
    cursor: pointer;
    color: var(--fg-2);
    font-size: 13px;
    font-family: var(--font-ui);
  }
  .result-item:hover,
  .result-item.selected { background: var(--accent-weak, var(--bg-4)); color: var(--fg-0); }

  .result-name { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .result-dir { color: var(--fg-3); font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; }

  .no-results {
    padding: 20px 14px;
    color: var(--fg-3);
    font-size: 13px;
    text-align: center;
  }
</style>
