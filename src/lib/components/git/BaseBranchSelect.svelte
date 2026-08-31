<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * The one picker for an instance's base branch, shared by the three places
   * that set it: the creation form, the instance manager, and the branch bar of
   * the Git step. It is a button showing the current value that opens a
   * searchable list, so a repository with hundreds of branches stays usable.
   *
   * The component only picks a name. Persisting it - and what that means for the
   * instance - belongs to the caller.
   */
  import { createEventDispatcher, tick } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import { t } from '$lib/i18n';
  import { clickOutside } from '$lib/utils/click-outside';
  import { matchesSearch } from '$lib/utils/files/files-search';

  /** The selected branch; empty means no base, which is a legitimate state. */
  export let value = '';
  export let branches: string[] = [];
  /** Never offered as a base: a branch compared with itself has no diff. */
  export let exclude = '';
  export let placeholder = '';
  /** Shown in place of the value while the caller resolves a suggestion. */
  export let loading = false;
  export let disabled = false;
  /** Renders the trigger as a compact chip, for the Git step's branch bar. */
  export let compact = false;
  /** Warns that the current value cannot produce a diff. */
  export let isUnset = false;
  export let unsetLabel = '';
  const dispatch = createEventDispatcher<{ change: { branch: string } }>();

  /** How many rows render at once; the search narrows past it. */
  const RENDER_MAX = 60;
  const PANEL_MARGIN = 8;

  let isOpen = false;
  let search = '';
  let searchInput: HTMLInputElement | null = null;
  let triggerEl: HTMLButtonElement | null = null;
  let panelEl: HTMLDivElement | null = null;
  let panelStyle = '';

  /**
   * The panel is positioned in fixed coordinates rather than laid out inside the
   * trigger, so it escapes the scroll container of whatever modal holds it -
   * inside one, an absolutely positioned panel is clipped by the modal body.
   * Opens upwards when there is no room below.
   */
  function place() {
    if (!triggerEl) return;
    const rect = triggerEl.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - PANEL_MARGIN;
    const above = rect.top - PANEL_MARGIN;
    const opensUp = below < 200 && above > below;
    const maxHeight = Math.min(320, Math.max(140, opensUp ? above : below));
    const vertical = opensUp
      ? `bottom: ${window.innerHeight - rect.top + 4}px`
      : `top: ${rect.bottom + 4}px`;
    const width = Math.max(rect.width, 260);
    // Never let the panel run off the right edge of the window.
    const left = Math.min(rect.left, window.innerWidth - width - PANEL_MARGIN);
    panelStyle = `left: ${Math.max(PANEL_MARGIN, left)}px; width: ${width}px; ${vertical}; --bbs-max: ${maxHeight}px`;
  }

  /** A scroll outside the panel would leave it detached from its trigger. */
  function onScrollCapture(e: Event) {
    if (!isOpen) return;
    if (panelEl?.contains(e.target as Node)) return;
    isOpen = false;
  }

  $: choices = branches.filter((b) => b !== exclude);
  $: matches = choices.filter((b) => matchesSearch(b, search));
  $: shown = matches.slice(0, RENDER_MAX);
  $: hidden = matches.length - shown.length;

  async function toggle() {
    if (disabled) return;
    isOpen = !isOpen;
    if (!isOpen) return;
    search = '';
    await tick();
    place();
    // The list is long enough that typing is the normal way in.
    searchInput?.focus();
  }

  function choose(branch: string) {
    isOpen = false;
    search = '';
    if (branch === value) return;
    value = branch;
    dispatch('change', { branch });
  }

  /** Clearing is allowed: an instance may legitimately have no base yet. */
  function clear() {
    isOpen = false;
    search = '';
    if (value === '') return;
    value = '';
    dispatch('change', { branch: '' });
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && isOpen) {
      e.stopPropagation();
      isOpen = false;
      return;
    }
    // A single match is what the search was narrowing towards.
    if (e.key === 'Enter' && isOpen && shown.length === 1) {
      e.preventDefault();
      choose(shown[0]);
    }
  }
</script>

<svelte:window on:resize={() => isOpen && place()} on:scroll|capture={onScrollCapture} />

<div class="bbs" class:compact use:clickOutside={() => (isOpen = false)}>
  <button
    type="button"
    class="bbs-trigger"
    class:unset={isUnset}
    bind:this={triggerEl}
    {disabled}
    aria-expanded={isOpen}
    aria-haspopup="listbox"
    on:click={toggle}
    on:keydown={onKeydown}
  >
    {#if loading}
      <Spinner size={compact ? 10 : 12}/>
    {:else}
      <Icon name={isUnset ? 'alert' : 'branch'} size={compact ? 11 : 12}/>
    {/if}
    <span class="bbs-value">
      {value || (isUnset && unsetLabel ? unsetLabel : placeholder || t('git.setBaseBranch'))}
    </span>
    <Icon name="chev-d" size={compact ? 10 : 11}/>
  </button>

  {#if isOpen}
    <div class="bbs-panel" role="listbox" tabindex="-1" bind:this={panelEl} style={panelStyle}>
      <input
        class="bbs-search selectable"
        type="text"
        bind:this={searchInput}
        bind:value={search}
        placeholder={t('git.filterBranches') as string}
        autocomplete="off"
        on:keydown={onKeydown}
      />
      <div class="bbs-list">
        {#if value}
          <button type="button" class="bbs-item clear" on:click={clear}>
            <Icon name="x" size={11}/>
            <span>{t('git.clearBase')}</span>
          </button>
        {/if}
        {#each shown as b (b)}
          <button
            type="button"
            class="bbs-item"
            class:active={b === value}
            role="option"
            aria-selected={b === value}
            on:click={() => choose(b)}
          >
            <Icon name="branch" size={11}/>
            <span>{b}</span>
            {#if b === value}<Icon name="check" size={11}/>{/if}
          </button>
        {/each}
        {#if matches.length === 0}
          <div class="bbs-empty">
            {search
              ? (t('createInstance.noBranchesMatch') as (q: string) => string)(search)
              : t('git.noOtherBranches')}
          </div>
        {/if}
        {#if hidden > 0}
          <div class="bbs-empty">
            {(t('createInstance.branchesHidden') as (n: number) => string)(hidden)}
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .bbs { position: relative; min-width: 0; }

  .bbs-trigger {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 6px 8px;
    border: 1px solid var(--stroke-0);
    border-radius: 4px;
    background: var(--bg-0);
    color: var(--fg-0);
    font-size: 12px;
    cursor: pointer;
    text-align: left;
  }
  .bbs-trigger:hover:not(:disabled) { border-color: var(--stroke-1); }
  .bbs-trigger:disabled { opacity: 0.6; cursor: default; }
  .bbs-value {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
  }

  /* The Git step's branch bar packs its controls as chips. */
  .bbs.compact .bbs-trigger {
    width: auto;
    max-width: 220px;
    height: 22px;
    padding: 0 7px;
    border-radius: 999px;
    border-color: var(--stroke-1);
    background: transparent;
    color: var(--fg-2);
    font-size: 11px;
  }
  .bbs.compact .bbs-trigger:hover:not(:disabled) { background: var(--bg-3); }
  .bbs-trigger.unset { color: oklch(0.82 0.14 60); border-color: oklch(0.82 0.14 60 / 0.5); }

  .bbs-panel {
    position: fixed;
    z-index: 10000;
    display: flex;
    flex-direction: column;
    max-height: var(--bbs-max, 320px);
    padding: 6px;
    border: 1px solid var(--stroke-1);
    border-radius: 6px;
    background: var(--bg-1);
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.35);
  }

  .bbs-search {
    width: 100%;
    margin-bottom: 6px;
    padding: 4px 6px;
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--fg-0);
    background: var(--bg-0);
    border: 1px solid var(--stroke-0);
    border-radius: 4px;
  }

  .bbs-list { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; }
  .bbs-item {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 4px 6px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--fg-1);
    font-size: 11.5px;
    font-family: var(--font-mono);
    cursor: pointer;
    text-align: left;
  }
  .bbs-item span {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bbs-item:hover { background: var(--bg-3); }
  .bbs-item.active { color: var(--fg-0); background: var(--bg-4); }
  .bbs-item.clear { color: var(--fg-3); font-family: inherit; }
  .bbs-empty { padding: 6px; font-size: 11px; color: var(--fg-3); }
</style>
