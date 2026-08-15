<script lang="ts">
  /**
   * AI provider configuration: API key, model, effort and permission defaults, plus the
   * availability probe. Keys are handed to the service and never read back.
   */
  import { onMount } from 'svelte';
  import { t } from '$lib/i18n';
  import Spinner from '$lib/components/Spinner.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Select from '$lib/components/Select.svelte';
  import ProviderLogo from './ProviderLogo.svelte';
  import { PROVIDERS, contextWindowOf, type ModelOption, type ProviderDef } from './providers-data';
  import { groupModelFamilies } from '$lib/utils/agent/model-families';
  import { effortLabel, permissionModeLabel } from '$lib/utils/agent/run-options';
  import {
    aiProviders, apiKeyStatus, probeResults, probing,
    providerCapabilities, effortsOf, permissionModesOf, loadingModels, modelsError, modelsOf, refreshProviderModels,
    loadAiProviders, runProbe, setDefaultProvider, updateProviderSettings,
  } from '$lib/stores/ai-providers';
  import { deleteProviderApiKey, setProviderApiKey } from '$lib/services/ai-provider-service';

  let selectedId: string = PROVIDERS[0].id;
  let search = '';
  let keyDraft = '';
  let editingKey = false;
  let savingKey = false;
  let ready = false;

  onMount(async () => {
    await loadAiProviders();
    ready = true;
    for (const p of PROVIDERS) {
      if (p.status !== 'coming-soon') void runProbe(p.id);
    }
  });

  $: query = search.trim().toLowerCase();
  $: visibleProviders = query
    ? PROVIDERS.filter((p) =>
        `${p.name} ${p.desc} ${p.id} ${p.kind}`.toLowerCase().includes(query))
    : PROVIDERS;

  $: selected = PROVIDERS.find((p) => p.id === selectedId)!;
  $: config = $aiProviders.providers[selectedId];
  $: keyState = $apiKeyStatus[selectedId];
  $: probe = $probeResults[selectedId];
  $: isProbing = $probing[selectedId] ?? false;
  const askedModels = new Set<string>();
  $: if (ready && selected.status !== 'coming-soon' && !askedModels.has(selectedId)) {
    askedModels.add(selectedId);
    void refreshProviderModels(selectedId);
  }
  $: isLoadingModels = $loadingModels[selectedId] ?? false;
  $: modelsFailure = $modelsError[selectedId] ?? '';
  $: isDiscovered = ($providerCapabilities[selectedId]?.models ?? []).length > 0;
  $: effortOptions = [
    { value: '', label: t('home.agents.fields.modelDefault') as string },
    ...effortsOf(selectedId, $providerCapabilities, config?.effort ?? '')
      .map((level) => ({ value: level, label: effortLabel(level) })),
  ];
  $: permissionOptions = [
    { value: '', label: t('home.agents.fields.modelDefault') as string },
    ...permissionModesOf(selectedId, $providerCapabilities, config?.permissionMode ?? '')
      .map((mode) => ({ value: mode, label: permissionModeLabel(mode) })),
  ];
  $: modelOptions = modelsOf(selectedId, $providerCapabilities) as ModelOption[];
  $: modelFamilies = groupModelFamilies(modelOptions);
  $: selectedContext = config?.model ? contextWindowOf(selectedId, config.model) : undefined;
  $: isDefault = $aiProviders.defaultProviderId === selectedId;

  let customDraft = '';
  $: customModels = config?.customModels ?? [];
  $: canAddCustom = customDraft.trim().length > 0 && !customModels.includes(customDraft.trim());

  /**
   * Families first, then the hand-pinned names. A model saved earlier but no
   * longer reported keeps an entry of its own so the picker never shows blank.
   */
  $: modelSelectOptions = (() => {
    const options = selected?.kind === 'cli'
      ? [{ value: '', label: t('home.agents.fields.modelDefault') as string }]
      : [];
    for (const family of modelFamilies) options.push({ value: family.models[0].id, label: family.label });
    for (const id of customModels) options.push({ value: id, label: id });
    const current = config?.model ?? '';
    if (current && !options.some((o) => o.value === current)) options.push({ value: current, label: current });
    return options;
  })();

  function addCustomModel() {
    const id = customDraft.trim();
    if (!id || customModels.includes(id)) return;
    set({ customModels: [...customModels, id] });
    customDraft = '';
  }

  /** Removing the model in use falls the provider back to its default. */
  function removeCustomModel(id: string) {
    const fields: Record<string, unknown> = {
      customModels: customModels.filter((m) => m !== id),
    };
    if (config?.model === id) fields.model = '';
    set(fields);
  }

  /** Context window in k or M, the way the providers themselves quote it. */
  function formatContext(n: number): string {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${Math.round(n / 1000)}k`;
    return String(n);
  }

  function set(fields: Record<string, unknown>) {
    updateProviderSettings(selectedId, fields);
  }

  /** The probe result outranks the declared status: a provider that failed reads unavailable. */
  function statusLabel(p: ProviderDef): string {
    if (p.status === 'coming-soon') return t('home.agents.comingSoon') as string;
    const result = $probeResults[p.id];
    if (result && !result.available) return t('home.agents.probe.unavailable') as string;
    if (p.status === 'active') return t('home.agents.active') as string;
    return $aiProviders.providers[p.id]?.enabled
      ? (t('home.agents.enabled') as string)
      : (t('home.agents.disabled') as string);
  }

  function statusTone(p: ProviderDef): string {
    if (p.status === 'coming-soon') return '';
    const result = $probeResults[p.id];
    if (result && !result.available) return 'ko';
    if (p.status === 'active') return 'ok';
    return $aiProviders.providers[p.id]?.enabled ? 'ok' : '';
  }

  /** Stores the key through the service and reprobes; the key itself is never held here. */
  async function saveKey() {
    if (!keyDraft.trim()) return;
    savingKey = true;
    try {
      const status = await setProviderApiKey(selectedId, keyDraft.trim());
      apiKeyStatus.update((m) => ({ ...m, [selectedId]: status }));
      keyDraft = '';
      editingKey = false;
      void runProbe(selectedId);
    } finally {
      savingKey = false;
    }
  }

  async function removeKey() {
    await deleteProviderApiKey(selectedId);
    apiKeyStatus.update((m) => ({ ...m, [selectedId]: { set: false } }));
    void runProbe(selectedId);
  }

  function selectProvider(id: string) {
    selectedId = id;
    keyDraft = '';
    customDraft = '';
    editingKey = false;
  }
</script>

<div class="ag-layout">
  <aside class="ag-master">
    <div class="ag-master-header">
      <span class="ag-master-title">{t('home.agents.providerList')}</span>
    </div>

    <div class="ag-search">
      <Icon name="search" size={12}/>
      <input
        bind:value={search}
        placeholder={t('home.agents.searchProviders') as string}
        aria-label={t('home.agents.searchProviders') as string}
        spellcheck="false"
      />
      {#if search}
        <button class="ag-search-clear" on:click={() => search = ''} aria-label={t('home.agents.clearSearch') as string}>
          <Icon name="x" size={11}/>
        </button>
      {/if}
    </div>

    {#if visibleProviders.length === 0}
      <p class="ag-master-empty">{t('home.agents.searchNoResults')}</p>
    {/if}

    {#each visibleProviders as p}
      <button
        class="ag-item {selectedId === p.id ? 'active' : ''}"
        style="--tile: {p.accentColor}"
        on:click={() => selectProvider(p.id)}
        disabled={p.status === 'coming-soon'}
      >
        <span class="ag-tile"><ProviderLogo id={p.id} size={16} fallback={p.logo}/></span>
        <span class="ag-item-info">
          <span class="ag-item-name">
            <span class="truncate">{p.name}</span>
            {#if $aiProviders.defaultProviderId === p.id}
              <Icon name="pin" size={10}/>
            {/if}
          </span>
          <span class="ag-item-sub">
            {#if $probing[p.id]}
              <Spinner size={10}/>
            {:else}
              <span class="ag-dot {statusTone(p)}"></span>
              {statusLabel(p)}
            {/if}
          </span>
        </span>
      </button>
    {/each}
  </aside>

  <section class="ag-detail">
    {#if selected && config && ready}
      <div class="ag-head" style="--tile: {selected.accentColor}">
        <span class="ag-tile ag-tile-lg">
          <ProviderLogo id={selected.id} size={24} fallback={selected.logo}/>
        </span>
        <div class="ag-head-text">
          <h2 class="ag-head-title">
            {selected.name}
            {#if selected.kind === 'api'}
              <span class="ag-badge">{t('home.agents.probe.chatOnly')}</span>
            {/if}
            {#if isDefault}
              <span class="ag-badge accent">{t('home.agents.probe.defaultProvider')}</span>
            {/if}
          </h2>
          <p class="ag-head-desc">{selected.desc}</p>
        </div>
        {#if selected.status === 'active'}
          <span class="ag-badge accent">{t('home.agents.active')}</span>
        {:else}
          <label class="ag-toggle" title={t('home.agents.enabled') as string}>
            <input
              type="checkbox"
              checked={config.enabled}
              on:change={(e) => set({ enabled: (e.currentTarget as HTMLInputElement).checked })}
            />
            <span class="ag-toggle-track"><span class="ag-toggle-thumb"></span></span>
          </label>
        {/if}
      </div>

      <div class="probe-bar">
        <span class="probe-status">
          {#if isProbing}
            <Spinner size={11}/>
          {:else if probe}
            <span class="ag-dot {probe.available ? 'ok' : 'ko'}"></span>
            <span class="probe-text {probe.available ? '' : 'bad'}">
              {#if probe.available}
                {t('home.agents.probe.available')}{probe.version ? ` - ${probe.version}` : ''}
              {:else}
                {probe.detail || t('home.agents.probe.unavailable')}
              {/if}
            </span>
          {/if}
        </span>
        <button class="btn ghost" on:click={() => runProbe(selectedId)} disabled={isProbing}>
          <Icon name="zap" size={12}/> {t('home.agents.probe.test')}
        </button>
        {#if !isDefault}
          <button class="btn ghost" on:click={() => setDefaultProvider(selectedId)}>
            <Icon name="pin" size={12}/> {t('home.agents.probe.makeDefault')}
          </button>
        {/if}
      </div>

      {#if selected.note}
        <div class="ag-note">
          <Icon name="info" size={14}/>
          <span>{selected.note}</span>
        </div>
      {/if}

      {#if selected.hasApiKey || selected.hasBaseUrl || selected.kind === 'cli'}
        <div class="ag-group">
          <div class="ag-group-title">{t('home.agents.sections.connection')}</div>

          {#if selected.hasApiKey}
            <div class="ag-card">
              <div class="ag-field">
                <div class="ag-card-head">
                  <div class="ag-card-info">
                    <span class="ag-label">{t('home.agents.fields.apiKey')}</span>
                    <span class="ag-hint">{t('home.agents.fields.apiKeyHint')}</span>
                  </div>
                  {#if keyState?.set && !editingKey}
                    <div class="ag-control">
                      <span class="key-set">
                        <Icon name="check" size={11}/> {t('home.agents.probe.keySet')}
                      </span>
                      <button class="btn ghost" on:click={() => { editingKey = true; }}>
                        {t('home.agents.probe.replaceKey')}
                      </button>
                      <button class="btn ghost danger" on:click={removeKey}>
                        {t('home.agents.probe.removeKey')}
                      </button>
                    </div>
                  {/if}
                </div>

                {#if !keyState?.set || editingKey}
                  <div class="inline-row">
                    <input class="ag-input" type="password"
                      placeholder={t('home.agents.fields.apiKeyPlaceholder') as string}
                      bind:value={keyDraft} autocomplete="off" spellcheck="false"
                      on:keydown={(e) => { if (e.key === 'Enter') void saveKey(); }}/>
                    <button class="btn primary" on:click={saveKey} disabled={!keyDraft.trim() || savingKey}>
                      {#if savingKey}<Spinner size={11}/>{:else}{t('home.agents.probe.saveKey')}{/if}
                    </button>
                    {#if keyState?.set}
                      <button class="btn ghost" on:click={() => { editingKey = false; keyDraft = ''; }}>
                        {t('common.cancel')}
                      </button>
                    {/if}
                  </div>
                {/if}
              </div>
            </div>
          {/if}

          {#if selected.hasBaseUrl}
            <div class="ag-card">
              <div class="ag-field">
                <div class="ag-card-info">
                  <label class="ag-label" for="p-baseurl">{t('home.agents.fields.baseUrl')}</label>
                  <span class="ag-hint">{t('home.agents.fields.baseUrlHint')}</span>
                </div>
                <input id="p-baseurl" class="ag-input" type="text"
                  placeholder={selected.defaultBaseUrl ?? (t('home.agents.fields.baseUrlPlaceholder') as string)}
                  value={config.baseUrl}
                  on:input={(e) => set({ baseUrl: (e.currentTarget as HTMLInputElement).value })}
                  autocomplete="off" spellcheck="false"/>
              </div>
            </div>
          {/if}

          {#if selected.kind === 'cli'}
            <div class="ag-card">
              <div class="ag-field">
                <div class="ag-card-info">
                  <label class="ag-label" for="p-binary">{t('home.agents.fields.binaryPath')}</label>
                  <span class="ag-hint">{t('home.agents.fields.binaryPathHint')}</span>
                </div>
                <input id="p-binary" class="ag-input" type="text"
                  placeholder={t('home.agents.fields.binaryPathPlaceholder') as string}
                  value={config.binaryPath}
                  on:input={(e) => set({ binaryPath: (e.currentTarget as HTMLInputElement).value })}
                  autocomplete="off" spellcheck="false"/>
              </div>
            </div>
          {/if}
        </div>
      {/if}

      {#if modelOptions.length > 0}
        <div class="ag-group">
          <div class="ag-group-title">{t('home.agents.sections.model')}</div>

          <div class="ag-card">
            <div class="ag-field">
              <div class="ag-card-head">
                <div class="ag-card-info">
                  <span class="ag-label" id="p-model-label">{t('home.agents.fields.model')}</span>
                  <span class="ag-hint {modelsFailure ? 'warn' : ''}">
                    {#if modelsFailure}
                      {t('home.agents.fields.modelsFailed')}
                    {:else if isDiscovered}
                      {t('home.agents.fields.modelsLive')}
                    {:else}
                      {t('home.agents.fields.modelsFallback')}
                    {/if}
                  </span>
                </div>
                <div class="ag-control">
                  {#if selectedContext}
                    <span class="ag-value">{formatContext(selectedContext)} tokens</span>
                  {/if}
                  <button class="btn ghost" on:click={() => refreshProviderModels(selectedId)} disabled={isLoadingModels}
                    title={t('home.agents.fields.refreshModels') as string}>
                    {#if isLoadingModels}<Spinner size={11}/>{:else}<Icon name="refresh" size={12}/>{/if}
                  </button>
                </div>
              </div>
              <Select
                value={config.model}
                options={modelSelectOptions}
                ariaLabel={t('home.agents.fields.model') as string}
                on:change={(e) => set({ model: e.detail })}
              />
            </div>
          </div>

          <div class="ag-card">
            <div class="ag-field">
              <div class="ag-card-info">
                <label class="ag-label" for="p-custom">{t('home.agents.fields.customModels')}</label>
                <span class="ag-hint">{t('home.agents.fields.customModelsHint')}</span>
              </div>
              <div class="inline-row">
                <input
                  id="p-custom"
                  class="ag-input"
                  type="text"
                  placeholder={t('home.agents.fields.customModelPlaceholder') as string}
                  bind:value={customDraft}
                  on:keydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomModel(); } }}
                  autocomplete="off"
                  spellcheck="false"
                />
                <button class="btn" on:click={addCustomModel} disabled={!canAddCustom}>
                  <Icon name="plus" size={12}/> {t('home.agents.fields.addCustomModel')}
                </button>
              </div>
              {#if customModels.length > 0}
                <div class="ag-chips">
                  {#each customModels as id}
                    <span class="ag-chip">
                      <span class="selectable">{id}</span>
                      <button
                        class="ag-chip-remove"
                        aria-label={(t('home.agents.fields.removeCustomModel') as (m: string) => string)(id)}
                        on:click={() => removeCustomModel(id)}
                      >
                        <Icon name="x" size={10}/>
                      </button>
                    </span>
                  {/each}
                </div>
              {/if}
            </div>
          </div>
        </div>
      {/if}

      {#if selected.supportsEffort || selected.supportsPermissionMode}
        <div class="ag-group">
          <div class="ag-group-title">{t('home.agents.sections.generation')}</div>

          {#if selected.supportsEffort}
            <div class="ag-card">
              <div class="ag-card-head">
                <div class="ag-card-info">
                  <span class="ag-label">{t('home.agents.fields.effort')}</span>
                  <span class="ag-hint">{t('home.agents.fields.effortHint')}</span>
                </div>
                <div class="ag-control select-control">
                  <Select
                    value={config.effort}
                    options={effortOptions}
                    ariaLabel={t('home.agents.fields.effort') as string}
                    on:change={(e) => set({ effort: e.detail })}
                  />
                </div>
              </div>
            </div>
          {/if}

          {#if selected.supportsPermissionMode}
            <div class="ag-card">
              <div class="ag-card-head">
                <div class="ag-card-info">
                  <span class="ag-label">{t('home.agents.fields.permissionMode')}</span>
                  {#if config.permissionMode === 'bypassPermissions'}
                    <span class="ag-hint warn">{t('home.agents.fields.bypassWarning')}</span>
                  {:else}
                    <span class="ag-hint">{t('home.agents.fields.permissionModeHint')}</span>
                  {/if}
                </div>
                <div class="ag-control select-control">
                  <Select
                    value={config.permissionMode}
                    options={permissionOptions}
                    ariaLabel={t('home.agents.fields.permissionMode') as string}
                    on:change={(e) => set({ permissionMode: e.detail })}
                  />
                </div>
              </div>
            </div>
          {/if}
        </div>
      {/if}

      {#if selected.kind === 'api'}
        <div class="ag-group">
          <div class="ag-group-title">{t('home.agents.sections.generation')}</div>

          <div class="ag-card">
            <div class="ag-card-head">
              <div class="ag-card-info">
                <label class="ag-label" for="p-temp">{t('home.agents.fields.temperature')}</label>
                <span class="ag-hint">{t('home.agents.fields.temperatureHint')}</span>
              </div>
              <div class="ag-control">
                <input id="p-temp" class="ag-range" type="range" min="0" max="2" step="0.1"
                  value={config.temperature}
                  on:input={(e) => set({ temperature: Number((e.currentTarget as HTMLInputElement).value) })}/>
                <span class="ag-value">{config.temperature.toFixed(1)}</span>
              </div>
            </div>
          </div>

          <div class="ag-card">
            <div class="ag-card-head">
              <div class="ag-card-info">
                <label class="ag-label" for="p-maxtokens">{t('home.agents.fields.maxTokens')}</label>
                <span class="ag-hint">{t('home.agents.fields.maxTokensHint')}</span>
              </div>
              <input id="p-maxtokens" class="ag-input ag-input-sm" type="number" min="1" max="200000" step="256"
                value={config.maxTokens}
                on:change={(e) => set({ maxTokens: Number((e.currentTarget as HTMLInputElement).value) })}/>
            </div>
          </div>

          <div class="ag-card">
            <div class="ag-card-head">
              <div class="ag-card-info">
                <label class="ag-label" for="p-timeout">{t('home.agents.fields.timeout')}</label>
                <span class="ag-hint">{t('home.agents.fields.timeoutHint')}</span>
              </div>
              <input id="p-timeout" class="ag-input ag-input-sm" type="number" min="5" max="600" step="5"
                value={config.timeout}
                on:change={(e) => set({ timeout: Number((e.currentTarget as HTMLInputElement).value) })}/>
            </div>
          </div>

          <div class="ag-card">
            <div class="ag-card-head">
              <div class="ag-card-info">
                <span class="ag-label">{t('home.agents.fields.streaming')}</span>
                <span class="ag-hint">{t('home.agents.fields.streamingHint')}</span>
              </div>
              <label class="ag-toggle" title={t('home.agents.fields.streaming') as string}>
                <input
                  type="checkbox"
                  checked={config.streaming}
                  on:change={(e) => set({ streaming: (e.currentTarget as HTMLInputElement).checked })}
                />
                <span class="ag-toggle-track"><span class="ag-toggle-thumb"></span></span>
              </label>
            </div>
          </div>
        </div>
      {/if}
    {:else}
      <div class="ag-empty"><Spinner size={16}/></div>
    {/if}
  </section>
</div>

<style>
  .truncate { overflow: hidden; text-overflow: ellipsis; }

  .probe-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: 620px;
    margin-top: 10px;
  }

  .probe-status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    min-width: 0;
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--fg-2);
  }

  .probe-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .probe-text.bad { color: var(--danger); }

  .ag-note {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    max-width: 620px;
    margin-top: 12px;
    padding: 10px 14px;
    background: var(--bg-2);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-md);
    font-size: 12px;
    color: var(--fg-2);
    line-height: 1.5;
  }
  .ag-note :global(svg) { flex-shrink: 0; margin-top: 1px; color: var(--fg-3); }

  .inline-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .inline-row :global(.ag-input) { flex: 1; min-width: 0; }
  .inline-row .btn { flex-shrink: 0; }

  .select-control { width: 190px; }
  .select-control :global(.select) { width: 100%; }

  .key-set {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 9px;
    border-radius: var(--r-sm);
    background: var(--success-weak);
    border: 1px solid color-mix(in srgb, var(--success) 30%, transparent);
    color: var(--success);
    font-size: 11.5px;
    white-space: nowrap;
  }
</style>
