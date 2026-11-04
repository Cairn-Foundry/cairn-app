<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import Icon from '#lib/components/Icon.svelte';
  import { t } from '#lib/i18n';
  import { projects } from '#lib/stores/project';
  import { projectFolders } from '#lib/stores/project-folders';
  import { matchesSearch } from '#lib/utils/files/files-search';

  const dispatch = createEventDispatcher<{ close: void; pick: string }>();

  let search = '';
  let searchInputEl: HTMLInputElement | null = null;

  $: folderNameByProject = new Map(
    $projectFolders.flatMap((f) => f.projectIds.map((id) => [id, f.name] as const)),
  );
  $: filtered = $projects.filter((p) => matchesSearch(`${p.name} ${p.path}`, search));

  onMount(() => searchInputEl?.focus());
</script>

<svelte:window on:keydown={(e) => e.key === 'Escape' && dispatch('close')} />

<div class="modal-backdrop" on:click={() => dispatch('close')} role="button" tabindex="-1" on:keydown={() => {}}>
  <div class="modal" on:click|stopPropagation role="presentation">
    <div class="modal-head">
      <h3 style="margin: 0">{t('addProject.existingTitle')}</h3>
      <button class="icon-btn close" aria-label={t('common.close') as string} on:click={() => dispatch('close')}><Icon name="x" size={16}/></button>
    </div>
    <div class="modal-body">
      <div class="search-bar">
        <Icon name="search" size={13}/>
        <input class="search-input" bind:value={search} bind:this={searchInputEl}
               placeholder={t('home.projects.filterPlaceholder') as string}
               aria-label={t('home.projects.filterAriaLabel') as string}/>
      </div>
      <div class="project-list">
        {#each filtered as p (p.id)}
          <div class="project-row" role="button" tabindex="0"
               on:click={() => dispatch('pick', p.id)}
               on:keydown={(e) => e.key === 'Enter' && dispatch('pick', p.id)}>
            <span class="swatch" style="background: {p.color}"></span>
            <div class="row-text">
              <div class="row-name">{p.name}</div>
              <div class="row-path">{p.path}</div>
            </div>
            {#if folderNameByProject.get(p.id)}
              <span class="folder-tag"><Icon name="folder" size={11}/>{folderNameByProject.get(p.id)}</span>
            {/if}
          </div>
        {:else}
          <div class="empty-state">{(t('home.projects.emptyFiltered') as (q: string) => string)(search)}</div>
        {/each}
      </div>
    </div>
  </div>
</div>

<style>
  .search-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    margin-bottom: 12px;
    background: var(--bg-0);
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-sm);
    color: var(--fg-3);
  }
  .search-bar:focus-within { border-color: var(--accent-line); color: var(--fg-1); }
  .search-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    font-size: 13px;
    font-family: var(--font-ui);
    color: var(--fg-0);
  }
  .search-input::placeholder { color: var(--fg-4); }
  .project-list { display: flex; flex-direction: column; gap: 2px; max-height: 50vh; overflow-y: auto; }
  .project-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 10px;
    border-radius: var(--r-sm);
    cursor: pointer;
  }
  .project-row:hover, .project-row:focus-visible { background: var(--bg-2); outline: none; }
  .swatch { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
  .row-text { flex: 1; min-width: 0; }
  .row-name { font-size: 13px; color: var(--fg-0); }
  .row-path {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .folder-tag {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    padding: 2px 8px;
    border-radius: 999px;
    border: 1px solid var(--stroke-1);
    font-size: 11px;
    color: var(--fg-2);
  }
  .empty-state { padding: 24px; text-align: center; color: var(--fg-3); font-size: 13px; }
</style>
