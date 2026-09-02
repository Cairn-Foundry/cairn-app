<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * CI/CD step: the pipelines of the instance's branch, each shown as its stages and jobs with the
   * failing one called out, plus the log of the job being looked at. Data comes from the bound CI
   * service through `stores/pipelines.ts`; without a `ci` capability the step points to Integrations.
   */
  import { createEventDispatcher, onDestroy, tick } from 'svelte';
  import { openUrl } from '@tauri-apps/plugin-opener';
  import Icon from '$lib/components/Icon.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import CopyButton from '$lib/components/CopyButton.svelte';
  import PipelineSkeleton from './PipelineSkeleton.svelte';
  import { t } from '$lib/i18n';
  import { activeInstance } from '$lib/stores/instance';
  import { activeProjectId } from '$lib/stores/project';
  import { activeStep } from '$lib/stores/ui.js';
  import { aiEnabled, settings } from '$lib/stores/settings';
  import { capabilities, hasCi } from '$lib/stores/integrations';
  import { git } from '$lib/stores/git';
  import {
    pipelines, pipelineStateFor, loadPipelines, loadMorePipelines, selectPipeline,
    setPipelineQuery, openJobLog, closeJobLog, retryJob, playJob, cancelPipeline,
  } from '$lib/stores/pipelines';
  import { requestAgentDraft } from '$lib/stores/agent-draft';
  import { buildCiFixPrompt } from '$lib/utils/integrations/prompts';
  import { ansiToLines, stripAnsi } from '$lib/utils/integrations/ansi';
  import { buildPipelinesUrl } from '$lib/utils/integrations/links';
  import { formatDuration } from '$lib/utils/format';
  import { EMPTY_PIPELINE_QUERY, type Pipeline, type PipelineJob, type PipelineStatus } from '$lib/types/integrations';

  const dispatch = createEventDispatcher<{ goIntegrations: void }>();

  $: projectId = $activeProjectId ?? '';
  $: instanceId = $activeInstance?.id ?? '';
  /**
   * The base pseudo-instance carries no branch of its own - it stands for the
   * repository itself - so the checked out branch is what its pipelines hang
   * off. Without this the step has no ref and never loads.
   */
  $: branch = $activeInstance?.branch || $git.currentBranch;
  $: state = pipelineStateFor($pipelines, projectId, instanceId);
  $: ciLabel = $capabilities.ci?.label ?? '';

  let loadedFor = '';
  $: if ($activeStep === 'cicd' && $hasCi && projectId && instanceId && branch) {
    const key = `${projectId}:${instanceId}:${branch}`;
    if (loadedFor !== key) {
      loadedFor = key;
      void loadPipelines(projectId, instanceId, branch);
    }
  }

  function refresh() {
    if (!branch) return;
    void loadPipelines(projectId, instanceId, branch);
  }

  let searchQuery = '';
  let statusFilter: PipelineStatus | '' = '';

  const FILTER_STATUSES: PipelineStatus[] = ['success', 'failed', 'running', 'pending', 'canceled'];

  /**
   * Filters are applied by the provider on the whole branch history, so every
   * change reloads from page 1 rather than narrowing the pages already held.
   */
  function applyFilters() {
    if (!branch) return;
    void setPipelineQuery(projectId, instanceId, branch, {
      ...EMPTY_PIPELINE_QUERY,
      status: statusFilter || null,
      text: searchQuery.trim(),
    });
  }

  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  function onSearchInput() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(applyFilters, 300);
  }

  function setStatusFilter(status: PipelineStatus | '') {
    statusFilter = status;
    applyFilters();
  }

  onDestroy(() => clearTimeout(searchTimer));

  $: hasFilters = searchQuery.trim() !== '' || statusFilter !== '';
  /**
   * A reload replaces the list it already shows, so the placeholder keeps its
   * height rather than collapsing to a fixed count and jolting the scroll.
   */
  $: skeletonCards = state.pipelines.length === 0
    ? 3
    : Math.min(state.pipelines.length, 6);
  $: selected = state.pipelines.find((p) => p.id === state.selectedPipelineId) ?? state.pipelines[0] ?? null;

  /**
   * The pipeline list of the branch, not whichever pipeline happens to be
   * selected: the button sits in the header, next to the branch name, so it
   * mirrors what the step shows rather than one row of it.
   */
  $: pipelinesUrl = buildPipelinesUrl($capabilities.forge, branch);

  async function openOnForge() {
    const url = pipelinesUrl || $capabilities.forge?.webUrl;
    if (url) await openUrl(url);
  }

  type PillClass = 'running' | 'passed' | 'failed' | 'pending';
  function pillClass(status: PipelineStatus): PillClass {
    if (status === 'success') return 'passed';
    if (status === 'failed') return 'failed';
    if (status === 'running') return 'running';
    return 'pending';
  }

  function statusLabel(status: PipelineStatus): string {
    return t(`cicd.status.${status}`) as string;
  }

  function relativeTime(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return '<1m';
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    return `${Math.floor(h / 24)}d`;
  }

  function timing(pipeline: Pipeline): string {
    if (pipeline.durationMs !== null && pipeline.finishedAt) {
      const ago = (t('cicd.ago') as (ago: string) => string)(relativeTime(pipeline.finishedAt));
      return `${ago} - ${formatDuration(pipeline.durationMs)}`;
    }
    if (pipeline.startedAt) {
      const ago = (t('cicd.ago') as (ago: string) => string)(relativeTime(pipeline.startedAt));
      return (t('cicd.startedAgo') as (ago: string) => string)(ago);
    }
    return '';
  }

  function jobTime(job: PipelineJob): string {
    if (job.durationMs !== null) return formatDuration(job.durationMs);
    return '-';
  }

  function shortSha(sha: string): string {
    return sha.slice(0, 7);
  }

  function failedJobOf(pipeline: Pipeline): PipelineJob | null {
    const jobs = pipeline.stages.flatMap((s) => s.jobs);
    return jobs.find((j) => j.id === pipeline.failedJobId) ?? jobs.find((j) => j.status === 'failed') ?? null;
  }

  let pendingJobIds = new Set<string>();
  async function runJobAction(jobId: string, action: () => Promise<void>) {
    pendingJobIds = new Set(pendingJobIds).add(jobId);
    try {
      await action();
    } finally {
      const next = new Set(pendingJobIds);
      next.delete(jobId);
      pendingJobIds = next;
    }
  }

  function toggleJobLog(pipeline: Pipeline, job: PipelineJob) {
    if (state.selectedPipelineId !== pipeline.id) selectPipeline(projectId, instanceId, pipeline.id);
    if (state.openJobId === job.id) closeJobLog(projectId, instanceId);
    else void openJobLog(projectId, instanceId, job.id);
  }

  function fixWithAgent(pipeline: Pipeline, job: PipelineJob) {
    if (!instanceId) return;
    const excerpt = state.openJobId === job.id && state.jobLog?.failureExcerpt ? state.jobLog.failureExcerpt : '';
    requestAgentDraft(instanceId, buildCiFixPrompt(job, excerpt, pipeline.sha, $settings.aiFeatures));
    activeStep.set('agent');
  }

  async function fixWithAgentFromBanner(pipeline: Pipeline, job: PipelineJob) {
    if (state.openJobId !== job.id || !state.jobLog) {
      await openJobLog(projectId, instanceId, job.id);
    }
    fixWithAgent(pipeline, job);
  }

  $: logLines = state.jobLog ? ansiToLines(state.jobLog.text) : [];
  $: failureRange = state.jobLog ? findFailureRange(state.jobLog.text, state.jobLog.failureExcerpt) : null;

  /** The [first, last] line indexes covered by the excerpt inside the log, or null when it is not found. */
  function findFailureRange(text: string, excerpt: string | null): [number, number] | null {
    if (!excerpt) return null;
    const plain = stripAnsi(text);
    const needle = stripAnsi(excerpt).trim();
    if (!needle) return null;
    const at = plain.indexOf(needle);
    if (at < 0) {
      const firstLine = needle.split('\n')[0];
      const alt = plain.indexOf(firstLine);
      if (alt < 0) return null;
      const line = plain.slice(0, alt).split('\n').length - 1;
      return [line, line];
    }
    const first = plain.slice(0, at).split('\n').length - 1;
    const last = first + needle.split('\n').length - 1;
    return [first, last];
  }

  let logBody: HTMLElement | null = null;
  async function jumpToFailure() {
    if (!failureRange || !logBody) return;
    await tick();
    const target = logBody.querySelector<HTMLElement>(`[data-line="${failureRange[0]}"]`);
    target?.scrollIntoView({ block: 'center' });
  }

  function handlePipelineScroll(e: Event) {
    const el = e.target as HTMLElement;
    if (!state.hasMore || state.isLoadingMore || !branch) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) {
      void loadMorePipelines(projectId, instanceId, branch);
    }
  }

  function jobLogOf(pipeline: Pipeline): PipelineJob | null {
    if (!state.openJobId) return null;
    return pipeline.stages.flatMap((s) => s.jobs).find((j) => j.id === state.openJobId) ?? null;
  }
</script>

<style>
  .pulse { animation: pulse-dot 1.4s infinite; }
  .status-dot { display: inline-block; width: 6px; height: 6px; border-radius: 3px; background: currentColor; }
  .empty-state {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 8px; height: 100%; padding: 32px; text-align: center; color: var(--fg-3);
  }
  .empty-state .title { color: var(--fg-1); font-size: 13px; }
  .empty-state .body { font-size: 12px; max-width: 400px; line-height: 1.6; }
  .empty-state .btn { margin-top: 8px; }
  .meta { font-size: 11px; }
  .pipeline.dimmed { opacity: 0.65; }
  .pipeline.dimmed:hover { opacity: 0.85; }
  .pipeline-head.clickable { cursor: pointer; }
  .sha { display: inline-flex; align-items: center; gap: 4px; }
  .stage-job.job-btn {
    border-radius: var(--r-xs);
    cursor: pointer; padding-left: 4px; padding-right: 4px;
  }
  .stage-job.job-btn:hover { background: var(--bg-3); }
  .stage-job.job-btn.open { background: var(--accent-weak); }
  .job-actions { display: inline-flex; gap: 2px; margin-left: 4px; }
  .job-action {
    display: inline-flex; align-items: center; justify-content: center;
    width: 18px; height: 18px; border-radius: var(--r-xs);
    background: none; border: 0; color: var(--fg-3); cursor: pointer;
  }
  .job-action:hover { background: var(--bg-3); color: var(--fg-0); }
  .log-panel {
    margin-top: 14px;
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-md);
    background: var(--bg-0);
    overflow: hidden;
  }
  .log-head {
    display: flex; align-items: center; gap: 10px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--stroke-0);
    font-size: 12px; color: var(--fg-1);
  }
  .log-head .job-name { font-family: var(--font-mono); color: var(--fg-0); }
  .log-head .spacer { flex: 1; }
  .log-body {
    max-height: 420px; overflow: auto;
    padding: 10px 12px;
    font-family: var(--font-mono); font-size: 11px; line-height: 1.55;
    color: var(--fg-1);
    white-space: pre-wrap; word-break: break-all;
  }
  .log-body .line { min-height: 1.55em; }
  .log-body .line.failure { background: var(--danger-weak); margin: 0 -12px; padding: 0 12px; }
  .log-body :global(.ansi-bold) { font-weight: 600; }
  .log-body :global(.ansi-dim) { opacity: 0.6; }
  .log-body :global(.ansi-italic) { font-style: italic; }
  .log-body :global(.ansi-underline) { text-decoration: underline; }
  .log-body :global(.ansi-fg-black) { color: var(--fg-3); }
  .log-body :global(.ansi-fg-red), .log-body :global(.ansi-fg-bright-red) { color: var(--danger); }
  .log-body :global(.ansi-fg-green), .log-body :global(.ansi-fg-bright-green) { color: var(--success); }
  .log-body :global(.ansi-fg-yellow), .log-body :global(.ansi-fg-bright-yellow) { color: oklch(0.8 0.15 85); }
  .log-body :global(.ansi-fg-blue), .log-body :global(.ansi-fg-bright-blue) { color: var(--accent); }
  .log-body :global(.ansi-fg-magenta), .log-body :global(.ansi-fg-bright-magenta) { color: oklch(0.7 0.18 330); }
  .log-body :global(.ansi-fg-cyan), .log-body :global(.ansi-fg-bright-cyan) { color: oklch(0.75 0.12 200); }
  .log-body :global(.ansi-fg-white), .log-body :global(.ansi-fg-bright-white) { color: var(--fg-0); }
  .log-body :global(.ansi-bg-red) { background: var(--danger-weak); }
  .log-body :global(.ansi-bg-green) { background: var(--success-weak); }
  .log-body :global(.ansi-bg-yellow) { background: oklch(0.8 0.15 85 / 0.25); }
  .log-body :global(.ansi-bg-blue) { background: var(--accent-weak); }
  .log-truncated { padding: 6px 12px; font-size: 11px; color: var(--fg-3); border-top: 1px solid var(--stroke-0); }
  .log-pending { padding: 14px 12px; }
  .excerpt {
    display: block; margin-top: 4px;
    font-family: var(--font-mono); font-size: 11px; color: var(--fg-2);
    white-space: pre-wrap; word-break: break-all;
    max-height: 4.8em; overflow: hidden;
  }
  .error-banner {
    display: flex; align-items: center; gap: 10px;
    padding: 10px 14px; margin-bottom: 16px;
    border: 1px solid oklch(0.70 0.18 25 / 0.3); border-radius: var(--r-md);
    background: var(--danger-weak); color: var(--fg-1); font-size: 12px;
  }
  .ci-filters { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
  .ci-search {
    flex: 1; min-width: 140px;
    padding: 5px 10px; border: 1px solid var(--stroke-0); border-radius: var(--r-md);
    background: var(--bg-1); color: var(--fg-1); font-size: 12px;
  }
  .ci-search::placeholder { color: var(--fg-3); }
  .ci-status-filters { display: flex; gap: 4px; flex-wrap: wrap; }
  .filter-chip {
    padding: 3px 8px; border: 1px solid var(--stroke-0); border-radius: 999px;
    background: var(--bg-2); color: var(--fg-2); font-size: 11px; cursor: pointer;
  }
  .filter-chip:hover { background: var(--bg-3); color: var(--fg-1); }
  .filter-chip.active { background: var(--accent-weak); border-color: var(--accent); color: var(--accent); }
  .pipeline-list { overflow-y: auto; flex: 1; min-height: 0; }
  .load-more { display: flex; justify-content: center; padding: 12px 0; }
</style>

<div class="ci-wrap">
  {#if !$hasCi}
    <div class="empty-state">
      <Icon name="ci" size={24}/>
      <div class="title">{t('cicd.noCi')}</div>
      <div class="body">{t('cicd.noCiBody')}</div>
      <button class="btn" on:click={() => dispatch('goIntegrations')}>
        <Icon name="link" size={13}/> {t('cicd.goToIntegrations')}
      </button>
    </div>
  {:else}
    <div class="ci-header">
      <h2>{t('cicd.title')}</h2>
      <span class="dim mono meta">{(t('cicd.onBranch') as (branch: string) => string)(branch)}</span>
      <div class="spacer"></div>
      <button class="btn" on:click={refresh} disabled={state.isRefreshing}>
        {#if state.isRefreshing}<Spinner size={13}/>{:else}<Icon name="refresh" size={13}/>{/if} {t('cicd.refresh')}
      </button>
      <button class="btn" on:click={openOnForge}>
        <Icon name="external" size={13}/> {(t('cicd.openOnForge') as (service: string) => string)(ciLabel)}
      </button>
    </div>

    {#if state.error}
      <div class="error-banner">
        <Icon name="alert" size={14} style="color: var(--danger)"/>
        <span>{t(`integrations.errors.${state.error.code}`)}</span>
      </div>
    {/if}

    <div class="ci-filters">
      <input
        class="ci-search"
        type="text"
        placeholder={t('cicd.search') as string}
        bind:value={searchQuery}
        on:input={onSearchInput}
      />
      <div class="ci-status-filters">
        <button class="filter-chip" class:active={statusFilter === ''} on:click={() => setStatusFilter('')}>{t('cicd.allStatuses')}</button>
        {#each FILTER_STATUSES as s}
          <button class="filter-chip {pillClass(s)}" class:active={statusFilter === s} on:click={() => setStatusFilter(statusFilter === s ? '' : s)}>{statusLabel(s)}</button>
        {/each}
      </div>
    </div>

    {#if !state.isLoaded || state.isRefreshing}
      <PipelineSkeleton cards={skeletonCards}/>
    {:else if state.pipelines.length === 0}
      <div class="empty-state">
        <Icon name="ci" size={24}/>
        <div class="body">{hasFilters ? t('cicd.noMatch') : t('cicd.noPipelines')}</div>
      </div>
    {:else}
      <div class="pipeline-list" on:scroll={handlePipelineScroll}>
      {#each state.pipelines as pipeline (pipeline.id)}
        {@const isExpanded = selected?.id === pipeline.id}
        {@const failedJob = pipeline.status === 'failed' ? failedJobOf(pipeline) : null}
        {@const openJob = isExpanded ? jobLogOf(pipeline) : null}
        <div class="pipeline" class:dimmed={!isExpanded}>
          <div
            class="pipeline-head"
            class:clickable={!isExpanded}
            role="button"
            tabindex="0"
            on:click={() => { if (!isExpanded) selectPipeline(projectId, instanceId, pipeline.id); }}
            on:keydown={(e) => { if (!isExpanded && (e.key === 'Enter' || e.key === ' ')) selectPipeline(projectId, instanceId, pipeline.id); }}
          >
            <span class="pipe-id">{pipeline.number}</span>
            <div class="pipe-title">
              {pipeline.title}
              <span class="commit sha">
                <span class="selectable">{shortSha(pipeline.sha)}</span>
                <CopyButton value={pipeline.sha} size={10}/>
              </span>
            </div>
            <div class="spacer"></div>
            <span class="dim mono meta">{timing(pipeline)}</span>
            <span class="status-pill {pillClass(pipeline.status)}">
              {#if pipeline.status === 'running' || pipeline.status === 'pending'}
                <span class="status-dot" class:pulse={pipeline.status === 'running'}></span>
              {:else if pipeline.status === 'success'}
                <Icon name="check" size={10}/>
              {:else if pipeline.status === 'failed'}
                <Icon name="x" size={10}/>
              {/if}
              {statusLabel(pipeline.status)}
            </span>
          </div>

          <div class="stages">
            {#each pipeline.stages as stage, i (stage.name + i)}
              <div class="stage-card">
                <div class="stage-name">{i + 1}. {stage.name}</div>
                {#each stage.jobs as job (job.id)}
                  <div
                    class="stage-job job-btn {pillClass(job.status)}"
                    class:open={state.openJobId === job.id && isExpanded}
                    title={statusLabel(job.status)}
                    role="button"
                    tabindex="0"
                    on:click={() => toggleJobLog(pipeline, job)}
                    on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleJobLog(pipeline, job); } }}
                  >
                    <span class="dot"></span>
                    <span>{job.name}</span>
                    <span class="time">{jobTime(job)}</span>
                    {#if job.canRetry || job.canCancel || job.isManual}
                      <span class="job-actions">
                        {#if pendingJobIds.has(job.id)}
                          <span class="job-action"><Spinner size={10}/></span>
                        {:else}
                          {#if job.isManual}
                            <button class="job-action" title={t('cicd.play') as string} aria-label={t('cicd.play') as string}
                              on:click|stopPropagation={() => runJobAction(job.id, () => playJob(projectId, instanceId, pipeline.id, job.id))}>
                              <Icon name="play" size={10}/>
                            </button>
                          {/if}
                          {#if job.canRetry}
                            <button class="job-action" title={t('cicd.retry') as string} aria-label={t('cicd.retry') as string}
                              on:click|stopPropagation={() => runJobAction(job.id, () => retryJob(projectId, instanceId, pipeline.id, job.id))}>
                              <Icon name="refresh" size={10}/>
                            </button>
                          {/if}
                          {#if job.canCancel}
                            <button class="job-action" title={t('cicd.cancel') as string} aria-label={t('cicd.cancel') as string}
                              on:click|stopPropagation={() => runJobAction(job.id, () => cancelPipeline(projectId, instanceId, pipeline.id))}>
                              <Icon name="stop" size={10}/>
                            </button>
                          {/if}
                        {/if}
                      </span>
                    {/if}
                  </div>
                {/each}
              </div>
            {/each}
          </div>

          {#if openJob}
            <div class="log-panel">
              <div class="log-head">
                <span>{t('cicd.log')}</span>
                <span class="job-name">{openJob.name}</span>
                <div class="spacer"></div>
                {#if failureRange && openJob.status === 'failed'}
                  <button class="btn" on:click={jumpToFailure}><Icon name="alert" size={12}/> {t('cicd.jumpToFailure')}</button>
                {/if}
                <button class="btn" on:click={() => openUrl(openJob.url)}><Icon name="external" size={12}/> {t('cicd.openJob')}</button>
                <button class="btn" aria-label={t('common.close') as string} title={t('common.close') as string} on:click={() => closeJobLog(projectId, instanceId)}><Icon name="x" size={12}/></button>
              </div>
              {#if state.isLogLoading}
                <div class="log-pending"><Skeleton lines={6} height={10} gap={8}/></div>
              {:else if state.jobLog}
                <div class="log-body selectable" bind:this={logBody}>
                  {#each logLines as line, index}
                    <div class="line" class:failure={failureRange !== null && openJob.status === 'failed' && index >= failureRange[0] && index <= failureRange[1]} data-line={index}>{@html line}</div>
                  {/each}
                </div>
                {#if state.jobLog.truncated}
                  <div class="log-truncated">{t('cicd.logTruncated')}</div>
                {/if}
              {/if}
            </div>
          {/if}

          {#if isExpanded && failedJob}
            <div class="pipeline-log-link error">
              <Icon name="alert" size={14} style="color: var(--danger)"/>
              <div class="msg">
                <b style="color: var(--danger)">{(t('cicd.failed') as (job: string) => string)(failedJob.name)}</b>
                {#if state.openJobId === failedJob.id && state.jobLog?.failureExcerpt}
                  <span class="excerpt selectable">{stripAnsi(state.jobLog.failureExcerpt)}</span>
                {/if}
              </div>
              {#if $aiEnabled}
                <button class="fix-with-agent" style="padding: 6px 10px; font-size: 12px;" on:click={() => fixWithAgentFromBanner(pipeline, failedJob)}>
                  <Icon name="sparkles" size={12}/> {t('cicd.fixWithAgent')}
                </button>
              {/if}
            </div>
          {/if}
        </div>
      {/each}

      {#if state.isLoadingMore}
        <div class="load-more"><Spinner size={13}/></div>
      {/if}
      </div>
    {/if}
  {/if}
</div>
