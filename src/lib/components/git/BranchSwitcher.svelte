<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * Current branch of the active worktree, with a searchable menu to check out
   * another local branch, or to open the branch creation dialog off the current
   * branch, prefilled with what was typed in the search. Surfaced on the base instance, whose branch is the
   * repository's own rather than a worktree the instance owns.
   */
  import CopyButton from '#lib/components/CopyButton.svelte';
  import CreateBranchModal from '#lib/components/git/CreateBranchModal.svelte';
  import BranchInUseModal from '#lib/components/git/BranchInUseModal.svelte';
  import DirtyWorktreeModal from '#lib/components/git/DirtyWorktreeModal.svelte';
  import Icon from '#lib/components/Icon.svelte';
  import Skeleton from '#lib/components/Skeleton.svelte';
  import Spinner from '#lib/components/Spinner.svelte';
  import { t } from '#lib/i18n';
  import { checkoutBranch, clearGitError, git, loadBranches, pushStash } from '#lib/stores/git';
  import { instances } from '#lib/stores/instance';
  import { activateInstance, activeProject } from '#lib/stores/project';
  import { toGitError } from '#lib/services/git-service';
  import type { Instance } from '#lib/types/instance';
  import { clickOutside } from '#lib/utils/click-outside';
  import { worktreeInUsePath } from '#lib/utils/git/git-error';

  let isOpen = false;
  let isSwitching = false;
  let isLoadingBranches = false;
  let inUse: { branch: string; worktreePath: string; instance: Instance | null } | null = null;
  let dirty: string | null = null;
  let isStashing = false;
  let query = '';
  let searchEl: HTMLInputElement | null = null;
  let triggerEl: HTMLButtonElement | null = null;
  let listEl: HTMLDivElement | null = null;
  let menuPos = { top: 0, left: 0 };
  let createRequest: { from: string; name: string } | null = null;

  $: current = $git.currentBranch;
  $: needle = query.trim().toLowerCase();
  $: matches = $git.branches.filter((b) => b.toLowerCase().includes(needle));
  $: remoteMatches = $git.remoteBranches.filter(
    (b) => b.toLowerCase().includes(needle) && !$git.branches.includes(localNameOf(b)),
  );
  $: hasMatches = matches.length > 0 || remoteMatches.length > 0;

  /** `origin/feat/x` checks out as `feat/x`; git creates the tracking branch on the spot. */
  function localNameOf(remote: string): string {
    return remote.split('/').slice(1).join('/');
  }

  function open() {
    isOpen = !isOpen;
    query = '';
    if (!isOpen) return;
    // Fixed, like `Select`: the panel is placed against the viewport rather
    // than painted inside the header.
    const rect = triggerEl?.getBoundingClientRect();
    if (rect) menuPos = { top: rect.bottom + 4, left: rect.left };
    void refreshBranches();
    queueMicrotask(() => searchEl?.focus());
  }

  /**
   * The lists come from a fetch, which is slow enough to be seen: without this
   * the freshly opened menu reads "No branch" until the answer lands.
   */
  async function refreshBranches() {
    const path = $activeProject?.path;
    if (!path) return;
    isLoadingBranches = true;
    try {
      await loadBranches(path);
    } finally {
      isLoadingBranches = false;
    }
  }

  async function pick(branch: string, isRemote = false) {
    isOpen = false;
    const target = isRemote ? localNameOf(branch) : branch;
    if (target === current || isSwitching) return;
    isSwitching = true;
    try {
      await checkoutBranch(target);
    } catch (e) {
      showModalOrKeepBanner(target, e);
    } finally {
      isSwitching = false;
    }
  }

  /**
   * A filter that shrinks the list leaves it scrolled where the long one was,
   * past the end of what is left: WKWebView does not clamp it, so the panel
   * reads empty. Every new filter starts from the top.
   */
  function resetListScroll() {
    if (listEl) listEl.scrollTop = 0;
  }

  function openCreate() {
    isOpen = false;
    createRequest = { from: current, name: query.trim() };
  }

  /** Stashes what blocks the checkout, then retries it. */
  async function stashAndSwitch() {
    const target = dirty;
    if (!target) return;
    isStashing = true;
    try {
      await pushStash((t('git.dirtyWorktree.heading') as string), true, false);
      await checkoutBranch(target);
      dirty = null;
    } catch (e) {
      dirty = null;
      showModalOrKeepBanner(target, e);
    } finally {
      isStashing = false;
    }
  }

  /**
   * A branch held by another worktree is an instance to open, and uncommitted
   * changes are a choice to make, so both drop the banner the store raised in
   * favour of a modal. Anything else stays in the banner.
   */
  function showModalOrKeepBanner(branch: string, error: unknown) {
    const err = toGitError(error);
    const path = worktreeInUsePath(err.raw);
    if (path) {
      clearGitError();
      inUse = { branch, worktreePath: path, instance: instanceAt(path) };
      return;
    }
    if (err.code === 'dirty_worktree') {
      clearGitError();
      dirty = branch;
    }
  }

  /** The instance owning a worktree, matched on its path as git printed it. */
  function instanceAt(path: string): Instance | null {
    const wanted = normalizePath(path);
    return $instances.find((i) => normalizePath(i.worktreePath) === wanted) ?? null;
  }

  function normalizePath(path: string): string {
    return path.replace(/\\/g, '/').replace(/\/+$/, '');
  }

  async function openInUseInstance(instance: Instance) {
    inUse = null;
    await activateInstance(instance.projectId, instance.id);
  }
</script>

{#if inUse}
  <BranchInUseModal
    branch={inUse.branch}
    worktreePath={inUse.worktreePath}
    instance={inUse.instance}
    on:close={() => (inUse = null)}
    on:open={(e) => openInUseInstance(e.detail)}
  />
{/if}

{#if createRequest}
  <CreateBranchModal
    from={createRequest.from}
    name={createRequest.name}
    on:close={() => (createRequest = null)}
    on:created={() => (createRequest = null)}
  />
{/if}

{#if dirty}
  <DirtyWorktreeModal
    branch={dirty}
    {isStashing}
    on:close={() => (dirty = null)}
    on:stash={stashAndSwitch}
  />
{/if}

{#if current}
  <div class="branch-switcher" use:clickOutside={() => { isOpen = false; }}>
    <button class="branch-trigger" bind:this={triggerEl} disabled={isSwitching} on:click={open}>
      {#if isSwitching}
        <Spinner size={11} stroke={1.5} trackColor="var(--stroke-1)" color="var(--accent)"/>
      {:else}
        <Icon name="branch" size={11}/>
      {/if}
      <span class="branch-name">{current}</span>
      <Icon name="chev-d" size={10}/>
    </button>
    <CopyButton value={current}/>

    {#if isOpen}
      <div class="branch-menu" style="top: {menuPos.top}px; left: {menuPos.left}px;">
        <div class="branch-menu-search">
          <Icon name="search" size={11}/>
          <input
            bind:this={searchEl}
            bind:value={query}
            placeholder={t('git.branchSwitcher.searchPlaceholder') as string}
            aria-label={t('git.branchSwitcher.searchPlaceholder') as string}
            autocomplete="off"
            on:keydown={(e) => e.key === 'Escape' && (isOpen = false)}
            on:input={resetListScroll}
          />
        </div>
        <div class="branch-menu-create-row">
          <button class="branch-menu-create" on:click={openCreate}>
            <Icon name="plus" size={11}/>
            <span class="branch-name">{(t('git.branchSwitcher.create') as (from: string) => string)(current)}</span>
          </button>
        </div>
        <div class="branch-menu-list" bind:this={listEl}>
          {#each matches as branch (branch)}
            <button class="branch-menu-item {branch === current ? 'active' : ''}" on:click={() => pick(branch)}>
              <Icon name="branch" size={11}/>
              <span class="branch-name">{branch}</span>
            </button>
          {/each}
          {#if remoteMatches.length > 0}
            <div class="branch-menu-group">{t('git.remoteBranches')}</div>
            {#each remoteMatches as branch (branch)}
              <button class="branch-menu-item" on:click={() => pick(branch, true)}>
                <Icon name="branch" size={11}/>
                <span class="branch-name">{branch}</span>
              </button>
            {/each}
          {/if}
          {#if isLoadingBranches && !hasMatches}
            <div class="branch-menu-loading"><Skeleton lines={4} height={13} gap={11}/></div>
          {:else if !hasMatches}
            <div class="branch-menu-empty">{t('git.branchSwitcher.empty')}</div>
          {/if}
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .branch-switcher { position: relative; display: flex; align-items: center; gap: 2px; }

  .branch-trigger {
    display: flex;
    align-items: center;
    gap: 5px;
    max-width: 260px;
    padding: 3px 7px;
    background: var(--bg-2);
    border: 1px solid var(--stroke-0);
    border-radius: 5px;
    color: var(--fg-2);
    font-family: var(--font-ui);
    font-size: 11.5px;
    cursor: pointer;
  }
  .branch-trigger:hover:not(:disabled) { background: var(--bg-3); color: var(--fg-0); }
  .branch-trigger:disabled { cursor: default; opacity: 0.7; }

  .branch-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .branch-menu {
    position: fixed;
    display: flex;
    flex-direction: column;
    min-width: 240px;
    max-height: 320px;
    padding: 4px;
    background: var(--bg-2);
    border: 1px solid var(--stroke-1);
    border-radius: 6px;
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.35);
    z-index: 200;
  }

  .branch-menu-search {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    margin-bottom: 4px;
    border-bottom: 1px solid var(--stroke-0);
    color: var(--fg-3);
  }
  .branch-menu-search input {
    flex: 1;
    min-width: 0;
    background: none;
    border: none;
    outline: none;
    color: var(--fg-0);
    font-family: var(--font-ui);
    font-size: 12px;
  }

  .branch-menu-item, .branch-menu-create {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    padding: 5px 7px;
    background: none;
    border: none;
    border-radius: 4px;
    color: var(--fg-2);
    font-family: var(--font-ui);
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }
  .branch-menu-item:hover, .branch-menu-create:hover { background: var(--bg-4); color: var(--fg-0); }
  .branch-menu-create { color: var(--accent); }
  .branch-menu-create-row {
    flex-shrink: 0;
    padding-bottom: 4px;
    margin-bottom: 4px;
    border-bottom: 1px solid var(--stroke-0);
  }
  .branch-menu-search { flex-shrink: 0; }
  .branch-menu-item.active { color: var(--accent); }

  .branch-menu-group {
    padding: 6px 7px 3px;
    color: var(--fg-3);
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .branch-menu-list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .branch-menu-loading { padding: 5px 7px; }

  .branch-menu-empty {
    padding: 8px 7px;
    color: var(--fg-3);
    font-size: 12px;
  }
</style>
