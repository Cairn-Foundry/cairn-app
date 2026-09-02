<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * Creation form of a merge request on the bound forge, shared by the branch
   * bar and the finalize modal. Dispatches `created` with the new MR and
   * `cancel`; the parent decides where the form lives.
   */
  import { createEventDispatcher, onMount } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import ActorPicker from '$lib/components/git/ActorPicker.svelte';
  import Select from '$lib/components/Select.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import { t } from '$lib/i18n';
  import { activeProject } from '$lib/stores/project';
  import { git, loadBranches } from '$lib/stores/git';
  import { AiAssistError, runOneShotShaped } from '$lib/services/ai-assist-service';
  import { isAssistCliInstalled, loadCliProviders } from '$lib/stores/cli-providers';
  import { forgeIdentity, forgeTerms } from '$lib/stores/integrations';
  import { createMergeRequest, loadForgeLabels } from '$lib/stores/merge-request';
  import { settings } from '$lib/stores/settings';
  import type { Actor, IntegrationError, MergeRequest } from '$lib/types/integrations';
  import { FEATURE_SCHEMAS, resolveAiFeature } from '$lib/utils/home/ai-features';
  import { buildMrDescriptionPrompt } from '$lib/utils/integrations/prompts';
  import { toIntegrationError } from '$lib/services/integration-service';
  import { errorMessage } from '$lib/utils/error-message';

  export let projectId: string;
  export let instanceId: string;
  export let sourceBranch: string;
  export let targetBranch: string;
  export let worktreePath: string;
  export let ticket: { key: string; title: string; url: string } | null = null;

  const dispatch = createEventDispatcher<{ created: MergeRequest; cancel: void }>();

  let title = '';
  let description = '';
  let isDraft = false;
  let removeSourceBranch = true;
  let isSquash = false;
  let selectedTarget = targetBranch;
  let hasLinkedTicket = ticket !== null;
  let reviewers: Actor[] = [];
  let assignees: Actor[] = [];
  let labels: string[] = [];

  /**
   * The forge account the connection authenticates as: the merge request is
   * assigned to whoever opens it unless that is changed here.
   */
  let hasDefaultedAssignee = false;
  $: if (!hasDefaultedAssignee && $forgeIdentity) {
    hasDefaultedAssignee = true;
    assignees = [{
      login: $forgeIdentity.login,
      displayName: $forgeIdentity.displayName,
      avatarUrl: $forgeIdentity.avatarUrl,
    }];
  }

  let availableLabels: string[] = [];
  let areLabelsLoaded = false;

  let isSubmitting = false;
  let submitError: IntegrationError | null = null;

  let isGenerating = false;
  let generateError = '';
  let generateAbort: AbortController | null = null;
  let aiStatusMessage = '';

  $: terms = $forgeTerms;
  $: resolvedFeature = resolveAiFeature('mrDescription', $settings.aiFeatures, $isAssistCliInstalled);
  $: canGenerate = !resolvedFeature.unavailable && !isGenerating && !isSubmitting;
  $: canSubmit = title.trim() !== '' && !isSubmitting && !isGenerating;
  $: targetOptions = buildTargetOptions($git.branches, $git.remoteBranches);

  /** Every branch the MR could target, source excluded, current target always present. */
  function buildTargetOptions(local: string[], remote: string[]): { value: string; label: string }[] {
    const names = new Set([targetBranch, ...local, ...remote.map(stripRemote)]);
    names.delete(sourceBranch);
    return [...names].sort().map((value) => ({ value, label: value }));
  }

  function stripRemote(name: string): string {
    const slash = name.indexOf('/');
    return slash === -1 ? name : name.slice(slash + 1);
  }

  onMount(() => {
    void loadCliProviders();
    if ($activeProject?.path) void loadBranches($activeProject.path);
    void loadForgeLabels(projectId)
      .then((list) => { availableLabels = list ?? []; })
      .catch(() => { availableLabels = []; })
      .finally(() => { areLabelsLoaded = true; });
  });

  function toggleLabel(label: string) {
    labels = labels.includes(label) ? labels.filter((l) => l !== label) : [...labels, label];
  }

  async function generateWithAi() {
    if (!canGenerate || !worktreePath) return;
    const feature = resolvedFeature;
    isGenerating = true;
    generateError = '';
    generateAbort = new AbortController();
    aiStatusMessage = t('mergeRequest.aiGenerating') as string;
    try {
      const answer = await runOneShotShaped<{ title: string; description: string }>(
        buildMrDescriptionPrompt(selectedTarget, ticket, $settings.aiFeatures),
        worktreePath,
        feature.providerId,
        FEATURE_SCHEMAS.mrDescription,
        { model: feature.model || undefined, signal: generateAbort.signal },
      );
      const generatedTitle = (answer.title ?? '').trim();
      if (generatedTitle) {
        title = generatedTitle;
        description = (answer.description ?? '').trim();
      } else {
        generateError = t('mergeRequest.aiEmpty') as string;
      }
    } catch (e) {
      if (e instanceof AiAssistError) {
        if (e.kind !== 'cancelled') generateError = aiErrorMessage(e);
      } else {
        generateError = errorMessage(e);
      }
    } finally {
      aiStatusMessage = '';
      isGenerating = false;
      generateAbort = null;
    }
  }

  function aiErrorMessage(e: AiAssistError): string {
    const base = t(
      e.kind === 'unavailable' ? 'git.aiUnavailable'
      : e.kind === 'notAuthenticated' ? 'git.aiNotAuthenticated'
      : 'git.aiFailed',
    ) as string;
    return e.detail ? `${base} - ${e.detail}` : base;
  }

  function cancelGenerate() {
    generateAbort?.abort();
  }

  function errorText(err: IntegrationError): string {
    const base = t(`integrations.errors.${err.code}`) as string;
    return err.message && err.message !== base ? `${base} ${err.message}` : base;
  }

  async function submit() {
    if (!canSubmit) return;
    isSubmitting = true;
    submitError = null;
    try {
      const created = await createMergeRequest(projectId, instanceId, {
        title: title.trim(),
        description,
        isDraft,
        sourceBranch,
        targetBranch: selectedTarget,
        reviewers: reviewers.map((r) => r.login),
        assignees: assignees.map((a) => a.login),
        labels,
        removeSourceBranch,
        isSquash,
        linkedTicketKey: hasLinkedTicket && ticket ? ticket.key : null,
      });
      dispatch('created', created);
    } catch (e) {
      submitError = toIntegrationError(e);
    } finally {
      isSubmitting = false;
    }
  }
</script>

<form class="mr-form" on:submit|preventDefault={submit}>
  <div class="mr-branches">
    <span class="mr-branch selectable">{sourceBranch}</span>
    <Icon name="chev-r" size={11}/>
    <div class="mr-target">
      <Select
        bind:value={selectedTarget}
        options={targetOptions}
        disabled={isSubmitting}
        ariaLabel={t('mergeRequest.target') as string}
      />
    </div>
  </div>

  <div class="form-row">
    <label for="mr-title">{t('mergeRequest.title')}</label>
    <div class="mr-title-row">
      <div class="ai-field mr-title-field" class:is-generating={isGenerating}>
        <input id="mr-title" type="text" bind:value={title} disabled={isGenerating} aria-busy={isGenerating} />
        {#if isGenerating}
          <span class="ai-sweep" aria-hidden="true"></span>
          {#if !title}
            <span class="ai-ghost" aria-hidden="true"><i style="width: 62%"></i></span>
          {/if}
        {/if}
      </div>
      {#if isGenerating}
        <button type="button" class="btn ghost ai-btn" on:click={cancelGenerate}>
          <Spinner size={11} trackColor="var(--bg-3)" color="var(--fg-3)"/>
          {t('common.cancel')}
        </button>
      {:else}
        <button
          type="button"
          class="btn ghost ai-btn"
          disabled={!canGenerate}
          title={resolvedFeature.unavailable ? (t('git.aiUnavailable') as string) : undefined}
          on:click={generateWithAi}
        >
          <Icon name="sparkles" size={12}/>
          {t('mergeRequest.generateWithAi')}
        </button>
      {/if}
    </div>
    <span class="sr-only" role="status" aria-live="polite">{aiStatusMessage}</span>
    {#if generateError}
      <span class="mr-error" role="alert">{generateError}</span>
    {/if}
  </div>

  <div class="form-row">
    <label for="mr-description">{t('mergeRequest.description')}</label>
    <div class="ai-field" class:is-generating={isGenerating}>
      <textarea id="mr-description" rows="6" bind:value={description} disabled={isGenerating} aria-busy={isGenerating}></textarea>
      {#if isGenerating}
        <span class="ai-sweep" aria-hidden="true"></span>
        {#if !description}
          <span class="ai-ghost" aria-hidden="true"><i style="width: 88%"></i><i style="width: 74%"></i><i style="width: 46%"></i></span>
        {/if}
      {/if}
    </div>
  </div>

  <ActorPicker
    id="mr-reviewers"
    label={t('mergeRequest.reviewers') as string}
    placeholder={t('mergeRequest.searchReviewers') as string}
    {projectId}
    bind:selected={reviewers}
  />

  <ActorPicker
    id="mr-assignees"
    label={t('mergeRequest.assignees') as string}
    placeholder={t('mergeRequest.searchAssignees') as string}
    {projectId}
    bind:selected={assignees}
  />

  <div class="form-row">
    <span class="mr-label">{t('mergeRequest.labels')}</span>
    {#if !areLabelsLoaded}
      <span class="mr-hint"><Spinner size={11} trackColor="var(--bg-3)" color="var(--fg-3)"/></span>
    {:else if availableLabels.length === 0}
      <span class="mr-hint">{t('mergeRequest.noLabels')}</span>
    {:else}
      <div class="mr-chips">
        {#each availableLabels as label (label)}
          <button
            type="button"
            class="chip label-chip"
            class:active={labels.includes(label)}
            aria-pressed={labels.includes(label)}
            on:click={() => toggleLabel(label)}
          >
            {label}
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <div class="mr-options">
    <label class="mr-option">
      <input type="checkbox" bind:checked={isDraft} />
      <span>{t('mergeRequest.draft')}</span>
    </label>
    <label class="mr-option">
      <input type="checkbox" bind:checked={removeSourceBranch} />
      <span>{t('mergeRequest.removeSourceBranch')}</span>
    </label>
    <label class="mr-option">
      <input type="checkbox" bind:checked={isSquash} />
      <span>{t('mergeRequest.squash')}</span>
    </label>
    {#if ticket}
      <label class="mr-option">
        <input type="checkbox" bind:checked={hasLinkedTicket} />
        <span>{t('mergeRequest.linkTicket')} <span class="mr-ticket-key selectable">{ticket.key}</span></span>
      </label>
    {/if}
  </div>

  {#if submitError}
    <div class="mr-error banner" role="alert">
      <Icon name="alert" size={13}/>
      <span>{errorText(submitError)}</span>
    </div>
  {/if}

  <div class="mr-actions">
    <button type="button" class="btn ghost" on:click={() => dispatch('cancel')}>{t('common.cancel')}</button>
    <button type="submit" class="btn primary" disabled={!canSubmit}>
      {#if isSubmitting}
        <Spinner size={11} trackColor="oklch(1 0 0 / 0.3)" color="var(--accent-fg)"/>
      {/if}
      {t(`integrations.terms.${terms}.create`)}
    </button>
  </div>
</form>

<style>
  .mr-form {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .mr-branches {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 14px;
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--fg-2);
  }
  .mr-target {
    flex: 1;
    min-width: 0;
    max-width: 60%;
  }
  .mr-branch {
    max-width: 45%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mr-title-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .mr-title-field {
    flex: 1;
    min-width: 0;
  }
  .mr-title-field input {
    width: 100%;
  }
  .ai-btn {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 11.5px;
    white-space: nowrap;
  }
  .mr-form textarea {
    width: 100%;
    padding: 9px 11px;
    background: var(--bg-0);
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-sm);
    font-size: 12.5px;
    color: var(--fg-0);
    outline: none;
    resize: vertical;
    font-family: inherit;
    line-height: 1.5;
  }
  .mr-form textarea:focus { border-color: var(--accent-line); }
  .mr-label {
    font-size: 11px;
    font-family: var(--font-mono);
    color: var(--fg-3);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .mr-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }
  .label-chip { cursor: pointer; }
  .label-chip:hover { color: var(--fg-0); }
  .mr-hint {
    font-size: 11.5px;
    color: var(--fg-3);
  }
  .mr-options {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 14px;
  }
  .mr-option {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12.5px;
    color: var(--fg-1);
    cursor: pointer;
  }
  .mr-ticket-key {
    font-family: var(--font-mono);
    color: var(--fg-2);
  }
  .mr-error {
    font-size: 11.5px;
    color: var(--danger);
  }
  .mr-error.banner {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin-bottom: 12px;
    padding: 8px 10px;
    border: 1px solid color-mix(in oklch, var(--danger) 40%, var(--stroke-0));
    border-radius: var(--r-md);
    background: color-mix(in oklch, var(--danger) 10%, var(--bg-0));
  }
  .mr-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
</style>
