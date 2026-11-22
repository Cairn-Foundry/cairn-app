<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * What is left to do across every project that has a tracker bound: the open
   * tickets grouped by project, and a plan the model writes over the whole
   * backlog rather than project by project.
   *
   * Dispatches `startTicket` with the project and the ticket; the parent opens
   * the project and hands the ticket to the instance creation modal.
   */
  import { onDestroy, onMount } from 'svelte';
  import Icon from '#lib/components/Icon.svelte';
  import Spinner from '#lib/components/Spinner.svelte';
  import Skeleton from '#lib/components/Skeleton.svelte';
  import SearchInput from '#lib/components/SearchInput.svelte';
  import ModeToggle from '#lib/components/ModeToggle.svelte';
  import { createEventDispatcher } from 'svelte';
  import { getLocale, t } from '#lib/i18n';
  import { projects } from '#lib/stores/project';
  import { aiEnabled, settings } from '#lib/stores/settings';
  import { isAssistCliInstalled, loadCliProviders } from '#lib/stores/cli-providers';
  import {
    collapsedTicketProjects,
    loadTicketsOverview,
    ticketsByProject,
    ticketsLoading,
    ticketsScope,
    toggleTicketProjectCollapse,
    type TicketScope,
  } from '#lib/stores/tickets-overview';
  import { AiAssistError, runOneShot } from '#lib/services/ai-assist-service';
  import { resolveAiFeature } from '#lib/utils/home/ai-features';
  import { buildTicketPlanPrompt } from '#lib/utils/integrations/prompts';
  import { renderRemoteMarkdown } from '#lib/utils/integrations/markdown';
  import { formatDateTimeFull, relativeTime } from '#lib/utils/format';
  import SearchEmpty from '#lib/components/SearchEmpty.svelte';
  import { openUrl } from '#lib/services/opener-service';
  import type { Ticket } from '#lib/types/integrations';

  const dispatch = createEventDispatcher<{
    startTicket: { projectId: string; ticket: Ticket };
    goIntegrations: void;
  }>();

  /** Rows per group of the placeholder list drawn while the tickets load. */
  const SKELETON_GROUPS = [4, 2];

  let query = '';
  let plan = '';
  let planError = '';
  let isPlanning = false;
  let planAbort: AbortController | null = null;

  $: groups = $projects
    .filter((p) => $ticketsByProject[p.id])
    .map((p) => ({ project: p, ...$ticketsByProject[p.id] }));

  $: filteredGroups = groups
    .map((g) => ({ ...g, tickets: g.tickets.filter(matches) }))
    .filter((g) => g.tickets.length > 0 || !query.trim());

  $: totalTickets = groups.reduce((n, g) => n + g.tickets.length, 0);
  $: anyMore = groups.some((g) => g.hasMore);


  $: resolvedFeature = resolveAiFeature('ticketPlan', $settings.aiFeatures, $isAssistCliInstalled);
  // The plan runs in a project directory, so it needs at least one project.
  $: canPlan = !resolvedFeature.unavailable && totalTickets > 0 && !isPlanning;

  function matches(ticket: Ticket): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      ticket.key.toLowerCase().includes(q) ||
      ticket.title.toLowerCase().includes(q) ||
      ticket.labels.some((l) => l.toLowerCase().includes(q))
    );
  }

  function setScope(scope: TicketScope) {
    if ($ticketsScope === scope) return;
    ticketsScope.set(scope);
    ticketsByProject.set({});
    void loadTicketsOverview(scope, true);
  }

  async function generatePlan() {
    if (!canPlan) return;
    // The one-shot runs somewhere; any registered project serves, the plan
    // reads the ticket list in the prompt rather than the repository.
    const workingDir = groups[0]?.project.path ?? $projects[0]?.path;
    if (!workingDir) return;
    isPlanning = true;
    planError = '';
    planAbort = new AbortController();
    try {
      plan = await runOneShot(
        buildTicketPlanPrompt(
          groups.map((g) => ({ name: g.project.name, tickets: g.tickets })),
          getLocale(),
          $settings.aiFeatures,
        ),
        workingDir,
        resolvedFeature.providerId,
        { model: resolvedFeature.model || undefined, signal: planAbort.signal, context: resolvedFeature.context },
      );
    } catch (e) {
      if (!(e instanceof AiAssistError && e.kind === 'cancelled')) {
        planError = t('tickets.planFailed') as string;
      }
    } finally {
      isPlanning = false;
      planAbort = null;
    }
  }

  function cancelPlan() {
    planAbort?.abort();
  }

  onMount(() => {
    void loadCliProviders();
    void loadTicketsOverview($ticketsScope);
  });

  onDestroy(() => planAbort?.abort());
</script>

<header class="tk-head">
  <h1>
    {t('home.sections.tickets')}
    {#if totalTickets > 0}<span class="head-count">{totalTickets}{anyMore ? '+' : ''}</span>{/if}
  </h1>
</header>

{#if !$ticketsLoading && groups.length === 0}
  <section class="tk-empty">
    <Icon name="ticket" size={22} />
    <h2>{t('tickets.noTrackerTitle')}</h2>
    <p>{t('tickets.noTracker')}</p>
    <button class="btn" on:click={() => dispatch('goIntegrations')}>
      <Icon name="link" size={13} /> {t('tickets.configure')}
    </button>
  </section>
{:else}
  {#if $aiEnabled}
    <section class="tk-plan">
      <div class="tk-plan-head">
        <Icon name="wand" size={14} />
        <span class="tk-plan-title">{t('tickets.planTitle')}</span>
        <span class="tk-plan-hint" class:is-error={planError}>
          {#if resolvedFeature.unavailable}{t('tickets.planUnavailable')}
          {:else if planError}{planError}
          {:else if !plan && !isPlanning}{t('tickets.planEmpty')}{/if}
        </span>
        {#if isPlanning}
          <button class="btn ai-btn is-busy" on:click={cancelPlan}>{t('git.aiCancel')}</button>
        {:else}
          <button
            class="btn ai-btn"
            on:click={generatePlan}
            disabled={!canPlan}
            title={resolvedFeature.unavailable ? (t('git.aiUnavailable') as string) : undefined}
          >
            <Icon name="sparkles" size={12} />
            {plan ? t('tickets.planRegenerate') : t('tickets.planGenerate')}
          </button>
        {/if}
      </div>
      <span class="sr-only" role="status" aria-live="polite">{isPlanning ? t('tickets.planTitle') : ''}</span>
      {#if (plan || isPlanning) && !resolvedFeature.unavailable}
        <div class="ai-field tk-plan-body" class:is-generating={isPlanning} aria-busy={isPlanning}>
          {#if plan}
            <div class="plan-body selectable">{@html renderRemoteMarkdown(plan)}</div>
          {/if}
          {#if isPlanning}
            <span class="ai-sweep" aria-hidden="true"></span>
            {#if !plan}
              <span class="ai-ghost" aria-hidden="true"><i style="width: 88%"></i><i style="width: 74%"></i><i style="width: 46%"></i></span>
            {/if}
          {/if}
        </div>
      {/if}
    </section>
  {/if}

  <div class="tk-bar">
    <ModeToggle
      options={[
        { value: 'assigned', label: t('tickets.scopeAssigned') as string },
        { value: 'all', label: t('tickets.scopeAll') as string },
      ]}
      value={$ticketsScope}
      ariaLabel={t('tickets.scopeLabel') as string}
      on:select={(e) => setScope(e.detail as TicketScope)}
    />
    <div class="spacer"></div>
    <SearchInput bind:value={query} placeholder={t('tickets.search') as string} />
    <button
      class="btn ghost tk-refresh"
      on:click={() => loadTicketsOverview($ticketsScope, true)}
      disabled={$ticketsLoading}
      aria-label={t('tickets.refresh') as string}
      title={t('tickets.refresh') as string}
    >
      {#if $ticketsLoading}<Spinner size={12} />{:else}<Icon name="refresh" size={13} />{/if}
    </button>
  </div>

  {#if groups.length === 0}
    <div class="tk-list" aria-hidden="true">
      {#each SKELETON_GROUPS as rows, g (g)}
        <section class="group">
          <div class="group-toggle is-skeleton"><Skeleton width="140px" height={10} /></div>
          {#each { length: rows } as _, i (i)}
            <div class="row">
              <Skeleton width="72px" height={10} />
              <Skeleton width="{[62, 48, 70, 40][i % 4]}%" height={10} />
              <Skeleton width="76px" height={10} />
              <Skeleton width="22px" height={10} />
              <Skeleton width="112px" height={10} />
            </div>
          {/each}
        </section>
      {/each}
    </div>
  {:else if filteredGroups.length === 0}
    <SearchEmpty
      title={t('tickets.noMatchTitle') as string}
      text={(t('tickets.noMatchText') as (q: string) => string)(query.trim())}
      clearLabel={t('common.clearSearch') as string}
      on:clear={() => (query = '')}
    />
  {:else}
    <div class="tk-list">
      {#each filteredGroups as group (group.project.id)}
        {@const isEmpty = group.tickets.length === 0 && !group.error}
        {@const collapsed = !isEmpty && $collapsedTicketProjects.includes(group.project.id)}
        <section class="group">
          <!-- A project with no open ticket has nothing to fold: its header is plain. -->
          {#if isEmpty}
            <header class="group-toggle is-empty">
              <span class="chevron"></span>
              <span class="swatch" style="background: {group.project.color}"></span>
              <span class="proj">{group.project.name}</span>
              <span class="count">0</span>
            </header>
          {:else}
            <header
              class="group-toggle"
              role="button"
              tabindex="0"
              aria-expanded={!collapsed}
              on:click={() => toggleTicketProjectCollapse(group.project.id)}
              on:keydown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggleTicketProjectCollapse(group.project.id);
                }
              }}
            >
              <span class="chevron" class:collapsed>
                <Icon name="chev-d" size={13} />
              </span>
              <span class="swatch" style="background: {group.project.color}"></span>
              <span class="proj">{group.project.name}</span>
              <span class="count">{group.tickets.length}{group.hasMore ? '+' : ''}</span>
            </header>
          {/if}
          {#if collapsed}
            <!-- Folded: the header keeps the count, which is what the fold is for. -->
          {:else if group.error}
            <div class="hint error">{t('tickets.loadFailed')}</div>
          {:else}
            {#each group.tickets as ticket (ticket.id)}
              <div class="row">
                <span class="key selectable">{ticket.key}</span>
                <span class="title-cell">
                  <span class="title" title={ticket.title}>{ticket.title}</span>
                  {#each ticket.labels.slice(0, 2) as label (label)}
                    <span class="label">{label}</span>
                  {/each}
                </span>
                <span class="status s-{ticket.statusCategory}">{ticket.status}</span>
                <span class="age" title={formatDateTimeFull(ticket.updatedAt)}>{relativeTime(ticket.updatedAt)}</span>
                <span class="actions">
                  {#if ticket.url}
                    <button
                      class="row-action"
                      aria-label={t('tickets.openInTracker') as string}
                      title={t('tickets.openInTracker') as string}
                      on:click={() => void openUrl(ticket.url)}
                    >
                      <Icon name="external" size={13} />
                    </button>
                  {/if}
                  <button
                    class="btn start"
                    on:click={() => dispatch('startTicket', { projectId: group.project.id, ticket })}
                  >
                    <Icon name="branch" size={12} /> {t('tickets.start')}
                  </button>
                </span>
              </div>
            {/each}
          {/if}
        </section>
      {/each}
    </div>
  {/if}
{/if}

<style>
  .tk-head { margin-bottom: 32px; }
  .tk-head h1 {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0;
    font-family: var(--font-ui);
    font-size: 18px;
    font-weight: 600;
    color: var(--fg-0);
  }
  .head-count {
    padding: 1px 8px;
    font-size: 11.5px;
    font-weight: 400;
    line-height: 1.6;
    color: var(--fg-2);
    background: var(--bg-3);
    border-radius: 10px;
  }

  /* -- no tracker -- */
  .tk-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 64px 0;
    text-align: center;
    color: var(--fg-3);
  }
  .tk-empty h2 { margin: 8px 0 0; font-size: 15px; font-weight: 600; color: var(--fg-0); }
  .tk-empty p { max-width: 52ch; margin: 0 0 8px; font-size: 13px; line-height: 1.55; color: var(--fg-2); }

  /* -- plan -- */
  .tk-plan {
    margin-bottom: 28px;
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-md);
    background: var(--bg-1);
  }
  .tk-plan-head {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    padding: 0 10px 0 14px;
    color: var(--fg-2);
  }
  .tk-plan-title { flex: none; font-size: 13px; font-weight: 600; color: var(--fg-0); }
  .tk-plan-hint {
    flex: 1;
    min-width: 0;
    font-size: 12px;
    color: var(--fg-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tk-plan-hint.is-error { color: var(--danger); }
  .tk-plan-body { border-top: 1px solid var(--stroke-0); }
  .plan-body { padding: 12px 14px; font-size: 13px; line-height: 1.55; color: var(--fg-1); }

  /* -- toolbar -- */
  .tk-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }
  .tk-bar .spacer { flex: 1; }
  .tk-bar :global(.ag-search) { flex: 0 1 260px; height: 28px; box-sizing: border-box; }
  .tk-bar :global(.mode-toggle) { height: 28px; box-sizing: border-box; }
  .tk-refresh { width: 28px; height: 28px; padding: 0; justify-content: center; }

  /* -- list -- */
  /* One grid for every group: the rows take its columns through subgrid, so a
     key or a status is as wide as the widest one of the whole list. */
  .tk-list {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto auto auto;
    column-gap: 20px;
    border: 1px solid color-mix(in oklch, var(--stroke-0) 60%, var(--stroke-1));
    border-radius: var(--r-md);
    background: var(--bg-1);
    overflow: hidden;
  }
  .group,
  .row {
    display: grid;
    grid-column: 1 / -1;
    grid-template-columns: subgrid;
  }
  .group + .group { border-top: 1px solid var(--stroke-1); }
  .group-toggle {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 36px;
    padding: 0 16px 0 10px;
    background: var(--bg-2);
    cursor: pointer;
  }
  .group-toggle:hover { background: var(--bg-3); }
  .group-toggle.is-empty { cursor: default; }
  .group-toggle.is-empty:hover { background: var(--bg-2); }
  .group-toggle.is-empty .proj { color: var(--fg-2); }
  .group-toggle.is-skeleton { cursor: default; padding-left: 33px; }
  .group-toggle.is-skeleton:hover { background: var(--bg-2); }
  .group-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .chevron { display: inline-flex; width: 13px; color: var(--fg-3); }
  .chevron.collapsed { transform: rotate(-90deg); }
  .swatch { width: 8px; height: 8px; border-radius: 2px; flex: none; }
  .proj { font-size: 12.5px; font-weight: 600; color: var(--fg-0); }
  .count { font-size: 11.5px; color: var(--fg-3); }
  .hint { grid-column: 1 / -1; padding: 12px 16px; font-size: 12px; color: var(--fg-2); }
  .hint.error { color: var(--danger); }

  .row {
    align-items: center;
    min-height: 40px;
    padding: 0 10px 0 33px;
    border-top: 1px solid var(--stroke-0);
  }
  .row:hover { background: var(--bg-2); }
  .key { font-family: var(--font-mono); font-size: 12px; color: var(--fg-3); }
  .title-cell { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .title {
    min-width: 0;
    font-size: 13px;
    color: var(--fg-0);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .label {
    flex: none;
    padding: 0 6px;
    font-size: 11px;
    line-height: 18px;
    color: var(--fg-3);
    border: 1px solid var(--stroke-1);
    border-radius: 4px;
  }
  .status {
    justify-self: start;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--fg-2);
    white-space: nowrap;
  }
  .status::before {
    content: '';
    width: 7px;
    height: 7px;
    border-radius: 50%;
    border: 1.5px solid var(--fg-3);
    box-sizing: border-box;
  }
  .status.s-in_progress { color: var(--fg-1); }
  .status.s-in_progress::before { border-color: var(--accent); background: var(--accent); }
  .status.s-done::before { border-color: var(--success); background: var(--success); }
  .age { font-size: 11.5px; color: var(--fg-3); text-align: right; font-variant-numeric: tabular-nums; }
  .actions { display: flex; align-items: center; gap: 4px; }
  .row-action {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border-radius: var(--r-sm);
    color: var(--fg-3);
  }
  .row-action:hover { background: var(--bg-4); color: var(--fg-0); }
  .start { height: 24px; padding: 0 8px; }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
</style>
