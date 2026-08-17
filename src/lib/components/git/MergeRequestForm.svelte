<script lang="ts">
  /**
   * Creation form of a merge request on the bound forge, shared by the branch
   * bar and the finalize modal. Dispatches `created` with the new MR and
   * `cancel`; the parent decides where the form lives.
   */
  import { createEventDispatcher, onMount } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import { t } from '$lib/i18n';
  import { AiAssistError, runOneShot } from '$lib/services/ai-assist-service';
  import { aiProviders, loadAiProviders } from '$lib/stores/ai-providers';
  import { forgeTerms } from '$lib/stores/integrations';
  import {
    createMergeRequest,
    loadForgeLabels,
    searchForgeMembers,
  } from '$lib/stores/merge-request';
  import { settings } from '$lib/stores/settings';
  import type { Actor, IntegrationError, MergeRequest } from '$lib/types/integrations';
  import { readOnlyPermissionMode, readOnlyTools, resolveAiFeature } from '$lib/utils/home/ai-features';
  import { buildMrDescriptionPrompt } from '$lib/utils/integrations/prompts';
  import { toIntegrationError } from '$lib/services/integration-service';

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
  let hasLinkedTicket = ticket !== null;
  let reviewers: Actor[] = [];
  let labels: string[] = [];

  let reviewerQuery = '';
  let reviewerResults: Actor[] = [];
  let isSearchingReviewers = false;
  let reviewerSearchTimer: ReturnType<typeof setTimeout> | null = null;
  let hasSearchedReviewers = false;

  let availableLabels: string[] = [];
  let areLabelsLoaded = false;

  let isSubmitting = false;
  let submitError: IntegrationError | null = null;

  let isGenerating = false;
  let generateError = '';
  let generateAbort: AbortController | null = null;
  let aiStatusMessage = '';

  $: terms = $forgeTerms;
  $: resolvedFeature = resolveAiFeature('mrDescription', $settings.aiFeatures, $aiProviders);
  $: canGenerate = !resolvedFeature.unavailable && !isGenerating && !isSubmitting;
  $: canSubmit = title.trim() !== '' && !isSubmitting && !isGenerating;

  onMount(() => {
    void loadAiProviders();
    void loadForgeLabels(projectId)
      .then((list) => { availableLabels = list; })
      .catch(() => { availableLabels = []; })
      .finally(() => { areLabelsLoaded = true; });
  });

  function scheduleReviewerSearch() {
    if (reviewerSearchTimer) clearTimeout(reviewerSearchTimer);
    const text = reviewerQuery.trim();
    if (text === '') {
      reviewerResults = [];
      hasSearchedReviewers = false;
      return;
    }
    reviewerSearchTimer = setTimeout(() => void runReviewerSearch(text), 250);
  }

  async function runReviewerSearch(text: string) {
    isSearchingReviewers = true;
    try {
      const found = await searchForgeMembers(projectId, text);
      if (reviewerQuery.trim() !== text) return;
      reviewerResults = found.filter((a) => !reviewers.some((r) => r.login === a.login));
      hasSearchedReviewers = true;
    } catch {
      reviewerResults = [];
      hasSearchedReviewers = true;
    } finally {
      isSearchingReviewers = false;
    }
  }

  function addReviewer(actor: Actor) {
    reviewers = [...reviewers, actor];
    reviewerResults = reviewerResults.filter((a) => a.login !== actor.login);
    reviewerQuery = '';
    hasSearchedReviewers = false;
  }

  function removeReviewer(login: string) {
    reviewers = reviewers.filter((r) => r.login !== login);
  }

  function toggleLabel(label: string) {
    labels = labels.includes(label) ? labels.filter((l) => l !== label) : [...labels, label];
  }

  function parseGenerated(answer: string): { title: string; description: string } {
    const lines = answer.replace(/\r\n/g, '\n').split('\n');
    let index = 0;
    while (index < lines.length && lines[index].trim() === '') index += 1;
    const firstLine = lines[index] ?? '';
    return {
      title: firstLine.replace(/^\s*(?:title)\s*:\s*/i, '').replace(/^#+\s*/, '').trim(),
      description: lines.slice(index + 1).join('\n').replace(/^\s*\n/, '').trimEnd(),
    };
  }

  async function generateWithAi() {
    if (!canGenerate || !worktreePath) return;
    const feature = resolvedFeature;
    isGenerating = true;
    generateError = '';
    generateAbort = new AbortController();
    aiStatusMessage = t('mergeRequest.aiGenerating') as string;
    try {
      const answer = await runOneShot(
        buildMrDescriptionPrompt(targetBranch, ticket, $settings.aiFeatures),
        worktreePath,
        feature.providerId,
        {
          model: feature.model || undefined,
          permissionMode: readOnlyPermissionMode(feature.providerId) || undefined,
          allowedTools: readOnlyTools(feature.providerId),
          signal: generateAbort.signal,
        },
      );
      const parsed = parseGenerated(answer);
      if (parsed.title) {
        title = parsed.title;
        description = parsed.description;
      } else {
        generateError = t('mergeRequest.aiEmpty') as string;
      }
    } catch (e) {
      if (e instanceof AiAssistError) {
        if (e.kind !== 'cancelled') generateError = aiErrorMessage(e);
      } else {
        generateError = String(e);
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
        targetBranch,
        reviewers: reviewers.map((r) => r.login),
        labels,
        removeSourceBranch,
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
    <span class="mr-branch selectable" title={t('mergeRequest.target') as string}>{targetBranch}</span>
  </div>

  <div class="form-row">
    <label for="mr-title">{t('mergeRequest.title')}</label>
    <div class="mr-title-row">
      <input id="mr-title" type="text" bind:value={title} disabled={isGenerating} />
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
    <textarea id="mr-description" rows="6" bind:value={description} disabled={isGenerating}></textarea>
  </div>

  <div class="form-row">
    <label for="mr-reviewers">{t('mergeRequest.reviewers')}</label>
    {#if reviewers.length > 0}
      <div class="mr-chips">
        {#each reviewers as reviewer (reviewer.login)}
          <span class="chip active">
            {reviewer.displayName || reviewer.login}
            <button type="button" class="chip-x" aria-label={t('common.close') as string} on:click={() => removeReviewer(reviewer.login)}>
              <Icon name="x" size={10}/>
            </button>
          </span>
        {/each}
      </div>
    {/if}
    <div class="mr-search">
      <input
        id="mr-reviewers"
        type="text"
        placeholder={t('mergeRequest.searchReviewers') as string}
        bind:value={reviewerQuery}
        on:input={scheduleReviewerSearch}
        autocomplete="off"
      />
      {#if isSearchingReviewers}
        <span class="mr-search-spinner"><Spinner size={11} trackColor="var(--bg-3)" color="var(--fg-3)"/></span>
      {/if}
    </div>
    {#if reviewerResults.length > 0}
      <ul class="mr-results" role="listbox">
        {#each reviewerResults as actor (actor.login)}
          <li>
            <button type="button" role="option" aria-selected="false" on:click={() => addReviewer(actor)}>
              <span class="mr-result-name">{actor.displayName || actor.login}</span>
              <span class="mr-result-login">@{actor.login}</span>
            </button>
          </li>
        {/each}
      </ul>
    {:else if hasSearchedReviewers && !isSearchingReviewers}
      <span class="mr-hint">{t('mergeRequest.noMatch')}</span>
    {/if}
  </div>

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
  .mr-title-row input {
    flex: 1;
    min-width: 0;
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
  .chip-x {
    display: inline-grid;
    place-items: center;
    padding: 0;
    margin-left: 2px;
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  .mr-search {
    position: relative;
    display: flex;
  }
  .mr-search input { flex: 1; }
  .mr-search-spinner {
    position: absolute;
    right: 10px;
    top: 50%;
    transform: translateY(-50%);
    display: inline-flex;
  }
  .mr-results {
    list-style: none;
    margin: 0;
    padding: 4px;
    max-height: 160px;
    overflow-y: auto;
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-sm);
    background: var(--bg-2);
  }
  .mr-results button {
    display: flex;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--fg-0);
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }
  .mr-results button:hover { background: var(--bg-3); }
  .mr-result-login {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-3);
  }
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
