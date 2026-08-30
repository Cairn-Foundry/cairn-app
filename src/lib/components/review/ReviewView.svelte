<script lang="ts">
  /**
   * Review step: the guide of the branch, and the raw diff behind it. The header
   * is the merge request when the forge knows one, the local comparison
   * otherwise; the body is whichever mode the reviewer left it in. The diff
   * always comes from the local repository; only the discussions go through the
   * network.
   */
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { renderRemoteMarkdown } from '$lib/utils/integrations/markdown';
  import Icon from '$lib/components/Icon.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import ModeToggle from '$lib/components/ModeToggle.svelte';
  import { t, type TranslationKey } from '$lib/i18n';
  import {
    commitExists,
    fetch as gitFetch,
    toGitError,
  } from '$lib/services/git-service';
  import { activeInstance } from '$lib/stores/instance';
  import { forgeTerms, hasForge } from '$lib/stores/integrations';
  import {
    approveMergeRequest,
    loadDiscussions,
    loadMergeRequest,
    mergeRequestStateFor,
    mergeRequests,
    replyToDiscussion,
    selectDiscussion,
    setDiscussionResolved,
  } from '$lib/stores/merge-request';
  import {
    addComment,
    deleteComment,
    editComment,
    loadReview,
    openReview,
    reviewAction,
    setDiffMode,
    setDiscussionFilter,
    setDiscussionsOpen,
    setMergeRequestId,
    setSelectedPath,
    reviewHunks,
    reviewStates,
    type ReviewScope,
  } from '$lib/stores/review';
  import { emptyReviewState } from '$lib/types/review';
  import type { Discussion } from '$lib/types/integrations';
  import { describeGitError } from '$lib/utils/git/git-error';
  import MergeRequestForm from '$lib/components/git/MergeRequestForm.svelte';
  import ReviewDiff from './ReviewDiff.svelte';
  import ReviewGuide from './ReviewGuide.svelte';
  import { aiEnabled } from '$lib/stores/settings';

  const renderMarkdown = renderRemoteMarkdown;

  $: instance = $activeInstance;
  $: mrState = instance ? mergeRequestStateFor($mergeRequests, instance.projectId, instance.id) : null;
  $: mr = $hasForge && mrState ? mrState.mergeRequest : null;
  $: isMrLoading = $hasForge && !!mrState && !mrState.isLoaded;

  $: base = mr ? mr.targetBranch : (instance?.baseBranch ?? '');
  /**
   * Without a merge request the comparison rests on the instance's base branch.
   * Unset - or set to the branch itself, which older instances carry - it would
   * compare the branch with itself and show an empty diff with no explanation.
   */
  $: isBaseUnusable = !mr && ((base ?? '').trim() === '' || base === instance?.branch);
  $: head = mr ? mr.headSha : 'HEAD';
  $: worktreePath = instance?.worktreePath ?? '';

  $: scope = instance
    ? ({ projectId: instance.projectId, instanceId: instance.id, worktreePath } satisfies ReviewScope)
    : null;
  $: scopeKey = scope ? `${scope.projectId}:${scope.instanceId}` : '';
  $: reviewState = $reviewStates[scopeKey] ?? emptyReviewState();
  $: hunks = $reviewHunks[scopeKey] ?? [];

  // The stored state is read as soon as the instance is known, so the panel and
  // the file being read are right from the first frame rather than after the
  // diff resolves - or never, on a branch with no base to compare against.
  let loadedFor = '';
  $: if (scope && scopeKey && loadedFor !== scopeKey) {
    loadedFor = scopeKey;
    void loadReview(scope);
  }

  let openedFor = '';
  $: if (scope && worktreePath && base && !isHeadMissing) {
    const key = `${scopeKey}|${base}|${head}`;
    if (openedFor !== key) {
      openedFor = key;
      void openReview(scope, base, head);
    }
  }

  $: if (scope) setMergeRequestId(scope, mr?.id ?? '');

  let mrLoadedFor = '';
  $: if (instance && $hasForge && mrState && !mrState.isLoaded && !mrState.isRefreshing) {
    const key = `${instance.projectId}:${instance.id}`;
    if (mrLoadedFor !== key) {
      mrLoadedFor = key;
      void loadMergeRequest(instance.projectId, instance.id, instance.branch);
    }
  }

  let discussionsLoadedFor = '';
  $: if (instance && mr && mrState && !mrState.areDiscussionsLoaded) {
    if (discussionsLoadedFor !== mr.id) {
      discussionsLoadedFor = mr.id;
      void loadDiscussions(instance.projectId, instance.id);
    }
  }

  let isHeadMissing = false;
  let isFetching = false;
  let headCheckedFor = '';
  $: if (mr && worktreePath) {
    const key = `${worktreePath}:${mr.headSha}`;
    if (headCheckedFor !== key) {
      headCheckedFor = key;
      void checkHead(worktreePath, mr.headSha);
    }
  } else {
    isHeadMissing = false;
  }

  async function checkHead(path: string, sha: string) {
    try {
      isHeadMissing = !(await commitExists(path, sha));
      if (isHeadMissing) gitError = '';
    } catch {
      isHeadMissing = false;
    }
  }

  async function fetchHead() {
    if (!worktreePath || isFetching) return;
    isFetching = true;
    try {
      await gitFetch(worktreePath);
      headCheckedFor = '';
      refreshToken += 1;
    } catch (err) {
      gitError = describeGitError(toGitError(err)).title;
    } finally {
      isFetching = false;
    }
  }

  let gitError = '';
  let areFilesLoading = false;
  let refreshToken = 0;

  function refresh() {
    if (instance && $hasForge) {
      void loadMergeRequest(instance.projectId, instance.id, instance.branch);
      discussionsLoadedFor = '';
    }
    openedFor = '';
    refreshToken += 1;
  }

  $: discussions = mrState?.discussions ?? [];
  $: selectedDiscussionId = mrState?.selectedDiscussionId ?? '';
  $: forgeError = mrState?.error ?? null;
  /** Every remark of the guide, flattened, for the gutter of the diff mode. */
  $: remarks = (reviewState.guide?.chapters ?? []).flatMap(c => c.remarks);

  let replyingIds = new Set<string>();
  let resolvingIds = new Set<string>();

  async function reply(discussion: Discussion, body: string) {
    if (!instance) return;
    replyingIds = new Set(replyingIds).add(discussion.id);
    try {
      await replyToDiscussion(instance.projectId, instance.id, discussion.id, body).catch(() => undefined);
    } finally {
      const next = new Set(replyingIds);
      next.delete(discussion.id);
      replyingIds = next;
    }
  }

  async function resolve(discussion: Discussion, resolved: boolean) {
    if (!instance) return;
    resolvingIds = new Set(resolvingIds).add(discussion.id);
    try {
      await setDiscussionResolved(instance.projectId, instance.id, discussion.id, resolved).catch(() => undefined);
    } finally {
      const next = new Set(resolvingIds);
      next.delete(discussion.id);
      resolvingIds = next;
    }
  }

  let isMrFormOpen = false;

  let isApproving = false;
  async function toggleApproval() {
    if (!instance || !mr || isApproving) return;
    isApproving = true;
    try {
      await approveMergeRequest(instance.projectId, instance.id, !mr.approvals.approvedByMe).catch(() => undefined);
    } finally {
      isApproving = false;
    }
  }

  function openInBrowser() {
    if (mr?.url) void openUrl(mr.url);
  }

  function pipelineClass(status: string): string {
    if (status === 'success') return 'ok';
    if (status === 'failed') return 'bad';
    if (status === 'running' || status === 'pending') return 'busy';
    return '';
  }

  $: if (!$aiEnabled && !reviewState.isDiffMode) showMode(true);

  function showMode(isDiff: boolean) {
    if (scope) setDiffMode(scope, isDiff);
  }

  let diffView: ReviewDiff | null = null;
  let guideView: ReviewGuide | null = null;

  let lastActionAt = 0;
  $: if ($reviewAction && $reviewAction.at !== lastActionAt) {
    lastActionAt = $reviewAction.at;
    const id = $reviewAction.id;
    if (id === 'reviewToggleMode') showMode(!reviewState.isDiffMode);
    else guideView?.executeAction(id);
  }

  /** Following a remark from the guide means opening the diff on its line. */
  function onOpenInDiff(e: CustomEvent<{ path: string; line: number; side: 'old' | 'new' }>) {
    showMode(true);
    requestAnimationFrame(() => diffView?.goTo(e.detail.path, e.detail.line, e.detail.side));
  }
</script>

<div class="review-root">
  <div class="review-header">
    {#if isMrLoading}
      <div class="header-skeleton"><Skeleton lines={1} height={14}/></div>
    {:else if mr}
      <span class="mr-number mono selectable">{mr.number}</span>
      <span class="mr-title" title={mr.title}>{mr.title}</span>
      <span class="sep" aria-hidden="true"></span>
      <span class="target dim">
        <Icon name="branch" size={11}/> {(t('mergeRequest.targetInto') as (b: string) => string)(mr.targetBranch)}
      </span>
      <!--
        The badges sit after the target and read outward from the reviewer:
        what is asked of them (approvals), then where the request stands
        (draft / merged / closed), then what the machines said (pipeline).
      -->
      <span class="sep" aria-hidden="true"></span>
      <span class="pill" class:ok={mr.approvals.approvedByMe}>
        {(t('mergeRequest.approvals') as (n: number, total: number | null) => string)(mr.approvals.approved, mr.approvals.required)}
      </span>
      {#if mr.isDraft}<span class="pill draft">{t('mergeRequest.draft')}</span>{/if}
      <span class="pill state-{mr.state}">{t(`mergeRequest.state.${mr.state}` as TranslationKey)}</span>
      {#if mr.pipelineStatus}
        <span class="pill ci {pipelineClass(mr.pipelineStatus)}">
          {#if mr.pipelineStatus === 'running' || mr.pipelineStatus === 'pending'}<Spinner size={10}/>{/if}
          {t(`cicd.status.${mr.pipelineStatus}` as TranslationKey)}
        </span>
      {/if}
      <span class="spacer"></span>
      <button class="btn small" disabled={isApproving || mr.state !== 'open'} on:click={toggleApproval}>
        {#if isApproving}<Spinner size={11}/>{:else}<Icon name="check" size={12}/>{/if}
        {mr.approvals.approvedByMe ? t('mergeRequest.revoke') : t('mergeRequest.approve')}
      </button>
      <button class="btn ghost small" on:click={openInBrowser} title={t('mergeRequest.openInBrowser') as string}>
        <Icon name="external" size={12}/> {t('mergeRequest.openInBrowser')}
      </button>
    {:else}
      <span class="local-title">{t('review.localDiff')}</span>
      {#if base}
        <span class="mono dim selectable">{(t('review.compare') as (b: string, h: string) => string)(base, head)}</span>
      {/if}
      <span class="spacer"></span>
      {#if $hasForge && instance}
        <button class="btn primary small" on:click={() => (isMrFormOpen = true)}>
          <Icon name="plus" size={12}/> {t(`integrations.terms.${$forgeTerms}.chipCreate` as TranslationKey)}
        </button>
      {/if}
    {/if}
    {#if $aiEnabled}
      <ModeToggle
        options={[
          { value: 'guide', label: t('review.guide') as string },
          { value: 'diff', label: t('review.diff') as string },
        ]}
        value={reviewState.isDiffMode ? 'diff' : 'guide'}
        ariaLabel={t('review.toggleGuideDiff') as string}
        on:select={(e) => showMode(e.detail === 'diff')}
      />
    {/if}
    <button class="btn ghost small icon-only" on:click={refresh} title={t('integrations.refresh') as string} disabled={areFilesLoading || !!mrState?.isRefreshing}>
      {#if areFilesLoading || mrState?.isRefreshing}<Spinner size={11}/>{:else}<Icon name="refresh" size={12}/>{/if}
    </button>
  </div>

  {#if forgeError}
    <div class="banner error">
      <Icon name="alert" size={12}/>
      <span>{t(`integrations.errors.${forgeError.code}` as TranslationKey)}</span>
    </div>
  {/if}
  {#if gitError}
    <div class="banner error">
      <Icon name="alert" size={12}/>
      <span>{gitError}</span>
    </div>
  {/if}
  {#if mr && isHeadMissing}
    <div class="banner">
      <Icon name="info" size={12}/>
      <span>{t('review.fetchHeadBody')}</span>
      <button class="btn small" disabled={isFetching} on:click={fetchHead}>
        {#if isFetching}<Spinner size={11}/>{:else}<Icon name="download" size={12}/>{/if}
        {t('review.fetchHead')}
      </button>
    </div>
  {/if}

  {#if isBaseUnusable}
    <div class="base-missing">
      <Icon name="branch" size={26} style="color: var(--fg-3)"/>
      <h3>{t('review.noBase')}</h3>
      <p class="base-note">{t('review.noBaseBody')}</p>
      <p class="base-note dim">{t('review.noBaseWhere')}</p>
    </div>
  {:else if scope && !reviewState.isDiffMode && $aiEnabled}
    <ReviewGuide
      bind:this={guideView}
      {scope}
      {base}
      {head}
      state={reviewState}
      {hunks}
      mrTitle={mr?.title ?? ''}
      mrDescription={mr?.description ?? ''}
      ticket={instance?.ticket.key ? { key: instance.ticket.key, title: instance.ticket.title } : null}
      hasMergeRequest={!!mr}
      on:openInDiff={onOpenInDiff}
    />
  {:else}
    <ReviewDiff
      bind:this={diffView}
      {worktreePath}
      {base}
      {head}
      {isHeadMissing}
      hasMergeRequest={!!mr}
      {discussions}
      {selectedDiscussionId}
      areDiscussionsLoaded={!!mrState?.areDiscussionsLoaded}
      {replyingIds}
      {resolvingIds}
      {renderMarkdown}
      {remarks}
      comments={reviewState.comments}
      {hunks}
      seenHunks={reviewState.seenHunks}
      {refreshToken}
      isDiscussionsOpen={reviewState.isDiscussionsOpen}
      initialPath={reviewState.selectedPath}
      initialFilter={reviewState.discussionFilter}
      on:filterChange={(e) => scope && setDiscussionFilter(scope, e.detail.filter)}
      on:selectPath={(e) => scope && setSelectedPath(scope, e.detail.path)}
      on:discussionsToggle={(e) => scope && setDiscussionsOpen(scope, e.detail.isOpen)}
      on:error={(e) => (gitError = e.detail.message)}
      on:loading={(e) => (areFilesLoading = e.detail.isLoading)}
      on:selectDiscussion={(e) => instance && selectDiscussion(instance.projectId, instance.id, e.detail.id)}
      on:reply={(e) => reply(e.detail.discussion, e.detail.body)}
      on:resolve={(e) => resolve(e.detail.discussion, e.detail.resolved)}
      on:addComment={(e) => scope && addComment(scope, e.detail)}
      on:deleteComment={(e) => scope && deleteComment(scope, e.detail.id)}
      on:editComment={(e) => scope && editComment(scope, e.detail.id, e.detail.body)}
      on:openFile
    />
  {/if}
</div>

{#if isMrFormOpen && instance}
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
          <div class="step-count">{t(`integrations.terms.${$forgeTerms}.one` as TranslationKey)}</div>
          <h3>{t(`integrations.terms.${$forgeTerms}.create` as TranslationKey)}</h3>
        </div>
        <button class="icon-btn close" on:click={() => (isMrFormOpen = false)} aria-label={t('common.close') as string}>
          <Icon name="x" size={16} />
        </button>
      </div>
      <div class="modal-body">
        <MergeRequestForm
          projectId={instance.projectId}
          instanceId={instance.id}
          sourceBranch={instance.branch}
          targetBranch={instance.baseBranch}
          worktreePath={instance.worktreePath}
          ticket={instance.ticket.key
            ? { key: instance.ticket.key, title: instance.ticket.title, url: instance.ticket.url ?? '' }
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

  .base-missing {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 24px;
    min-height: 0;
    text-align: center;
  }
  .base-missing h3 { margin: 0; font-size: 14px; color: var(--fg-0); }
  .base-note { margin: 0; max-width: 430px; font-size: 12px; color: var(--fg-2); line-height: 1.55; }
  .base-note.dim { color: var(--fg-3); }

  .review-root {
    /* `.step-view` is a row flex container, so the root has to claim the main
       axis: with height alone it collapses to the width of its content and the
       whole step renders as a narrow column. */
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .review-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 12px;
    height: 40px;
    flex-shrink: 0;
    border-bottom: 1px solid var(--stroke-0);
    font-size: 12px;
    color: var(--fg-1);
    min-width: 0;
  }
  .header-skeleton { flex: 1; max-width: 360px; }
  .spacer { flex: 1; }
  .dim { color: var(--fg-3); }
  .mr-number { color: var(--fg-2); font-size: 12px; }
  .mr-title {
    font-weight: 600;
    color: var(--fg-0);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 40%;
  }
  .local-title { font-weight: 600; color: var(--fg-0); }

  /* Splits the header into its three readings: which request, where it goes,
     and how it stands. Decorative, so it is hidden from assistive tech. */
  .sep {
    width: 1px;
    height: 14px;
    flex-shrink: 0;
    background: var(--stroke-0);
  }
  /* The title is the only thing that gives way: the target and the badges are
     short and must stay legible whatever the window width. */
  .target {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11.5px;
    flex-shrink: 0;
    white-space: nowrap;
  }

  .pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 7px;
    border-radius: 999px;
    font-size: 10.5px;
    line-height: 1;
    background: var(--bg-3);
    color: var(--fg-2);
    white-space: nowrap;
    flex-shrink: 0;
  }
  .pill.state-open { color: var(--success); background: oklch(0.78 0.14 135 / 0.16); }
  .pill.state-merged { color: var(--accent); background: oklch(0.7 0.14 280 / 0.16); }
  .pill.state-closed { color: var(--danger); background: oklch(0.70 0.18 15 / 0.16); }
  .pill.draft { color: oklch(0.82 0.14 60); background: oklch(0.82 0.14 60 / 0.16); }
  .pill.ok { color: var(--success); }
  .pill.ci.ok { color: var(--success); }
  .pill.ci.bad { color: var(--danger); }
  .pill.ci.busy { color: var(--accent); }

  .btn.small { padding: 3px 8px; font-size: 11.5px; display: inline-flex; align-items: center; gap: 5px; }
  .btn.icon-only { padding: 3px 5px; }

  .banner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    font-size: 11.5px;
    color: var(--fg-1);
    background: var(--bg-2);
    border-bottom: 1px solid var(--stroke-0);
    flex-shrink: 0;
  }
  .banner.error { color: var(--danger); background: var(--danger-weak); }
  .banner span { flex: 1; }
</style>
