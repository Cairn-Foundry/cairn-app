<script lang="ts">
  /**
   * Branch header of the git view: current branch, ahead/behind counts, and the fetch, pull and push actions.
   * Dispatches `openMergeRebase` to surface a conflicted state and `filesChanged` after a pull touches the worktree.
   */
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { openUrl } from '@tauri-apps/plugin-opener';
  import Icon from '$lib/components/Icon.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import MergeRequestForm from '$lib/components/git/MergeRequestForm.svelte';
  import { t } from '$lib/i18n';
  import { activeInstance } from '$lib/stores/instance';
  import { capabilities, forgeTerms, hasForge } from '$lib/stores/integrations';
  import {
    loadMergeRequest,
    mergeRequestFormRequest,
    mergeRequests,
    mergeRequestStateFor,
  } from '$lib/stores/merge-request';
  import { activeStep } from '$lib/stores/ui';
  import { clickOutside } from '$lib/utils/click-outside';
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

  $: projectId = $activeProject?.id ?? '';
  $: instanceId = $activeInstance?.id ?? '';
  $: mrState = mergeRequestStateFor($mergeRequests, projectId, instanceId);
  $: mergeRequest = mrState.mergeRequest;
  $: forgeLabel = $capabilities.forge?.label ?? '';

  let lastMrKey = '';
  $: {
    const key = $hasForge && projectId && instanceId && state.currentBranch
      ? `${projectId}:${instanceId}:${state.currentBranch}`
      : '';
    if (key !== lastMrKey) {
      lastMrKey = key;
      if (key) void loadMergeRequest(projectId, instanceId, state.currentBranch);
    }
  }

  let isMrFormOpen = false;
  let isMrMenuOpen = false;
  let mrLinkCopied = false;

  let lastFormRequest = get(mergeRequestFormRequest);
  const unsubscribeFormRequest = mergeRequestFormRequest.subscribe((n) => {
    if (n === lastFormRequest) return;
    lastFormRequest = n;
    if ($hasForge && !mergeRequest) isMrFormOpen = true;
  });
  onDestroy(unsubscribeFormRequest);

  $: mrChipText = mergeRequest
    ? [
        mergeRequest.number,
        mergeRequest.isDraft ? (t('mergeRequest.draft') as string) : null,
        mergeRequest.state !== 'open' ? (t(`mergeRequest.state.${mergeRequest.state}`) as string) : null,
        (t('mergeRequest.approvals') as (n: number, total: number | null) => string)(
          mergeRequest.approvals.approved,
          mergeRequest.approvals.required,
        ),
        mergeRequest.pipelineStatus
          ? `${t('mergeRequest.pipeline')} ${(t(`cicd.status.${mergeRequest.pipelineStatus}`) as string).toLowerCase()}`
          : null,
      ].filter((part) => part !== null).join(' - ')
    : '';

  function openReview() {
    isMrMenuOpen = false;
    activeStep.set('review');
  }

  async function openMrInBrowser() {
    isMrMenuOpen = false;
    if (mergeRequest?.url) await openUrl(mergeRequest.url);
  }

  async function copyMrLink() {
    if (!mergeRequest?.url) return;
    await navigator.clipboard.writeText(mergeRequest.url);
    mrLinkCopied = true;
    setTimeout(() => { mrLinkCopied = false; isMrMenuOpen = false; }, 900);
  }

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

    {#if $hasForge && projectId && instanceId}
      {#if mergeRequest}
        <div class="mr-chip-wrap" use:clickOutside={() => (isMrMenuOpen = false)}>
          <button
            class="mr-chip"
            class:is-draft={mergeRequest.isDraft}
            class:is-failing={mergeRequest.pipelineStatus === 'failed'}
            title={`${mergeRequest.title} - ${t('mergeRequest.openReview')}`}
            on:click={openReview}
          >
            <Icon name="review" size={12} />
            <span class="mr-chip-text">{mrChipText}</span>
          </button>
          <button
            class="mr-chip-menu-btn"
            aria-label={t('mergeRequest.moreActions') as string}
            aria-expanded={isMrMenuOpen}
            on:click={() => (isMrMenuOpen = !isMrMenuOpen)}
          >
            <Icon name="chev-d" size={11} />
          </button>
          {#if isMrMenuOpen}
            <div class="mr-menu" role="menu">
              <button role="menuitem" on:click={openMrInBrowser}>
                <Icon name="external" size={12} />
                {forgeLabel ? (t('integrations.openOn') as (s: string) => string)(forgeLabel) : t('mergeRequest.openInBrowser')}
              </button>
              <button role="menuitem" on:click={copyMrLink}>
                <Icon name={mrLinkCopied ? 'check' : 'copy'} size={12} />
                {mrLinkCopied ? t('mergeRequest.linkCopied') : t('mergeRequest.copyLink')}
              </button>
              <button role="menuitem" on:click={openReview}>
                <Icon name="review" size={12} />
                {t('mergeRequest.openReview')}
              </button>
            </div>
          {/if}
        </div>
      {:else if mrState.isRefreshing && !mrState.isLoaded}
        <span class="mr-chip-pending" title={t(`integrations.terms.${$forgeTerms}.one`) as string}>
          <Spinner size={11} trackColor="var(--bg-3)" color="var(--fg-3)" />
        </span>
      {:else}
        <button class="mr-chip create" on:click={() => (isMrFormOpen = true)}>
          <Icon name="plus" size={11} />
          <span>{t(`integrations.terms.${$forgeTerms}.chipCreate`)}</span>
        </button>
      {/if}
    {/if}

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

{#if isMrFormOpen && $activeInstance}
  <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
  <div
    class="modal-backdrop"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    on:click={() => (isMrFormOpen = false)}
    on:keydown={(e) => e.key === 'Escape' && (isMrFormOpen = false)}
  >
    <div class="modal mr-modal" on:click|stopPropagation role="presentation">
      <div class="modal-head">
        <div>
          <div class="step-count">{t(`integrations.terms.${$forgeTerms}.one`)}</div>
          <h3>{t(`integrations.terms.${$forgeTerms}.create`)}</h3>
        </div>
        <button class="icon-btn close" on:click={() => (isMrFormOpen = false)} aria-label={t('common.close') as string}>
          <Icon name="x" size={16} />
        </button>
      </div>
      <div class="modal-body">
        <MergeRequestForm
          {projectId}
          {instanceId}
          sourceBranch={state.currentBranch}
          targetBranch={$activeInstance.baseBranch}
          worktreePath={$activeInstance.worktreePath}
          ticket={$activeInstance.ticket.key
            ? { key: $activeInstance.ticket.key, title: $activeInstance.ticket.title, url: $activeInstance.ticket.url ?? '' }
            : null}
          on:created={() => (isMrFormOpen = false)}
          on:cancel={() => (isMrFormOpen = false)}
        />
      </div>
    </div>
  </div>
{/if}

<style>
  .mr-modal { width: min(560px, 92vw); }

  .mr-chip-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
    min-width: 0;
  }
  .mr-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 380px;
    padding: 3px 8px;
    border: 1px solid var(--stroke-0);
    border-radius: 999px;
    background: var(--bg-2);
    color: var(--fg-1);
    font-size: 11px;
    cursor: pointer;
  }
  .mr-chip:hover { background: var(--bg-3); }
  .mr-chip.is-draft { color: var(--fg-2); border-style: dashed; }
  .mr-chip.is-failing { border-color: color-mix(in oklch, var(--danger) 40%, var(--stroke-0)); }
  .mr-chip.create { color: var(--fg-2); }
  .mr-chip.create:hover { color: var(--fg-0); }
  .mr-chip-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mr-chip-wrap .mr-chip {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
    border-right: none;
  }
  .mr-chip-menu-btn {
    display: inline-grid;
    place-items: center;
    height: 100%;
    padding: 3px 5px;
    border: 1px solid var(--stroke-0);
    border-radius: 0 999px 999px 0;
    background: var(--bg-2);
    color: var(--fg-2);
    cursor: pointer;
  }
  .mr-chip-menu-btn:hover { background: var(--bg-3); color: var(--fg-0); }
  .mr-chip-pending { display: inline-flex; padding: 0 4px; }
  .mr-menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 30;
    display: flex;
    flex-direction: column;
    min-width: 190px;
    padding: 4px;
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-md);
    background: var(--bg-2);
    box-shadow: 0 8px 24px oklch(0 0 0 / 0.25);
  }
  .mr-menu button {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--fg-0);
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }
  .mr-menu button:hover { background: var(--bg-3); }

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
