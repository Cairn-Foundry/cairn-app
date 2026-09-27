<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts" context="module">
  export type BranchRequest = { action: 'rename' | 'delete'; branch: string };
</script>

<script lang="ts">
  /**
   * Branches and remotes of the repository, with the actions that change them:
   * renaming and deleting a branch, locally and on a remote as two separate
   * choices, and adding, editing and removing remotes. A branch an instance
   * works on is left alone - renaming or deleting it would pull the ground
   * from under that instance.
   */
  import { createEventDispatcher, onMount, tick } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import CopyButton from '$lib/components/CopyButton.svelte';
  import { t } from '$lib/i18n';
  import {
    git,
    loadBranches,
    deleteBranch,
    deleteRemoteBranch,
    renameBranch,
    refreshRemotes,
    editRemote,
  } from '$lib/stores/git';
  import { activeInstance, instances } from '$lib/stores/instance';
  import { toGitError } from '$lib/services/git-service';
  import type { GitRemote } from '$lib/services/git-service';
  import type { Instance } from '$lib/types/instance';
  import { errorMessage } from '$lib/utils/error-message';

  /** An action asked for from elsewhere (a graph chip); opened once, then handed back. */
  export let request: BranchRequest | null = null;

  const dispatch = createEventDispatcher<{ requestHandled: void }>();

  let searchQuery = '';

  $: worktreePath = $activeInstance?.worktreePath ?? '';
  $: projectInstances = $activeInstance
    ? $instances.filter(i => i.projectId === $activeInstance?.projectId)
    : [];
  $: branchOwner = new Map<string, Instance>(projectInstances.map(i => [i.branch, i]));
  $: currentBranch = $git.currentBranch;
  $: remotes = $git.remotes;
  $: query = searchQuery.trim().toLowerCase();
  $: localBranches = $git.branches.filter(b => !query || b.toLowerCase().includes(query));
  $: remoteBranches = $git.remoteBranches.filter(b => !query || b.toLowerCase().includes(query));

  onMount(() => {
    if (worktreePath) void loadBranches(worktreePath, { fetch: false });
    void refreshRemotes();
  });

  $: if (request) openRequest(request);

  function openRequest(req: BranchRequest) {
    if (req.action === 'rename') void openRename(req.branch);
    else openDelete(req.branch);
    dispatch('requestHandled');
  }

  /** Splits `origin/feature/x` on the remote it belongs to; remote names may hold a slash too. */
  function splitRemoteBranch(ref: string): { remote: string; branch: string } {
    const known = remotes
      .map(r => r.name)
      .filter(name => ref.startsWith(`${name}/`))
      .sort((a, b) => b.length - a.length)[0];
    const remote = known ?? ref.slice(0, Math.max(ref.indexOf('/'), 0));
    return { remote, branch: ref.slice(remote.length + 1) };
  }

  /** Why a local branch cannot be renamed or deleted from here, if it cannot. */
  function lockReason(branch: string): string | null {
    const owner = branchOwner.get(branch);
    if (owner) return (t('git.branchList.usedByInstance') as (id: string) => string)(owner.ticket.id);
    if (branch === currentBranch) return t('git.branchList.isCurrent') as string;
    return null;
  }

  // --- Rename ---
  let renameFrom: string | null = null;
  let renameTo = '';
  let renameError = '';
  let isRenaming = false;
  let renameInput: HTMLInputElement;

  async function openRename(branch: string) {
    renameFrom = branch;
    renameTo = branch;
    renameError = lockReason(branch) ?? '';
    await tick();
    renameInput?.select();
  }

  async function confirmRename() {
    if (!renameFrom || isRenaming || lockReason(renameFrom)) return;
    const to = renameTo.trim();
    if (!to || to === renameFrom) return;
    isRenaming = true;
    renameError = '';
    try {
      await renameBranch(renameFrom, to);
      renameFrom = null;
    } catch (e) {
      renameError = errorMessage(e);
    } finally {
      isRenaming = false;
    }
  }

  // --- Delete ---
  let deleteName: string | null = null;
  let hasLocal = false;
  let deleteLocal = false;
  let deleteForce = false;
  let remotesHolding: string[] = [];
  let deleteOnRemotes: string[] = [];
  let deleteError = '';
  let isNotMerged = false;
  let isDeleting = false;

  /** `name` is a local branch name, or a remote ref like `origin/x` for a remote-only branch. */
  function openDelete(name: string) {
    const isRemoteRef = !$git.branches.includes(name) && $git.remoteBranches.includes(name);
    const branch = isRemoteRef ? splitRemoteBranch(name).branch : name;
    deleteName = branch;
    hasLocal = $git.branches.includes(branch);
    deleteLocal = hasLocal;
    deleteForce = false;
    remotesHolding = $git.remoteBranches
      .map(splitRemoteBranch)
      .filter(r => r.branch === branch)
      .map(r => r.remote);
    deleteOnRemotes = isRemoteRef ? [splitRemoteBranch(name).remote] : [];
    deleteError = hasLocal ? (lockReason(branch) ?? '') : '';
    isNotMerged = false;
  }

  function toggleRemote(remote: string, on: boolean) {
    deleteOnRemotes = on
      ? [...deleteOnRemotes, remote]
      : deleteOnRemotes.filter(r => r !== remote);
  }

  $: deleteBlocked = !!deleteName && deleteLocal && !!lockReason(deleteName);
  $: canDelete = !!deleteName && !deleteBlocked && (deleteLocal || deleteOnRemotes.length > 0);

  async function confirmDelete() {
    if (!deleteName || !canDelete || isDeleting) return;
    const branch = deleteName;
    isDeleting = true;
    deleteError = '';
    isNotMerged = false;
    try {
      if (deleteLocal) {
        await deleteBranch(branch, { force: deleteForce });
        deleteLocal = false;
        hasLocal = false;
      }
      for (const remote of [...deleteOnRemotes]) {
        await deleteRemoteBranch(branch, remote);
        deleteOnRemotes = deleteOnRemotes.filter(r => r !== remote);
        remotesHolding = remotesHolding.filter(r => r !== remote);
      }
      deleteName = null;
    } catch (e) {
      isNotMerged = toGitError(e).code === 'branch_not_merged';
      deleteError = isNotMerged ? t('git.branchList.notMerged') as string : errorMessage(e);
    } finally {
      isDeleting = false;
    }
  }

  // --- Remotes ---
  let remoteForm: { original: GitRemote | null; name: string; url: string } | null = null;
  let remoteError = '';
  let isSavingRemote = false;
  let removeTarget: GitRemote | null = null;
  let isRemovingRemote = false;
  let remoteNameInput: HTMLInputElement;

  async function openRemoteForm(remote: GitRemote | null) {
    remoteForm = { original: remote, name: remote?.name ?? '', url: remote?.fetchUrl ?? '' };
    remoteError = '';
    await tick();
    remoteNameInput?.focus();
  }

  async function saveRemote() {
    if (!remoteForm || isSavingRemote) return;
    const { original } = remoteForm;
    const name = remoteForm.name.trim();
    const url = remoteForm.url.trim();
    if (!name || !url) return;
    isSavingRemote = true;
    remoteError = '';
    try {
      if (!original) {
        await editRemote({ kind: 'add', name, url });
      } else {
        if (name !== original.name) await editRemote({ kind: 'rename', oldName: original.name, newName: name });
        if (url !== original.fetchUrl) await editRemote({ kind: 'set-url', name, url });
      }
      remoteForm = null;
    } catch (e) {
      remoteError = errorMessage(e);
    } finally {
      isSavingRemote = false;
    }
  }

  async function confirmRemoveRemote() {
    if (!removeTarget || isRemovingRemote) return;
    isRemovingRemote = true;
    try {
      await editRemote({ kind: 'remove', name: removeTarget.name });
      removeTarget = null;
    } catch {
      // The failure reaches the error banner through the store.
    } finally {
      isRemovingRemote = false;
    }
  }

  function closeAll() {
    if (isRenaming || isDeleting || isSavingRemote || isRemovingRemote) return;
    renameFrom = null;
    deleteName = null;
    remoteForm = null;
    removeTarget = null;
  }

  $: anyModal = !!renameFrom || !!deleteName || !!remoteForm || !!removeTarget;
</script>

<svelte:window on:keydown={anyModal ? (e) => e.key === 'Escape' && closeAll() : undefined}/>

<div class="br-toolbar">
  <div class="br-search">
    <Icon name="search" size={11}/>
    <input
      class="br-search-input"
      bind:value={searchQuery}
      placeholder={t('git.branchSearchPlaceholder') as string}
    />
    {#if searchQuery}
      <button class="br-search-clear" aria-label={t('common.clearSearch') as string} on:click={() => searchQuery = ''}>
        <Icon name="x" size={10}/>
      </button>
    {/if}
  </div>
</div>

<div class="br-list">
  <div class="br-section-head">
    <span>{t('git.branchList.local')}</span>
    <span class="br-count">{localBranches.length}</span>
  </div>
  {#each localBranches as branch (branch)}
    {@const owner = branchOwner.get(branch)}
    {@const locked = lockReason(branch)}
    <div class="br-item">
      <span class="br-icon" class:is-current={branch === currentBranch}><Icon name="branch" size={10}/></span>
      <span class="br-name selectable">{branch}</span>
      {#if branch === currentBranch}
        <span class="br-badge">{t('git.branchList.current')}</span>
      {/if}
      {#if owner}
        <span class="br-badge">{owner.ticket.id}</span>
      {/if}
      <div class="br-actions">
        <button
          class="br-action-btn icon-only"
          title={locked ?? t('git.branchList.rename') as string}
          aria-label={t('git.branchList.rename') as string}
          disabled={!!locked}
          on:click={() => openRename(branch)}
        >
          <Icon name="edit" size={11}/>
        </button>
        <button
          class="br-action-btn icon-only danger"
          title={t('git.branchList.delete') as string}
          aria-label={t('git.branchList.delete') as string}
          on:click={() => openDelete(branch)}
        >
          <Icon name="trash" size={11}/>
        </button>
      </div>
    </div>
  {:else}
    <div class="br-empty">{t('git.branchList.none')}</div>
  {/each}

  <div class="br-section-head">
    <span>{t('git.branchList.remote')}</span>
    <span class="br-count">{remoteBranches.length}</span>
  </div>
  {#each remoteBranches as ref (ref)}
    <div class="br-item">
      <span class="br-icon"><Icon name="cloud" size={10}/></span>
      <span class="br-name selectable">{ref}</span>
      <div class="br-actions">
        <button
          class="br-action-btn icon-only danger"
          title={t('git.branchList.deleteOnRemote') as string}
          aria-label={t('git.branchList.deleteOnRemote') as string}
          on:click={() => openDelete(ref)}
        >
          <Icon name="trash" size={11}/>
        </button>
      </div>
    </div>
  {:else}
    <div class="br-empty">{t('git.branchList.none')}</div>
  {/each}

  <div class="br-section-head">
    <span>{t('git.remotes.title')}</span>
    <span class="br-count">{remotes.length}</span>
    <button class="br-action-btn br-head-btn" on:click={() => openRemoteForm(null)}>
      <Icon name="plus" size={10}/>
      {t('git.remotes.add')}
    </button>
  </div>
  {#each remotes as remote (remote.name)}
    <div class="br-item">
      <span class="br-icon"><Icon name="globe" size={10}/></span>
      <div class="br-remote-info">
        <span class="br-name selectable">{remote.name}</span>
        <span class="br-url selectable">{remote.fetchUrl}</span>
        {#if remote.pushUrl && remote.pushUrl !== remote.fetchUrl}
          <span class="br-url selectable">{t('git.remotes.push')} {remote.pushUrl}</span>
        {/if}
      </div>
      <CopyButton value={remote.fetchUrl}/>
      <div class="br-actions">
        <button
          class="br-action-btn icon-only"
          title={t('git.remotes.edit') as string}
          aria-label={t('git.remotes.edit') as string}
          on:click={() => openRemoteForm(remote)}
        >
          <Icon name="edit" size={11}/>
        </button>
        <button
          class="br-action-btn icon-only danger"
          title={t('git.remotes.remove') as string}
          aria-label={t('git.remotes.remove') as string}
          on:click={() => (removeTarget = remote)}
        >
          <Icon name="trash" size={11}/>
        </button>
      </div>
    </div>
  {:else}
    <div class="br-empty">{t('git.remotes.none')}</div>
  {/each}
</div>

{#if renameFrom}
  <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
  <div class="modal-backdrop" role="dialog" aria-modal="true" tabindex="-1" on:click={closeAll} on:keydown={() => {}}>
    <div class="modal br-modal" on:click|stopPropagation role="presentation">
      <div class="modal-head">
        <div>
          <div class="step-count">GIT</div>
          <h3>{t('git.branchList.rename')}</h3>
        </div>
        <button class="icon-btn close" on:click={closeAll} aria-label={t('common.close') as string}>
          <Icon name="x" size={16}/>
        </button>
      </div>
      <div class="modal-body">
        <p class="br-confirm">{t('git.branchList.renameFrom')} <strong class="selectable">{renameFrom}</strong></p>
        <input
          class="br-modal-input"
          bind:this={renameInput}
          bind:value={renameTo}
          aria-label={t('git.branchList.newName') as string}
          placeholder={t('git.branchNamePlaceholder') as string}
          on:keydown={(e) => e.key === 'Enter' && confirmRename()}
        />
        <span class="br-hint">{t('git.branchList.renameHint')}</span>
        {#if renameError}<div class="br-error">{renameError}</div>{/if}
      </div>
      <div class="modal-foot">
        <div class="spacer"></div>
        <button class="btn ghost" disabled={isRenaming} on:click={closeAll}>{t('common.cancel')}</button>
        <button
          class="btn primary"
          disabled={isRenaming || !renameTo.trim() || renameTo.trim() === renameFrom || !!lockReason(renameFrom)}
          on:click={confirmRename}
        >
          {#if isRenaming}<Spinner size={11}/>{:else}{t('git.branchList.renameAction')}{/if}
        </button>
      </div>
    </div>
  </div>
{/if}

{#if deleteName}
  <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
  <div class="modal-backdrop" role="dialog" aria-modal="true" tabindex="-1" on:click={closeAll} on:keydown={() => {}}>
    <div class="modal br-modal" on:click|stopPropagation role="presentation">
      <div class="modal-head">
        <div>
          <div class="step-count">GIT</div>
          <h3>{t('git.branchList.delete')}</h3>
        </div>
        <button class="icon-btn close" on:click={closeAll} aria-label={t('common.close') as string}>
          <Icon name="x" size={16}/>
        </button>
      </div>
      <div class="modal-body">
        <p class="br-confirm"><strong class="selectable">{deleteName}</strong></p>
        {#if hasLocal}
          <label class="br-option">
            <span class="br-option-text">
              <span class="br-option-label">{t('git.branchList.deleteLocal')}</span>
              <span class="br-option-desc">{t('git.branchList.deleteLocalDesc')}</span>
            </span>
            <span class="toggle">
              <input type="checkbox" bind:checked={deleteLocal}/>
              <span class="toggle-track"><span class="toggle-thumb"></span></span>
            </span>
          </label>
          {#if deleteLocal}
            <label class="br-option br-option-nested">
              <span class="br-option-text">
                <span class="br-option-label">{t('git.branchList.force')}</span>
                <span class="br-option-desc">{t('git.branchList.forceDesc')}</span>
              </span>
              <span class="toggle">
                <input type="checkbox" bind:checked={deleteForce}/>
                <span class="toggle-track"><span class="toggle-thumb"></span></span>
              </span>
            </label>
          {/if}
        {/if}
        {#each remotesHolding as remote (remote)}
          <label class="br-option">
            <span class="br-option-text">
              <span class="br-option-label">{(t('git.branchList.deleteOn') as (remote: string) => string)(remote)}</span>
              <span class="br-option-desc">{t('git.branchList.deleteOnDesc')}</span>
            </span>
            <span class="toggle">
              <input
                type="checkbox"
                checked={deleteOnRemotes.includes(remote)}
                on:change={(e) => toggleRemote(remote, e.currentTarget.checked)}
              />
              <span class="toggle-track"><span class="toggle-thumb"></span></span>
            </span>
          </label>
        {/each}
        {#if deleteError}<div class="br-error" class:is-hint={isNotMerged}>{deleteError}</div>{/if}
      </div>
      <div class="modal-foot">
        <div class="spacer"></div>
        <button class="btn ghost" disabled={isDeleting} on:click={closeAll}>{t('common.cancel')}</button>
        <button class="btn danger" disabled={isDeleting || !canDelete} on:click={confirmDelete}>
          {#if isDeleting}<Spinner size={11}/>{:else}{t('common.delete')}{/if}
        </button>
      </div>
    </div>
  </div>
{/if}

{#if remoteForm}
  <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
  <div class="modal-backdrop" role="dialog" aria-modal="true" tabindex="-1" on:click={closeAll} on:keydown={() => {}}>
    <div class="modal br-modal" on:click|stopPropagation role="presentation">
      <div class="modal-head">
        <div>
          <div class="step-count">GIT</div>
          <h3>{remoteForm.original ? t('git.remotes.edit') : t('git.remotes.add')}</h3>
        </div>
        <button class="icon-btn close" on:click={closeAll} aria-label={t('common.close') as string}>
          <Icon name="x" size={16}/>
        </button>
      </div>
      <div class="modal-body">
        <div class="br-field">
          <label class="br-field-label" for="remote-name">{t('git.remotes.name')}</label>
          <input
            id="remote-name"
            class="br-modal-input"
            bind:this={remoteNameInput}
            bind:value={remoteForm.name}
            placeholder="upstream"
            on:keydown={(e) => e.key === 'Enter' && saveRemote()}
          />
        </div>
        <div class="br-field">
          <label class="br-field-label" for="remote-url">{t('git.remotes.url')}</label>
          <input
            id="remote-url"
            class="br-modal-input"
            bind:value={remoteForm.url}
            placeholder="git@github.com:owner/repo.git"
            on:keydown={(e) => e.key === 'Enter' && saveRemote()}
          />
        </div>
        {#if remoteError}<div class="br-error">{remoteError}</div>{/if}
      </div>
      <div class="modal-foot">
        <div class="spacer"></div>
        <button class="btn ghost" disabled={isSavingRemote} on:click={closeAll}>{t('common.cancel')}</button>
        <button
          class="btn primary"
          disabled={isSavingRemote || !remoteForm.name.trim() || !remoteForm.url.trim()}
          on:click={saveRemote}
        >
          {#if isSavingRemote}<Spinner size={11}/>{:else}{t('common.save')}{/if}
        </button>
      </div>
    </div>
  </div>
{/if}

{#if removeTarget}
  <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
  <div class="modal-backdrop" role="dialog" aria-modal="true" tabindex="-1" on:click={closeAll} on:keydown={() => {}}>
    <div class="modal br-modal" on:click|stopPropagation role="presentation">
      <div class="modal-head">
        <div>
          <div class="step-count">GIT</div>
          <h3>{t('git.remotes.remove')}</h3>
        </div>
        <button class="icon-btn close" on:click={closeAll} aria-label={t('common.close') as string}>
          <Icon name="x" size={16}/>
        </button>
      </div>
      <div class="modal-body">
        <p class="br-confirm"><strong class="selectable">{removeTarget.name}</strong></p>
        <p class="br-hint">{t('git.remotes.removeConfirm')}</p>
      </div>
      <div class="modal-foot">
        <div class="spacer"></div>
        <button class="btn ghost" disabled={isRemovingRemote} on:click={closeAll}>{t('common.cancel')}</button>
        <button class="btn danger" disabled={isRemovingRemote} on:click={confirmRemoveRemote}>
          {#if isRemovingRemote}<Spinner size={11}/>{:else}{t('git.remotes.remove')}{/if}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .br-toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--stroke-0);
    flex-shrink: 0;
  }
  .br-search {
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
  .br-search:focus-within { border-color: var(--accent); color: var(--fg-2); }
  .br-search-input {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    font-size: 11px;
    color: var(--fg-0);
    font-family: var(--font-ui);
    min-width: 0;
  }
  .br-search-input::placeholder { color: var(--fg-4); }
  .br-search-clear {
    display: inline-flex;
    background: none;
    border: none;
    padding: 0 2px;
    color: var(--fg-4);
    cursor: pointer;
  }
  .br-search-clear:hover { color: var(--fg-1); }

  .br-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }

  .br-section-head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 10px 5px;
    font-size: 10.5px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--fg-3);
    border-bottom: 1px solid var(--stroke-0);
  }
  .br-count { font-weight: 400; color: var(--fg-4); }
  .br-head-btn { margin-left: auto; text-transform: none; letter-spacing: 0; }

  .br-empty {
    padding: 12px 16px;
    font-size: 11.5px;
    color: var(--fg-4);
  }

  .br-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--stroke-0);
    min-width: 0;
  }
  .br-item:hover { background: var(--bg-1); }

  .br-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--fg-4);
    background: var(--bg-3);
    border-radius: 4px;
    padding: 2px 5px;
    flex-shrink: 0;
  }
  .br-icon.is-current { color: var(--accent); }

  .br-name {
    flex: 1;
    min-width: 0;
    font-size: 12px;
    color: var(--fg-0);
    font-family: var(--font-mono);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .br-remote-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .br-url {
    font-size: 10.5px;
    font-family: var(--font-mono);
    color: var(--fg-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .br-badge {
    flex-shrink: 0;
    font-size: 9.5px;
    color: var(--fg-3);
    padding: 0 5px;
    height: 15px;
    display: inline-flex;
    align-items: center;
    border-radius: var(--r-xs);
    outline: 1px solid var(--stroke-1);
    outline-offset: -1px;
  }

  .br-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }
  .br-action-btn {
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
  .br-action-btn:hover:not(:disabled) {
    background: var(--bg-4);
    color: var(--fg-0);
    border-color: var(--stroke-1);
  }
  .br-action-btn:disabled { opacity: 0.4; cursor: default; }
  .br-action-btn.icon-only { padding: 2px 5px; }
  .br-action-btn.danger { color: var(--fg-3); }
  .br-action-btn.danger:hover:not(:disabled) {
    color: var(--danger);
    background: var(--danger-weak);
    border-color: transparent;
  }

  .br-modal { width: min(440px, 92vw); }
  .br-confirm {
    margin: 0 0 12px;
    font-size: 12.5px;
    color: var(--fg-2);
    font-family: var(--font-mono);
  }
  .br-hint {
    display: block;
    margin: 6px 0 0;
    font-size: 11px;
    color: var(--fg-3);
  }
  .br-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 16px;
  }
  .br-field-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--fg-2);
  }
  .br-modal-input {
    background: var(--bg-0);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-sm);
    color: var(--fg-0);
    font-family: var(--font-mono);
    font-size: 12.5px;
    padding: 8px 10px;
    outline: none;
    transition: border-color .12s;
    width: 100%;
    box-sizing: border-box;
  }
  .br-modal-input:focus { border-color: var(--accent); }
  .br-modal-input::placeholder { color: var(--fg-4); }

  .br-option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 0;
    border-top: 1px solid var(--stroke-0);
    cursor: pointer;
    gap: 12px;
  }
  .br-option-nested { padding-left: 16px; }
  .br-option-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .br-option-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--fg-1);
  }
  .br-option-desc {
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

  .br-error {
    margin-top: 10px;
    font-size: 11.5px;
    color: var(--danger, #e5534b);
    white-space: pre-wrap;
  }
  .br-error.is-hint { color: var(--warning); }
</style>
