<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n';
  import type { CustomCommand } from '$lib/services/custom-command-service';
  import type { ShortcutId, ShortcutBinding, ShortcutDef } from '$lib/types/shortcuts';
  import { matchesSearch } from '$lib/utils/files/files-search';
  import { bindingToLabels, SHORTCUT_GROUP_LABELS } from '$lib/stores/shortcuts';

  export let shortcuts: Record<ShortcutId, ShortcutBinding>;
  export let shortcutDefs: ShortcutDef[];
  export let customCommands: CustomCommand[] = [];
  export let onClose: () => void;
  export let onAction: (id: ShortcutId) => void;
  export let onRunCommand: (command: CustomCommand) => void = () => {};

  type Entry =
    | { kind: 'command'; label: string; description: string; command: CustomCommand }
    | { kind: 'shortcut'; label: string; description: string; def: ShortcutDef };

  let query = '';
  let selectedIdx = 0;
  let inputEl: HTMLInputElement;
  let listEl: HTMLUListElement;

  $: entries = [
    ...customCommands.map((command): Entry => ({
      kind: 'command',
      label: command.name,
      description: command.steps.join(' && '),
      command,
    })),
    ...shortcutDefs.map((def): Entry => ({
      kind: 'shortcut',
      label: def.label,
      description: def.description,
      def,
    })),
  ];

  $: filtered = query.trim()
    ? entries.filter(e => matchesSearch(e.label, query) || matchesSearch(e.description, query))
    : entries;

  $: { query; selectedIdx = 0; }

  function commit(entry: Entry) {
    if (entry.kind === 'command') onRunCommand(entry.command);
    else onAction(entry.def.id);
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
      const entry = filtered[selectedIdx];
      if (entry) commit(entry);
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
  <div class="cp-modal" role="dialog" aria-label={t('commandPalette.ariaLabel') as string}>
    <input
      bind:this={inputEl}
      bind:value={query}
      class="cp-input"
      placeholder={t('commandPalette.placeholder') as string}
      on:keydown={handleKey}
      autocomplete="off"
      spellcheck={false}
    />
    <ul class="cp-list" bind:this={listEl}>
      {#each filtered as entry, i}
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <li
          class="cp-item {i === selectedIdx ? 'cp-item-selected' : ''}"
          data-idx={i}
          on:mouseenter={() => { selectedIdx = i; }}
          on:mousedown|preventDefault={() => commit(entry)}
        >
          <div class="cp-item-main">
            {#if entry.kind === 'command'}
              <span class="cp-item-icon"><Icon name={entry.command.icon} size={13}/></span>
            {/if}
            <span class="cp-item-label">{entry.label}</span>
            <span class="cp-item-group">
              {entry.kind === 'command'
                ? t('commands.paletteGroup')
                : SHORTCUT_GROUP_LABELS[entry.def.group] ?? entry.def.group}
            </span>
          </div>
          <div class="cp-item-meta">
            <span class="cp-item-desc">{entry.description}</span>
            {#if entry.kind === 'shortcut' && shortcuts[entry.def.id]}
              <span class="cp-item-keys">
                {#each bindingToLabels(shortcuts[entry.def.id]) as key}
                  <kbd class="cp-kbd">{key}</kbd>
                {/each}
              </span>
            {/if}
          </div>
        </li>
      {/each}
      {#if filtered.length === 0}
        <li class="cp-empty">{(t('commandPalette.noResults') as (q: string) => string)(query)}</li>
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
    backdrop-filter: blur(3px);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 10vh;
    animation: fade .15s ease-out;
  }

  @keyframes fade { from { opacity: 0; } to { opacity: 1; } }

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
    animation: pop .2s cubic-bezier(.3,1.2,.4,1);
  }

  @keyframes pop { from { transform: translateY(10px) scale(.98); opacity: 0; } to { transform: none; opacity: 1; } }

  .cp-input {
    width: 100%;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--stroke-0);
    padding: 14px 16px;
    font-size: 14px;
    font-family: var(--font-ui);
    color: var(--fg-0);
    outline: none;
    box-sizing: border-box;
  }

  .cp-input::placeholder { color: var(--fg-3); }

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

  .cp-item-selected { background: var(--accent-weak); }

  .cp-item-main {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .cp-item-icon {
    display: grid;
    place-items: center;
    color: var(--fg-3);
    flex-shrink: 0;
  }

  .cp-item-label {
    font-size: 13px;
    font-family: var(--font-ui);
    color: var(--fg-2);
    flex: 1;
  }

  .cp-item-selected .cp-item-label { color: var(--fg-0); }

  .cp-item-group {
    font-size: 10.5px;
    font-family: var(--font-ui);
    color: var(--fg-3);
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
    color: var(--fg-3);
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
    color: var(--fg-2);
  }

  .cp-empty {
    padding: 16px;
    font-size: 13px;
    font-family: var(--font-ui);
    color: var(--fg-3);
    text-align: center;
  }
</style>
