<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import { t } from '$lib/i18n';
  import { projects } from '$lib/stores/project';
  import { effortLabel, permissionModeLabel } from '$lib/utils/agent/run-options';
  import { listClaudeAgents, type DiscoveredAgent } from '$lib/services/ai-provider-service';

  /** Names already taken, so an import cannot silently shadow an existing agent. */
  export let existingNames: string[] = [];

  const dispatch = createEventDispatcher<{ close: void; confirm: DiscoveredAgent[] }>();

  let found: DiscoveredAgent[] = [];
  let selected = new Set<string>();
  let loading = true;
  let failed = '';

  $: taken = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  $: importable = found.filter((a) => !taken.has(a.name.trim().toLowerCase()));
  $: canImport = selected.size > 0;

  onMount(async () => {
    try {
      found = await listClaudeAgents($projects.map((p) => p.path));
      for (const agent of found) {
        if (!taken.has(agent.name.trim().toLowerCase())) selected.add(agent.path);
      }
      selected = selected;
    } catch (e) {
      failed = String(e);
    } finally {
      loading = false;
    }
  });

  function toggle(path: string) {
    if (selected.has(path)) selected.delete(path);
    else selected.add(path);
    selected = selected;
  }

  function submit() {
    const picked = found.filter((a) => selected.has(a.path));
    if (picked.length > 0) dispatch('confirm', picked);
  }
</script>

<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
<div
  class="modal-backdrop"
  role="dialog"
  aria-modal="true"
  tabindex="-1"
  on:click={() => dispatch('close')}
  on:keydown={(e) => e.key === 'Escape' && dispatch('close')}
>
  <div class="modal import-agents-modal" on:click|stopPropagation role="presentation">
    <div class="modal-head">
      <div>
        <div class="step-count">{t('home.agents.customAgents.import.heading')}</div>
        <h3>{t('home.agents.customAgents.import.title')}</h3>
      </div>
      <button class="icon-btn close" on:click={() => dispatch('close')} aria-label={t('common.close') as string}>
        <Icon name="x" size={16}/>
      </button>
    </div>

    <div class="modal-body">
      {#if loading}
        <div class="import-loading"><Spinner size={16}/></div>
      {:else if failed}
        <p class="import-error">{failed}</p>
      {:else if found.length === 0}
        <p class="import-empty">{t('home.agents.customAgents.import.empty')}</p>
      {:else}
        <p class="import-lead">{t('home.agents.customAgents.import.lead')}</p>
        <div class="import-list">
          {#each found as agent (agent.path)}
            {@const isTaken = taken.has(agent.name.trim().toLowerCase())}
            <label class="import-row {isTaken ? 'taken' : ''}">
              <input
                type="checkbox"
                checked={selected.has(agent.path)}
                disabled={isTaken}
                on:change={() => toggle(agent.path)}
              />
              <span class="import-info">
                <span class="import-name">
                  {agent.name}
                  <span class="import-scope">{agent.scope === 'project'
                    ? t('home.agents.customAgents.import.scopeProject')
                    : t('home.agents.customAgents.import.scopeGlobal')}</span>
                  {#if isTaken}
                    <span class="import-taken">{t('home.agents.customAgents.import.alreadyExists')}</span>
                  {/if}
                </span>
                {#if agent.description}
                  <span class="import-desc">{agent.description}</span>
                {/if}
                <span class="import-meta selectable">
                  {#if agent.model}<span>{agent.model}</span>{/if}
                  {#if agent.effort}<span>{effortLabel(agent.effort)}</span>{/if}
                  {#if agent.permissionMode}<span>{permissionModeLabel(agent.permissionMode)}</span>{/if}
                  {#if agent.tools.length > 0}<span>{agent.tools.join(', ')}</span>{/if}
                </span>
              </span>
            </label>
          {/each}
        </div>
      {/if}
    </div>

    <div class="modal-foot">
      <div class="spacer"></div>
      <button class="btn ghost" on:click={() => dispatch('close')}>{t('common.cancel')}</button>
      <button class="btn primary" disabled={!canImport} on:click={submit}>
        <Icon name="download" size={14}/>
        {(t('home.agents.customAgents.import.confirm') as (n: number) => string)(selected.size)}
      </button>
    </div>
  </div>
</div>

<style>
  .import-agents-modal { width: min(560px, 94vw); }

  .import-lead {
    margin: 0 0 12px;
    font-size: 12px;
    color: var(--fg-3);
    line-height: 1.5;
  }

  .import-loading { display: grid; place-items: center; padding: 32px; }

  .import-empty, .import-error {
    margin: 0;
    padding: 20px 0;
    font-size: 12.5px;
    color: var(--fg-3);
    line-height: 1.6;
  }
  .import-error { color: var(--danger); }

  .import-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 46vh;
    overflow-y: auto;
  }

  .import-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 9px 11px;
    background: var(--bg-2);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-md);
    cursor: pointer;
  }
  .import-row:hover { border-color: var(--stroke-1); }
  .import-row.taken { opacity: .5; cursor: default; }

  .import-row input { margin-top: 2px; accent-color: var(--accent); flex-shrink: 0; }

  .import-info {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .import-name {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--fg-0);
  }

  .import-scope {
    padding: 1px 6px;
    border-radius: 99px;
    background: var(--bg-3);
    border: 1px solid var(--stroke-0);
    color: var(--fg-3);
    font-size: 10px;
    font-family: var(--font-mono);
  }

  .import-taken { font-size: 10.5px; color: var(--warning); }

  .import-desc {
    font-size: 11.5px;
    color: var(--fg-3);
    line-height: 1.45;
  }

  .import-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--fg-4);
  }
</style>
