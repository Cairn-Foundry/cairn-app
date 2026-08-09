<script lang="ts">
  import { createEventDispatcher, tick } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { t, type TranslationKey } from '$lib/i18n';
  import { ICON_GROUPS } from '$lib/utils/icons';
  import { matchesSearch } from '$lib/utils/files/files-search';
  import { clickOutside } from '$lib/utils/click-outside';

  export let value: string;

  const dispatch = createEventDispatcher<{ select: string }>();

  const PANEL_WIDTH = 232;
  const PANEL_MARGIN = 8;

  let open = false;
  let query = '';
  let searchEl: HTMLInputElement | null = null;
  let triggerEl: HTMLButtonElement | null = null;
  let panelEl: HTMLDivElement | null = null;
  let panelStyle = '';

  $: groups = ICON_GROUPS
    .map(g => ({ id: g.id, names: g.names.filter(n => matchesSearch(n, query)) }))
    .filter(g => g.names.length > 0);

  function place() {
    if (!triggerEl) return;
    const rect = triggerEl.getBoundingClientRect();
    const left = Math.max(
      PANEL_MARGIN,
      Math.min(rect.left, window.innerWidth - PANEL_WIDTH - PANEL_MARGIN),
    );
    const below = window.innerHeight - rect.bottom - PANEL_MARGIN;
    const above = rect.top - PANEL_MARGIN;
    const opensUp = below < 220 && above > below;
    const maxHeight = Math.min(320, Math.max(160, opensUp ? above : below));
    const vertical = opensUp
      ? `bottom: ${window.innerHeight - rect.top + 4}px`
      : `top: ${rect.bottom + 4}px`;
    panelStyle = `left: ${left}px; ${vertical}; --panel-max: ${maxHeight}px`;
  }

  async function toggle() {
    open = !open;
    if (!open) return;
    query = '';
    await tick();
    place();
    searchEl?.focus();
  }

  function pick(name: string) {
    dispatch('select', name);
    open = false;
  }

  function onScrollCapture(e: Event) {
    if (!open) return;
    if (panelEl?.contains(e.target as Node)) return;
    open = false;
  }
</script>

<svelte:window on:resize={() => open && place()} on:scroll|capture={onScrollCapture} />

<div class="icon-picker" use:clickOutside={() => open = false}>
  <button type="button" class="icon-trigger" bind:this={triggerEl} on:click={toggle} aria-label={t('commands.iconPicker') as string}>
    {#if value}
      <Icon name={value} size={16}/>
    {:else}
      <span class="icon-none"></span>
    {/if}
    <Icon name="chev-d" size={10}/>
  </button>

  {#if open}
    <div class="icon-panel" bind:this={panelEl} style={panelStyle}>
      <div class="icon-search">
        <Icon name="search" size={11}/>
        <input
          bind:this={searchEl}
          bind:value={query}
          class="icon-search-input"
          placeholder={t('commands.iconSearch') as string}
          autocomplete="off"
          on:keydown={(e) => e.key === 'Escape' && (open = false)}
        />
      </div>
      <div class="icon-scroll">
        {#each groups as group}
          <div class="icon-group-label">{t(`commands.iconGroups.${group.id}` as TranslationKey)}</div>
          <div class="icon-grid">
            {#each group.names as name}
              <button
                type="button"
                class="icon-cell {name === value ? 'active' : ''}"
                title={name}
                aria-label={name}
                on:click={() => pick(name)}
              >
                <Icon name={name} size={16}/>
              </button>
            {/each}
          </div>
        {/each}
        {#if groups.length === 0}
          <p class="icon-empty">{t('commands.iconNoResults')}</p>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .icon-picker { position: relative; }

  .icon-trigger {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 34px;
    box-sizing: border-box;
    padding: 0 10px;
    background: var(--bg-2);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-sm);
    color: var(--fg-1);
    cursor: pointer;
  }
  .icon-trigger:hover { border-color: var(--stroke-1); color: var(--fg-0); }

  .icon-none {
    width: 16px;
    height: 16px;
    border: 1px dashed var(--stroke-1);
    border-radius: var(--r-xs);
  }

  .icon-panel {
    position: fixed;
    z-index: 10000;
    width: 232px;
    display: flex;
    flex-direction: column;
    max-height: var(--panel-max, 320px);
    background: var(--bg-2);
    border: 1px solid var(--stroke-1);
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    overflow: hidden;
  }

  .icon-search {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    padding: 7px 10px;
    border-bottom: 1px solid var(--stroke-0);
    color: var(--fg-4);
  }

  .icon-search-input {
    flex: 1;
    min-width: 0;
    background: none;
    border: none;
    outline: none;
    font-size: 12px;
    font-family: var(--font-ui);
    color: var(--fg-0);
  }
  .icon-search-input::placeholder { color: var(--fg-4); }

  .icon-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 6px;
  }

  .icon-group-label {
    padding: 4px 4px 2px;
    font-size: 10px;
    font-family: var(--font-mono);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--fg-4);
  }

  .icon-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 2px;
    margin-bottom: 4px;
  }

  .icon-cell {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    padding: 0;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--r-xs);
    color: var(--fg-2);
    cursor: pointer;
  }
  .icon-cell:hover { background: var(--bg-4); color: var(--fg-0); }
  .icon-cell.active {
    background: var(--accent-weak);
    border-color: var(--accent);
    color: var(--fg-0);
  }

  .icon-empty {
    margin: 0;
    padding: 10px 4px;
    font-size: 11.5px;
    color: var(--fg-4);
    text-align: center;
  }
</style>
