<script lang="ts">
  /**
   * Panel listing the sub-agents called in the current conversation, one row
   * per agent with its latest run, elapsed time and permission state.
   */
  import Icon from '$lib/components/Icon.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import { t } from '$lib/i18n';
  import { agentPermissionRequests, isInFlight, type AgentRun } from '$lib/stores/agent-runs';

  /** One entry per agent called in this conversation, not one per run. */
  export let threads: { agentId: string; latest: AgentRun; runs: AgentRun[] }[] = [];
  export let openAgentId = '';
  export let onOpen: (agentId: string) => void;
  export let onDelete: (agentId: string) => void;

  $: running = threads.filter((th) => isInFlight(th.latest.status)).length;

  /** True when any run of the thread still has an unanswered permission request. */
  function waiting(thread: { runs: AgentRun[] }): boolean {
    return thread.runs.some((r) => $agentPermissionRequests[r.id]);
  }

  /** Coarse run duration, counted against now while the run is still in flight. */
  function elapsed(run: AgentRun): string {
    const end = run.endedAt ?? Date.now();
    const seconds = Math.max(0, Math.round((end - run.startedAt) / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h`;
  }
</script>

<div class="agents-panel">
  <div class="activity-head">
    <Icon name="sparkles" size={13}/>
    <span class="la-title">{t('agents.title')}</span>
    {#if threads.length > 0}
      <span class="la-badge" class:running={running > 0}>
        {running > 0 ? `${running}/${threads.length}` : threads.length}
      </span>
    {/if}
  </div>

  <div class="agents-list">
    {#if threads.length === 0}
      <div class="ap-empty">
        <Icon name="sparkles" size={16}/>
        <span>{t('agents.empty')}</span>
      </div>
    {:else}
      {#each threads as thread (thread.agentId)}
        <div class="ap-row">
        <button
          class="ap-item"
          class:active={thread.agentId === openAgentId}
          style="--agent: {thread.latest.color}"
          on:click={() => onOpen(thread.agentId)}
          title={t('agents.enter') as string}
        >
          <span class="ap-icon">
            <Icon name={thread.latest.icon || 'sparkles'} size={12}/>
          </span>
          <span class="ap-body">
            <span class="ap-name">{thread.latest.agentName}</span>
            <span class="ap-prompt" title={thread.latest.prompt}>{thread.latest.prompt}</span>
          </span>
          <span class="ap-side">
            {#if waiting(thread)}
              <Icon name="shield" size={11}/>
            {:else if isInFlight(thread.latest.status)}
              <Spinner size={10}/>
            {/if}
            <span class="ap-time">{elapsed(thread.latest)}</span>
          </span>
        </button>
        <button
          class="ap-delete"
          title={t('agents.deleteThread') as string}
          aria-label={t('agents.deleteThread') as string}
          on:click|stopPropagation={() => onDelete(thread.agentId)}
        >
          <Icon name="trash" size={11}/>
        </button>
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .agents-panel {
    border-bottom: 1px solid var(--stroke-0);
    display: flex;
    flex-direction: column;
    max-height: 45%;
    min-height: 0;
  }

  .activity-head { flex: 0 0 auto; }

  .la-title { flex: 1; }

  .la-badge {
    color: var(--fg-3);
    font-family: var(--font-mono);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
  }

  .la-badge.running { color: var(--accent); }

  .agents-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow-y: auto;
    padding: 8px 6px;
  }

  .ap-empty {
    align-items: center;
    color: var(--fg-3);
    display: flex;
    flex-direction: column;
    font-size: 11px;
    gap: 6px;
    padding: 14px 10px;
    text-align: center;
  }

  .ap-row {
    align-items: center;
    display: flex;
    min-width: 0;
  }

  .ap-delete {
    background: none;
    border: none;
    border-radius: 5px;
    color: var(--fg-3);
    cursor: pointer;
    display: flex;
    flex: 0 0 auto;
    padding: 5px;
  }

  .ap-delete:hover { background: var(--bg-2); color: var(--danger); }

  .ap-item {
    align-items: center;
    background: none;
    border: none;
    border-left: 2px solid transparent;
    border-radius: 5px;
    color: inherit;
    cursor: pointer;
    display: flex;
    flex: 1;
    gap: 7px;
    min-width: 0;
    padding: 6px 7px;
    text-align: left;
  }

  .ap-item:hover { background: var(--bg-2); }

  /* A selected row is a bar against the panel edge, not a floating pill. */
  .ap-item.active {
    background: var(--bg-3);
  }

  .ap-icon {
    align-items: center;
    color: var(--agent);
    display: flex;
    flex: 0 0 auto;
  }

  .ap-body {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .ap-name {
    color: var(--fg-0);
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ap-prompt,
  .ap-time {
    color: var(--fg-3);
    font-size: 10px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ap-side {
    align-items: center;
    color: var(--fg-2);
    display: flex;
    flex: 0 0 auto;
    gap: 4px;
  }
</style>
