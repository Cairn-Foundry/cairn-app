<script lang="ts">
  /**
   * Guided checklist closing an instance: commit, sync on the base branch, push,
   * open the merge request, then archive it. Each step unlocks only once the
   * previous one is satisfied by the real git state.
   */
  import { createEventDispatcher, onMount } from 'svelte';
  import { openUrl } from '@tauri-apps/plugin-opener';
  import Icon from '$lib/components/Icon.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import CopyButton from '$lib/components/CopyButton.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import DeleteInstanceModal from '$lib/components/home/DeleteInstanceModal.svelte';
  import MergeRequestForm from '$lib/components/git/MergeRequestForm.svelte';
  import { t } from '$lib/i18n';
  import type { Instance } from '$lib/types/instance';
  import type { BranchDivergence } from '$lib/services/git-service';
  import {
    git,
    gitFileCounts,
    clearGitError,
    fetchRemote,
    refreshStatus,
    rebaseOnto,
    pushBranch,
    getRemoteUrl,
    getBranchDivergence,
  } from '$lib/stores/git';
  import { isArchivedInstance, removeInstance, setInstanceStatus } from '$lib/stores/instance';
  import { hasForge, hasTracker, projectBindings } from '$lib/stores/integrations';
  import { loadMergeRequest, mergeRequests, mergeRequestStateFor } from '$lib/stores/merge-request';
  import { loadTicket, ticketStateFor, tickets, transitionTicketToStatus } from '$lib/stores/tracker';
  import { describeGitError } from '$lib/utils/git/git-error';
  import { buildMergeRequestUrl } from '$lib/utils/git/remote-url';

  export let instance: Instance;

  const dispatch = createEventDispatcher<{ close: void; openGit: void }>();

  type StepId = 'commit' | 'sync' | 'push' | 'handoff' | 'close';

  let checking = true;
  let busyStep: StepId | null = null;
  let divergence: BranchDivergence | null = null;
  let remoteUrl = '';
  let handedOff = false;
  let pendingDelete = false;
  let deleting = false;
  let isMrFormOpen = false;
  let hasTransitionFailed = false;

  $: state = $git;
  $: counts = $gitFileCounts;
  $: opKind = state.operationState?.kind ?? 'none';
  $: conflictCount = state.operationState?.conflictedFiles.length ?? 0;
  $: baseRef = divergence?.baseRef ?? '';
  $: behindBase = divergence?.behind ?? 0;
  $: hasUpstream = state.remoteStatus?.hasUpstream ?? false;
  $: ahead = state.remoteStatus?.ahead ?? 0;
  $: behindRemote = state.remoteStatus?.behind ?? 0;
  $: needsForcePush = hasUpstream && ahead > 0 && behindRemote > 0;
  $: mrUrl = buildMergeRequestUrl(remoteUrl, instance.branch, instance.baseBranch);
  $: mrState = mergeRequestStateFor($mergeRequests, instance.projectId, instance.id);
  $: mergeRequest = $hasForge ? mrState.mergeRequest : null;
  $: ticket = instance.ticket.key
    ? { key: instance.ticket.key, title: instance.ticket.title, url: instance.ticket.url ?? '' }
    : null;
  $: gitError = state.error ? describeGitError(state.error) : null;

  $: commitDone = counts.total === 0;
  $: syncDone = commitDone && opKind === 'none' && behindBase === 0;
  $: pushDone = syncDone && hasUpstream && ahead === 0;
  $: closeDone = isArchivedInstance(instance);

  $: stepStates = {
    commit: commitDone,
    sync: syncDone,
    push: pushDone,
    handoff: handedOff || mergeRequest !== null,
    close: closeDone,
  } as Record<StepId, boolean>;

  $: stepEnabled = {
    commit: true,
    sync: commitDone,
    push: syncDone,
    handoff: pushDone,
    close: pushDone || closeDone,
  } as Record<StepId, boolean>;

  /** Refreshes everything the checklist derives its step states from. */
  async function loadState(fetchFirst: boolean) {
    checking = true;
    try {
      if (fetchFirst) {
        try {
          await fetchRemote();
        } catch {
          // Offline or unreachable remote: the local counts stay meaningful.
        }
      }
      await refreshStatus(true);
      const [url, div] = await Promise.all([
        getRemoteUrl(),
        getBranchDivergence(instance.baseBranch),
      ]);
      remoteUrl = url;
      divergence = div;
      if ($hasForge) await loadMergeRequest(instance.projectId, instance.id, instance.branch);
    } finally {
      checking = false;
    }
  }

  onMount(() => loadState(true));

  function goToGit() {
    dispatch('openGit');
    dispatch('close');
  }

  /** Runs one step at a time, leaving error reporting to the git store banner. */
  async function runStep(id: StepId, action: () => Promise<void>) {
    if (busyStep) return;
    busyStep = id;
    clearGitError();
    try {
      await action();
    } catch {
      // The banner renders the classified error from the store.
    } finally {
      busyStep = null;
    }
  }

  const doRebase = () =>
    runStep('sync', async () => {
      await rebaseOnto(baseRef);
      await loadState(false);
    });

  const doPush = () =>
    runStep('push', async () => {
      await pushBranch(false, needsForcePush);
      await loadState(false);
    });

  const doHandoff = () =>
    runStep('handoff', async () => {
      if (!mrUrl) return;
      await openUrl(mrUrl);
      handedOff = true;
    });

  function onMergeRequestCreated() {
    isMrFormOpen = false;
    handedOff = true;
  }

  async function openMergeRequest() {
    if (mergeRequest) await openUrl(mergeRequest.url);
  }

  /** The finalize transition is a courtesy: its failure is shown, never blocking. */
  async function transitionOnFinalize() {
    const status = $projectBindings.autoTransition.onFinalize;
    if (!status || !$hasTracker || !ticket) return;
    hasTransitionFailed = false;
    try {
      if (!ticketStateFor($tickets, instance.projectId, instance.id).ticket) {
        await loadTicket(instance.projectId, instance.id, ticket.key);
      }
      await transitionTicketToStatus(instance.projectId, instance.id, status);
    } catch {
      hasTransitionFailed = true;
    }
  }

  const doClose = () =>
    runStep('close', async () => {
      await setInstanceStatus(instance.id, instance.projectId, 'done');
      await transitionOnFinalize();
    });

  const doReopen = () =>
    runStep('close', async () => {
      await setInstanceStatus(instance.id, instance.projectId, 'idle');
    });

  async function confirmDelete() {
    pendingDelete = false;
    deleting = true;
    try {
      await removeInstance(instance.id, instance.projectId);
      dispatch('close');
    } finally {
      deleting = false;
    }
  }
</script>

<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
<div
  class="modal-backdrop"
  role="dialog"
  aria-modal="true"
  tabindex="-1"
  on:click={() => dispatch('close')}
  on:keydown={(e) => e.key === 'Escape' && dispatch('close')}
>
  <div class="modal fin-modal" on:click|stopPropagation role="presentation">
    <div class="modal-head">
      <div>
        <div class="step-count">{t('finalizeInstance.heading')}</div>
        <h3>{instance.ticket.title}</h3>
      </div>
      <button class="icon-btn close" on:click={() => dispatch('close')} aria-label={t('common.close') as string}>
        <Icon name="x" size={16}/>
      </button>
    </div>

    <div class="modal-body">
      <p class="fin-intro">{t('finalizeInstance.description')}</p>

      {#if checking && !divergence}
        <div class="fin-loading"><Skeleton lines={5} height={44} gap={8}/></div>
      {:else}
        <ol class="fin-steps">
          <li class="fin-step" class:muted={!stepEnabled.commit}>
            <span class="fin-mark" class:ok={stepStates.commit}>
              <Icon name={stepStates.commit ? 'check' : 'circle-dot'} size={12}/>
            </span>
            <div class="fin-text">
              <span class="fin-title">{t('finalizeInstance.steps.commit.title')}</span>
              <span class="fin-sub">
                {stepStates.commit
                  ? t('finalizeInstance.steps.commit.clean')
                  : (t('finalizeInstance.steps.commit.pending') as (n: number) => string)(counts.total)}
              </span>
            </div>
            {#if !stepStates.commit}
              <button class="btn step-btn" on:click={goToGit}>
                {t('finalizeInstance.steps.commit.action')}
              </button>
            {/if}
          </li>

          <li class="fin-step" class:muted={!stepEnabled.sync}>
            <span class="fin-mark" class:ok={stepStates.sync}>
              <Icon name={stepStates.sync ? 'check' : 'circle-dot'} size={12}/>
            </span>
            <div class="fin-text">
              <span class="fin-title">{t('finalizeInstance.steps.sync.title')}</span>
              <span class="fin-sub">
                {#if opKind !== 'none'}
                  {(t('finalizeInstance.steps.sync.conflicts') as (n: number) => string)(conflictCount)}
                {:else if !baseRef}
                  {(t('finalizeInstance.steps.sync.noBase') as (base: string) => string)(instance.baseBranch)}
                {:else if stepStates.sync}
                  {(t('finalizeInstance.steps.sync.upToDate') as (base: string) => string)(baseRef)}
                {:else}
                  {(t('finalizeInstance.steps.sync.behind') as (n: number, base: string) => string)(behindBase, baseRef)}
                {/if}
              </span>
            </div>
            {#if opKind !== 'none'}
              <button class="btn step-btn" on:click={goToGit}>
                {t('finalizeInstance.steps.sync.resolve')}
              </button>
            {:else if !stepStates.sync && baseRef}
              <button class="btn step-btn" disabled={!stepEnabled.sync || !!busyStep} on:click={doRebase}>
                {#if busyStep === 'sync'}
                  <Spinner size={11} trackColor="var(--bg-3)" color="var(--fg-3)"/>
                {/if}
                {t('finalizeInstance.steps.sync.action')}
              </button>
            {/if}
          </li>

          <li class="fin-step" class:muted={!stepEnabled.push}>
            <span class="fin-mark" class:ok={stepStates.push}>
              <Icon name={stepStates.push ? 'check' : 'circle-dot'} size={12}/>
            </span>
            <div class="fin-text">
              <span class="fin-title">{t('finalizeInstance.steps.push.title')}</span>
              <span class="fin-sub">
                {#if !hasUpstream}
                  {t('finalizeInstance.steps.push.noUpstream')}
                {:else if stepStates.push}
                  {t('finalizeInstance.steps.push.published')}
                {:else}
                  {(t('finalizeInstance.steps.push.pending') as (n: number) => string)(ahead)}
                {/if}
              </span>
            </div>
            {#if !stepStates.push}
              <button class="btn step-btn" disabled={!stepEnabled.push || !!busyStep} on:click={doPush}>
                {#if busyStep === 'push'}
                  <Spinner size={11} trackColor="var(--bg-3)" color="var(--fg-3)"/>
                {/if}
                {needsForcePush
                  ? t('finalizeInstance.steps.push.forceAction')
                  : t('finalizeInstance.steps.push.action')}
              </button>
            {/if}
          </li>

          <li class="fin-step" class:muted={!stepEnabled.handoff}>
            <span class="fin-mark" class:ok={stepStates.handoff}>
              <Icon name={stepStates.handoff ? 'check' : 'circle-dot'} size={12}/>
            </span>
            <div class="fin-text">
              <span class="fin-title">{t('finalizeInstance.steps.handoff.title')}</span>
              <span class="fin-sub">
                {#if mergeRequest}
                  {(t('finalizeInstance.steps.handoff.existing') as (number: string, base: string) => string)(mergeRequest.number, mergeRequest.targetBranch)}
                {:else if $hasForge || mrUrl}
                  {(t('finalizeInstance.steps.handoff.ready') as (base: string) => string)(instance.baseBranch)}
                {:else}
                  {t('finalizeInstance.steps.handoff.noRemote')}
                {/if}
              </span>
            </div>
            <div class="fin-actions">
              {#if mergeRequest}
                <span class="fin-branch selectable">{mergeRequest.url}</span>
                <CopyButton value={mergeRequest.url} size={12}/>
                <button class="btn step-btn" on:click={openMergeRequest}>
                  <Icon name="external" size={12}/>
                  {t('finalizeInstance.steps.handoff.open')}
                </button>
              {:else}
                <span class="fin-branch selectable">{instance.branch}</span>
                <CopyButton value={instance.branch} size={12}/>
                {#if $hasForge}
                  {#if mrState.isRefreshing && !mrState.isLoaded}
                    <Spinner size={11} trackColor="var(--bg-3)" color="var(--fg-3)"/>
                  {:else}
                    <button class="btn step-btn" disabled={!stepEnabled.handoff || !!busyStep} on:click={() => (isMrFormOpen = !isMrFormOpen)}>
                      <Icon name={isMrFormOpen ? 'chev-u' : 'plus'} size={12}/>
                      {t('finalizeInstance.steps.handoff.action')}
                    </button>
                  {/if}
                {:else if mrUrl}
                  <button class="btn step-btn" disabled={!stepEnabled.handoff || !!busyStep} on:click={doHandoff}>
                    <Icon name="external" size={12}/>
                    {t('finalizeInstance.steps.handoff.action')}
                  </button>
                {/if}
              {/if}
            </div>
          </li>

          {#if isMrFormOpen && !mergeRequest && $hasForge}
            <li class="fin-step fin-mr-form">
              <MergeRequestForm
                projectId={instance.projectId}
                instanceId={instance.id}
                sourceBranch={instance.branch}
                targetBranch={instance.baseBranch}
                worktreePath={instance.worktreePath}
                {ticket}
                on:created={onMergeRequestCreated}
                on:cancel={() => (isMrFormOpen = false)}
              />
            </li>
          {/if}

          <li class="fin-step" class:muted={!stepEnabled.close}>
            <span class="fin-mark" class:ok={stepStates.close}>
              <Icon name={stepStates.close ? 'check' : 'circle-dot'} size={12}/>
            </span>
            <div class="fin-text">
              <span class="fin-title">{t('finalizeInstance.steps.close.title')}</span>
              <span class="fin-sub">
                {stepStates.close
                  ? t('finalizeInstance.steps.close.marked')
                  : t('finalizeInstance.steps.close.pending')}
              </span>
            </div>
            <button class="btn step-btn" disabled={!stepEnabled.close || !!busyStep} on:click={stepStates.close ? doReopen : doClose}>
              {#if busyStep === 'close'}
                <Spinner size={11} trackColor="var(--bg-3)" color="var(--fg-3)"/>
              {:else if stepStates.close}
                <Icon name="undo" size={12}/>
              {/if}
              {stepStates.close
                ? t('finalizeInstance.steps.close.reopen')
                : t('finalizeInstance.steps.close.action')}
            </button>
          </li>
        </ol>

        {#if stepStates.close}
          <div class="fin-cleanup">
            <div class="fin-text">
              <span class="fin-title">{t('finalizeInstance.cleanup.title')}</span>
              <span class="fin-sub">{t('finalizeInstance.cleanup.description')}</span>
            </div>
            <button class="btn step-btn danger-text" disabled={deleting} on:click={() => pendingDelete = true}>
              {#if deleting}
                <Spinner size={11} trackColor="var(--bg-3)" color="var(--fg-3)"/>
              {:else}
                <Icon name="trash" size={12}/>
              {/if}
              {t('finalizeInstance.cleanup.action')}
            </button>
          </div>
        {/if}
      {/if}

      {#if hasTransitionFailed}
        <div class="git-error-banner">
          <Icon name="alert" size={14}/>
          <div class="git-error-text">
            <span class="git-error-title">{t('ticket.transitionFailed')}</span>
          </div>
        </div>
      {/if}

      {#if gitError}
        <div class="git-error-banner">
          <Icon name="alert" size={14}/>
          <div class="git-error-text">
            <span class="git-error-title">{gitError.title}</span>
            <span class="git-error-hint">{gitError.hint}</span>
          </div>
        </div>
      {/if}
    </div>

    <div class="modal-foot">
      <button class="btn step-btn" disabled={checking || !!busyStep} on:click={() => loadState(true)}>
        {#if checking}
          <Spinner size={11} trackColor="var(--bg-3)" color="var(--fg-3)"/>
        {:else}
          <Icon name="refresh" size={12}/>
        {/if}
        {t('finalizeInstance.recheck')}
      </button>
      <div class="spacer"></div>
      <button class="btn ghost" on:click={() => dispatch('close')}>{t('common.close')}</button>
    </div>
  </div>
</div>

{#if pendingDelete}
  <DeleteInstanceModal
    {instance}
    on:close={() => pendingDelete = false}
    on:confirm={confirmDelete}
  />
{/if}

<style>
  .fin-modal { width: min(620px, 92vw); }

  .fin-intro {
    margin: 0 0 16px;
    font-size: 13px;
    line-height: 1.6;
    color: var(--fg-2);
  }

  .fin-loading { padding: 4px 0; }

  .fin-steps {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .fin-step {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 11px 12px;
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-md);
    background: var(--bg-0);
  }
  .fin-step.muted { opacity: 0.55; }
  .fin-mr-form {
    display: block;
    padding: 14px;
  }

  .fin-mark {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    flex: none;
    border-radius: 50%;
    background: var(--bg-3);
    color: var(--fg-3);
  }
  .fin-mark.ok {
    background: var(--success-weak);
    color: var(--success);
  }

  .fin-text {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .fin-title { font-size: 12.5px; color: var(--fg-0); }
  .fin-sub { font-size: 11.5px; color: var(--fg-3); }

  .fin-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .fin-branch {
    max-width: 150px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-2);
  }

  .fin-cleanup {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 14px;
    padding: 11px 12px;
    border: 1px dashed var(--stroke-1);
    border-radius: var(--r-md);
  }
  .step-btn {
    flex: none;
    padding: 5px 10px;
    font-size: 11.5px;
  }
  .danger-text { color: var(--danger); }

  .git-error-banner {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin-top: 14px;
    padding: 10px 12px;
    border: 1px solid color-mix(in oklch, var(--danger) 40%, var(--stroke-0));
    border-radius: var(--r-md);
    background: color-mix(in oklch, var(--danger) 10%, var(--bg-0));
    color: var(--danger);
  }
  .git-error-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .git-error-title { font-size: 12.5px; color: var(--fg-0); }
  .git-error-hint { font-size: 11.5px; color: var(--fg-2); }
</style>
