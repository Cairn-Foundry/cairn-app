<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n';
  import type { FileNode } from '$lib/services/file-service';
  import { flattenTreeFilePaths, scorePathMatch } from '$lib/utils/files/files-search';
  import { basename, parentPathOf } from '$lib/utils/files/files-tree';
  import { quickSearch } from '$lib/services/file-service';
  import { settings } from '$lib/stores/settings';

  interface Props {
    tree: FileNode[];
    worktreePath?: string;
    onOpen: (path: string) => void;
    onClose: () => void;
  }

  let { tree, worktreePath = '', onOpen, onClose }: Props = $props();

  const RESULT_LIMIT = 50;

  let query = $state('');
  let selectedIdx = $state(0);
  let inputEl: HTMLInputElement | undefined;

  let results = $state<string[]>([]);
  let lastIndexKey = '';

  const showGitignored = $derived($settings.quickSearchShowGitignored);

  function toggleGitignored() {
    settings.save({ quickSearchShowGitignored: !showGitignored });
    inputEl?.focus();
  }

  function rankInTree(q: string): string[] {
    return flattenTreeFilePaths(tree)
      .map(path => ({ path, s: scorePathMatch(path, q) }))
      .filter(x => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, RESULT_LIMIT)
      .map(x => x.path);
  }

  $effect(() => {
    const wt = worktreePath;
    const includeIgnored = showGitignored;
    const q = query;

    if (!wt) {
      results = rankInTree(q);
      return;
    }

    const indexKey = `${wt}::${includeIgnored}`;
    const refresh = indexKey !== lastIndexKey;
    lastIndexKey = indexKey;

    let cancelled = false;
    quickSearch(wt, q, includeIgnored, refresh, RESULT_LIMIT)
      .then(r => { if (!cancelled) results = r; })
      .catch(() => { if (!cancelled) results = rankInTree(q); });
    return () => { cancelled = true; };
  });

  $effect(() => {
    void results;
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
        placeholder={t('quickOpen.placeholder') as string}
        class="search-input"
        onkeydown={handleKey}
        autocomplete="off"
        spellcheck="false"
      />
      <button
        class="gitignore-toggle {showGitignored ? 'active' : ''}"
        title={t('quickOpen.toggleGitignored') as string}
        onclick={toggleGitignored}
      >
        <Icon name="eye" size={12}/>
        <span>.gitignore</span>
      </button>
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
      <div class="no-results">{(t('quickOpen.noResults') as (q: string) => string)(query)}</div>
    {/if}
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: oklch(0 0 0 / 0.5);
    backdrop-filter: blur(3px);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 80px;
    animation: fade .15s ease-out;
  }

  @keyframes fade { from { opacity: 0; } to { opacity: 1; } }

  .panel {
    width: 540px;
    max-width: 90vw;
    background: var(--bg-2);
    border: 1px solid var(--stroke-1, var(--stroke-0));
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 24px 64px oklch(0 0 0 / 0.6);
    animation: pop .2s cubic-bezier(.3,1.2,.4,1);
  }

  @keyframes pop { from { transform: translateY(10px) scale(.98); opacity: 0; } to { transform: none; opacity: 1; } }

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

  .gitignore-toggle {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    padding: 3px 7px;
    font-size: 11px;
    font-family: var(--font-ui);
    color: var(--fg-3);
    background: var(--bg-3);
    border: 1px solid var(--stroke-0);
    border-radius: 4px;
    cursor: pointer;
    transition: background .1s, color .1s, border-color .1s;
  }
  .gitignore-toggle:hover {
    color: var(--fg-1);
    border-color: var(--stroke-1);
  }
  .gitignore-toggle.active {
    color: var(--accent);
    background: var(--accent-weak);
    border-color: var(--accent-line);
  }

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
