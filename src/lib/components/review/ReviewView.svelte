<script lang="ts">
  /**
   * Review step: the merge request of the branch when the forge knows one, the
   * local diff against the base branch otherwise. The diff always comes from
   * the local repository; only the discussions go through the network.
   */
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { renderRemoteMarkdown } from '$lib/utils/integrations/markdown';
  import Icon from '$lib/components/Icon.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import { t, type TranslationKey } from '$lib/i18n';
  import { langFromPath } from '$lib/services/file-service';
  import {
    commitExists,
    fetch as gitFetch,
    getDiffFileBetween,
    getDiffFilesBetween,
    toGitError,
    type GitChangedFile,
    type GitFileBetween,
  } from '$lib/services/git-service';
  import { requestAgentDraft } from '$lib/stores/agent-draft';
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
  import { settings } from '$lib/stores/settings';
  import { activeStep } from '$lib/stores/ui';
  import type { Discussion } from '$lib/types/integrations';
  import type { EditorLanguage } from '$lib/utils/editor/editor-theme';
  import { basename, parentPathOf } from '$lib/utils/files/files-tree';
  import { describeGitError } from '$lib/utils/git/git-error';
  import { buildReviewAddressPrompt } from '$lib/utils/integrations/prompts';
  import {
    diffMarkersFor,
    discussionsForFile,
    excerptAround,
    normalizeAnchorPath,
    openDiscussionCount,
  } from '$lib/utils/review/diff-markers';
  import MergeRequestForm from '$lib/components/git/MergeRequestForm.svelte';
  import DiffEditor from './DiffEditor.svelte';
  import ReviewDiscussion from './ReviewDiscussion.svelte';

  const renderMarkdown = renderRemoteMarkdown;

  $: instance = $activeInstance;
  $: mrState = instance ? mergeRequestStateFor($mergeRequests, instance.projectId, instance.id) : null;
  $: mr = $hasForge && mrState ? mrState.mergeRequest : null;
  $: isMrLoading = $hasForge && !!mrState && !mrState.isLoaded;

  $: base = mr ? mr.targetBranch : (instance?.baseBranch ?? '');
  $: head = mr ? mr.headSha : 'HEAD';
  $: worktreePath = instance?.worktreePath ?? '';

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
      filesLoadedFor = '';
    } catch (err) {
      gitError = describeGitError(toGitError(err)).title;
    } finally {
      isFetching = false;
    }
  }

  let files: GitChangedFile[] = [];
  let areFilesLoading = false;
  let filesLoadedFor = '';
  let gitError = '';
  let selectedPath = '';

  $: filesKey = `${worktreePath}|${base}|${head}|${isHeadMissing}`;
  $: if (worktreePath && base && !isHeadMissing && filesLoadedFor !== filesKey) {
    filesLoadedFor = filesKey;
    void loadFiles(worktreePath, base, head);
  }

  async function loadFiles(path: string, from: string, to: string) {
    areFilesLoading = true;
    gitError = '';
    const key = filesKey;
    try {
      const next = await getDiffFilesBetween(path, from, to);
      if (key !== filesKey) return;
      files = next;
      if (!files.some(f => f.filePath === selectedPath)) selectedPath = files[0]?.filePath ?? '';
    } catch (err) {
      if (key !== filesKey) return;
      files = [];
      gitError = describeGitError(toGitError(err)).title;
    } finally {
      if (key === filesKey) areFilesLoading = false;
    }
  }

  let fileContent: GitFileBetween | null = null;
  let isFileLoading = false;
  let fileLoadedFor = '';
  $: fileKey = `${filesKey}|${selectedPath}`;
  $: if (worktreePath && selectedPath && !isHeadMissing && fileLoadedFor !== fileKey) {
    fileLoadedFor = fileKey;
    void loadFile(worktreePath, base, head, selectedPath, fileKey);
  }

  async function loadFile(path: string, from: string, to: string, filePath: string, key: string) {
    isFileLoading = true;
    try {
      const next = await getDiffFileBetween(path, from, to, filePath);
      if (key !== fileKey) return;
      fileContent = next;
    } catch (err) {
      fileContent = null;
      gitError = describeGitError(toGitError(err)).title;
    } finally {
      if (key === fileKey) isFileLoading = false;
    }
  }

  function refresh() {
    if (instance && $hasForge) {
      void loadMergeRequest(instance.projectId, instance.id, instance.branch);
      discussionsLoadedFor = '';
    }
    filesLoadedFor = '';
    fileLoadedFor = '';
  }

  $: selectedFile = files.find(f => f.filePath === selectedPath) ?? null;
  $: language = (selectedPath ? langFromPath(selectedPath) : 'text') as EditorLanguage;
  $: discussions = mrState?.discussions ?? [];
  $: anchoredDiscussions = selectedPath ? discussionsForFile(discussions, selectedPath) : [];
  $: generalDiscussions = discussions.filter(d => d.anchor === null);
  $: markers = selectedPath ? diffMarkersFor(discussions, selectedPath) : [];
  $: selectedDiscussionId = mrState?.selectedDiscussionId ?? '';
  $: forgeError = mrState?.error ?? null;

  let diffEditor: DiffEditor | null = null;

  function badgeClass(status: GitChangedFile['status']): string {
    if (status === 'A') return 'add';
    if (status === 'D') return 'del';
    return 'mod';
  }

  function onMarkerClick(e: CustomEvent<{ line: number; side: 'old' | 'new' }>) {
    if (!instance) return;
    const hit = anchoredDiscussions.find(d => d.anchor?.line === e.detail.line && d.anchor?.side === e.detail.side);
    if (!hit) return;
    selectDiscussion(instance.projectId, instance.id, hit.id);
    document.getElementById(`review-discussion-${hit.id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function jumpTo(discussion: Discussion) {
    if (!discussion.anchor || !instance) return;
    const path = normalizeAnchorPath(discussion.anchor.path);
    if (path !== selectedPath && files.some(f => f.filePath === path)) selectedPath = path;
    selectDiscussion(instance.projectId, instance.id, discussion.id);
    requestAnimationFrame(() => diffEditor?.scrollToLine(discussion.anchor!.line, discussion.anchor!.side));
  }

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

  function addressWithAgent(discussion: Discussion) {
    if (!instance) return;
    const anchor = discussion.anchor;
    const source = anchor
      ? (anchor.side === 'old' ? fileContent?.oldContent : fileContent?.newContent) ?? ''
      : '';
    const excerpt = anchor && normalizeAnchorPath(anchor.path) === selectedPath
      ? excerptAround(source, anchor.line)
      : '';
    const comment = discussion.comments.filter(c => !c.isSystem).map(c => `${c.author.displayName || c.author.login}: ${c.body}`).join('\n\n');
    const prompt = buildReviewAddressPrompt(
      { path: anchor ? normalizeAnchorPath(anchor.path) : '', line: anchor?.line ?? null, excerpt, comment },
      $settings.aiFeatures,
    );
    requestAgentDraft(instance.id, prompt);
    activeStep.set('agent');
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
</script>

<div class="review-root">
  <div class="review-header">
    {#if isMrLoading}
      <div class="header-skeleton"><Skeleton lines={1} height={14}/></div>
    {:else if mr}
      <span class="mr-number mono selectable">{mr.number}</span>
      <span class="mr-title" title={mr.title}>{mr.title}</span>
      <span class="pill state-{mr.state}">{t(`mergeRequest.state.${mr.state}` as TranslationKey)}</span>
      {#if mr.isDraft}<span class="pill draft">{t('mergeRequest.draft')}</span>{/if}
      <span class="pill" class:ok={mr.approvals.approvedByMe}>
        {(t('mergeRequest.approvals') as (n: number, total: number | null) => string)(mr.approvals.approved, mr.approvals.required)}
      </span>
      {#if mr.pipelineStatus}
        <span class="pill pipeline {pipelineClass(mr.pipelineStatus)}">
          {#if mr.pipelineStatus === 'running' || mr.pipelineStatus === 'pending'}<Spinner size={10}/>{/if}
          {t(`cicd.status.${mr.pipelineStatus}` as TranslationKey)}
        </span>
      {/if}
      <span class="target dim">
        <Icon name="branch" size={11}/> {(t('mergeRequest.targetInto') as (b: string) => string)(mr.targetBranch)}
      </span>
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

  <div class="review-layout">
    <aside class="files-list">
      <div class="files-section-title">{(t('review.changedFiles') as (n: number) => string)(files.length)}</div>
      {#if areFilesLoading && files.length === 0}
        <div class="files-skeleton"><Skeleton lines={6} height={12} gap={10}/></div>
      {:else if files.length === 0}
        <div class="empty-note">{base ? (t('review.noChanges') as (b: string) => string)(base) : ''}</div>
      {:else}
        {#each files as f (f.filePath)}
          {@const openCount = mr ? openDiscussionCount(discussions, f.filePath) : 0}
          <div
            class="file-item {f.filePath === selectedPath ? 'active' : ''}"
            on:click={() => selectedPath = f.filePath}
            role="button"
            tabindex="0"
            on:keydown={(e) => e.key === 'Enter' && (selectedPath = f.filePath)}
            title={f.filePath}
          >
            <span class="badge {badgeClass(f.status)}">{f.status}</span>
            <span class="fname">{f.filePath}</span>
            {#if openCount > 0}
              <span class="disc-count" title={(t('review.openDiscussions') as (n: number) => string)(openCount)}>{openCount}</span>
            {/if}
            <span class="dim mono stat-mini">
              <span class="plus">+{f.additions}</span>
              {#if f.deletions > 0}
                <span class="minus"> -{f.deletions}</span>
              {/if}
            </span>
          </div>
        {/each}
      {/if}
    </aside>

    <div class="diff-pane">
      {#if selectedFile}
        <div class="diff-filebar">
          <Icon name="file" size={14} style="color: var(--fg-2)"/>
          <div class="fp selectable">
            {#if parentPathOf(selectedFile.filePath)}<span class="dir">{parentPathOf(selectedFile.filePath)}/</span>{/if}<b>{basename(selectedFile.filePath)}</b>
          </div>
          <div class="stat">
            <span class="plus">+{selectedFile.additions}</span>
            {#if selectedFile.deletions > 0}
              <span class="minus"> -{selectedFile.deletions}</span>
            {/if}
          </div>
          {#if mr && anchoredDiscussions.length > 0}
            <span class="dim anchored-count">{(t('review.anchoredDiscussions') as (n: number) => string)(anchoredDiscussions.length)}</span>
          {/if}
        </div>

        <div class="diff-editor-wrap">
          {#if isFileLoading && !fileContent}
            <div class="diff-skeleton"><Skeleton lines={14} height={11} gap={9}/></div>
          {:else if fileContent && (fileContent.oldContent !== null || fileContent.newContent !== null)}
            {#key fileKey}
              <DiffEditor
                bind:this={diffEditor}
                oldContent={fileContent.oldContent ?? ''}
                newContent={fileContent.newContent ?? ''}
                {language}
                {markers}
                on:markerClick={onMarkerClick}
              />
            {/key}
          {:else}
            <div class="empty-note">{t('review.noContent')}</div>
          {/if}
        </div>

        {#if mr && anchoredDiscussions.length > 0}
          <div class="anchored-panel">
            {#each anchoredDiscussions as d (d.id)}
              <div id={`review-discussion-${d.id}`}>
                <ReviewDiscussion
                  discussion={d}
                  {renderMarkdown}
                  isSelected={d.id === selectedDiscussionId}
                  isReplying={replyingIds.has(d.id)}
                  isResolving={resolvingIds.has(d.id)}
                  on:select={() => instance && selectDiscussion(instance.projectId, instance.id, d.id)}
                  on:jump={() => jumpTo(d)}
                  on:reply={(e) => reply(d, e.detail.body)}
                  on:resolve={(e) => resolve(d, e.detail.resolved)}
                  on:address={() => addressWithAgent(d)}
                />
              </div>
            {/each}
          </div>
        {/if}
      {:else if !areFilesLoading}
        <div class="empty-note center">{files.length === 0 ? '' : t('review.selectFile')}</div>
      {/if}
    </div>

    {#if mr}
      <aside class="general-panel">
        <div class="files-section-title">{t('review.general')}</div>
        {#if !mrState?.areDiscussionsLoaded}
          <div class="files-skeleton"><Skeleton lines={4} height={12} gap={10}/></div>
        {:else if generalDiscussions.length === 0}
          <div class="empty-note">{t('review.noDiscussions')}</div>
        {:else}
          <div class="general-list">
            {#each generalDiscussions as d (d.id)}
              <ReviewDiscussion
                discussion={d}
                {renderMarkdown}
                isSelected={d.id === selectedDiscussionId}
                isReplying={replyingIds.has(d.id)}
                isResolving={resolvingIds.has(d.id)}
                on:select={() => instance && selectDiscussion(instance.projectId, instance.id, d.id)}
                on:reply={(e) => reply(d, e.detail.body)}
                on:resolve={(e) => resolve(d, e.detail.resolved)}
                on:address={() => addressWithAgent(d)}
              />
            {/each}
          </div>
        {/if}
      </aside>
    {/if}
  </div>
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

  .review-root {
    display: flex;
    flex-direction: column;
    height: 100%;
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
  .target { display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px; }

  .pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 7px;
    border-radius: 999px;
    font-size: 10.5px;
    background: var(--bg-3);
    color: var(--fg-2);
    white-space: nowrap;
  }
  .pill.state-open { color: var(--success); background: oklch(0.78 0.14 135 / 0.16); }
  .pill.state-merged { color: var(--accent); background: oklch(0.7 0.14 280 / 0.16); }
  .pill.state-closed { color: var(--danger); background: oklch(0.70 0.18 15 / 0.16); }
  .pill.draft { color: oklch(0.82 0.14 60); background: oklch(0.82 0.14 60 / 0.16); }
  .pill.ok { color: var(--success); }
  .pill.pipeline.ok { color: var(--success); }
  .pill.pipeline.bad { color: var(--danger); }
  .pill.pipeline.busy { color: var(--accent); }

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

  .review-layout {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .files-list {
    width: 240px;
    flex-shrink: 0;
    border-right: 1px solid var(--stroke-0);
    overflow-y: auto;
    padding-top: 8px;
  }

  .files-section-title {
    padding: 4px 16px;
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--fg-3);
  }

  .files-skeleton { padding: 8px 16px; }
  .diff-skeleton { padding: 16px; }
  .empty-note { padding: 8px 16px; font-size: 11.5px; color: var(--fg-3); }
  .empty-note.center { display: flex; align-items: center; justify-content: center; flex: 1; }

  .file-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 12px;
    cursor: pointer;
    font-size: 12px;
    color: var(--fg-1);
    border-radius: 4px;
    margin: 0 4px;
  }
  .file-item:hover { background: var(--bg-3); }
  .file-item.active { background: var(--bg-4); color: var(--fg-0); }

  .badge {
    font-size: 10px;
    font-weight: 700;
    width: 14px;
    height: 14px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 3px;
    flex-shrink: 0;
  }
  .badge.add { background: oklch(0.78 0.14 135 / 0.18); color: oklch(0.78 0.14 135); }
  .badge.mod { background: oklch(0.82 0.14 60 / 0.18); color: oklch(0.82 0.14 60); }
  .badge.del { background: oklch(0.70 0.18 15 / 0.18); color: oklch(0.70 0.18 15); }

  .fname {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: 11.5px;
    direction: rtl;
    text-align: left;
  }
  .disc-count {
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 8px;
    background: var(--accent);
    color: var(--bg-0);
    font-size: 10px;
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .stat-mini { font-size: 10px; flex-shrink: 0; }

  .diff-pane {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 0;
  }

  .diff-filebar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 12px;
    height: 36px;
    flex-shrink: 0;
    border-bottom: 1px solid var(--stroke-0);
    font-size: 12.5px;
    color: var(--fg-2);
  }
  .fp { flex: 1; font-family: var(--font-mono); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dir { color: var(--fg-3); }
  .stat { display: flex; gap: 4px; font-size: 11.5px; font-family: var(--font-mono); }
  .plus { color: var(--success); }
  .minus { color: var(--danger); }
  .anchored-count { font-size: 11px; margin-left: 8px; }

  .diff-editor-wrap {
    flex: 1;
    position: relative;
    overflow: hidden;
    min-height: 120px;
  }

  .anchored-panel {
    flex-shrink: 0;
    max-height: 40%;
    overflow-y: auto;
    border-top: 1px solid var(--stroke-0);
    padding: 8px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: var(--bg-0);
  }

  .general-panel {
    width: 300px;
    flex-shrink: 0;
    border-left: 1px solid var(--stroke-0);
    overflow-y: auto;
    padding-top: 8px;
    display: flex;
    flex-direction: column;
  }
  .general-list { display: flex; flex-direction: column; gap: 8px; padding: 4px 12px 12px; }
</style>
