<script lang="ts">
  /**
   * Inline card asking the user to allow or deny one agent tool call.
   * `onAnswer` resolves the pending request; ExitPlanMode renders as a plan
   * approval rather than a tool prompt.
   */
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n';
  import type {
    PendingPermission, PermissionDecision,
  } from '$lib/utils/agent/permission-response';

  export let request: PendingPermission;
  export let onAnswer: (decision: PermissionDecision) => void;
  export let renderMarkdown: (source: string) => string;
  /** Named when the request comes from an agent, so the card says who is asking. */
  export let agentName = '';

  $: isPlan = request.toolName === 'ExitPlanMode';

  /** The one value the decision actually turns on, when the tool has one. */
  $: preview = (() => {
    const input = request.input;
    const value =
      input.command ?? input.file_path ?? input.path ?? input.url ?? input.pattern;
    return typeof value === 'string' ? value : '';
  })();
</script>

<div class="permission-card" class:plan={isPlan}>
  <div class="permission-head">
    <Icon name="shield" size={13}/>
    {#if isPlan}
      {t('agent.permission.planTitle')}
    {:else}
      {t('agent.permission.title')} - {request.displayName ?? request.toolName}
    {/if}
    {#if agentName}
      <span class="permission-who">{agentName}</span>
    {/if}
  </div>

  {#if isPlan}
    <div class="permission-plan selectable">
      {@html renderMarkdown(String(request.input.plan ?? ''))}
    </div>
  {:else}
    {#if request.description}
      <div class="permission-desc">{request.description}</div>
    {/if}
    {#if preview}
      <code class="permission-preview selectable">{preview}</code>
    {/if}
  {/if}

  <div class="permission-actions">
    {#if isPlan}
      <button class="perm-btn allow" on:click={() => onAnswer('allow')}>
        <Icon name="check" size={12}/> {t('agent.permission.approvePlan')}
      </button>
      <button class="perm-btn" on:click={() => onAnswer('deny')}>
        {t('agent.permission.keepPlanning')}
      </button>
    {:else}
      <button class="perm-btn allow" on:click={() => onAnswer('allow')}>
        <Icon name="check" size={12}/> {t('agent.permission.allow')}
      </button>
      {#if request.suggestions?.length}
        <button class="perm-btn" on:click={() => onAnswer('always')}>
          {t('agent.permission.alwaysAllow')}
        </button>
      {/if}
      <button class="perm-btn deny" on:click={() => onAnswer('deny')}>
        <Icon name="x" size={12}/> {t('agent.permission.deny')}
      </button>
    {/if}
  </div>
</div>

<style>
  .permission-card {
    background: var(--bg-2);
    border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
    border-radius: var(--r-md);
    margin: 10px 0;
    padding: 12px 14px;
  }

  .permission-head {
    align-items: center;
    color: var(--fg-0);
    display: flex;
    font-size: 12px;
    font-weight: 600;
    gap: 8px;
  }

  .permission-who {
    background: var(--bg-3);
    border-radius: 8px;
    color: var(--fg-2);
    font-size: 10px;
    font-weight: 500;
    padding: 1px 7px;
  }

  .permission-desc {
    color: var(--fg-2);
    font-size: 11.5px;
    margin-top: 6px;
  }

  .permission-preview {
    background: var(--bg-0);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-sm);
    color: var(--fg-1);
    display: block;
    font-family: var(--font-mono);
    font-size: 11px;
    margin-top: 8px;
    padding: 7px 10px;
    white-space: pre-wrap;
    word-break: break-all;
  }

  .permission-plan {
    border-left: 2px solid var(--accent);
    color: var(--fg-1);
    font-size: 12px;
    margin-top: 8px;
    max-height: 320px;
    overflow-y: auto;
    padding: 8px 12px;
  }

  .permission-actions {
    display: flex;
    gap: 8px;
    margin-top: 12px;
  }

  .perm-btn {
    align-items: center;
    background: var(--bg-3);
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-sm);
    color: var(--fg-1);
    cursor: pointer;
    display: inline-flex;
    font-family: var(--font-ui);
    font-size: 11.5px;
    gap: 5px;
    padding: 5px 12px;
    transition: background .12s, color .12s, border-color .12s;
  }

  .perm-btn:hover { background: var(--bg-4); color: var(--fg-0); }

  .perm-btn.allow {
    background: var(--accent-weak, color-mix(in srgb, var(--accent) 12%, transparent));
    border-color: color-mix(in srgb, var(--accent) 35%, transparent);
    color: var(--accent);
  }

  .perm-btn.allow:hover {
    background: color-mix(in srgb, var(--accent) 22%, transparent);
  }

  .perm-btn.deny:hover {
    border-color: rgba(255, 80, 80, .4);
    color: #ff8080;
  }
</style>
