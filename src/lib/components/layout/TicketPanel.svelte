<script lang="ts">
  /**
   * The ticket of the active instance, folded behind its key in the workspace
   * header: status with transitions, labels, assignees, description, a link to
   * the tracker and a hand-off to the agent. A manual id with no tracker ticket
   * offers to link it. The open flag lives in memory only.
   */
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { renderRemoteMarkdown } from '$lib/utils/integrations/markdown';
  import Icon from '$lib/components/Icon.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import { t } from '$lib/i18n';
  import { requestAgentDraft } from '$lib/stores/agent-draft';
  import { aiEnabled } from '$lib/stores/settings';
  import { setInstanceTicket } from '$lib/stores/instance';
  import { capabilities, hasTracker, projectBindings } from '$lib/stores/integrations';
  import {
    loadTicket,
    loadTransitions,
    resolveTicketInput,
    tickets,
    ticketStateFor,
    transitionTicket,
  } from '$lib/stores/tracker';
  import { activeStep, showTool } from '$lib/stores/ui';
  import type { Instance } from '$lib/types/instance';
  import { clickOutside } from '$lib/utils/click-outside';
  import { buildTicketStartPrompt } from '$lib/utils/integrations/prompts';

  export let instance: Instance;

  let isOpen = false;
  let showTransitions = false;
  let isTransitioning = false;
  let isLinking = false;
  let linkError = '';
  let loadedFor = '';

  $: state = ticketStateFor($tickets, instance.projectId, instance.id);
  $: ticket = state.ticket;
  $: isLinked = !!instance.ticket.key;
  $: trackerLabel = $capabilities.tracker?.label ?? '';
  $: descriptionHtml = ticket?.description
    ? renderRemoteMarkdown(ticket.description)
    : '';

  $: if (isOpen && $hasTracker && isLinked && loadedFor !== instance.id) {
    loadedFor = instance.id;
    void loadTicket(instance.projectId, instance.id, instance.ticket.key ?? instance.ticket.id)
      .then(() => loadTransitions(instance.projectId, instance.id));
  }

  $: if (loadedFor && loadedFor !== instance.id) loadedFor = '';

  function toggle() {
    isOpen = !isOpen;
    showTransitions = false;
    linkError = '';
  }

  function close() {
    isOpen = false;
    showTransitions = false;
  }

  async function runTransition(id: string) {
    showTransitions = false;
    isTransitioning = true;
    try {
      await transitionTicket(instance.projectId, instance.id, id);
    } catch {
    } finally {
      isTransitioning = false;
    }
  }

  async function linkTicket() {
    isLinking = true;
    linkError = '';
    try {
      const resolved = await resolveTicketInput(instance.projectId, instance.ticket.id);
      if (!resolved) {
        linkError = t('ticket.linkFailed') as string;
        return;
      }
      await setInstanceTicket(instance.id, instance.projectId, {
        ...instance.ticket,
        key: resolved.key,
        url: resolved.url,
        source: $capabilities.tracker?.kind,
        connectionId: $projectBindings.tracker?.connectionId,
      });
      loadedFor = '';
    } catch (err) {
      linkError = err instanceof Error ? err.message : t('ticket.linkFailed') as string;
    } finally {
      isLinking = false;
    }
  }

  function startFromTicket() {
    if (!ticket) return;
    requestAgentDraft(instance.id, buildTicketStartPrompt(ticket));
    activeStep.set('agent');
    // A tool open over the main area would keep the agent step hidden behind it.
    showTool(null);
    close();
  }

  function openOnTracker() {
    const url = ticket?.url ?? instance.ticket.url;
    if (url) void openUrl(url);
  }
</script>

<div class="ticket-panel-wrap" use:clickOutside={close}>
  <button
    class="ticket-toggle"
    class:active={isOpen}
    class:linked={isLinked}
    title={t('ticket.toggle') as string}
    aria-expanded={isOpen}
    on:click={toggle}
  >
    <Icon name="ticket" size={11}/>
    <span class="mono">{instance.ticket.key ?? instance.ticket.id}</span>
    <Icon name={isOpen ? 'chev-u' : 'chev-d'} size={10}/>
  </button>

  {#if isOpen}
    <div class="ticket-panel">
      {#if !$hasTracker || !isLinked}
        <div class="ticket-head">
          <span class="mono ticket-key">{instance.ticket.id}</span>
          <span class="ticket-title">{instance.ticket.title}</span>
        </div>
        <div class="ticket-empty">{t('ticket.notLinked')}</div>
        {#if $hasTracker}
          <div class="ticket-actions">
            <button class="btn" disabled={isLinking} on:click={linkTicket}>
              {#if isLinking}
                <Spinner size={11} trackColor="var(--stroke-1)" color="var(--accent)"/>
              {:else}
                <Icon name="link" size={12}/>
              {/if}
              {t('ticket.linking')}
            </button>
          </div>
          {#if linkError}
            <div class="ticket-error">{linkError}</div>
          {/if}
        {/if}
      {:else if !state.isLoaded}
        <div class="ticket-skeleton"><Skeleton lines={5} height={12} gap={10}/></div>
      {:else if !ticket}
        <div class="ticket-head">
          <span class="mono ticket-key">{instance.ticket.key}</span>
          <span class="ticket-title">{instance.ticket.title}</span>
        </div>
        {#if state.error}
          <div class="ticket-error">{state.error.message}</div>
        {/if}
      {:else}
        <div class="ticket-head">
          <span class="mono ticket-key">{ticket.key}</span>
          <span class="ticket-title selectable">{ticket.title}</span>
          {#if state.isRefreshing}
            <Spinner size={11} trackColor="var(--stroke-1)" color="var(--accent)"/>
          {/if}
        </div>

        <div class="ticket-meta">
          <div class="ticket-meta-row">
            <span class="ticket-meta-label">{t('ticket.status')}</span>
            <div class="ticket-status-wrap">
              <button
                class="ticket-status {ticket.statusCategory}"
                disabled={isTransitioning || state.transitions.length === 0}
                on:click={() => showTransitions = !showTransitions}
              >
                {#if isTransitioning}
                  <Spinner size={10} trackColor="var(--stroke-1)" color="var(--accent)"/>
                {/if}
                {ticket.status}
                {#if state.transitions.length > 0}<Icon name="chev-d" size={10}/>{/if}
              </button>
              {#if showTransitions}
                <div class="ticket-transitions">
                  <div class="ticket-transitions-label">{t('ticket.transitionTo')}</div>
                  {#each state.transitions as transition (transition.id)}
                    <button class="ticket-transition" on:click={() => runTransition(transition.id)}>
                      {transition.name}
                      {#if transition.toStatus !== transition.name}
                        <span class="ticket-transition-to">{transition.toStatus}</span>
                      {/if}
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          </div>
          {#if ticket.labels.length > 0}
            <div class="ticket-meta-row">
              <span class="ticket-meta-label">{t('ticket.labels')}</span>
              <div class="ticket-chips">
                {#each ticket.labels as label}
                  <span class="ticket-chip">{label}</span>
                {/each}
              </div>
            </div>
          {/if}
          {#if ticket.assignees.length > 0}
            <div class="ticket-meta-row">
              <span class="ticket-meta-label">{t('ticket.assignees')}</span>
              <div class="ticket-chips">
                {#each ticket.assignees as assignee}
                  <span class="ticket-chip"><Icon name="user" size={10}/> {assignee.displayName || assignee.login}</span>
                {/each}
              </div>
            </div>
          {/if}
        </div>

        {#if state.error}
          <div class="ticket-error">{t('ticket.transitionFailed')} {state.error.message}</div>
        {/if}

        <div class="ticket-description selectable">
          {#if descriptionHtml}
            {@html descriptionHtml}
          {:else}
            <span class="ticket-empty">{t('ticket.noDescription')}</span>
          {/if}
        </div>

        <div class="ticket-actions">
          {#if $aiEnabled}
            <button class="btn primary" on:click={startFromTicket}>
              <Icon name="agent" size={12}/> {t('ticket.startFromTicket')}
            </button>
          {/if}
          {#if ticket.url}
            <button class="btn" on:click={openOnTracker}>
              <Icon name="external" size={12}/> {(t('ticket.openOn') as (s: string) => string)(trackerLabel)}
            </button>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  /*
   * `align-self: stretch` takes the height of the `.btn` beside it in the
   * header flex row, and the toggle fills the wrapper: the two stay aligned
   * even if that button's padding or font size changes.
   */
  .ticket-panel-wrap { position: relative; align-self: stretch; }

  .ticket-toggle {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 100%;
    padding: 4px 8px;
    border-radius: var(--r-sm);
    border: 1px solid var(--stroke-0);
    background: var(--bg-2);
    color: var(--fg-2);
    font-size: 11px;
    cursor: pointer;
    transition: background .12s, color .12s;
  }
  .ticket-toggle:hover, .ticket-toggle.active { background: var(--bg-3); color: var(--fg-0); }
  .ticket-toggle.linked .mono { color: var(--accent); }

  /*
   * Anchored on its right edge: the toggle sits at the right end of the header,
   * so a panel growing rightwards from `left: 0` would run off the window.
   */
  .ticket-panel {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 40;
    width: min(520px, calc(100vw - 24px));
    max-height: 70vh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px;
    background: var(--bg-1);
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-md);
    box-shadow: 0 12px 32px rgba(0, 0, 0, .35);
    font-size: 12px;
    color: var(--fg-1);
  }

  .ticket-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }
  .ticket-key { color: var(--accent); flex-shrink: 0; }
  .ticket-title { font-size: 13px; font-weight: 600; color: var(--fg-0); min-width: 0; overflow-wrap: anywhere; }

  .ticket-meta { display: flex; flex-direction: column; gap: 6px; }
  .ticket-meta-row { display: flex; align-items: center; gap: 10px; }
  .ticket-meta-label {
    width: 70px;
    flex-shrink: 0;
    font-size: 10px;
    font-family: var(--font-mono);
    color: var(--fg-3);
    letter-spacing: .04em;
    text-transform: uppercase;
  }

  .ticket-status-wrap { position: relative; }
  .ticket-status {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px;
    border-radius: 999px;
    border: 1px solid var(--stroke-0);
    background: var(--bg-2);
    color: var(--fg-0);
    font-size: 11px;
    cursor: pointer;
  }
  .ticket-status:disabled { cursor: default; }
  .ticket-status.in_progress { border-color: var(--accent); }
  .ticket-status.done { color: var(--fg-3); }

  .ticket-transitions {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 2;
    min-width: 180px;
    display: flex;
    flex-direction: column;
    padding: 4px;
    background: var(--bg-2);
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-sm);
    box-shadow: 0 8px 20px rgba(0, 0, 0, .3);
  }
  .ticket-transitions-label {
    padding: 4px 8px 2px;
    font-size: 10px;
    font-family: var(--font-mono);
    color: var(--fg-4);
    text-transform: uppercase;
    letter-spacing: .04em;
  }
  .ticket-transition {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    padding: 6px 8px;
    border: none;
    border-radius: var(--r-sm);
    background: none;
    color: var(--fg-1);
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }
  .ticket-transition:hover { background: var(--bg-3); color: var(--fg-0); }
  .ticket-transition-to { color: var(--fg-3); font-size: 11px; }

  .ticket-chips { display: flex; flex-wrap: wrap; gap: 4px; }
  .ticket-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 7px;
    border-radius: 999px;
    background: var(--bg-3);
    color: var(--fg-2);
    font-size: 11px;
  }

  .ticket-description {
    padding: 10px 12px;
    background: var(--bg-0);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-md);
    font-size: 12px;
    line-height: 1.6;
    overflow-wrap: anywhere;
  }
  .ticket-description :global(p) { margin: 0 0 8px; }
  .ticket-description :global(p:last-child) { margin-bottom: 0; }
  .ticket-description :global(pre) { white-space: pre-wrap; overflow-wrap: anywhere; }
  .ticket-description :global(ul), .ticket-description :global(ol) { padding-left: 18px; margin: 0 0 8px; }
  .ticket-description :global(h1), .ticket-description :global(h2), .ticket-description :global(h3) { font-size: 13px; margin: 8px 0 4px; }
  .ticket-description :global(a) { color: var(--accent); }
  .ticket-description :global(img) { max-width: 100%; }

  .ticket-empty { color: var(--fg-3); font-style: italic; }
  .ticket-skeleton { padding: 4px 0; }
  .ticket-error { color: var(--danger, oklch(0.75 0.18 15)); font-size: 11px; }

  .ticket-actions { display: flex; gap: 6px; flex-wrap: wrap; }
</style>
