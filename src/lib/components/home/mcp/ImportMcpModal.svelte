<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * Imports MCP servers from a pasted `mcpServers` JSON block into a chosen scope and set of agents.
   * Dispatches `imported` with the names that were created.
   */
  import { createEventDispatcher, onMount } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Select from '$lib/components/Select.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import { t } from '$lib/i18n';
  import { projects } from '$lib/stores/project';
  import { importMcpServers, type McpScope } from '$lib/services/mcp-service';
  import ProviderPicker from '$lib/components/home/ProviderPicker.svelte';
  import { cliProviders, loadCliProviders } from '$lib/stores/cli-providers';
  import type { CliProviderId } from '$lib/services/cli-provider-service';

  const dispatch = createEventDispatcher<{ close: void; imported: string[] }>();

  const SAMPLE = `{
  "mcpServers": {
    "my-server": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "my-mcp-server"]
    }
  }
}`;

  let raw = '';
  let scope: McpScope = 'user';
  let projectId = $projects[0]?.id ?? '';
  let busy = false;
  let error = '';
  let targets: CliProviderId[] = ['claude-code'];

  onMount(loadCliProviders);

  $: unavailable = Object.fromEntries(
    $cliProviders
      .filter(() => scope === 'local')
      .filter((p) => !p.hasLocalScope)
      .map((p) => [p.id, t('mcp.scope.localOnlyClaude') as string]),
  );

  $: scopeOptions = [
    { value: 'user', label: t('mcp.scope.user') as string },
    ...($projects.length > 0
      ? [
          { value: 'local', label: t('mcp.scope.local') as string },
          { value: 'project', label: t('mcp.scope.project') as string },
        ]
      : []),
  ];

  $: projectOptions = $projects.map((p) => ({ value: p.id, label: p.name }));

  async function run() {
    busy = true;
    error = '';
    try {
      const project = $projects.find((p) => p.id === projectId);
      const names = await importMcpServers(
        scope,
        scope === 'user' ? '' : projectId,
        scope === 'user' ? '' : (project?.path ?? ''),
        targets,
        raw,
      );
      dispatch('imported', names);
    } catch (e) {
      error = String(e);
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
  <div class="modal import-modal" on:click|stopPropagation role="presentation">
    <div class="modal-head">
      <div>
        <div class="step-count">{t('mcp.import.heading')}</div>
        <h3>{t('mcp.import.title')}</h3>
      </div>
      <button class="icon-btn close" on:click={() => dispatch('close')} aria-label={t('common.close') as string}>
        <Icon name="x" size={16}/>
      </button>
    </div>

    <div class="modal-body">
      <p class="lead">{t('mcp.import.description')}</p>

      <div class="ag-card row-card">
        <div class="row-fields">
          <div class="ag-field">
            <span class="ag-hint">{t('mcp.fields.scope')}</span>
            <Select
              value={scope}
              options={scopeOptions}
              ariaLabel={t('mcp.fields.scope') as string}
              on:change={(e) => scope = e.detail as McpScope}
            />
          </div>
          {#if scope !== 'user'}
            <div class="ag-field">
              <span class="ag-hint">{t('mcp.fields.project')}</span>
              <Select
                value={projectId}
                options={projectOptions}
                ariaLabel={t('mcp.fields.project') as string}
                on:change={(e) => projectId = e.detail}
              />
            </div>
          {/if}
        </div>
      </div>

      <div class="ag-card">
        <div class="ag-card-info stacked">
          <span class="ag-label">{t('cliProviders.title')}</span>
          <span class="ag-hint">{t('mcp.import.targetsHint')}</span>
        </div>
        <ProviderPicker
          selected={targets}
          reached={targets}
          {unavailable}
          on:change={(e) => targets = e.detail}
        />
      </div>

      <label class="ag-label" for="mcp-import-json">{t('mcp.import.json')}</label>
      <textarea
        id="mcp-import-json"
        class="ag-textarea mono selectable"
        rows="12"
        spellcheck="false"
        placeholder={SAMPLE}
        bind:value={raw}
      ></textarea>

      {#if error}
        <div class="banner bad"><Icon name="alert" size={13}/><span>{error}</span></div>
      {/if}
    </div>

    <div class="modal-foot">
      <div class="spacer"></div>
      <button class="btn ghost" on:click={() => dispatch('close')}>{t('common.cancel')}</button>
      <button class="btn primary" on:click={run} disabled={busy || raw.trim() === '' || targets.length === 0 || (scope !== 'user' && !projectId)}>
        {#if busy}<Spinner size={11}/>{:else}<Icon name="download" size={12}/>{/if}
        {t('mcp.import.confirm')}
      </button>
    </div>
  </div>
</div>

<style>
  .import-modal { width: min(620px, 94vw); }
  .lead {
    margin: 0 0 14px;
    font-size: 13px;
    color: var(--fg-2);
    line-height: 1.6;
  }
  .row-card { display: flex; flex-direction: column; gap: 10px; }
  .ag-card-info.stacked { margin-bottom: 10px; }
  .row-fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 10px;
  }
  .mono {
    margin-top: 6px;
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1.6;
  }
  .banner {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 12px;
    padding: 9px 12px;
    border-radius: var(--r-md);
    font-size: 12px;
  }
  .banner.bad { background: var(--danger-weak); color: var(--danger); }
</style>
