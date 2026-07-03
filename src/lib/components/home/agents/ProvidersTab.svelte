<script lang="ts">
  import { t } from '$lib/i18n';
  import { PROVIDERS, defaultConfig, type ProviderDef, type ProviderConfig } from './providers-data';

  let configs: Record<string, ProviderConfig> = Object.fromEntries(
    PROVIDERS.map((p) => [p.id, defaultConfig(p)])
  );

  let selectedId: string = PROVIDERS[0].id;

  $: selected = PROVIDERS.find((p) => p.id === selectedId)!;
  $: config = configs[selectedId];
  $: selectedModel = selected.models.find((m) => m.id === config.model);

  function formatContext(n: number): string {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${Math.round(n / 1000)}k`;
    return String(n);
  }

  function statusLabel(p: ProviderDef): string {
    if (p.status === 'active')      return t('home.agents.active') as string;
    if (p.status === 'coming-soon') return t('home.agents.comingSoon') as string;
    return configs[p.id]?.enabled
      ? t('home.agents.enabled') as string
      : t('home.agents.disabled') as string;
  }
</script>

<div class="providers-layout">
  <!-- Left: provider list -->
  <aside class="providers-sidebar">
    <div class="sidebar-title">{t('home.agents.providerList')}</div>
    {#each PROVIDERS as p}
      <button
        class="provider-item {selectedId === p.id ? 'active' : ''} {p.status === 'coming-soon' ? 'dimmed' : ''}"
        on:click={() => selectedId = p.id}
        disabled={p.status === 'coming-soon'}
      >
        <span class="provider-logo" style="--color: {p.accentColor}">{p.logo}</span>
        <span class="provider-item-info">
          <span class="provider-item-name">{p.name}</span>
          <span class="provider-item-status {p.status} {configs[p.id]?.enabled ? 'on' : ''}">
            {statusLabel(p)}
          </span>
        </span>
        {#if p.status !== 'coming-soon' && p.status !== 'active'}
          <span class="provider-toggle-wrap">
            <span
              role="switch"
              aria-checked={configs[p.id]?.enabled}
              class="toggle {configs[p.id]?.enabled ? 'on' : ''}"
              tabindex="0"
              on:click|stopPropagation={() => configs[p.id].enabled = !configs[p.id].enabled}
              on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); configs[p.id].enabled = !configs[p.id].enabled; }}}
            ></span>
          </span>
        {/if}
      </button>
    {/each}
  </aside>

  <!-- Right: config panel -->
  <section class="provider-config">
    {#if selected}
      <div class="config-header">
        <span class="config-logo" style="--color: {selected.accentColor}">{selected.logo}</span>
        <div class="config-header-text">
          <h2 class="config-title">{selected.name}</h2>
          <p class="config-desc">{selected.desc}</p>
        </div>
        {#if selected.status === 'active'}
          <span class="badge badge-active">{t('home.agents.active')}</span>
        {:else if selected.status === 'coming-soon'}
          <span class="badge badge-soon">{t('home.agents.comingSoon')}</span>
        {:else}
          <div class="config-enabled-toggle">
            <span class="toggle-label">{configs[selected.id].enabled ? t('home.agents.enabled') : t('home.agents.disabled')}</span>
            <span
              role="switch"
              aria-checked={configs[selected.id].enabled}
              aria-label={t('home.agents.enabled') as string}
              class="toggle {configs[selected.id].enabled ? 'on' : ''}"
              tabindex="0"
              on:click={() => config.enabled = !config.enabled}
              on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); config.enabled = !config.enabled; }}}
            ></span>
          </div>
        {/if}
      </div>

      {#if selected.note}
        <div class="config-note">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>
          </svg>
          {selected.note}
        </div>
      {/if}

      <div class="config-body">
        {#if selected.hasApiKey}
          <div class="field-group">
            <label class="field-label" for="p-apikey">{t('home.agents.fields.apiKey')}</label>
            <input id="p-apikey" class="field-input" type="password"
              placeholder={t('home.agents.fields.apiKeyPlaceholder') as string}
              bind:value={config.apiKey} autocomplete="off" spellcheck="false"/>
            <span class="field-hint">{t('home.agents.fields.apiKeyHint')}</span>
          </div>
        {/if}

        {#if selected.hasBaseUrl}
          <div class="field-group">
            <label class="field-label" for="p-baseurl">{t('home.agents.fields.baseUrl')}</label>
            <input id="p-baseurl" class="field-input" type="text"
              placeholder={selected.defaultBaseUrl ?? (t('home.agents.fields.baseUrlPlaceholder') as string)}
              bind:value={config.baseUrl} autocomplete="off" spellcheck="false"/>
            <span class="field-hint">{t('home.agents.fields.baseUrlHint')}</span>
          </div>
        {/if}

        {#if selected.models.length > 0}
          <div class="field-group">
            <label class="field-label" for="p-model">{t('home.agents.fields.model')}</label>
            <select id="p-model" class="field-select" bind:value={config.model}>
              {#each selected.models as m}
                <option value={m.id}>{m.label}</option>
              {/each}
            </select>
            {#if config.model === '__custom__' && selected.hasCustomModel}
              <input class="field-input" style="margin-top: 6px" type="text"
                placeholder={t('home.agents.fields.customModelPlaceholder') as string}
                bind:value={config.customModel} autocomplete="off" spellcheck="false"/>
            {/if}
            {#if selectedModel?.contextWindow && config.model !== '__custom__'}
              <span class="field-hint">
                {t('home.agents.fields.contextWindow')} - {formatContext(selectedModel.contextWindow)} tokens
              </span>
            {/if}
          </div>
        {/if}

        <div class="field-row">
          <div class="field-group">
            <label class="field-label" for="p-temp">
              {t('home.agents.fields.temperature')}
              <span class="field-value-badge">{config.temperature.toFixed(1)}</span>
            </label>
            <input id="p-temp" class="field-range" type="range" min="0" max="2" step="0.1" bind:value={config.temperature}/>
            <span class="field-hint">{t('home.agents.fields.temperatureHint')}</span>
          </div>
          <div class="field-group">
            <label class="field-label" for="p-maxtokens">{t('home.agents.fields.maxTokens')}</label>
            <input id="p-maxtokens" class="field-input" type="number" min="1" max="200000" step="256" bind:value={config.maxTokens}/>
            <span class="field-hint">{t('home.agents.fields.maxTokensHint')}</span>
          </div>
        </div>

        <div class="field-row">
          <div class="field-group">
            <label class="field-label" for="p-timeout">{t('home.agents.fields.timeout')}</label>
            <input id="p-timeout" class="field-input" type="number" min="5" max="600" step="5" bind:value={config.timeout}/>
            <span class="field-hint">{t('home.agents.fields.timeoutHint')}</span>
          </div>
          <div class="field-group">
            <span class="field-label">{t('home.agents.fields.streaming')}</span>
            <div class="toggle-row">
              <span
                role="switch"
                aria-checked={config.streaming}
                class="toggle {config.streaming ? 'on' : ''}"
                tabindex="0"
                on:click={() => config.streaming = !config.streaming}
                on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); config.streaming = !config.streaming; }}}
              ></span>
              <span class="field-hint" style="margin-top: 0">{t('home.agents.fields.streamingHint')}</span>
            </div>
          </div>
        </div>
      </div>
    {/if}
  </section>
</div>

<style>
  .providers-layout {
    display: flex;
    gap: 0;
    width: 100%;
    align-items: flex-start;
  }

  .providers-sidebar {
    width: 210px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding-right: 16px;
    border-right: 1px solid var(--stroke-0);
  }

  .sidebar-title {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: .06em;
    color: var(--fg-3);
    padding: 0 4px 8px;
  }

  .provider-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 6px;
    border-radius: var(--r-sm);
    background: none;
    border: none;
    cursor: pointer;
    width: 100%;
    text-align: left;
    color: var(--fg-1);
    font-family: var(--font-ui);
  }
  .provider-item:hover:not(:disabled) { background: var(--bg-4); }
  .provider-item.active  { background: var(--accent-weak); }
  .provider-item.dimmed  { opacity: .45; cursor: default; }

  .provider-logo {
    width: 28px;
    height: 28px;
    border-radius: var(--r-sm);
    background: color-mix(in srgb, var(--color) 18%, transparent);
    border: 1px solid color-mix(in srgb, var(--color) 30%, transparent);
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

  .provider-item-info {
    display: flex;
    flex-direction: column;
    gap: 1px;
    flex: 1;
    min-width: 0;
  }

  .provider-item-name {
    font-size: 12.5px;
    font-weight: 500;
    color: var(--fg-0);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .provider-item-status { font-size: 10.5px; color: var(--fg-3); }
  .provider-item-status.active { color: var(--accent); }
  .provider-item-status.available.on { color: #4ade80; }

  .provider-toggle-wrap { flex-shrink: 0; }

  .provider-config {
    flex: 1;
    padding: 0 0 24px 28px;
    display: flex;
    flex-direction: column;
  }

  .config-header {
    display: flex;
    align-items: flex-start;
    gap: 14px;
    padding-bottom: 20px;
    border-bottom: 1px solid var(--stroke-0);
    margin-bottom: 24px;
  }

  .config-logo {
    width: 40px;
    height: 40px;
    border-radius: var(--r-md);
    background: color-mix(in srgb, var(--color) 18%, transparent);
    border: 1px solid color-mix(in srgb, var(--color) 30%, transparent);
    color: var(--color);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    font-weight: 700;
    font-family: var(--font-mono);
    flex-shrink: 0;
    letter-spacing: -.02em;
  }

  .config-header-text { flex: 1; }

  .config-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--fg-0);
    margin: 0 0 3px;
  }

  .config-desc {
    font-size: 12px;
    color: var(--fg-3);
    margin: 0;
    line-height: 1.5;
  }

  .badge {
    flex-shrink: 0;
    font-size: 10.5px;
    font-weight: 600;
    padding: 3px 8px;
    border-radius: 99px;
    font-family: var(--font-ui);
  }
  .badge-active {
    background: color-mix(in srgb, var(--accent) 15%, transparent);
    color: var(--accent);
    border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
  }
  .badge-soon {
    background: var(--bg-3);
    color: var(--fg-3);
    border: 1px solid var(--stroke-0);
  }

  .config-enabled-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .toggle-label { font-size: 12px; color: var(--fg-3); }

  .config-note {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 10px 14px;
    border-radius: var(--r-md);
    background: var(--bg-3);
    border: 1px solid var(--stroke-0);
    font-size: 12px;
    color: var(--fg-2);
    line-height: 1.5;
    margin-bottom: 20px;
  }
  .config-note svg { flex-shrink: 0; margin-top: 1px; color: var(--fg-3); }

  .config-body {
    display: flex;
    flex-direction: column;
    gap: 20px;
    max-width: 560px;
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

  .field-range { width: 100%; accent-color: var(--accent); cursor: pointer; }

  .field-hint { font-size: 11px; color: var(--fg-3); line-height: 1.4; }

  .toggle-row { display: flex; align-items: center; gap: 10px; }

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
