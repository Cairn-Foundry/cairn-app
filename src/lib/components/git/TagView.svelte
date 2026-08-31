<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * Tag list with search and the create / push / delete actions. Deleting is
   * offered locally and on the remote separately: the two are distinct in git,
   * and dropping a tag locally leaves the published one in place.
   */
  import { tick } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import { t } from '$lib/i18n';
  import { git, createTag, deleteTag, pushTag, deleteRemoteTag } from '$lib/stores/git';
  import type { GitTag } from '$lib/services/git-service';
  import { relativeTime } from '$lib/utils/format';

  let searchQuery = '';
  let loadingName: string | null = null;

  // --- New tag modal ---
  let newOpen = false;
  let newName = '';
  let newMessage = '';
  let isSaving = false;
  let newNameInput: HTMLInputElement;
  let createError = '';

  // --- Delete modal ---
  let deleteOpen = false;
  let deleteTarget: GitTag | null = null;
  let deleteOnRemote = false;
  let isDeleting = false;

  $: tags = $git.tags;
  $: filtered = searchQuery.trim()
    ? tags.filter(tag =>
        tag.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        tag.subject.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : tags;

  async function openNew() {
    newName = '';
    newMessage = '';
    createError = '';
    newOpen = true;
    await tick();
    newNameInput?.focus();
  }

  function closeNew() {
    if (isSaving) return;
    newOpen = false;
  }

  async function handleCreate() {
    if (!newName.trim() || isSaving) return;
    isSaving = true;
    createError = '';
    try {
      await createTag(newName.trim(), newMessage.trim());
      newOpen = false;
    } catch (error) {
      createError = error instanceof Error ? error.message : String(error);
    } finally {
      isSaving = false;
    }
  }

  function openDelete(tag: GitTag) {
    deleteTarget = tag;
    deleteOnRemote = false;
    deleteOpen = true;
  }

  function closeDelete() {
    if (isDeleting) return;
    deleteOpen = false;
    deleteTarget = null;
  }

  async function handleDelete() {
    if (!deleteTarget || isDeleting) return;
    const target = deleteTarget;
    isDeleting = true;
    try {
      await deleteTag(target.name);
      if (deleteOnRemote) await deleteRemoteTag(target.name);
      deleteOpen = false;
      deleteTarget = null;
    } finally {
      isDeleting = false;
    }
  }

  async function handlePush(tag: GitTag) {
    loadingName = tag.name;
    try {
      await pushTag(tag.name);
    } finally {
      loadingName = null;
    }
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (newOpen) closeNew();
      if (deleteOpen) closeDelete();
    }
  }
</script>

<svelte:window on:keydown={newOpen || deleteOpen ? handleKey : undefined}/>

<div class="tag-toolbar">
  <div class="tag-search">
    <Icon name="search" size={11}/>
    <input
      class="tag-search-input"
      bind:value={searchQuery}
      placeholder={t('git.tagSearchPlaceholder') as string}
    />
    {#if searchQuery}
      <button class="tag-search-clear" on:click={() => searchQuery = ''}>×</button>
    {/if}
  </div>
  <button class="btn primary tag-new-btn" on:click={openNew}>
    <Icon name="plus" size={12}/>
    {t('git.tagNew')}
  </button>
</div>

<div class="tag-list">
  {#if tags.length === 0}
    <div class="tag-empty">{t('git.tagEmpty')}</div>
  {:else if filtered.length === 0}
    <div class="tag-empty">{t('git.tagNoResults')}</div>
  {:else}
    {#each filtered as tag (tag.name)}
      <div class="tag-item">
        <span class="tag-badge" title={tag.annotated ? t('git.tagAnnotated') as string : t('git.tagLightweight') as string}>
          <Icon name="bookmark" size={9}/>
        </span>
        <div class="tag-info">
          <span class="tag-name selectable">{tag.name}</span>
          {#if tag.subject}
            <span class="tag-subject">{tag.subject}</span>
          {/if}
        </div>
        <span class="tag-hash selectable">{tag.shortHash}</span>
        <span class="tag-date">{relativeTime(tag.date)}</span>
        <div class="tag-item-actions">
          {#if loadingName === tag.name}
            <Spinner size={11} trackColor="var(--bg-3)" color="var(--fg-3)"/>
          {:else}
            <button
              class="tag-action-btn"
              title={t('git.tagPushTitle') as string}
              on:click|stopPropagation={() => handlePush(tag)}
            >
              {t('git.tagPush')}
            </button>
            <button
              class="tag-action-btn icon-only danger"
              title={t('git.tagDelete') as string}
              on:click|stopPropagation={() => openDelete(tag)}
            >
              <Icon name="trash" size={11}/>
            </button>
          {/if}
        </div>
      </div>
    {/each}
  {/if}
</div>

{#if newOpen}
  <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
  <div
    class="modal-backdrop"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    on:click={closeNew}
    on:keydown={(e) => e.key === 'Escape' && closeNew()}
  >
    <div class="modal tag-modal" on:click|stopPropagation role="presentation">
      <div class="modal-head">
        <div>
          <div class="step-count">GIT</div>
          <h3>{t('git.tagNew')}</h3>
        </div>
        <button class="icon-btn close" on:click={closeNew}>
          <Icon name="x" size={16}/>
        </button>
      </div>
      <div class="modal-body">
        <div class="tag-field">
          <label class="tag-field-label" for="tag-name">{t('git.tagNameLabel')}</label>
          <input
            id="tag-name"
            class="tag-modal-input"
            bind:this={newNameInput}
            bind:value={newName}
            placeholder={t('git.tagNamePlaceholder') as string}
            on:keydown={(e) => e.key === 'Enter' && !isSaving && handleCreate()}
          />
        </div>
        <div class="tag-field">
          <label class="tag-field-label" for="tag-msg">{t('git.tagMessageLabel')}</label>
          <input
            id="tag-msg"
            class="tag-modal-input"
            bind:value={newMessage}
            placeholder={t('git.tagMessagePlaceholder') as string}
            on:keydown={(e) => e.key === 'Enter' && !isSaving && handleCreate()}
          />
          <span class="tag-field-hint">{t('git.tagMessageHint')}</span>
        </div>
        {#if createError}
          <div class="tag-error">{createError}</div>
        {/if}
      </div>
      <div class="modal-foot">
        <div class="spacer"></div>
        <button class="btn ghost" on:click={closeNew}>{t('common.cancel')}</button>
        <button class="btn primary" disabled={isSaving || !newName.trim()} on:click={handleCreate}>
          {#if isSaving}<Spinner size={11}/>{:else}{t('git.tagCreate')}{/if}
        </button>
      </div>
    </div>
  </div>
{/if}

{#if deleteOpen && deleteTarget}
  <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
  <div
    class="modal-backdrop"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    on:click={closeDelete}
    on:keydown={(e) => e.key === 'Escape' && closeDelete()}
  >
    <div class="modal tag-modal" on:click|stopPropagation role="presentation">
      <div class="modal-head">
        <div>
          <div class="step-count">GIT</div>
          <h3>{t('git.tagDelete')}</h3>
        </div>
        <button class="icon-btn close" on:click={closeDelete}>
          <Icon name="x" size={16}/>
        </button>
      </div>
      <div class="modal-body">
        <p class="tag-confirm">{t('git.tagDeleteConfirm')} <strong>{deleteTarget.name}</strong></p>
        <label class="tag-option">
          <div class="tag-option-text">
            <span class="tag-option-label">{t('git.tagDeleteRemote')}</span>
            <span class="tag-option-desc">{t('git.tagDeleteRemoteDesc')}</span>
          </div>
          <label class="toggle">
            <input type="checkbox" bind:checked={deleteOnRemote}/>
            <span class="toggle-track"><span class="toggle-thumb"></span></span>
          </label>
        </label>
      </div>
      <div class="modal-foot">
        <div class="spacer"></div>
        <button class="btn ghost" on:click={closeDelete}>{t('common.cancel')}</button>
        <button class="btn danger" disabled={isDeleting} on:click={handleDelete}>
          {#if isDeleting}<Spinner size={11}/>{:else}{t('git.tagDelete')}{/if}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .tag-toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--stroke-0);
    flex-shrink: 0;
  }

  .tag-search {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 5px;
    background: var(--bg-0);
    border: 1px solid var(--stroke-0);
    border-radius: 4px;
    padding: 3px 7px;
    min-width: 0;
    color: var(--fg-4);
  }
  .tag-search:focus-within {
    border-color: var(--accent);
    color: var(--fg-2);
  }
  .tag-search-input {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    font-size: 11px;
    color: var(--fg-0);
    font-family: var(--font-ui);
    min-width: 0;
  }
  .tag-search-input::placeholder { color: var(--fg-4); }
  .tag-search-clear {
    background: none;
    border: none;
    padding: 0 2px;
    font-size: 13px;
    line-height: 1;
    color: var(--fg-4);
    cursor: pointer;
  }
  .tag-search-clear:hover { color: var(--fg-1); }

  .tag-new-btn {
    flex-shrink: 0;
    font-size: 11px;
    padding: 4px 10px;
    white-space: nowrap;
  }

  .tag-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }

  .tag-empty {
    padding: 24px 16px;
    font-size: 12px;
    color: var(--fg-4);
    text-align: center;
  }

  .tag-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--stroke-0);
    min-width: 0;
  }
  .tag-item:hover { background: var(--bg-1); }

  .tag-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--fg-4);
    background: var(--bg-3);
    border-radius: 4px;
    padding: 2px 5px;
    flex-shrink: 0;
  }
  .tag-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .tag-name {
    font-size: 12px;
    color: var(--fg-0);
    font-family: var(--font-mono);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tag-subject {
    font-size: 10px;
    color: var(--fg-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tag-hash {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--fg-3);
    flex-shrink: 0;
  }

  .tag-date {
    font-size: 10px;
    color: var(--fg-4);
    flex-shrink: 0;
    white-space: nowrap;
  }

  .tag-item-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    justify-content: flex-end;
    flex-shrink: 0;
  }

  .tag-action-btn {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 2px 8px;
    font-size: 10px;
    font-family: var(--font-ui);
    font-weight: 500;
    color: var(--fg-2);
    background: var(--bg-3);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-sm);
    cursor: pointer;
    transition: background-color .1s, color .1s, border-color .1s;
    white-space: nowrap;
  }
  .tag-action-btn:hover {
    background: var(--bg-4);
    color: var(--fg-0);
    border-color: var(--stroke-1);
  }
  .tag-action-btn.icon-only { padding: 2px 5px; }
  .tag-action-btn.danger { color: var(--fg-3); }
  .tag-action-btn.danger:hover {
    color: var(--danger);
    background: var(--danger-weak);
    border-color: transparent;
  }

  .tag-modal { width: min(420px, 92vw); }

  .tag-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 20px;
  }
  .tag-field-hint {
    font-size: 11px;
    color: var(--fg-3);
  }
  .tag-field-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--fg-2);
  }
  .tag-modal-input {
    background: var(--bg-0);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-sm);
    color: var(--fg-0);
    font-family: var(--font-ui);
    font-size: 13px;
    padding: 8px 10px;
    outline: none;
    transition: border-color .12s;
    width: 100%;
    box-sizing: border-box;
  }
  .tag-modal-input:focus { border-color: var(--accent); }
  .tag-modal-input::placeholder { color: var(--fg-4); }

  .tag-option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 0;
    border-top: 1px solid var(--stroke-0);
    cursor: pointer;
    gap: 12px;
  }
  .tag-option-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .tag-option-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--fg-1);
  }
  .tag-option-desc {
    font-size: 11px;
    color: var(--fg-3);
  }

  .toggle { display: inline-flex; align-items: center; cursor: pointer; flex-shrink: 0; }
  .toggle input { display: none; }
  .toggle-track {
    width: 30px; height: 16px;
    border-radius: 8px;
    background: var(--bg-3);
    border: 1px solid var(--stroke-0);
    position: relative;
    transition: background .15s, border-color .15s;
  }
  .toggle input:checked ~ .toggle-track {
    background: var(--accent);
    border-color: var(--accent);
  }
  .toggle-thumb {
    position: absolute;
    top: 1px; left: 1px;
    width: 12px; height: 12px;
    border-radius: 50%;
    background: white;
    transition: transform .15s;
  }
  .toggle input:checked ~ .toggle-track .toggle-thumb {
    transform: translateX(14px);
  }

  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px; height: 30px;
    background: none;
    border: none;
    border-radius: var(--r-sm);
    color: var(--fg-3);
    cursor: pointer;
    transition: background .1s, color .1s;
  }
  .icon-btn:hover { background: var(--bg-3); color: var(--fg-1); }

  .tag-confirm {
    margin: 0 0 12px;
    font-size: 12.5px;
    color: var(--fg-2);
  }
  .tag-error {
    margin-top: 10px;
    font-size: 11.5px;
    color: var(--danger, #e5534b);
    white-space: pre-wrap;
  }
</style>
