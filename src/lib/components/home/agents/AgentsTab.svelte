<script lang="ts">
  import { t } from '$lib/i18n';
  import { PROVIDERS, type ProviderDef, type ModelOption } from './providers-data';
  import { ACCENT_PRESETS } from '$lib/utils/home/appearance';

  interface CustomAgent {
    id: string;
    name: string;
    description: string;
    color: string;
    providerId: string;
    model: string;
    systemPrompt: string;
    overrideParams: boolean;
    temperature: number;
    maxTokens: number;
  }


  const SELECTABLE_PROVIDERS = PROVIDERS.filter((p) => p.status !== 'coming-soon');

  function makeId(): string {
    return Math.random().toString(36).slice(2, 9);
  }

  function newAgent(): CustomAgent {
    const firstProvider = SELECTABLE_PROVIDERS[0];
    return {
      id: makeId(),
      name: '',
      description: '',
      color: ACCENT_PRESETS[0].color,
      providerId: firstProvider?.id ?? '',
      model: firstProvider?.models[0]?.id ?? '',
      systemPrompt: '',
      overrideParams: false,
      temperature: 1.0,
      maxTokens: 8192,
    };
  }

  let agents: CustomAgent[] = [];
  let selectedAgentId: string | null = null;
  let confirmDeleteId: string | null = null;

  $: selectedAgent = agents.find((a) => a.id === selectedAgentId) ?? null;
  $: selectedProviderDef = selectedAgent
    ? SELECTABLE_PROVIDERS.find((p) => p.id === selectedAgent!.providerId)
    : null;
  $: availableModels = selectedProviderDef?.models ?? [];
  $: colorIsPreset = selectedAgent ? ACCENT_PRESETS.some((p) => p.color === selectedAgent!.color) : true;

  function createAgent() {
    const agent = newAgent();
    agents = [...agents, agent];
    selectedAgentId = agent.id;
    confirmDeleteId = null;
  }

  function deleteAgent(id: string) {
    agents = agents.filter((a) => a.id !== id);
    if (selectedAgentId === id) {
      selectedAgentId = agents[0]?.id ?? null;
    }
    confirmDeleteId = null;
  }

  function onProviderChange(agent: CustomAgent) {
    const provider = SELECTABLE_PROVIDERS.find((p) => p.id === agent.providerId);
    agent.model = provider?.models[0]?.id ?? '';
    agents = agents;
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
    const provider = SELECTABLE_PROVIDERS.find((p) => p.id === providerId);
    return provider?.models.find((m) => m.id === modelId)?.label ?? modelId;
  }
</script>

<div class="agents-tab-layout">
  <!-- Left: agent list -->
  <aside class="agents-sidebar">
    <div class="sidebar-header">
      <span class="sidebar-title">{t('home.agents.customAgents.newAgent')}</span>
      <button class="btn-new" on:click={createAgent} title={t('home.agents.customAgents.newAgent') as string}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14"/>
        </svg>
      </button>
    </div>

    {#if agents.length === 0}
      <div class="agents-empty-list">
        <span>{t('home.agents.customAgents.emptyTitle')}</span>
      </div>
    {:else}
      {#each agents as agent (agent.id)}
        <!-- svelte-ignore a11y_interactive_supports_focus a11y_click_events_have_key_events -->
        <div
          class="agent-item {selectedAgentId === agent.id ? 'active' : ''}"
          role="option"
          aria-selected={selectedAgentId === agent.id}
          on:click={() => { selectedAgentId = agent.id; confirmDeleteId = null; }}
          on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectedAgentId = agent.id; confirmDeleteId = null; }}}
          tabindex="0"
        >
          <span class="agent-avatar" style="--color: {agent.color}">
            {agentInitials(agent.name || t('home.agents.customAgents.untitled') as string)}
          </span>
          <span class="agent-item-info">
            <span class="agent-item-name">
              {agent.name || t('home.agents.customAgents.untitled')}
            </span>
            <span class="agent-item-sub">
              {providerLabel(agent.providerId)}{agent.model ? ` · ${modelLabel(agent.providerId, agent.model)}` : ''}
            </span>
          </span>
          {#if confirmDeleteId === agent.id}
            <button
              class="btn-delete-confirm"
              on:click|stopPropagation={() => deleteAgent(agent.id)}
              title={t('home.agents.customAgents.deleteConfirm') as string}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M4 12l5 5L20 6"/>
              </svg>
            </button>
            <button
              class="btn-delete-cancel"
              aria-label="Cancel"
              on:click|stopPropagation={() => confirmDeleteId = null}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          {:else}
            <button
              class="btn-delete"
              on:click|stopPropagation={() => confirmDeleteId = agent.id}
              title={t('home.agents.customAgents.deleteConfirm') as string}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>
              </svg>
            </button>
          {/if}
        </div>
      {/each}
    {/if}
  </aside>

  <!-- Right: form or empty state -->
  <section class="agent-detail">
    {#if selectedAgent === null}
      <div class="detail-empty">
        <div class="detail-empty-icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 4l1.8 4.2L18 10l-4.2 1.8L12 16l-1.8-4.2L6 10l4.2-1.8L12 4z"/>
            <path d="M18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9L18 15z"/>
          </svg>
        </div>
        <p class="detail-empty-title">{t('home.agents.customAgents.emptyTitle')}</p>
        <p class="detail-empty-desc">{t('home.agents.customAgents.emptyDesc')}</p>
        <button class="btn-create-first" on:click={createAgent}>
          {t('home.agents.customAgents.createFirst')}
        </button>
      </div>
    {:else}
      <div class="agent-form">
        <!-- Header row: avatar + name + color -->
        <div class="form-header">
          <span class="agent-avatar agent-avatar-lg" style="--color: {selectedAgent.color}">
            {agentInitials(selectedAgent.name || t('home.agents.customAgents.untitled') as string)}
          </span>
          <div class="form-header-inputs">
            <input
              class="field-input field-name"
              type="text"
              placeholder={t('home.agents.customAgents.fields.namePlaceholder') as string}
              bind:value={selectedAgent.name}
              on:input={() => agents = agents}
            />
            <div class="color-picker">
              {#each ACCENT_PRESETS as preset}
                <button
                  class="color-dot {selectedAgent.color === preset.color && colorIsPreset ? 'active' : ''}"
                  title={preset.label}
                  style="background: {preset.color}"
                  on:click={() => { selectedAgent!.color = preset.color; agents = agents; }}
                ></button>
              {/each}
              <label
                class="color-dot color-dot-custom {!colorIsPreset ? 'active' : ''}"
                title="Custom color"
                style="background: {selectedAgent.color}"
              >
                <input
                  type="color"
                  value={selectedAgent.color}
                  on:input={(e) => { selectedAgent!.color = (e.target as HTMLInputElement).value; agents = agents; }}
                />
                {#if colorIsPreset}
                  <span class="color-custom-icon">+</span>
                {/if}
              </label>
            </div>
          </div>
        </div>

        <!-- Description -->
        <div class="field-group">
          <label class="field-label" for="a-desc">{t('home.agents.customAgents.fields.description')}</label>
          <input
            id="a-desc"
            class="field-input"
            type="text"
            placeholder={t('home.agents.customAgents.fields.descriptionPlaceholder') as string}
            bind:value={selectedAgent.description}
            on:input={() => agents = agents}
          />
        </div>

        <!-- Provider + Model row -->
        <div class="field-row">
          <div class="field-group">
            <label class="field-label" for="a-provider">{t('home.agents.customAgents.fields.provider')}</label>
            <select
              id="a-provider"
              class="field-select"
              bind:value={selectedAgent.providerId}
              on:change={() => onProviderChange(selectedAgent!)}
            >
              {#each SELECTABLE_PROVIDERS as p}
                <option value={p.id}>{p.name}</option>
              {/each}
            </select>
          </div>
          <div class="field-group">
            <label class="field-label" for="a-model">{t('home.agents.customAgents.fields.model')}</label>
            {#if availableModels.length > 0}
              <select
                id="a-model"
                class="field-select"
                bind:value={selectedAgent.model}
                on:change={() => agents = agents}
              >
                {#each availableModels as m}
                  <option value={m.id}>{m.label}</option>
                {/each}
              </select>
            {:else}
              <input
                id="a-model"
                class="field-input"
                type="text"
                placeholder="model-name"
                bind:value={selectedAgent.model}
                on:input={() => agents = agents}
              />
            {/if}
          </div>
        </div>

        <!-- System prompt -->
        <div class="field-group">
          <label class="field-label" for="a-prompt">{t('home.agents.customAgents.fields.systemPrompt')}</label>
          <textarea
            id="a-prompt"
            class="field-textarea"
            placeholder={t('home.agents.customAgents.fields.systemPromptPlaceholder') as string}
            bind:value={selectedAgent.systemPrompt}
            on:input={() => agents = agents}
            rows="8"
            spellcheck="false"
          ></textarea>
          <span class="field-hint">{t('home.agents.customAgents.fields.systemPromptHint')}</span>
        </div>

        <!-- Override params toggle -->
        <div class="field-group">
          <div class="override-header">
            <span class="field-label">{t('home.agents.customAgents.fields.overrideParams')}</span>
            <span
              role="switch"
              aria-checked={selectedAgent.overrideParams}
              aria-label={t('home.agents.customAgents.fields.overrideParams') as string}
              class="toggle {selectedAgent.overrideParams ? 'on' : ''}"
              tabindex="0"
              on:click={() => { selectedAgent!.overrideParams = !selectedAgent!.overrideParams; agents = agents; }}
              on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectedAgent!.overrideParams = !selectedAgent!.overrideParams; agents = agents; }}}
            ></span>
          </div>
          <span class="field-hint">{t('home.agents.customAgents.fields.overrideParamsHint')}</span>

          {#if selectedAgent.overrideParams}
            <div class="field-row" style="margin-top: 10px">
              <div class="field-group">
                <label class="field-label" for="a-temp">
                  {t('home.agents.customAgents.fields.temperature')}
                  <span class="field-value-badge">{selectedAgent.temperature.toFixed(1)}</span>
                </label>
                <input
                  id="a-temp"
                  class="field-range"
                  type="range"
                  min="0" max="2" step="0.1"
                  bind:value={selectedAgent.temperature}
                  on:input={() => agents = agents}
                />
              </div>
              <div class="field-group">
                <label class="field-label" for="a-maxtokens">{t('home.agents.customAgents.fields.maxTokens')}</label>
                <input
                  id="a-maxtokens"
                  class="field-input"
                  type="number"
                  min="1" max="200000" step="256"
                  bind:value={selectedAgent.maxTokens}
                  on:change={() => agents = agents}
                />
              </div>
            </div>
          {/if}
        </div>
      </div>
    {/if}
  </section>
</div>

<style>
  .agents-tab-layout {
    display: flex;
    gap: 0;
    width: 100%;
    align-items: flex-start;
  }

  /* -- Sidebar -- */
  .agents-sidebar {
    width: 210px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding-right: 16px;
    border-right: 1px solid var(--stroke-0);
  }

  .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 4px 8px;
  }

  .sidebar-title {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: .06em;
    color: var(--fg-3);
  }

  .btn-new {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: var(--r-sm);
    background: none;
    border: 1px solid var(--stroke-1);
    color: var(--fg-2);
    cursor: pointer;
    padding: 0;
    transition: background .12s, color .12s;
  }
  .btn-new:hover { background: var(--bg-4); color: var(--fg-0); }

  .agents-empty-list {
    padding: 12px 4px;
    font-size: 11.5px;
    color: var(--fg-3);
    font-style: italic;
  }

  .agent-item {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 6px 6px;
    border-radius: var(--r-sm);
    background: none;
    border: none;
    cursor: pointer;
    width: 100%;
    text-align: left;
    font-family: var(--font-ui);
    position: relative;
  }
  .agent-item:hover { background: var(--bg-4); }
  .agent-item.active { background: var(--accent-weak); }
  .agent-item:hover .btn-delete { opacity: 1; }

  .agent-avatar {
    width: 28px;
    height: 28px;
    border-radius: var(--r-sm);
    background: color-mix(in srgb, var(--color) 22%, transparent);
    border: 1px solid color-mix(in srgb, var(--color) 35%, transparent);
    color: var(--color);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 700;
    font-family: var(--font-mono);
    flex-shrink: 0;
    letter-spacing: -.02em;
  }

  .agent-avatar-lg {
    width: 44px;
    height: 44px;
    font-size: 14px;
    border-radius: var(--r-md);
    flex-shrink: 0;
  }

  .agent-item-info {
    display: flex;
    flex-direction: column;
    gap: 1px;
    flex: 1;
    min-width: 0;
  }

  .agent-item-name {
    font-size: 12.5px;
    font-weight: 500;
    color: var(--fg-0);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .agent-item-sub {
    font-size: 10.5px;
    color: var(--fg-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .btn-delete {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: var(--r-sm);
    background: none;
    border: none;
    color: var(--fg-3);
    cursor: pointer;
    padding: 0;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity .12s, background .12s, color .12s;
  }
  .btn-delete:hover { background: color-mix(in srgb, #ef4444 15%, transparent); color: #ef4444; }

  .btn-delete-confirm {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: var(--r-sm);
    background: color-mix(in srgb, #ef4444 15%, transparent);
    border: none;
    color: #ef4444;
    cursor: pointer;
    padding: 0;
    flex-shrink: 0;
  }
  .btn-delete-confirm:hover { background: color-mix(in srgb, #ef4444 25%, transparent); }

  .btn-delete-cancel {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: var(--r-sm);
    background: none;
    border: none;
    color: var(--fg-3);
    cursor: pointer;
    padding: 0;
    flex-shrink: 0;
  }
  .btn-delete-cancel:hover { background: var(--bg-4); color: var(--fg-1); }

  /* -- Detail / Empty state -- */
  .agent-detail {
    flex: 1;
    padding: 0 0 24px 28px;
  }

  .detail-empty {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    padding-top: 8px;
    max-width: 400px;
  }

  .detail-empty-icon {
    color: var(--fg-3);
    margin-bottom: 4px;
  }

  .detail-empty-title {
    font-size: 15px;
    font-weight: 600;
    color: var(--fg-0);
    margin: 0;
  }

  .detail-empty-desc {
    font-size: 12.5px;
    color: var(--fg-3);
    margin: 0;
    line-height: 1.6;
  }

  .btn-create-first {
    margin-top: 8px;
    padding: 7px 14px;
    border-radius: var(--r-sm);
    background: var(--accent-weak);
    border: 1px solid var(--accent-line);
    color: var(--accent);
    font-size: 12.5px;
    font-weight: 500;
    font-family: var(--font-ui);
    cursor: pointer;
    transition: background .12s;
  }
  .btn-create-first:hover { background: color-mix(in srgb, var(--accent) 20%, transparent); }

  /* -- Agent form -- */
  .agent-form {
    display: flex;
    flex-direction: column;
    gap: 20px;
    max-width: 560px;
  }

  .form-header {
    display: flex;
    align-items: center;
    gap: 14px;
    padding-bottom: 20px;
    border-bottom: 1px solid var(--stroke-0);
  }

  .form-header-inputs {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .field-name {
    font-size: 15px !important;
    font-weight: 600;
    height: 36px !important;
  }

  .color-picker {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .color-dot {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    padding: 0;
    flex-shrink: 0;
    position: relative;
    transition: transform .1s, border-color .1s;
  }
  .color-dot:hover { transform: scale(1.15); }
  .color-dot.active {
    border-color: var(--fg-0);
    transform: scale(1.1);
    box-shadow: 0 0 0 2px var(--bg-2);
  }

  .color-dot-custom {
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  .color-dot-custom input[type="color"] {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
    width: 100%;
    height: 100%;
    border: none;
    padding: 0;
  }
  .color-custom-icon {
    font-size: 14px;
    color: oklch(1 0 0 / 0.7);
    line-height: 1;
    pointer-events: none;
  }

  .field-group { display: flex; flex-direction: column; gap: 6px; }

  .field-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }

  .field-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--fg-1);
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .field-value-badge {
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 4px;
    background: var(--bg-4);
    color: var(--fg-2);
    font-weight: 400;
  }

  .field-input {
    height: 32px;
    padding: 0 10px;
    border-radius: var(--r-sm);
    border: 1px solid var(--stroke-1);
    background: var(--bg-1);
    color: var(--fg-0);
    font-size: 12.5px;
    font-family: var(--font-ui);
    width: 100%;
    box-sizing: border-box;
    outline: none;
    transition: border-color .15s;
  }
  .field-input:focus { border-color: var(--accent); }

  .field-select {
    height: 32px;
    padding: 0 10px;
    border-radius: var(--r-sm);
    border: 1px solid var(--stroke-1);
    background: var(--bg-1);
    color: var(--fg-0);
    font-size: 12.5px;
    font-family: var(--font-ui);
    width: 100%;
    outline: none;
    cursor: pointer;
    transition: border-color .15s;
  }
  .field-select:focus { border-color: var(--accent); }

  .field-textarea {
    padding: 10px;
    border-radius: var(--r-sm);
    border: 1px solid var(--stroke-1);
    background: var(--bg-1);
    color: var(--fg-0);
    font-size: 12.5px;
    font-family: var(--font-mono);
    width: 100%;
    box-sizing: border-box;
    outline: none;
    resize: vertical;
    line-height: 1.6;
    transition: border-color .15s;
  }
  .field-textarea:focus { border-color: var(--accent); }

  .field-range { width: 100%; accent-color: var(--accent); cursor: pointer; }

  .field-hint { font-size: 11px; color: var(--fg-3); line-height: 1.4; }

  .override-header {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .toggle {
    display: inline-flex;
    width: 32px;
    height: 18px;
    border-radius: 99px;
    background: var(--bg-4);
    border: 1px solid var(--stroke-1);
    position: relative;
    cursor: pointer;
    flex-shrink: 0;
    transition: background .15s, border-color .15s;
  }
  .toggle::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--fg-3);
    transition: transform .15s, background .15s;
  }
  .toggle.on { background: var(--accent); border-color: var(--accent); }
  .toggle.on::after { transform: translateX(14px); background: #fff; }
  .toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
