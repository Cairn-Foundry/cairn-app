<script lang="ts">
  /**
   * Current branch of the active worktree, with a searchable menu to check out
   * another local branch. Surfaced on the base instance, whose branch is the
   * repository's own rather than a worktree the instance owns.
   */
  import BranchInUseModal from '$lib/components/git/BranchInUseModal.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import { t } from '$lib/i18n';
  import { checkoutBranch, clearGitError, git, loadBranches } from '$lib/stores/git';
  import { instances } from '$lib/stores/instance';
  import { activateInstance, activeProject } from '$lib/stores/project';
  import { toGitError } from '$lib/services/git-service';
  import type { Instance } from '$lib/types/instance';
  import { clickOutside } from '$lib/utils/click-outside';
  import { worktreeInUsePath } from '$lib/utils/git/git-error';

  let isOpen = false;
  let isSwitching = false;
  let isLoadingBranches = false;
  let inUse: { branch: string; worktreePath: string; instance: Instance | null } | null = null;
  let query = '';
  let searchEl: HTMLInputElement | null = null;

  $: current = $git.currentBranch;
  $: needle = query.trim().toLowerCase();
  $: matches = $git.branches.filter((b) => b.toLowerCase().includes(needle));
  $: remoteMatches = $git.remoteBranches.filter(
    (b) => b.toLowerCase().includes(needle) && !$git.branches.includes(localNameOf(b)),
  );

  /** `origin/feat/x` checks out as `feat/x`; git creates the tracking branch on the spot. */
  function localNameOf(remote: string): string {
    return remote.split('/').slice(1).join('/');
  }

  function open() {
    isOpen = !isOpen;
    query = '';
    if (!isOpen) return;
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
      showInUseOrKeepBanner(target, e);
    } finally {
      isSwitching = false;
    }
  }

  /**
   * A branch held by another worktree is not a failure to report but an
   * instance to open, so the banner the store raised is dropped in favour of
   * the modal. Anything else stays in the banner.
   */
  function showInUseOrKeepBanner(branch: string, error: unknown) {
    const raw = toGitError(error).raw;
    const path = worktreeInUsePath(raw);
    if (!path) return;
    clearGitError();
    inUse = { branch, worktreePath: path, instance: instanceAt(path) };
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

{#if current}
  <div class="branch-switcher" use:clickOutside={() => { isOpen = false; }}>
    <button class="branch-trigger" disabled={isSwitching} on:click={open}>
      {#if isSwitching}
        <Spinner size={11} stroke={1.5} trackColor="var(--stroke-1)" color="var(--accent)"/>
      {:else}
        <Icon name="branch" size={11}/>
      {/if}
      <span class="branch-name">{current}</span>
      <Icon name="chev-d" size={10}/>
    </button>

    {#if isOpen}
      <div class="branch-menu">
        <div class="branch-menu-search">
          <Icon name="search" size={11}/>
          <input
            bind:this={searchEl}
            bind:value={query}
            placeholder={t('git.branchSwitcher.searchPlaceholder') as string}
            autocomplete="off"
            on:keydown={(e) => e.key === 'Escape' && (isOpen = false)}
          />
        </div>
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
        {#if isLoadingBranches && matches.length === 0 && remoteMatches.length === 0}
          <div class="branch-menu-loading"><Skeleton lines={4} height={13} gap={11}/></div>
        {:else if matches.length === 0 && remoteMatches.length === 0}
          <div class="branch-menu-empty">{t('git.branchSwitcher.empty')}</div>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .branch-switcher { position: relative; }

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
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    min-width: 240px;
    max-height: 320px;
    overflow-y: auto;
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

  .branch-menu-item {
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
  .branch-menu-item:hover { background: var(--bg-4); color: var(--fg-0); }
  .branch-menu-item.active { color: var(--accent); }

  .branch-menu-group {
    padding: 6px 7px 3px;
    color: var(--fg-3);
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .branch-menu-loading { padding: 5px 7px; }

  .branch-menu-empty {
    padding: 8px 7px;
    color: var(--fg-3);
    font-size: 12px;
  }
</style>
