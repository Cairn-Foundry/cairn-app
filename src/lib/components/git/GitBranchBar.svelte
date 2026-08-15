<script lang="ts">
  /**
   * Branch header of the git view: current branch, ahead/behind counts, and the fetch, pull and push actions.
   * Dispatches `openMergeRebase` to surface a conflicted state and `filesChanged` after a pull touches the worktree.
   */
  import { createEventDispatcher } from 'svelte';
  import { get } from 'svelte/store';
  import Icon from '$lib/components/Icon.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import { t } from '$lib/i18n';
  import {
    git,
    loadBranches,
    fetchRemote,
    pullBranch,
    pushBranch,
  } from '$lib/stores/git';
  import { activeProject } from '$lib/stores/project';

  const dispatch = createEventDispatcher<{ openMergeRebase: void; filesChanged: void }>();

  $: state = $git;
  $: op = state.operationState;
  $: remote = state.remoteStatus;
  $: inOperation = (op?.kind ?? 'none') !== 'none';
  $: ahead = remote?.ahead ?? 0;
  $: behind = remote?.behind ?? 0;
  $: canPush = !remote?.hasUpstream || ahead > 0;
  $: busy = fetching || pulling || pushing;

  let lastBranchPath = '';
  $: if ($activeProject?.path && $activeProject.path !== lastBranchPath) {
    lastBranchPath = $activeProject.path;
    loadBranches($activeProject.path);
  }

  let fetching = false;
  let pulling = false;
  let pushing = false;

  /** Fetches the remote then reloads the branch list so the ahead/behind counts follow. */
  async function doFetch() {
    if (busy) return;
    fetching = true;
    try {
      await fetchRemote();
      if ($activeProject?.path) await loadBranches($activeProject.path);
    } finally {
      fetching = false;
    }
  }

  /** Reads the store directly rather than the reactive copy, which is still stale right after the operation. */
  function openTabIfConflicted() {
    if ((get(git).operationState?.kind ?? 'none') !== 'none') {
      dispatch('openMergeRebase');
    }
  }

  /** Pulls, then tells the parent the worktree may have changed and opens the merge tab if it left conflicts. */
  async function doPull() {
    if (busy) return;
    pulling = true;
    try {
      await pullBranch();
      dispatch('filesChanged');
      openTabIfConflicted();
    } finally {
      pulling = false;
    }
  }

  async function doPush() {
    if (busy) return;
    pushing = true;
    try {
      await pushBranch();
      openTabIfConflicted();
    } finally {
      pushing = false;
    }
  }
</script>

{#if state.isGitRepo}
  <div class="branch-bar">
    <div class="branch-label" title={state.currentBranch}>
      <Icon name="branch" size={13} />
      <span class="branch-name selectable">{state.currentBranch}</span>
    </div>

    {#if inOperation && op}
      <button class="op-chip" on:click={() => dispatch('openMergeRebase')}>
        <Icon name="alert" size={12} />
        <span>
          {op.kind === 'merge'
            ? t('git.mergeInProgress')
            : t('git.rebaseInProgress')}
        </span>
        {#if op.conflictedFiles.length > 0}
          <span class="op-chip-count">
            {(t('git.conflictsCount') as (n: number) => string)(
              op.conflictedFiles.length,
            )}
          </span>
        {/if}
        <Icon name="chev-r" size={12} />
      </button>
    {/if}

    <div class="spacer"></div>

    {#if !remote?.hasUpstream}
      <span class="sync-clean muted">{t('git.noUpstreamShort')}</span>
    {:else if ahead === 0 && behind === 0}
      <span class="sync-clean" title={remote.remote}>{t('git.upToDate')}</span>
    {/if}

    <button
      class="op-btn"
      title={t('git.fetchTitle') as string}
      disabled={busy || inOperation}
      on:click={doFetch}
    >
      {#if fetching}
        <Spinner size={12} trackColor="var(--bg-3)" color="var(--fg-3)" />
      {:else}
        <Icon name="refresh" size={13} />
      {/if}
      <span>{t('git.fetch')}</span>
    </button>

    <button
      class="op-btn"
      title={t('git.pullTitle') as string}
      disabled={busy || inOperation || !remote?.hasUpstream}
      on:click={doPull}
    >
      {#if pulling}
        <Spinner size={12} trackColor="var(--bg-3)" color="var(--fg-3)" />
      {:else}
        <Icon name="download" size={13} />
      {/if}
      <span>{t('git.pull')}</span>
      {#if behind > 0}
        <span class="op-count">{behind}</span>
      {/if}
    </button>

    <button
      class="op-btn primary"
      title={t('git.pushTitle') as string}
      disabled={busy || inOperation || !canPush}
      on:click={doPush}
    >
      {#if pushing}
        <Spinner size={12} trackColor="oklch(1 0 0 / 0.3)" color="var(--accent-fg)" />
      {:else}
        <Icon name="send" size={13} />
      {/if}
      <span>{t('git.push')}</span>
      {#if ahead > 0}
        <span class="op-count on-primary">{ahead}</span>
      {/if}
    </button>
  </div>
{/if}

<style>
  .branch-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--stroke-0);
    background: var(--bg-1);
    min-height: 38px;
  }

  .spacer {
    flex: 1;
  }

  .branch-label {
    display: flex;
    align-items: center;
    gap: 6px;
    max-width: 260px;
    color: var(--fg-1);
    font-size: 12px;
    font-weight: 500;
  }
  .branch-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sync-clean {
    color: var(--fg-3);
    font-size: 11px;
  }
  .sync-clean.muted {
    font-style: italic;
  }

  .op-count {
    min-width: 15px;
    padding: 0 4px;
    border-radius: 8px;
    background: var(--bg-4);
    color: var(--fg-2);
    font-size: 10px;
    font-weight: 600;
    line-height: 15px;
    text-align: center;
  }
  .op-count.on-primary {
    background: oklch(1 0 0 / 0.22);
    color: var(--accent-fg);
  }

  .op-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px;
    border: 1px solid color-mix(in oklch, var(--danger) 40%, var(--stroke-0));
    border-radius: 999px;
    background: color-mix(in oklch, var(--danger) 12%, var(--bg-1));
    color: var(--fg-1);
    font-size: 11px;
    cursor: pointer;
  }
  .op-chip:hover {
    background: color-mix(in oklch, var(--danger) 20%, var(--bg-1));
  }
  .op-chip-count {
    color: var(--fg-2);
  }

  .op-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 9px;
    border: 1px solid var(--stroke-0);
    border-radius: 6px;
    background: var(--bg-2);
    color: var(--fg-1);
    font-size: 12px;
    cursor: pointer;
    transition:
      background 0.12s ease,
      border-color 0.12s ease,
      color 0.12s ease;
  }
  .op-btn:hover:not(:disabled) {
    background: var(--bg-3);
    border-color: var(--fg-3);
  }
  .op-btn:active:not(:disabled) {
    background: var(--bg-4);
  }
  .op-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .op-btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-fg);
  }
  .op-btn.primary:hover:not(:disabled) {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
    color: var(--accent-fg);
  }
</style>
