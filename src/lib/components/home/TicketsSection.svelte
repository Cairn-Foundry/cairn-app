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
  import Icon from '$lib/components/Icon.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import SearchInput from '$lib/components/SearchInput.svelte';
  import ModeToggle from '$lib/components/ModeToggle.svelte';
  import { createEventDispatcher } from 'svelte';
  import { getLocale, t } from '$lib/i18n';
  import { projects } from '$lib/stores/project';
  import { settings } from '$lib/stores/settings';
  import { assistCliInstalled, loadCliProviders } from '$lib/stores/cli-providers';
  import {
    loadTicketsOverview,
    ticketsByProject,
    ticketsLoading,
    ticketsScope,
    type TicketScope,
  } from '$lib/stores/tickets-overview';
  import { AiAssistError, runOneShot } from '$lib/services/ai-assist-service';
  import { resolveAiFeature } from '$lib/utils/home/ai-features';
  import { buildTicketPlanPrompt } from '$lib/utils/integrations/prompts';
  import { renderRemoteMarkdown } from '$lib/utils/integrations/markdown';
  import type { Ticket } from '$lib/types/integrations';

  const dispatch = createEventDispatcher<{
    startTicket: { projectId: string; ticket: Ticket };
    goIntegrations: void;
  }>();

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
    .filter((g) => g.tickets.length > 0 || g.error || !query.trim());

  $: totalTickets = groups.reduce((n, g) => n + g.tickets.length, 0);
  $: anyMore = groups.some((g) => g.hasMore);

  $: resolvedFeature = resolveAiFeature('ticketPlan', $settings.aiFeatures, $assistCliInstalled);
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
        { model: resolvedFeature.model || undefined, signal: planAbort.signal },
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

<div class="bar">
  <SearchInput bind:value={query} placeholder={t('tickets.search') as string} />
  <ModeToggle
    options={[
      { value: 'assigned', label: t('tickets.scopeAssigned') as string },
      { value: 'all', label: t('tickets.scopeAll') as string },
    ]}
    value={$ticketsScope}
    ariaLabel={t('tickets.scopeLabel') as string}
    on:select={(e) => setScope(e.detail as TicketScope)}
  />
  <div style="flex: 1"></div>
  <button class="chip" on:click={() => loadTicketsOverview($ticketsScope, true)} disabled={$ticketsLoading}>
    {#if $ticketsLoading}<Spinner size={12} />{:else}<Icon name="refresh" size={13} />{/if}
    {t('tickets.refresh')}
  </button>
</div>

{#if $ticketsLoading && groups.length === 0}
  <div class="pad"><Skeleton lines={6} /></div>
{:else if groups.length === 0}
  <div class="empty">
    <div>{t('tickets.noTracker')}</div>
    <button class="chip" on:click={() => dispatch('goIntegrations')}>
      <Icon name="link" size={13} /> {t('tickets.configure')}
    </button>
  </div>
{:else}
  <div class="total">
    {t('tickets.total')}: {totalTickets}{anyMore ? '+' : ''}
  </div>

  <section class="plan">
    <header>
      <Icon name="wand" size={14} />
      <span class="plan-title">{t('tickets.planTitle')}</span>
      <div style="flex: 1"></div>
      {#if isPlanning}
        <Spinner size={12} />
        <button class="chip" on:click={cancelPlan}>{t('tickets.planCancel')}</button>
      {:else}
        <button class="chip" on:click={generatePlan} disabled={!canPlan}>
          {plan ? t('tickets.planRegenerate') : t('tickets.planGenerate')}
        </button>
      {/if}
    </header>
    {#if resolvedFeature.unavailable}
      <div class="hint">{t('tickets.planUnavailable')}</div>
    {:else if planError}
      <div class="hint error">{planError}</div>
    {:else if plan}
      <div class="plan-body selectable">{@html renderRemoteMarkdown(plan)}</div>
    {:else if !isPlanning}
      <div class="hint">{t('tickets.planEmpty')}</div>
    {/if}
  </section>

  {#each filteredGroups as group (group.project.id)}
    <section class="group">
      <header>
        <span class="dot" style="background: {group.project.color}"></span>
        <span class="proj">{group.project.name}</span>
        <span class="count">{group.tickets.length}{group.hasMore ? '+' : ''}</span>
      </header>
      {#if group.error}
        <div class="hint error">{t('tickets.loadFailed')}</div>
      {:else}
        {#each group.tickets as ticket (ticket.id)}
          <div class="row">
            <span class="key selectable">{ticket.key}</span>
            <span class="title">{ticket.title}</span>
            <span class="status s-{ticket.statusCategory}">{ticket.status}</span>
            <button
              class="chip start"
              on:click={() => dispatch('startTicket', { projectId: group.project.id, ticket })}
            >
              <Icon name="branch" size={12} /> {t('tickets.start')}
            </button>
          </div>
        {/each}
        {#if group.tickets.length === 0}
          <div class="hint">{t('tickets.groupEmpty')}</div>
        {/if}
      {/if}
    </section>
  {/each}
{/if}

<style>
  .bar { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
  .chip {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 4px 9px; border: 1px solid var(--stroke-1); border-radius: var(--r-sm);
    background: var(--bg-3); color: var(--fg-1); font-size: 12px;
    font-family: var(--font-ui); cursor: pointer;
  }
  .chip:hover:not(:disabled) { background: var(--bg-4); color: var(--fg-0); }
  .chip:disabled { opacity: 0.5; cursor: default; }
  .total { color: var(--fg-2); font-size: 12px; margin-bottom: 10px; }
  .pad { padding: 8px 0; }
  .empty {
    display: flex; flex-direction: column; align-items: flex-start; gap: 10px;
    color: var(--fg-2); font-size: 13px; padding: 24px 0;
  }
  .plan, .group {
    border: 1px solid var(--stroke-1); border-radius: var(--r-md);
    background: var(--bg-2); margin-bottom: 12px; overflow: hidden;
  }
  header {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 10px; border-bottom: 1px solid var(--stroke-1);
  }
  .plan-title, .proj { font-size: 13px; color: var(--fg-0); }
  .dot { width: 8px; height: 8px; border-radius: 50%; }
  .count { color: var(--fg-2); font-size: 12px; font-family: var(--font-mono); }
  .plan-body { padding: 10px 12px; font-size: 13px; color: var(--fg-1); line-height: 1.55; }
  .hint { padding: 10px 12px; color: var(--fg-2); font-size: 12px; }
  .hint.error { color: var(--danger); }
  .row {
    display: flex; align-items: center; gap: 10px;
    padding: 7px 10px; border-bottom: 1px solid var(--stroke-0);
  }
  .row:last-child { border-bottom: none; }
  .key { font-family: var(--font-mono); font-size: 12px; color: var(--fg-2); flex-shrink: 0; }
  .title {
    flex: 1; font-size: 13px; color: var(--fg-0);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .status { font-size: 11px; color: var(--fg-2); flex-shrink: 0; }
  .status.s-in_progress { color: var(--accent); }
  .row .start { flex-shrink: 0; }
</style>
