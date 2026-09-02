<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
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
  import { activeInstance, isBaseInstance, setInstanceBaseBranch } from '$lib/stores/instance';
  import { capabilities, forgeTerms, hasForge } from '$lib/stores/integrations';
  import {
    loadMergeRequest,
    mergeRequestFormRequest,
    mergeRequests,
    mergeRequestStateFor,
  } from '$lib/stores/merge-request';
  import { activeStep } from '$lib/stores/ui';
  import { clickOutside } from '$lib/utils/click-outside';
  import type { PullMode, PushMode } from '$lib/services/git-service';
  import BaseBranchSelect from '$lib/components/git/BaseBranchSelect.svelte';
  import {
    git,
    loadBranches,
    fetchRemote,
    pullBranch,
    pushBranch,
  } from '$lib/stores/git';
  import { activeProject } from '$lib/stores/project';

  const dispatch = createEventDispatcher<{ openMergeRebase: void; filesChanged: void }>();

  /**
   * The base branch is what every diff of this instance is measured against, so
   * it is editable here rather than only as a side effect of a rebase. Changing
   * it never touches the worktree: it re-points the comparison, nothing else.
   */
  // Remote branches count: a base is very often `origin/main` rather than a
  // local ref the worktree happens to have.
  $: baseChoices = [...(state.branches ?? []), ...(state.remoteBranches ?? [])]
    .filter(b => b !== state.currentBranch);

  async function applyBase(branch: string) {
    if (!$activeInstance) return;
    await setInstanceBaseBranch($activeInstance.id, $activeInstance.projectId, branch)
      .catch(() => {});
  }

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
    // No fetch here: this runs on every project switch, and a network round trip
    // per switch is what the Fetch button and the branch switcher are for.
    loadBranches($activeProject.path, { fetch: false });
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
  async function doPull(mode: PullMode = 'rebase') {
    if (busy) return;
    isPullMenuOpen = false;
    pulling = true;
    try {
      await pullBranch(mode);
      dispatch('filesChanged');
      openTabIfConflicted();
    } finally {
      pulling = false;
    }
  }

  async function doPush(mode: PushMode = 'normal') {
    if (busy) return;
    isPushMenuOpen = false;
    pushing = true;
    try {
      await pushBranch(false, false, mode);
      openTabIfConflicted();
    } finally {
      pushing = false;
    }
  }

  let isPullMenuOpen = false;
  let isPushMenuOpen = false;
  const PULL_MODES: { mode: PullMode; icon: string }[] = [
    { mode: 'rebase', icon: 'branch' },
    { mode: 'merge', icon: 'git' },
    { mode: 'ff-only', icon: 'chev-r' },
  ];
  const PUSH_MODES: { mode: PushMode; icon: string }[] = [
    { mode: 'normal', icon: 'send' },
    { mode: 'force-with-lease', icon: 'shield' },
    { mode: 'force', icon: 'warning' },
  ];
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

    {#if $activeInstance && !isBaseInstance($activeInstance.id)}
      <!-- An instance stored before the base branch existed carries no field at all. -->
      {@const base = $activeInstance.baseBranch ?? ''}
      {@const isUnset = base.trim() === '' || base === state.currentBranch}
      <BaseBranchSelect
        compact
        value={base}
        branches={baseChoices}
        exclude={state.currentBranch}
        {isUnset}
        unsetLabel={t('git.baseUnset') as string}
        on:change={(e) => applyBase(e.detail.branch)}
      />
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

    <div class="op-split" use:clickOutside={() => (isPullMenuOpen = false)}>
      <button
        class="op-btn split-main"
        title={t('git.pullTitle') as string}
        disabled={busy || inOperation || !remote?.hasUpstream}
        on:click={() => doPull()}
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
        class="op-btn split-more"
        aria-label={t('git.pullMoreActions') as string}
        aria-expanded={isPullMenuOpen}
        disabled={busy || inOperation || !remote?.hasUpstream}
        on:click={() => (isPullMenuOpen = !isPullMenuOpen)}
      >
        <Icon name="chev-d" size={11} />
      </button>
      {#if isPullMenuOpen}
        <div class="op-menu" role="menu">
          {#each PULL_MODES as { mode, icon } (mode)}
            <button role="menuitem" on:click={() => doPull(mode)}>
              <Icon name={icon} size={12} />
              <span class="op-menu-text">
                <span class="op-menu-label">{t(`git.pullMode.${mode}`)}</span>
                <span class="op-menu-hint">{t(`git.pullModeHint.${mode}`)}</span>
              </span>
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <div class="op-split" use:clickOutside={() => (isPushMenuOpen = false)}>
      <button
        class="op-btn primary split-main"
        title={t('git.pushTitle') as string}
        disabled={busy || inOperation || !canPush}
        on:click={() => doPush()}
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
      <button
        class="op-btn primary split-more"
        aria-label={t('git.pushMoreActions') as string}
        aria-expanded={isPushMenuOpen}
        disabled={busy || inOperation || !canPush}
        on:click={() => (isPushMenuOpen = !isPushMenuOpen)}
      >
        <Icon name="chev-d" size={11} />
      </button>
      {#if isPushMenuOpen}
        <div class="op-menu" role="menu">
          {#each PUSH_MODES as { mode, icon } (mode)}
            <button role="menuitem" class:danger={mode === 'force'} on:click={() => doPush(mode)}>
              <Icon name={icon} size={12} />
              <span class="op-menu-text">
                <span class="op-menu-label">{t(`git.pushMode.${mode}`)}</span>
                <span class="op-menu-hint">{t(`git.pushModeHint.${mode}`)}</span>
              </span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
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
    align-self: stretch;
    padding: 3px 5px;
    border: 1px solid var(--stroke-0);
    border-radius: 0 999px 999px 0;
    background: var(--bg-2);
    color: var(--fg-2);
    cursor: pointer;
  }
  .mr-chip-menu-btn:hover { background: var(--bg-3); color: var(--fg-0); }
  .mr-chip-pending { display: inline-flex; padding: 0 4px; }
  .op-split {
    position: relative;
    display: flex;
  }
  .op-split .split-main {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }
  .op-split .split-more {
    padding-left: 4px;
    padding-right: 4px;
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
    border-left: 1px solid var(--stroke-1);
  }
  .op-split .split-more.primary {
    border-left-color: oklch(1 0 0 / 0.25);
  }
  .op-menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: 30;
    display: flex;
    flex-direction: column;
    min-width: 230px;
    padding: 4px;
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-md);
    background: var(--bg-2);
    box-shadow: 0 8px 24px oklch(0 0 0 / 0.25);
  }
  .op-menu button {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 6px 8px;
    border: none;
    border-radius: var(--r-sm);
    background: none;
    color: var(--fg-1);
    text-align: left;
    cursor: pointer;
  }
  .op-menu button:hover { background: var(--bg-3); }
  .op-menu button.danger { color: var(--danger, var(--fg-1)); }
  .op-menu-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .op-menu-label { font-size: 12px; }
  .op-menu-hint { font-size: 11px; color: var(--fg-3); }

  .mr-menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
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
