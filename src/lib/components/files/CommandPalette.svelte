<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { ShortcutId, ShortcutBinding, ShortcutDef } from '$lib/types/shortcuts';
  import { matchesSearch } from '$lib/utils/files/files-search';
  import { bindingToLabels, SHORTCUT_GROUP_LABELS } from '$lib/stores/shortcuts';

  export let shortcuts: Record<ShortcutId, ShortcutBinding>;
  export let shortcutDefs: ShortcutDef[];
  export let onClose: () => void;
  export let onAction: (id: ShortcutId) => void;

  let query = '';
  let selectedIdx = 0;
  let inputEl: HTMLInputElement;
  let listEl: HTMLUListElement;

  $: filtered = query.trim()
    ? shortcutDefs.filter(d => matchesSearch(d.label, query) || matchesSearch(d.description, query))
    : shortcutDefs;

  $: { query; selectedIdx = 0; }

  function commit(def: ShortcutDef) {
    onAction(def.id);
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIdx = Math.min(selectedIdx + 1, filtered.length - 1);
      scrollToSelected();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIdx = Math.max(selectedIdx - 1, 0);
      scrollToSelected();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const def = filtered[selectedIdx];
      if (def) commit(def);
    }
  }

  function scrollToSelected() {
    const items = listEl?.querySelectorAll<HTMLLIElement>('li[data-idx]');
    items?.[selectedIdx]?.scrollIntoView({ block: 'nearest' });
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  onMount(() => { inputEl?.focus(); });

  function globalKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  }
  window.addEventListener('keydown', globalKeydown, true);
  onDestroy(() => window.removeEventListener('keydown', globalKeydown, true));

</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="cp-backdrop" on:mousedown={handleBackdropClick}>
  <div class="cp-modal" role="dialog" aria-label="Command Palette">
    <input
      bind:this={inputEl}
      bind:value={query}
      class="cp-input"
      placeholder="Type a command…"
      on:keydown={handleKey}
      autocomplete="off"
      spellcheck={false}
    />
    <ul class="cp-list" bind:this={listEl}>
      {#each filtered as def, i}
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <li
          class="cp-item {i === selectedIdx ? 'cp-item-selected' : ''}"
          data-idx={i}
          on:mouseenter={() => { selectedIdx = i; }}
          on:mousedown|preventDefault={() => commit(def)}
        >
          <div class="cp-item-main">
            <span class="cp-item-label">{def.label}</span>
            <span class="cp-item-group">{SHORTCUT_GROUP_LABELS[def.group] ?? def.group}</span>
          </div>
          <div class="cp-item-meta">
            <span class="cp-item-desc">{def.description}</span>
            {#if shortcuts[def.id]}
              <span class="cp-item-keys">
                {#each bindingToLabels(shortcuts[def.id]) as key}
                  <kbd class="cp-kbd">{key}</kbd>
                {/each}
              </span>
            {/if}
          </div>
        </li>
      {/each}
      {#if filtered.length === 0}
        <li class="cp-empty">No commands match "{query}"</li>
      {/if}
    </ul>
  </div>
</div>

<style>
  .cp-backdrop {
    position: fixed;
    inset: 0;
    z-index: 9999;
    background: oklch(0 0 0 / 0.5);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 10vh;
  }

  .cp-modal {
    width: 560px;
    max-width: calc(100vw - 32px);
    background: var(--bg-1);
    border: 1px solid var(--stroke-1);
    border-radius: 10px;
    box-shadow: 0 24px 64px oklch(0 0 0 / 0.6);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .cp-input {
    width: 100%;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--stroke-0);
    padding: 14px 16px;
    font-size: 14px;
    font-family: var(--font-ui);
    color: var(--text-0);
    outline: none;
    box-sizing: border-box;
  }

  .cp-input::placeholder { color: var(--text-2); }

  .cp-list {
    list-style: none;
    margin: 0;
    padding: 4px 0;
    max-height: 420px;
    overflow-y: auto;
  }

  .cp-item {
    padding: 7px 14px;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .cp-item-selected { background: var(--accent-muted, oklch(0.72 0.14 250 / 0.14)); }

  .cp-item-main {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .cp-item-label {
    font-size: 13px;
    font-family: var(--font-ui);
    color: var(--text-0);
    flex: 1;
  }

  .cp-item-group {
    font-size: 10.5px;
    font-family: var(--font-ui);
    color: var(--text-2);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    background: var(--bg-2);
    padding: 1px 6px;
    border-radius: 3px;
  }

  .cp-item-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .cp-item-desc {
    font-size: 11.5px;
    font-family: var(--font-ui);
    color: var(--text-2);
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .cp-item-keys {
    display: flex;
    gap: 2px;
    flex-shrink: 0;
  }

  .cp-kbd {
    display: inline-block;
    padding: 1px 5px;
    background: var(--bg-2);
    border: 1px solid var(--stroke-1);
    border-radius: 3px;
    font-size: 10.5px;
    font-family: var(--font-ui);
    color: var(--text-1);
  }

  .cp-empty {
    padding: 16px;
    font-size: 13px;
    font-family: var(--font-ui);
    color: var(--text-2);
    text-align: center;
  }
</style>
