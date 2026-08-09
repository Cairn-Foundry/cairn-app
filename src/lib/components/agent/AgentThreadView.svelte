<script lang="ts">
  import { tick } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import { t } from '$lib/i18n';
  import { respondPermission, stopAgent } from '$lib/services/agent-service';
  import {
    agentPermissionRequests, clearAgentPermission, isInFlight, patchAgentRun,
    type AgentRun,
  } from '$lib/stores/agent-runs';
  import { settings } from '$lib/stores/settings';
  import {
    buildPermissionResponse, type PermissionDecision,
  } from '$lib/utils/agent/permission-response';
  import { responseStats } from '$lib/utils/agent/response-stats';
  import AgentThreadConfirmModal from './AgentThreadConfirmModal.svelte';
  import TurnBlocks from './TurnBlocks.svelte';
  import PermissionCard from './PermissionCard.svelte';

  /** Every run of this agent in this conversation, oldest first. */
  export let runs: AgentRun[] = [];
  export let projectId: string;
  export let onBack: () => void;
  export let onSend: (message: string) => void;
  export let onResetContext: () => void;
  export let onDelete: () => void;
  /** When the agent was last made to forget, so the thread can show the break. */
  export let contextResetAt = 0;
  export let renderMarkdown: (source: string) => string;

  let draft = '';
  let confirmingReset = false;
  let confirmingDelete = false;
  let scrollEl: HTMLElement | undefined;
  let textareaEl: HTMLTextAreaElement | undefined;

  const STATUS_KEYS = {
    running: 'agents.status.running',
    'awaiting-permission': 'agents.status.awaitingPermission',
    done: 'agents.status.done',
    stopped: 'agents.status.stopped',
    error: 'agents.status.error',
    interrupted: 'agents.status.interrupted',
  } as const;

  $: latest = runs[runs.length - 1];
  /** A finished agent needs no label - its answer is right there. */
  $: statusLabel = latest && latest.status !== 'done'
    ? (t(STATUS_KEYS[latest.status]) as string)
    : '';
  $: busy = !!latest && isInFlight(latest.status);
  $: request = latest ? $agentPermissionRequests[latest.id] : undefined;

  $: if (runs.length) void tick().then(scrollToEnd);

  function scrollToEnd() {
    if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
  }

  function statsOf(run: AgentRun) {
    return run.usage ? responseStats(run.usage, $settings.agentResponseStats) : [];
  }

  function resize() {
    if (!textareaEl) return;
    textareaEl.style.height = 'auto';
    textareaEl.style.height = `${textareaEl.scrollHeight}px`;
  }

  function send() {
    const message = draft.trim();
    if (!message || busy) return;
    draft = '';
    void tick().then(resize);
    onSend(message);
  }

  function onKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      send();
    }
  }

  async function stop() {
    if (!latest) return;
    try {
      await stopAgent(latest.id);
    } catch {
      // Already gone; the run's status follows from the event either way.
    }
  }

  async function answer(decision: PermissionDecision) {
    if (!request || !latest) return;
    clearAgentPermission(latest.id);
    patchAgentRun(projectId, latest.id, { status: 'running' });
    try {
      await respondPermission(
        request.runId,
        request.requestId,
        buildPermissionResponse(request, decision, t('agent.permission.denied') as string),
      );
    } catch (e) {
      patchAgentRun(projectId, latest.id, { error: String(e) });
    }
  }
</script>

<div class="thread-view" style="--agent: {latest?.color ?? 'var(--accent)'}">
  <div class="thread-bar">
    <span class="thread-identity">
      <Icon name={latest?.icon || 'sparkles'} size={14}/>
      <span class="thread-name">{latest?.agentName}</span>
    </span>
    {#if statusLabel}
      <span class="thread-status" class:warn={latest?.status === 'error'}>
        {#if busy}<Spinner size={11}/>{/if}
        {statusLabel}
      </span>
    {/if}
    <div class="thread-actions">
      <button
        class="btn ghost"
        on:click={() => { confirmingReset = true; }}
        title={t('agents.resetContextHint') as string}
      >
        <Icon name="undo" size={12}/> {t('agents.resetContext')}
      </button>
      <button
        class="btn ghost"
        on:click={() => { confirmingDelete = true; }}
        title={t('agents.deleteThread') as string}
      >
        <Icon name="trash" size={12}/> {t('agents.deleteThread')}
      </button>
      <button class="btn ghost" on:click={onBack}>
        <Icon name="x" size={12}/> {t('common.close')}
      </button>
    </div>
  </div>

  <div class="thread-scroll" bind:this={scrollEl}>
    {#if latest?.handedOverFrom}
      <div class="thread-note">{t('agents.handedOver')}</div>
    {/if}

    {#each runs as run, i (run.id)}
      {#if i > 0 && run.startedAt >= contextResetAt && runs[i - 1].startedAt < contextResetAt}
        <div class="thread-break">{t('agents.contextResetMark')}</div>
      {/if}
      <div class="msg user">
        <div class="msg-meta">{t('agent.you')}</div>
        <div class="bubble user-bubble selectable"><p>{run.prompt}</p></div>
      </div>

      <div class="msg agent">
        <div class="msg-meta">
          <Icon name={run.icon || 'sparkles'} size={11}/>
          {run.agentName}
          {#if run.usage?.model}
            <span class="msg-model">({run.usage.model})</span>
          {/if}
        </div>

        <div class="turn-blocks">
          <TurnBlocks
            blocks={run.blocks}
            showThinking={$settings.agentShowThinking}
            roots={[run.workingDir]}
            {renderMarkdown}
          />
        </div>

        {#if run.error}
          <div class="thread-error selectable">{run.error}</div>
        {/if}

        {#if run.result}
          {#if $settings.agentShowResponseStats && statsOf(run).length > 0}
            <div class="usage-line">
              {#each statsOf(run) as stat}
                <span class="usage-stat" title={t(`settings.agent.stat.${stat.id}`) as string}>
                  <Icon name={stat.icon} size={10}/>{stat.value}
                </span>
              {/each}
            </div>
          {/if}
        {:else if isInFlight(run.status)}
          <div class="thread-pending"><Spinner size={13}/></div>
        {/if}
      </div>
    {/each}

    {#if contextResetAt > 0 && (!latest || latest.startedAt < contextResetAt)}
      <div class="thread-break">{t('agents.contextResetMark')}</div>
    {/if}

    {#if request}
      <PermissionCard
        {request}
        onAnswer={answer}
        agentName={latest?.agentName ?? ''}
        {renderMarkdown}
      />
    {/if}
  </div>

  <div class="thread-input-wrap">
    <div class="thread-input">
      <textarea
        bind:this={textareaEl}
        bind:value={draft}
        on:input={resize}
        on:keydown={onKeydown}
        rows="1"
        class="selectable"
        placeholder={busy
          ? (t('agent.waitingResponse') as string)
          : ((t('agents.promptPlaceholder') as (n: string) => string)(latest?.agentName ?? ''))}
        disabled={busy}
      ></textarea>
      <div class="thread-input-row">
        <span class="thread-hint">{t('agents.ownContext')}</span>
        {#if busy}
          <button class="btn btn-stop" on:click={stop}>
            <Icon name="stop" size={12}/> {t('agent.interrupt')}
          </button>
        {:else}
          <button class="btn" on:click={send} disabled={!draft.trim()}>
            <Icon name="send" size={12}/> {t('agent.sendBtn')}
          </button>
        {/if}
      </div>
    </div>
  </div>
</div>

{#if confirmingDelete}
  <AgentThreadConfirmModal
    kind="delete"
    name={latest?.agentName ?? ''}
    on:close={() => { confirmingDelete = false; }}
    on:confirm={() => { confirmingDelete = false; onDelete(); }}
  />
{/if}

{#if confirmingReset}
  <AgentThreadConfirmModal
    kind="reset"
    name={latest?.agentName ?? ''}
    on:close={() => { confirmingReset = false; }}
    on:confirm={() => { confirmingReset = false; onResetContext(); }}
  />
{/if}

<style>
  .thread-view {
    border-left: 2px solid var(--agent);
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
  }

  .thread-bar {
    align-items: center;
    border-bottom: 1px solid var(--stroke-0);
    display: flex;
    flex: 0 0 auto;
    /* Three actions and a name do not fit a narrow panel side by side. */
    flex-wrap: wrap;
    gap: 8px;
    min-width: 0;
    padding: 8px 12px;
  }

  .thread-identity {
    align-items: center;
    color: var(--agent);
    display: flex;
    font-size: 13px;
    font-weight: 600;
    gap: 6px;
    min-width: 0;
  }

  .thread-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .thread-status {
    align-items: center;
    color: var(--fg-2);
    display: flex;
    font-size: 11px;
    gap: 5px;
  }

  .thread-status.warn { color: var(--danger); }

  .thread-actions {
    display: flex;
    gap: 6px;
    margin-left: auto;
  }

  .thread-scroll {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 16px;
    min-height: 0;
    /* A flex child is free to grow past its parent unless told otherwise, and
       one long path is enough to push the whole thread sideways. */
    min-width: 0;
    overflow-y: auto;
    padding: 16px 20px;
  }

  .thread-break {
    align-items: center;
    color: var(--fg-3);
    display: flex;
    font-size: 10px;
    gap: 8px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .thread-break::before,
  .thread-break::after {
    background: var(--stroke-0);
    content: "";
    flex: 1;
    height: 1px;
  }

  .thread-note {
    color: var(--fg-3);
    font-size: 11px;
  }

  .msg {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }

  .msg-meta {
    align-items: center;
    color: var(--fg-3);
    display: flex;
    font-size: 11px;
    gap: 5px;
  }

  .msg-model { color: var(--fg-3); }

  .bubble {
    font-size: 13px;
    line-height: 1.6;
    min-width: 0;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .bubble :global(p) { margin: 0 0 8px; }
  .bubble :global(p:last-child) { margin-bottom: 0; }

  .user-bubble {
    background: var(--bg-2);
    border-radius: 8px;
    padding: 8px 10px;
    white-space: pre-wrap;
  }

  .thread-error {
    color: var(--danger);
    font-size: 12px;
    white-space: pre-wrap;
  }

  .thread-pending {
    display: flex;
    padding: 6px 0;
  }

  .usage-line {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  .usage-stat {
    align-items: center;
    color: var(--fg-3);
    display: flex;
    font-size: 10px;
    gap: 3px;
  }

  .thread-input-wrap {
    flex: 0 0 auto;
    min-width: 0;
    padding: 10px 16px 14px;
  }

  .thread-input {
    background: var(--bg-1);
    border: 1px solid var(--agent);
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px 10px;
  }

  .thread-input textarea {
    background: none;
    border: none;
    color: var(--fg-0);
    font: inherit;
    font-size: 13px;
    max-height: 200px;
    outline: none;
    resize: none;
    width: 100%;
  }

  .thread-input-row {
    align-items: center;
    display: flex;
    gap: 8px;
  }

  .thread-hint {
    color: var(--fg-3);
    flex: 1;
    font-size: 10px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
