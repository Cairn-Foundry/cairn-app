<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * Picks forge members into a chip list: a debounced search against the forge
   * and the chosen actors as removable chips. Used for both the reviewers and
   * the assignees of a merge request.
   */
  import Icon from '$lib/components/Icon.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import { t } from '$lib/i18n';
  import { searchForgeMembers } from '$lib/stores/merge-request';
  import type { Actor } from '$lib/types/integrations';

  export let id: string;
  export let label: string;
  export let placeholder: string;
  export let projectId: string;
  export let selected: Actor[] = [];

  let query = '';
  let results: Actor[] = [];
  let isSearching = false;
  let hasSearched = false;
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleSearch() {
    if (searchTimer) clearTimeout(searchTimer);
    const text = query.trim();
    if (text === '') {
      results = [];
      hasSearched = false;
      return;
    }
    searchTimer = setTimeout(() => void runSearch(text), 250);
  }

  async function runSearch(text: string) {
    isSearching = true;
    try {
      const found = await searchForgeMembers(projectId, text);
      if (query.trim() !== text) return;
      results = found.filter((a) => !selected.some((s) => s.login === a.login));
      hasSearched = true;
    } catch {
      results = [];
      hasSearched = true;
    } finally {
      isSearching = false;
    }
  }

  function add(actor: Actor) {
    selected = [...selected, actor];
    results = results.filter((a) => a.login !== actor.login);
    query = '';
    hasSearched = false;
  }

  function remove(login: string) {
    selected = selected.filter((a) => a.login !== login);
  }
</script>

<div class="form-row">
  <label for={id}>{label}</label>
  {#if selected.length > 0}
    <div class="mr-chips">
      {#each selected as actor (actor.login)}
        <span class="chip active">
          {actor.displayName || actor.login}
          <button type="button" class="chip-x" aria-label={t('common.close') as string} on:click={() => remove(actor.login)}>
            <Icon name="x" size={10}/>
          </button>
        </span>
      {/each}
    </div>
  {/if}
  <div class="mr-search">
    <input {id} type="text" {placeholder} bind:value={query} on:input={scheduleSearch} autocomplete="off"/>
    {#if isSearching}
      <span class="mr-search-spinner"><Spinner size={11} trackColor="var(--bg-3)" color="var(--fg-3)"/></span>
    {/if}
  </div>
  {#if results.length > 0}
    <ul class="mr-results" role="listbox">
      {#each results as actor (actor.login)}
        <li>
          <button type="button" role="option" aria-selected="false" on:click={() => add(actor)}>
            <span class="mr-result-name">{actor.displayName || actor.login}</span>
            <span class="mr-result-login">@{actor.login}</span>
          </button>
        </li>
      {/each}
    </ul>
  {:else if hasSearched && !isSearching}
    <span class="mr-hint">{t('mergeRequest.noMatch')}</span>
  {/if}
</div>

<style>
  .mr-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }

  .chip-x {
    display: inline-grid;
    place-items: center;
    padding: 0;
    margin-left: 2px;
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .mr-search {
    position: relative;
    display: flex;
  }
  .mr-search input { flex: 1; }
  .mr-search-spinner {
    position: absolute;
    right: 10px;
    top: 50%;
    transform: translateY(-50%);
    display: inline-flex;
  }

  .mr-results {
    list-style: none;
    margin: 0;
    padding: 4px;
    max-height: 160px;
    overflow-y: auto;
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-sm);
    background: var(--bg-2);
  }
  .mr-results button {
    display: flex;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--fg-0);
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }
  .mr-results button:hover { background: var(--bg-3); }
  .mr-result-login {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-3);
  }
  .mr-hint {
    font-size: 11.5px;
    color: var(--fg-3);
  }
</style>
