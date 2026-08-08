<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { t } from '$lib/i18n';
  import Icon from '$lib/components/Icon.svelte';
  import IconPicker from '$lib/components/IconPicker.svelte';
  import Select from '$lib/components/Select.svelte';
  import ImportAgentsModal from './ImportAgentsModal.svelte';
  import ExportAgentsModal from './ExportAgentsModal.svelte';
  import { PROVIDERS, prettyModelName } from './providers-data';
  import { ACCENT_PRESETS } from '$lib/utils/home/appearance';
  import { KNOWN_TOOLS, normalizeToolList } from '$lib/utils/agent/tools';
  import { effortLabel, permissionModeLabel } from '$lib/utils/agent/run-options';
  import { mentionToken } from '$lib/utils/agent/mention';
  import {
    customAgents, effortsOf, loadAiProviders, modelsOf, permissionModesOf,
    providerCapabilities, refreshProviderModels, setCustomAgents, type CustomAgent,
  } from '$lib/stores/ai-providers';
  import type { AgentProviderRow, DiscoveredAgent } from '$lib/services/ai-provider-service';

  const SELECTABLE_PROVIDERS = PROVIDERS.filter((p) => p.status !== 'coming-soon');
  const CLAUDE_CLI_ID = 'claude-code-cli';

  function makeId(): string {
    return crypto.randomUUID();
  }

  function newAgent(): CustomAgent {
    return {
      id: makeId(),
      name: '',
      description: '',
      color: ACCENT_PRESETS[0].color,
      icon: '',
      systemPrompt: '',
      rows: [],
      allowedTools: [],
      disallowedTools: [],
      overrideParams: false,
      temperature: 1.0,
      maxTokens: 8192,
    };
  }

  function newRow(providerId: string): AgentProviderRow {
    return { providerId, model: '', effort: '', permissionMode: '' };
  }

  let agents: CustomAgent[] = [];
  let search = '';
  let selectedAgentId: string | null = null;
  let confirmDeleteId: string | null = null;
  let importOpen = false;
  let exportOpen = false;
  let hydrated = false;

  let allowedDraft = '';
  let disallowedDraft = '';

  onMount(async () => {
    await loadAiProviders();
    agents = structuredClone(get(customAgents));
    selectedAgentId = agents[0]?.id ?? null;
    hydrated = true;
    for (const p of SELECTABLE_PROVIDERS) void refreshProviderModels(p.id);
  });

  $: if (hydrated) setCustomAgents(structuredClone(agents));

  $: query = search.trim().toLowerCase();
  /** The agent being edited stays listed, so renaming it never makes its row vanish. */
  $: visibleAgents = query
    ? agents.filter((a) =>
        a.id === selectedAgentId
        || `${a.name} ${a.description} ${providerSummary(a)}`.toLowerCase().includes(query))
    : agents;

  $: selectedAgent = agents.find((a) => a.id === selectedAgentId) ?? null;
  $: colorIsPreset = selectedAgent ? ACCENT_PRESETS.some((p) => p.color === selectedAgent!.color) : true;

  /** A provider already given a row is not offered a second time. */
  $: unusedProviders = selectedAgent
    ? SELECTABLE_PROVIDERS.filter((p) => !selectedAgent!.rows.some((r) => r.providerId === p.id))
    : [];

  /**
   * Tools are passed as CLI flags, so they only bite when the agent is tuned
   * for at least one agentic CLI - or for no provider at all, in which case it
   * may end up running on one.
   */
  $: supportsTools = selectedAgent !== null
    && (selectedAgent.rows.length === 0
      || selectedAgent.rows.some((r) =>
        SELECTABLE_PROVIDERS.find((p) => p.id === r.providerId)?.kind === 'cli'));

  function defOf(providerId: string) {
    return SELECTABLE_PROVIDERS.find((p) => p.id === providerId);
  }

  function modelOptionsFor(providerId: string) {
    return modelsOf(providerId, $providerCapabilities).map((m) => ({ value: m.id, label: m.label }));
  }

  function effortOptionsFor(row: AgentProviderRow) {
    if (!defOf(row.providerId)?.supportsEffort) return [];
    return [
      { value: '', label: t('home.agents.customAgents.rows.inherit') as string },
      ...effortsOf(row.providerId, $providerCapabilities, row.effort)
        .map((level) => ({ value: level, label: effortLabel(level) })),
    ];
  }

  function permissionOptionsFor(row: AgentProviderRow) {
    if (!defOf(row.providerId)?.supportsPermissionMode) return [];
    return [
      { value: '', label: t('home.agents.customAgents.rows.inherit') as string },
      ...permissionModesOf(row.providerId, $providerCapabilities, row.permissionMode)
        .map((mode) => ({ value: mode, label: permissionModeLabel(mode) })),
    ];
  }

  /**
   * Two agents whose names collapse to the same `@token` are indistinguishable
   * at the prompt, and only the first one would ever run.
   */
  $: mentionClash = selectedAgent !== null
    && selectedAgent.name.trim() !== ''
    && agents.some((a) =>
      a.id !== selectedAgent!.id
      && a.name.trim() !== ''
      && mentionToken(a.name).toLowerCase() === mentionToken(selectedAgent!.name).toLowerCase());

  function touch() {
    agents = agents;
  }

  function selectAgent(id: string) {
    selectedAgentId = id;
    confirmDeleteId = null;
    allowedDraft = '';
    disallowedDraft = '';
  }

  function createAgent() {
    const agent = newAgent();
    search = '';
    agents = [...agents, agent];
    selectAgent(agent.id);
  }

  /** A copy is a starting point, so it lands next to its source, not at the end. */
  function duplicateAgent(source: CustomAgent) {
    const copy: CustomAgent = {
      ...structuredClone(source),
      id: makeId(),
      name: (t('home.agents.customAgents.copyOf') as (n: string) => string)(
        source.name || (t('home.agents.customAgents.untitled') as string),
      ),
    };
    const at = agents.findIndex((a) => a.id === source.id);
    agents = [...agents.slice(0, at + 1), copy, ...agents.slice(at + 1)];
    search = '';
    selectAgent(copy.id);
  }

  function deleteAgent(id: string) {
    agents = agents.filter((a) => a.id !== id);
    if (selectedAgentId === id) selectedAgentId = agents[0]?.id ?? null;
    confirmDeleteId = null;
  }

  function addRow(agent: CustomAgent) {
    const next = unusedProviders[0];
    if (!next) return;
    agent.rows = [...agent.rows, newRow(next.id)];
    touch();
    void refreshProviderModels(next.id);
  }

  function removeRow(agent: CustomAgent, index: number) {
    agent.rows = agent.rows.filter((_, i) => i !== index);
    touch();
  }

  /** Model, effort and permission belong to a provider; none survives a swap. */
  function changeRowProvider(agent: CustomAgent, index: number, providerId: string) {
    agent.rows[index] = newRow(providerId);
    touch();
    void refreshProviderModels(providerId);
  }

  function providerOptionsFor(agent: CustomAgent, index: number) {
    const own = agent.rows[index].providerId;
    return SELECTABLE_PROVIDERS
      .filter((p) => p.id === own || !agent.rows.some((r) => r.providerId === p.id))
      .map((p) => ({ value: p.id, label: p.name }));
  }

  function addTool(agent: CustomAgent, list: 'allowedTools' | 'disallowedTools', raw: string) {
    const tool = raw.trim();
    if (!tool || agent[list].includes(tool)) return;
    agent[list] = normalizeToolList([...agent[list], tool]);
    touch();
  }

  function removeTool(agent: CustomAgent, list: 'allowedTools' | 'disallowedTools', tool: string) {
    agent[list] = agent[list].filter((x) => x !== tool);
    touch();
  }

  /**
   * A Claude Code definition names its tools as an allow list and carries its
   * body as the system prompt. Whatever it leaves out keeps Cairn's default,
   * so an absent effort or permission mode means "inherit the provider's".
   */
  function importAgents(found: DiscoveredAgent[]) {
    const imported = found.map((a): CustomAgent => ({
      ...newAgent(),
      id: makeId(),
      name: a.name,
      description: a.description,
      rows: [{
        providerId: CLAUDE_CLI_ID,
        model: a.model,
        effort: a.effort,
        permissionMode: a.permissionMode,
      }],
      systemPrompt: a.systemPrompt,
      allowedTools: normalizeToolList(a.tools),
      color: a.color
        || ACCENT_PRESETS[(a.name.length + a.scope.length) % ACCENT_PRESETS.length].color,
    }));
    agents = [...agents, ...imported];
    search = '';
    importOpen = false;
    if (imported.length > 0) selectAgent(imported[0].id);
  }

  function agentInitials(name: string): string {
    const words = name.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return '?';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
  }

  function providerLabel(providerId: string): string {
    return SELECTABLE_PROVIDERS.find((p) => p.id === providerId)?.name ?? providerId;
  }

  function modelLabel(providerId: string, modelId: string): string {
    return (
      modelsOf(providerId, $providerCapabilities).find((m) => m.id === modelId)?.label
      ?? prettyModelName(modelId)
    );
  }

  /** What the list row says under the name: where this agent is tuned to run. */
  function providerSummary(agent: CustomAgent): string {
    if (agent.rows.length === 0) return t('home.agents.customAgents.rows.anyProvider') as string;
    if (agent.rows.length === 1) {
      const row = agent.rows[0];
      return providerLabel(row.providerId)
        + (row.model ? ` - ${modelLabel(row.providerId, row.model)}` : '');
    }
    return agent.rows.map((r) => providerLabel(r.providerId)).join(', ');
  }
</script>

<div class="ag-layout">
  <aside class="ag-master">
    <div class="ag-master-header">
      <span class="ag-master-title">{t('home.sidebar.agents')}</span>
      <span class="master-actions">
        <button
          class="icon-btn"
          on:click={() => importOpen = true}
          title={t('home.agents.customAgents.import.title') as string}
        >
          <Icon name="download" size={13}/>
        </button>
        <button
          class="icon-btn"
          on:click={() => exportOpen = true}
          disabled={agents.length === 0}
          title={t('home.agents.customAgents.export.title') as string}
        >
          <Icon name="upload" size={13}/>
        </button>
        <button
          class="icon-btn"
          on:click={createAgent}
          title={t('home.agents.customAgents.newAgent') as string}
        >
          <Icon name="plus" size={13}/>
        </button>
      </span>
    </div>

    {#if agents.length > 1}
      <div class="ag-search">
        <Icon name="search" size={12}/>
        <input
          bind:value={search}
          placeholder={t('home.agents.searchAgents') as string}
          aria-label={t('home.agents.searchAgents') as string}
          spellcheck="false"
        />
        {#if search}
          <button class="ag-search-clear" on:click={() => search = ''} aria-label={t('home.agents.clearSearch') as string}>
            <Icon name="x" size={11}/>
          </button>
        {/if}
      </div>
    {/if}

    {#if agents.length === 0}
      <p class="ag-master-empty">{t('home.agents.customAgents.emptyTitle')}</p>
    {:else if visibleAgents.length === 0}
      <p class="ag-master-empty">{t('home.agents.searchNoResults')}</p>
    {:else}
      {#each visibleAgents as agent (agent.id)}
        <div class="agent-row {selectedAgentId === agent.id ? 'active' : ''}">
          <button
            class="ag-item"
            style="--tile: {agent.color}"
            aria-pressed={selectedAgentId === agent.id}
            on:click={() => selectAgent(agent.id)}
          >
            <span class="ag-tile">
              {#if agent.icon}
                <Icon name={agent.icon} size={15}/>
              {:else}
                {agentInitials(agent.name || t('home.agents.customAgents.untitled') as string)}
              {/if}
            </span>
            <span class="ag-item-info">
              <span class="ag-item-name">
                {agent.name || t('home.agents.customAgents.untitled')}
              </span>
              <span class="ag-item-sub">{providerSummary(agent)}</span>
            </span>
          </button>

          {#if confirmDeleteId === agent.id}
            <button
              class="icon-btn confirm"
              on:click={() => deleteAgent(agent.id)}
              title={t('home.agents.customAgents.deleteConfirm') as string}
            >
              <Icon name="check" size={12}/>
            </button>
            <button
              class="icon-btn"
              aria-label={t('common.cancel') as string}
              on:click={() => confirmDeleteId = null}
            >
              <Icon name="x" size={12}/>
            </button>
          {:else}
            <button
              class="icon-btn delete"
              on:click={() => confirmDeleteId = agent.id}
              title={t('home.agents.customAgents.deleteConfirm') as string}
            >
              <Icon name="trash" size={12}/>
            </button>
          {/if}
        </div>
      {/each}
    {/if}
  </aside>

  <section class="ag-detail">
    {#if selectedAgent === null}
      <div class="ag-empty">
        <span class="ag-empty-icon"><Icon name="agent" size={30} sw={1.2}/></span>
        <p class="ag-empty-title">{t('home.agents.customAgents.emptyTitle')}</p>
        <p class="ag-empty-desc">{t('home.agents.customAgents.emptyDesc')}</p>
        <div class="empty-actions">
          <button class="btn primary" on:click={createAgent}>
            <Icon name="plus" size={12}/> {t('home.agents.customAgents.createFirst')}
          </button>
          <button class="btn" on:click={() => importOpen = true}>
            <Icon name="download" size={12}/> {t('home.agents.customAgents.import.title')}
          </button>
        </div>
      </div>
    {:else}
      <div class="ag-head" style="--tile: {selectedAgent.color}">
        <span class="ag-tile ag-tile-lg">
          {#if selectedAgent.icon}
            <Icon name={selectedAgent.icon} size={22}/>
          {:else}
            {agentInitials(selectedAgent.name || t('home.agents.customAgents.untitled') as string)}
          {/if}
        </span>
        <div class="ag-head-text">
          <input
            class="ag-input name-input"
            type="text"
            aria-label={t('home.agents.customAgents.fields.name') as string}
            placeholder={t('home.agents.customAgents.fields.namePlaceholder') as string}
            bind:value={selectedAgent.name}
            on:input={touch}
          />
          <input
            class="ag-input desc-input"
            type="text"
            aria-label={t('home.agents.customAgents.fields.description') as string}
            placeholder={t('home.agents.customAgents.fields.descriptionPlaceholder') as string}
            bind:value={selectedAgent.description}
            on:input={touch}
          />
          <span class="mention-line">
            {#if mentionClash}
              <span class="ag-hint warn">
                {(t('home.agents.customAgents.mentionClash') as (m: string) => string)(
                  `@${mentionToken(selectedAgent.name)}`,
                )}
              </span>
            {:else if selectedAgent.name.trim()}
              <span class="ag-hint">
                {(t('home.agents.customAgents.mentionHint') as (m: string) => string)(
                  `@${mentionToken(selectedAgent.name)}`,
                )}
              </span>
            {/if}
          </span>
        </div>
        <button
          class="btn ghost"
          on:click={() => duplicateAgent(selectedAgent)}
          title={t('home.agents.customAgents.duplicate') as string}
        >
          <Icon name="copy" size={13}/>
        </button>
      </div>

      <div class="ag-group">
        <div class="ag-group-title">{t('home.agents.customAgents.rows.title')}</div>

        {#if selectedAgent.rows.length === 0}
          <div class="ag-card">
            <div class="ag-card-head">
              <div class="ag-card-info">
                <span class="ag-label">{t('home.agents.customAgents.rows.anyProvider')}</span>
                <span class="ag-hint">{t('home.agents.customAgents.rows.anyProviderHint')}</span>
              </div>
            </div>
          </div>
        {/if}

        {#each selectedAgent.rows as row, i (i)}
          {@const modelOptions = modelOptionsFor(row.providerId)}
          {@const efforts = effortOptionsFor(row)}
          {@const permissions = permissionOptionsFor(row)}
          <div class="ag-card row-card">
            <div class="row-head">
              <span class="row-provider">
                <Select
                  value={row.providerId}
                  options={providerOptionsFor(selectedAgent, i)}
                  ariaLabel={t('home.agents.customAgents.fields.provider') as string}
                  on:change={(e) => changeRowProvider(selectedAgent, i, e.detail)}
                />
              </span>
              <button
                class="icon-btn delete"
                on:click={() => removeRow(selectedAgent, i)}
                title={t('home.agents.customAgents.rows.remove') as string}
              >
                <Icon name="trash" size={12}/>
              </button>
            </div>

            <div class="row-fields">
              <div class="ag-field">
                <span class="ag-hint">{t('home.agents.customAgents.fields.model')}</span>
                {#if modelOptions.length > 0}
                  <Select
                    value={row.model}
                    options={[{ value: '', label: t('home.agents.customAgents.rows.inherit') as string }, ...modelOptions]}
                    ariaLabel={t('home.agents.customAgents.fields.model') as string}
                    on:change={(e) => { row.model = e.detail; touch(); }}
                  />
                {:else}
                  <input
                    class="ag-input"
                    type="text"
                    aria-label={t('home.agents.customAgents.fields.model') as string}
                    placeholder="model-name"
                    bind:value={row.model}
                    on:input={touch}
                  />
                {/if}
              </div>

              {#if efforts.length > 0}
                <div class="ag-field">
                  <span class="ag-hint">{t('home.agents.fields.effort')}</span>
                  <Select
                    value={row.effort}
                    options={efforts}
                    ariaLabel={t('home.agents.fields.effort') as string}
                    on:change={(e) => { row.effort = e.detail; touch(); }}
                  />
                </div>
              {/if}

              {#if permissions.length > 0}
                <div class="ag-field">
                  <span class="ag-hint">{t('home.agents.fields.permissionMode')}</span>
                  <Select
                    value={row.permissionMode}
                    options={permissions}
                    ariaLabel={t('home.agents.fields.permissionMode') as string}
                    on:change={(e) => { row.permissionMode = e.detail; touch(); }}
                  />
                </div>
              {/if}
            </div>

            {#if row.permissionMode === 'bypassPermissions'}
              <span class="ag-hint warn">{t('home.agents.fields.bypassWarning')}</span>
            {/if}
          </div>
        {/each}

        {#if unusedProviders.length > 0}
          <button class="btn add-row" on:click={() => addRow(selectedAgent)}>
            <Icon name="plus" size={12}/> {t('home.agents.customAgents.rows.add')}
          </button>
        {/if}
      </div>

      <div class="ag-group">
        <div class="ag-group-title">{t('home.agents.customAgents.sections.appearance')}</div>

        <div class="ag-card">
          <div class="ag-card-head">
            <div class="ag-card-info">
              <span class="ag-label">{t('home.agents.customAgents.fields.icon')}</span>
              <span class="ag-hint">{t('home.agents.customAgents.fields.iconHint')}</span>
            </div>
            <div class="ag-control">
              {#if selectedAgent.icon}
                <button
                  class="btn ghost"
                  on:click={() => { selectedAgent.icon = ''; touch(); }}
                >
                  {t('home.agents.customAgents.fields.useInitials')}
                </button>
              {/if}
              <IconPicker
                value={selectedAgent.icon || 'agent'}
                on:select={(e) => { selectedAgent.icon = e.detail; touch(); }}
              />
            </div>
          </div>
        </div>

        <div class="ag-card">
          <div class="ag-field">
            <span class="ag-label">{t('settings.appearance.accentGroup')}</span>
            <div class="color-picker">
              {#each ACCENT_PRESETS as preset}
                <button
                  class="color-dot {selectedAgent.color === preset.color && colorIsPreset ? 'active' : ''}"
                  title={preset.label}
                  aria-label={preset.label}
                  style="background: {preset.color}"
                  on:click={() => { selectedAgent.color = preset.color; touch(); }}
                ></button>
              {/each}
              <label
                class="color-dot color-dot-custom {!colorIsPreset ? 'active' : ''}"
                title={t('settings.appearance.customColor') as string}
                style="background: {selectedAgent.color}"
              >
                <input
                  type="color"
                  aria-label={t('settings.appearance.customColor') as string}
                  value={selectedAgent.color}
                  on:input={(e) => { selectedAgent.color = (e.currentTarget as HTMLInputElement).value; touch(); }}
                />
                {#if colorIsPreset}<span class="color-custom-icon">+</span>{/if}
              </label>
            </div>
          </div>
        </div>
      </div>

      <div class="ag-group">
        <div class="ag-group-title">{t('home.agents.customAgents.fields.systemPrompt')}</div>

        <div class="ag-card">
          <div class="ag-field">
            <div class="ag-card-info">
              <label class="ag-label" for="a-prompt">{t('home.agents.customAgents.fields.systemPrompt')}</label>
              <span class="ag-hint">{t('home.agents.customAgents.fields.systemPromptHint')}</span>
            </div>
            <textarea
              id="a-prompt"
              class="ag-textarea"
              placeholder={t('home.agents.customAgents.fields.systemPromptPlaceholder') as string}
              bind:value={selectedAgent.systemPrompt}
              on:input={touch}
              rows="10"
              spellcheck="false"
            ></textarea>
          </div>
        </div>
      </div>

      <div class="ag-group">
        <div class="ag-group-title">{t('home.agents.customAgents.sections.tools')}</div>

        {#if !supportsTools}
          <div class="ag-card">
            <span class="ag-hint">{t('home.agents.customAgents.tools.cliOnly')}</span>
          </div>
        {:else}
          <datalist id="a-tool-names">
            {#each KNOWN_TOOLS as tool}<option value={tool}></option>{/each}
          </datalist>

          <div class="ag-card">
            <div class="ag-field">
              <div class="ag-card-info">
                <label class="ag-label" for="a-allowed">{t('home.agents.customAgents.tools.allowed')}</label>
                <span class="ag-hint">{t('home.agents.customAgents.tools.allowedHint')}</span>
              </div>
              <div class="inline-row">
                <input
                  id="a-allowed"
                  class="ag-input"
                  type="text"
                  list="a-tool-names"
                  placeholder={t('home.agents.customAgents.tools.placeholder') as string}
                  bind:value={allowedDraft}
                  on:keydown={(e) => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    addTool(selectedAgent, 'allowedTools', allowedDraft);
                    allowedDraft = '';
                  }}
                  autocomplete="off"
                  spellcheck="false"
                />
                <button
                  class="btn"
                  disabled={!allowedDraft.trim()}
                  on:click={() => { addTool(selectedAgent, 'allowedTools', allowedDraft); allowedDraft = ''; }}
                >
                  <Icon name="plus" size={12}/> {t('home.agents.fields.addCustomModel')}
                </button>
              </div>
              {#if selectedAgent.allowedTools.length > 0}
                <div class="ag-chips">
                  {#each selectedAgent.allowedTools as tool}
                    <span class="ag-chip">
                      <span class="selectable">{tool}</span>
                      <button
                        class="ag-chip-remove"
                        aria-label={(t('home.agents.customAgents.tools.remove') as (x: string) => string)(tool)}
                        on:click={() => removeTool(selectedAgent, 'allowedTools', tool)}
                      >
                        <Icon name="x" size={10}/>
                      </button>
                    </span>
                  {/each}
                </div>
              {:else}
                <span class="ag-hint">{t('home.agents.customAgents.tools.allowedEmpty')}</span>
              {/if}
            </div>
          </div>

          <div class="ag-card">
            <div class="ag-field">
              <div class="ag-card-info">
                <label class="ag-label" for="a-disallowed">{t('home.agents.customAgents.tools.disallowed')}</label>
                <span class="ag-hint">{t('home.agents.customAgents.tools.disallowedHint')}</span>
              </div>
              <div class="inline-row">
                <input
                  id="a-disallowed"
                  class="ag-input"
                  type="text"
                  list="a-tool-names"
                  placeholder={t('home.agents.customAgents.tools.placeholder') as string}
                  bind:value={disallowedDraft}
                  on:keydown={(e) => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    addTool(selectedAgent, 'disallowedTools', disallowedDraft);
                    disallowedDraft = '';
                  }}
                  autocomplete="off"
                  spellcheck="false"
                />
                <button
                  class="btn"
                  disabled={!disallowedDraft.trim()}
                  on:click={() => { addTool(selectedAgent, 'disallowedTools', disallowedDraft); disallowedDraft = ''; }}
                >
                  <Icon name="plus" size={12}/> {t('home.agents.fields.addCustomModel')}
                </button>
              </div>
              {#if selectedAgent.disallowedTools.length > 0}
                <div class="ag-chips">
                  {#each selectedAgent.disallowedTools as tool}
                    <span class="ag-chip">
                      <span class="selectable">{tool}</span>
                      <button
                        class="ag-chip-remove"
                        aria-label={(t('home.agents.customAgents.tools.remove') as (x: string) => string)(tool)}
                        on:click={() => removeTool(selectedAgent, 'disallowedTools', tool)}
                      >
                        <Icon name="x" size={10}/>
                      </button>
                    </span>
                  {/each}
                </div>
              {/if}
            </div>
          </div>
        {/if}
      </div>

      <div class="ag-group">
        <div class="ag-group-title">{t('home.agents.sections.generation')}</div>

        <div class="ag-card">
          <div class="ag-card-head">
            <div class="ag-card-info">
              <span class="ag-label">{t('home.agents.customAgents.fields.overrideParams')}</span>
              <span class="ag-hint">{t('home.agents.customAgents.fields.overrideParamsHint')}</span>
            </div>
            <label class="ag-toggle" title={t('home.agents.customAgents.fields.overrideParams') as string}>
              <input
                type="checkbox"
                bind:checked={selectedAgent.overrideParams}
                on:change={touch}
              />
              <span class="ag-toggle-track"><span class="ag-toggle-thumb"></span></span>
            </label>
          </div>
        </div>

        {#if selectedAgent.overrideParams}
          <div class="ag-card">
            <div class="ag-card-head">
              <div class="ag-card-info">
                <label class="ag-label" for="a-temp">{t('home.agents.customAgents.fields.temperature')}</label>
                <span class="ag-hint">{t('home.agents.fields.temperatureHint')}</span>
              </div>
              <div class="ag-control">
                <input
                  id="a-temp"
                  class="ag-range"
                  type="range"
                  min="0" max="2" step="0.1"
                  bind:value={selectedAgent.temperature}
                  on:input={touch}
                />
                <span class="ag-value">{selectedAgent.temperature.toFixed(1)}</span>
              </div>
            </div>
          </div>

          <div class="ag-card">
            <div class="ag-card-head">
              <div class="ag-card-info">
                <label class="ag-label" for="a-maxtokens">{t('home.agents.customAgents.fields.maxTokens')}</label>
                <span class="ag-hint">{t('home.agents.fields.maxTokensHint')}</span>
              </div>
              <input
                id="a-maxtokens"
                class="ag-input ag-input-sm"
                type="number"
                min="1" max="200000" step="256"
                bind:value={selectedAgent.maxTokens}
                on:change={touch}
              />
            </div>
          </div>
        {/if}
      </div>
    {/if}
  </section>
</div>

{#if importOpen}
  <ImportAgentsModal
    existingNames={agents.map((a) => a.name)}
    on:close={() => importOpen = false}
    on:confirm={(e) => importAgents(e.detail)}
  />
{/if}

{#if exportOpen}
  <ExportAgentsModal {agents} on:close={() => exportOpen = false}/>
{/if}

<style>
  .master-actions { display: flex; align-items: center; gap: 2px; }

  .agent-row {
    display: flex;
    align-items: center;
    gap: 2px;
    border-radius: var(--r-md);
  }
  .agent-row :global(.ag-item) { min-width: 0; }
  .agent-row .icon-btn { opacity: 0; }
  .agent-row:hover .icon-btn,
  .agent-row.active .icon-btn { opacity: 1; }

  .icon-btn {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    flex-shrink: 0;
    padding: 0;
    background: none;
    border: 1px solid transparent;
    border-radius: var(--r-sm);
    color: var(--fg-3);
    cursor: pointer;
    transition: background .12s, color .12s, border-color .12s, opacity .12s;
  }
  .icon-btn:hover { background: var(--bg-3); color: var(--fg-0); border-color: var(--stroke-0); }
  .icon-btn.delete:hover { background: var(--danger-weak); color: var(--danger); border-color: transparent; }
  .icon-btn.confirm {
    opacity: 1;
    background: var(--danger-weak);
    color: var(--danger);
  }

  .master-actions .icon-btn { opacity: 1; }

  .empty-actions { display: flex; align-items: center; gap: 8px; }

  .row-card { display: flex; flex-direction: column; gap: 10px; }

  .row-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .row-provider { flex: 1; min-width: 0; }
  .row-head .icon-btn { opacity: 1; }

  .row-fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 10px;
  }

  .add-row { align-self: flex-start; margin-top: 2px; }

  .name-input {
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 6px;
  }

  .desc-input { font-size: 12px; }

  .mention-line { display: block; margin-top: 5px; }

  .inline-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .inline-row :global(.ag-input) { flex: 1; min-width: 0; }
  .inline-row .btn { flex-shrink: 0; }

  .color-picker {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .color-dot {
    position: relative;
    width: 22px;
    height: 22px;
    flex-shrink: 0;
    padding: 0;
    border: 2px solid transparent;
    border-radius: 50%;
    cursor: pointer;
    transition: transform .1s, border-color .1s;
  }
  .color-dot:hover { transform: scale(1.15); }
  .color-dot.active {
    border-color: var(--fg-0);
    transform: scale(1.1);
    box-shadow: 0 0 0 2px var(--bg-2);
  }

  .color-dot-custom {
    display: grid;
    place-items: center;
    overflow: hidden;
  }
  .color-dot-custom input[type="color"] {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    padding: 0;
    border: none;
    opacity: 0;
    cursor: pointer;
  }
  .color-custom-icon {
    font-size: 14px;
    color: oklch(1 0 0 / 0.7);
    line-height: 1;
    pointer-events: none;
  }
</style>
