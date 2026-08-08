<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Select from '$lib/components/Select.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import { t } from '$lib/i18n';
  import { projects } from '$lib/stores/project';
  import { writeFile } from '$lib/services/file-service';
  import {
    exportClaudeAgents, type CustomAgent, type ExportedAgent,
  } from '$lib/services/ai-provider-service';

  export let agents: CustomAgent[] = [];

  const CLAUDE_CLI_ID = 'claude-code-cli';

  const dispatch = createEventDispatcher<{ close: void }>();

  let target = 'claude';
  let scope = '';
  let overwrite = false;
  let busy = false;
  let failed = '';
  let written = 0;
  let existing = 0;

  /** An agent without a name has no file name, so it cannot be written out. */
  const exportable = agents.filter((a) => a.name.trim() !== '');
  let selected = new Set(exportable.map((a) => a.id));

  $: picked = exportable.filter((a) => selected.has(a.id));
  $: skippedUnnamed = agents.length - exportable.length;

  $: targetOptions = [
    { value: 'claude', label: t('home.agents.customAgents.export.destClaude') as string },
    { value: 'json', label: t('home.agents.customAgents.export.destJson') as string },
  ];
  $: scopeOptions = [
    { value: '', label: t('home.agents.customAgents.export.scopeGlobal') as string },
    ...$projects.map((p) => ({ value: p.path, label: p.name })),
  ];

  function toggle(id: string) {
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    selected = selected;
  }

  /**
   * A Claude Code definition holds one provider's settings, so the Claude Code
   * row is the one that survives - and any row at all is better than none.
   */
  function flatten(agent: CustomAgent): ExportedAgent {
    const row = agent.rows.find((r) => r.providerId === CLAUDE_CLI_ID) ?? agent.rows[0];
    return {
      name: agent.name,
      description: agent.description,
      model: row?.model ?? '',
      effort: row?.effort ?? '',
      permissionMode: row?.permissionMode ?? '',
      color: agent.color,
      tools: agent.allowedTools,
      systemPrompt: agent.systemPrompt,
    };
  }

  async function exportJson() {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({
      defaultPath: 'cairn-agents.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (typeof path !== 'string') return;
    await writeFile(path, `${JSON.stringify(picked, null, 2)}\n`);
    written = picked.length;
    existing = 0;
  }

  async function exportClaude() {
    const results = await exportClaudeAgents(picked.map(flatten), scope || null, overwrite);
    const broken = results.find((r) => r.skipped !== '' && r.skipped !== 'exists');
    if (broken) throw new Error(broken.skipped);
    written = results.filter((r) => r.skipped === '').length;
    existing = results.filter((r) => r.skipped === 'exists').length;
  }

  async function submit() {
    if (picked.length === 0) return;
    busy = true;
    failed = '';
    try {
      if (target === 'json') await exportJson();
      else await exportClaude();
    } catch (e) {
      failed = String(e);
    } finally {
      busy = false;
    }
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
  <div class="modal export-agents-modal" on:click|stopPropagation role="presentation">
    <div class="modal-head">
      <div>
        <div class="step-count">{t('home.agents.customAgents.export.heading')}</div>
        <h3>{t('home.agents.customAgents.export.title')}</h3>
      </div>
      <button class="icon-btn close" on:click={() => dispatch('close')} aria-label={t('common.close') as string}>
        <Icon name="x" size={16}/>
      </button>
    </div>

    <div class="modal-body">
      {#if exportable.length === 0}
        <p class="export-empty">{t('home.agents.customAgents.export.empty')}</p>
      {:else}
        <p class="export-lead">{t('home.agents.customAgents.export.lead')}</p>

        <div class="export-field">
          <span class="export-label">{t('home.agents.customAgents.export.destination')}</span>
          <Select bind:value={target} options={targetOptions}/>
          <span class="export-hint">
            {target === 'json'
              ? t('home.agents.customAgents.export.destJsonHint')
              : t('home.agents.customAgents.export.destClaudeHint')}
          </span>
        </div>

        {#if target === 'claude'}
          <div class="export-field">
            <span class="export-label">{t('home.agents.customAgents.export.scope')}</span>
            <Select bind:value={scope} options={scopeOptions}/>
          </div>
          <label class="export-check">
            <input type="checkbox" bind:checked={overwrite}/>
            <span>{t('home.agents.customAgents.export.overwrite')}</span>
          </label>
        {/if}

        <div class="export-list">
          {#each exportable as agent (agent.id)}
            <label class="export-row">
              <input type="checkbox" checked={selected.has(agent.id)} on:change={() => toggle(agent.id)}/>
              <span class="export-info">
                <span class="export-name">{agent.name}</span>
                {#if agent.description}
                  <span class="export-desc">{agent.description}</span>
                {/if}
              </span>
            </label>
          {/each}
        </div>

        {#if skippedUnnamed > 0}
          <p class="export-note">{t('home.agents.customAgents.export.unnamedSkipped')}</p>
        {/if}
        {#if failed}
          <p class="export-error">{failed}</p>
        {:else if written > 0 || existing > 0}
          <p class="export-done">
            {(t('home.agents.customAgents.export.done') as (n: number) => string)(written)}
            {#if existing > 0}
              {(t('home.agents.customAgents.export.skippedExists') as (n: number) => string)(existing)}
            {/if}
          </p>
        {/if}
      {/if}
    </div>

    <div class="modal-foot">
      <div class="spacer"></div>
      <button class="btn ghost" on:click={() => dispatch('close')}>{t('common.cancel')}</button>
      <button class="btn primary" disabled={picked.length === 0 || busy} on:click={submit}>
        {#if busy}
          <Spinner size={12}/>
        {:else}
          <Icon name="upload" size={14}/>
        {/if}
        {(t('home.agents.customAgents.export.confirm') as (n: number) => string)(picked.length)}
      </button>
    </div>
  </div>
</div>

<style>
  .export-agents-modal { width: min(560px, 94vw); }

  .export-lead {
    margin: 0 0 12px;
    font-size: 12px;
    color: var(--fg-3);
    line-height: 1.5;
  }

  .export-empty {
    margin: 0;
    padding: 20px 0;
    font-size: 12.5px;
    color: var(--fg-3);
  }

  .export-field {
    display: flex;
    flex-direction: column;
    gap: 5px;
    margin-bottom: 12px;
  }

  .export-label {
    font-size: 11px;
    color: var(--fg-3);
  }

  .export-hint {
    font-size: 11px;
    color: var(--fg-4);
    line-height: 1.45;
  }

  .export-check {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
    font-size: 12px;
    color: var(--fg-2);
    cursor: pointer;
  }

  .export-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 32vh;
    overflow-y: auto;
  }

  .export-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 9px 11px;
    background: var(--bg-2);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-md);
    cursor: pointer;
  }
  .export-row:hover { border-color: var(--stroke-1); }

  .export-row input, .export-check input { accent-color: var(--accent); flex-shrink: 0; }
  .export-row input { margin-top: 2px; }

  .export-info {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .export-name { font-size: 13px; color: var(--fg-0); }

  .export-desc {
    font-size: 11.5px;
    color: var(--fg-3);
    line-height: 1.45;
  }

  .export-note, .export-done, .export-error {
    margin: 12px 0 0;
    font-size: 11.5px;
    line-height: 1.5;
  }
  .export-note { color: var(--fg-4); }
  .export-done { color: var(--fg-2); }
  .export-error { color: var(--danger); }
</style>
