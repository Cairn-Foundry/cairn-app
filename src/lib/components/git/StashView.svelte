<script lang="ts">
  import { createEventDispatcher, tick } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import { t } from '$lib/i18n';
  import {
    git,
    pushStash,
    popStash,
    applyStash,
    dropStash,
    clearStashes,
    renameStash,
  } from '$lib/stores/git';
  import type { GitStash } from '$lib/services/git-service';

  export let selectedStashIndex: number | null = null;

  const dispatch = createEventDispatcher<{ selectStash: GitStash | null }>();

  let searchQuery = '';
  let loadingIndex: number | null = null;

  // --- New stash modal ---
  let newStashOpen = false;
  let newStashMessage = '';
  let newStashIncludeUntracked = true;
  let newStashKeepIndex = false;
  let isSaving = false;
  let newStashMsgInput: HTMLInputElement;

  // --- Edit modal ---
  let editOpen = false;
  let editTarget: GitStash | null = null;
  let editMessage = '';
  let isEditing = false;
  let editInput: HTMLInputElement;

  // --- Delete modal ---
  let deleteOpen = false;
  let deleteTarget: GitStash | null = null; // null = clear all
  let isDeleting = false;

  $: stashes = $git.stashes;
  $: filtered = searchQuery.trim()
    ? stashes.filter(s =>
        s.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.branch.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : stashes;

  function selectStash(stash: GitStash) {
    dispatch('selectStash', stash);
  }

  // New stash modal
  async function openNewStash() {
    newStashMessage = '';
    newStashIncludeUntracked = true;
    newStashKeepIndex = false;
    newStashOpen = true;
    await tick();
    newStashMsgInput?.focus();
  }

  function closeNewStash() {
    newStashOpen = false;
  }

  async function handlePush() {
    isSaving = true;
    try {
      await pushStash(newStashMessage, newStashIncludeUntracked, newStashKeepIndex);
      newStashOpen = false;
      dispatch('selectStash', null);
    } finally {
      isSaving = false;
    }
  }

  // Edit modal
  async function openEdit(stash: GitStash) {
    editTarget = stash;
    editMessage = stash.message || stash.name;
    editOpen = true;
    await tick();
    editInput?.focus();
    editInput?.select();
  }

  function closeEdit() {
    editOpen = false;
    editTarget = null;
  }

  async function handleRename() {
    if (!editTarget || !editMessage.trim()) return;
    isEditing = true;
    try {
      await renameStash(editTarget.index, editMessage.trim());
      editOpen = false;
      editTarget = null;
      dispatch('selectStash', null);
    } finally {
      isEditing = false;
    }
  }

  // Delete modal
  function openDeleteStash(stash: GitStash) {
    deleteTarget = stash;
    deleteOpen = true;
  }

  function openClearAll() {
    deleteTarget = null;
    deleteOpen = true;
  }

  function closeDelete() {
    deleteOpen = false;
    deleteTarget = null;
  }

  async function handleDelete() {
    isDeleting = true;
    try {
      if (deleteTarget) {
        const idx = deleteTarget.index;
        await dropStash(idx);
        if (selectedStashIndex === idx) dispatch('selectStash', null);
      } else {
        await clearStashes();
        dispatch('selectStash', null);
      }
      deleteOpen = false;
      deleteTarget = null;
    } finally {
      isDeleting = false;
    }
  }

  // Apply / pop
  async function handleApply(stash: GitStash) {
    loadingIndex = stash.index;
    try {
      await applyStash(stash.index);
    } finally {
      loadingIndex = null;
    }
  }

  async function handlePop(stash: GitStash) {
    loadingIndex = stash.index;
    try {
      await popStash(stash.index);
      if (selectedStashIndex === stash.index) dispatch('selectStash', null);
    } finally {
      loadingIndex = null;
    }
  }

  function relativeTime(dateStr: string): string {
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    const d = Math.floor(h / 24);
    return d < 30 ? `${d}d` : new Date(dateStr).toLocaleDateString();
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (newStashOpen) closeNewStash();
      else if (editOpen) closeEdit();
      else if (deleteOpen) closeDelete();
    }
  }
</script>

<svelte:window on:keydown={newStashOpen || editOpen || deleteOpen ? handleKey : undefined}/>

<!-- Toolbar -->
<div class="stash-toolbar">
  <div class="stash-search">
    <Icon name="search" size={11}/>
    <input
      class="stash-search-input"
      bind:value={searchQuery}
      placeholder={t('git.stashSearchPlaceholder') as string}
    />
    {#if searchQuery}
      <button class="stash-search-clear" on:click={() => searchQuery = ''}>×</button>
    {/if}
  </div>
  {#if stashes.length > 0}
    <button
      class="btn ghost stash-clear-btn"
      title={t('git.stashClear') as string}
      on:click={openClearAll}
    >
      <Icon name="trash" size={12}/>
    </button>
  {/if}
  <button class="btn primary stash-new-btn" on:click={openNewStash}>
    <Icon name="plus" size={12}/>
    {t('git.stashNew')}
  </button>
</div>

<!-- Stash list -->
<div class="stash-list">
  {#if stashes.length === 0}
    <div class="stash-empty">{t('git.stashEmpty')}</div>
  {:else if filtered.length === 0}
    <div class="stash-empty">{t('git.stashNoResults')}</div>
  {:else}
    {#each filtered as stash (stash.index)}
      <div
        class="stash-item"
        class:is-selected={selectedStashIndex === stash.index}
        role="button"
        tabindex="0"
        on:click={() => selectStash(stash)}
        on:keydown={(e) => e.key === 'Enter' && selectStash(stash)}
      >
        <div class="stash-item-main">
          <span class="stash-index">{stash.index}</span>
          <div class="stash-info">
            <span class="stash-message">{stash.message || stash.name}</span>
            {#if stash.branch}
              <span class="stash-branch">
                <Icon name="branch" size={9}/>
                {stash.branch}
              </span>
            {/if}
          </div>
          <span class="stash-date">{relativeTime(stash.date)}</span>
        </div>
        <div class="stash-item-actions">
          {#if loadingIndex === stash.index}
            <Spinner size={11} trackColor="var(--bg-3)" color="var(--fg-3)"/>
          {:else}
            <button
              class="stash-action-btn"
              title={t('git.stashApplyTitle') as string}
              on:click|stopPropagation={() => handleApply(stash)}
            >
              {t('git.stashApply')}
            </button>
            <button
              class="stash-action-btn stash-pop-btn"
              title={t('git.stashPopTitle') as string}
              on:click|stopPropagation={() => handlePop(stash)}
            >
              {t('git.stashPop')}
            </button>
            <button
              class="stash-action-btn icon-only"
              title={t('git.stashEditTitle') as string}
              on:click|stopPropagation={() => openEdit(stash)}
            >
              <Icon name="edit" size={11}/>
            </button>
            <button
              class="stash-action-btn icon-only danger"
              title={t('git.stashDrop') as string}
              on:click|stopPropagation={() => openDeleteStash(stash)}
            >
              <Icon name="trash" size={11}/>
            </button>
          {/if}
        </div>
      </div>
    {/each}
  {/if}
</div>

<!-- New stash modal -->
{#if newStashOpen}
  <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
  <div
    class="modal-backdrop"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    on:click={closeNewStash}
    on:keydown={(e) => e.key === 'Escape' && closeNewStash()}
  >
    <div class="modal stash-modal" on:click|stopPropagation role="presentation">
      <div class="modal-head">
        <div>
          <div class="step-count">GIT</div>
          <h3>{t('git.stashNew')}</h3>
        </div>
        <button class="icon-btn close" on:click={closeNewStash}>
          <Icon name="x" size={16}/>
        </button>
      </div>
      <div class="modal-body">
        <div class="stash-field">
          <label class="stash-field-label" for="stash-msg">{t('git.stashMessageLabel')}</label>
          <input
            id="stash-msg"
            class="stash-modal-input"
            bind:this={newStashMsgInput}
            bind:value={newStashMessage}
            placeholder={t('git.stashMessagePlaceholder') as string}
            on:keydown={(e) => e.key === 'Enter' && !isSaving && handlePush()}
          />
        </div>
        <div class="stash-options">
          <label class="stash-option">
            <div class="stash-option-text">
              <span class="stash-option-label">{t('git.stashIncludeUntracked')}</span>
              <span class="stash-option-desc">{t('git.stashIncludeUntrackedDesc')}</span>
            </div>
            <label class="toggle">
              <input type="checkbox" bind:checked={newStashIncludeUntracked}/>
              <span class="toggle-track"><span class="toggle-thumb"></span></span>
            </label>
          </label>
          <label class="stash-option">
            <div class="stash-option-text">
              <span class="stash-option-label">{t('git.stashKeepIndex')}</span>
              <span class="stash-option-desc">{t('git.stashKeepIndexDesc')}</span>
            </div>
            <label class="toggle">
              <input type="checkbox" bind:checked={newStashKeepIndex}/>
              <span class="toggle-track"><span class="toggle-thumb"></span></span>
            </label>
          </label>
        </div>
      </div>
      <div class="modal-foot">
        <div class="spacer"></div>
        <button class="btn ghost" on:click={closeNewStash}>{t('common.cancel')}</button>
        <button class="btn primary" disabled={isSaving} on:click={handlePush}>
          {#if isSaving}<Spinner size={12} trackColor="oklch(1 0 0 / .3)" color="white"/>{/if}
          {t('git.stashPush')}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Edit stash modal -->
{#if editOpen && editTarget}
  <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
  <div
    class="modal-backdrop"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    on:click={closeEdit}
    on:keydown={(e) => e.key === 'Escape' && closeEdit()}
  >
    <div class="modal stash-modal" on:click|stopPropagation role="presentation">
      <div class="modal-head">
        <div>
          <div class="step-count">{editTarget.name}</div>
          <h3>{t('git.stashEditTitle')}</h3>
        </div>
        <button class="icon-btn close" on:click={closeEdit}>
          <Icon name="x" size={16}/>
        </button>
      </div>
      <div class="modal-body">
        <div class="stash-field">
          <label class="stash-field-label" for="edit-msg">{t('git.stashMessageLabel')}</label>
          <input
            id="edit-msg"
            class="stash-modal-input"
            bind:this={editInput}
            bind:value={editMessage}
            placeholder={t('git.stashMessagePlaceholder') as string}
            on:keydown={(e) => e.key === 'Enter' && !isEditing && handleRename()}
          />
        </div>
      </div>
      <div class="modal-foot">
        <div class="spacer"></div>
        <button class="btn ghost" on:click={closeEdit}>{t('common.cancel')}</button>
        <button class="btn primary" disabled={isEditing || !editMessage.trim()} on:click={handleRename}>
          {#if isEditing}<Spinner size={12} trackColor="oklch(1 0 0 / .3)" color="white"/>{/if}
          {t('common.save')}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Delete confirm modal -->
{#if deleteOpen}
  <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
  <div
    class="modal-backdrop"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    on:click={closeDelete}
    on:keydown={(e) => e.key === 'Escape' && closeDelete()}
  >
    <div class="modal confirm-modal" on:click|stopPropagation role="presentation">
      <div class="modal-head">
        <div>
          <div class="step-count">GIT STASH</div>
          <h3>{deleteTarget ? t('git.stashDrop') : t('git.stashClear')}</h3>
        </div>
        <button class="icon-btn close" on:click={closeDelete}>
          <Icon name="x" size={16}/>
        </button>
      </div>
      <div class="modal-body">
        <p class="confirm-body">
          {deleteTarget
            ? (t('git.stashDropConfirm') as (name: string) => string)(deleteTarget.message || deleteTarget.name)
            : t('git.stashClearConfirm')}
        </p>
      </div>
      <div class="modal-foot">
        <div class="spacer"></div>
        <button class="btn ghost" on:click={closeDelete}>{t('common.cancel')}</button>
        <button class="btn danger" disabled={isDeleting} on:click={handleDelete}>
          {#if isDeleting}<Spinner size={12} trackColor="oklch(1 0 0 / .3)" color="var(--danger)"/>{/if}
          <Icon name="trash" size={13}/>
          {t('common.delete')}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  /* Toolbar */
  .stash-toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--stroke-0);
    flex-shrink: 0;
  }

  .stash-search {
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
  .stash-search:focus-within {
    border-color: var(--accent);
    color: var(--fg-2);
  }
  .stash-search-input {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    font-size: 11px;
    color: var(--fg-0);
    font-family: var(--font-ui);
    min-width: 0;
  }
  .stash-search-input::placeholder { color: var(--fg-4); }
  .stash-search-clear {
    background: none;
    border: none;
    padding: 0 2px;
    font-size: 13px;
    line-height: 1;
    color: var(--fg-4);
    cursor: pointer;
  }
  .stash-search-clear:hover { color: var(--fg-1); }

  .stash-clear-btn {
    flex-shrink: 0;
    padding: 4px 6px;
    color: var(--fg-3);
  }
  .stash-clear-btn:hover {
    color: var(--danger);
    background: var(--danger-weak);
  }

  .stash-new-btn {
    flex-shrink: 0;
    font-size: 11px;
    padding: 4px 10px;
    white-space: nowrap;
  }

  /* Stash list */
  .stash-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }

  .stash-empty {
    padding: 24px 16px;
    font-size: 12px;
    color: var(--fg-4);
    text-align: center;
  }

  /* Stash item */
  .stash-item {
    display: flex;
    flex-direction: column;
    padding: 8px 12px;
    border-bottom: 1px solid var(--stroke-0);
    cursor: pointer;
    transition: background .1s;
    gap: 5px;
  }
  .stash-item:hover { background: var(--bg-1); }
  .stash-item.is-selected { background: var(--bg-2); }

  .stash-item-main {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .stash-index {
    font-size: 10px;
    font-family: var(--font-mono);
    font-weight: 600;
    color: var(--fg-4);
    background: var(--bg-3);
    border-radius: 4px;
    padding: 1px 5px;
    flex-shrink: 0;
    min-width: 18px;
    text-align: center;
  }
  .stash-item.is-selected .stash-index {
    background: var(--accent-weak);
    color: var(--accent);
  }

  .stash-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .stash-message {
    font-size: 12px;
    color: var(--fg-0);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .stash-branch {
    display: flex;
    align-items: center;
    gap: 3px;
    font-size: 10px;
    color: var(--fg-3);
  }

  .stash-date {
    font-size: 10px;
    color: var(--fg-4);
    flex-shrink: 0;
    white-space: nowrap;
  }

  /* Actions row - hidden until hover/selection */
  .stash-item-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    justify-content: flex-end;
    opacity: 0;
    transition: opacity .1s;
    height: 22px;
  }
  .stash-item:hover .stash-item-actions,
  .stash-item.is-selected .stash-item-actions {
    opacity: 1;
  }

  .stash-action-btn {
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
    transition: all .1s;
    white-space: nowrap;
  }
  .stash-action-btn:hover {
    background: var(--bg-4);
    color: var(--fg-0);
    border-color: var(--stroke-1);
  }
  .stash-action-btn.icon-only {
    padding: 2px 5px;
  }
  .stash-pop-btn {
    color: var(--accent);
    border-color: var(--accent-line);
    background: var(--accent-weak);
  }
  .stash-pop-btn:hover {
    background: var(--accent);
    color: white;
    border-color: transparent;
  }
  .stash-action-btn.danger {
    color: var(--fg-3);
  }
  .stash-action-btn.danger:hover {
    color: var(--danger);
    background: var(--danger-weak);
    border-color: transparent;
  }

  /* Modal shared */
  .stash-modal { width: min(420px, 92vw); }

  .confirm-body {
    font-size: 13px;
    color: var(--fg-1);
    line-height: 1.6;
    margin: 0;
  }

  /* Modal form */
  .stash-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 20px;
  }
  .stash-field-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--fg-2);
  }
  .stash-modal-input {
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
  .stash-modal-input:focus { border-color: var(--accent); }
  .stash-modal-input::placeholder { color: var(--fg-4); }

  .stash-options {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .stash-option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 0;
    border-top: 1px solid var(--stroke-0);
    cursor: pointer;
    gap: 12px;
  }
  .stash-option-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .stash-option-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--fg-1);
  }
  .stash-option-desc {
    font-size: 11px;
    color: var(--fg-3);
  }

  /* Toggle */
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

  /* Icon button */
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
</style>
