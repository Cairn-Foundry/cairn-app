<script lang="ts">
  /**
   * Settings screen: the tab strip, the cross-tab search, and import/export of the whole settings file.
   */
  import Icon from '$lib/components/Icon.svelte';
  import { createEventDispatcher } from 'svelte';
  import { t } from '$lib/i18n';
  import { settings } from '$lib/stores/settings';
  import GeneralTab from './settings/GeneralTab.svelte';
  import AppearanceTab from './settings/AppearanceTab.svelte';
  import EditorTab from './settings/EditorTab.svelte';
  import ShortcutsTab from './settings/ShortcutsTab.svelte';
  import ProjectTab from './settings/ProjectTab.svelte';
  import LanguagesTab from './settings/LanguagesTab.svelte';
  import LanguageServersSection from './LanguageServersSection.svelte';
  import GitTab from './settings/GitTab.svelte';
  import AgentTab from './settings/AgentTab.svelte';
  import { writeFile } from '$lib/services/file-service';
  import { searchSettings, type SettingsTab, type SettingEntry } from '$lib/utils/home/settings-registry';

  export let settingsTab: SettingsTab = 'general';

  const dispatch = createEventDispatcher<{ openSection: string }>();

  let settingsSearch = '';
  let importFileInput: HTMLInputElement;
  let importError = '';

  $: settingsResults = searchSettings(settingsSearch);

  function goToSettingEntry(entry: SettingEntry) {
    settingsSearch = '';
    if (entry.homeSection) {
      dispatch('openSection', entry.homeSection);
      return;
    }
    settingsTab = entry.tab;
  }

  async function exportSettings() {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({
      defaultPath: 'cairn-settings.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!path) return;
    await writeFile(path, JSON.stringify($settings, null, 2));
  }

  /** Reads a settings JSON back into the store, reporting a parse failure inline. */
  function handleImportFile(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    importError = '';
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string);
        settings.save(parsed);
      } catch {
        importError = t('settings.importError') as string;
      }
    };
    reader.readAsText(file);
    (e.target as HTMLInputElement).value = '';
  }
</script>

<div class="home-hero" style="padding-bottom: 0">
  <h1 style="font-size: 22px">{t('settings.title')}</h1>
</div>

<div class="settings-header-bar">
  <div class="settings-search-bar">
    <Icon name="search" size={13}/>
    <input
      class="settings-search-input"
      bind:value={settingsSearch}
      placeholder={t('settings.searchPlaceholder') as string}
      aria-label={t('settings.searchAriaLabel') as string}
    />
    {#if settingsSearch}
      <button class="search-clear" on:click={() => settingsSearch = ''} aria-label={t('settings.clearSearch') as string}>
        <Icon name="x" size={11}/>
      </button>
    {/if}
  </div>
  <button class="btn ghost settings-io-btn" on:click={exportSettings} title={t('settings.exportTitle') as string}>
    <Icon name="download" size={13}/> {t('settings.export')}
  </button>
  <button class="btn ghost settings-io-btn" on:click={() => importFileInput.click()} title={t('settings.importTitle') as string}>
    <Icon name="upload" size={13}/> {t('settings.import')}
  </button>
  <input
    bind:this={importFileInput}
    type="file"
    accept=".json"
    style="display:none"
    on:change={handleImportFile}
  />
</div>

{#if importError}
  <div class="settings-import-error" role="alert">{importError}</div>
{/if}

{#if settingsSearch.trim()}
  {#if settingsResults.length > 0}
    <div class="settings-search-results">
      {#each settingsResults as entry}
        <button class="settings-search-result" on:click={() => goToSettingEntry(entry)}>
          <div class="settings-row-info">
            <span class="settings-row-label">{entry.label}</span>
            <span class="settings-row-desc">{entry.desc}</span>
          </div>
          <span class="ssr-breadcrumb">{entry.homeSection ? entry.group : `${entry.tab.charAt(0).toUpperCase() + entry.tab.slice(1)} › ${entry.group}`}</span>
        </button>
      {/each}
    </div>
  {:else}
    <div style="margin-top: 24px; color: var(--fg-3); font-size: 13px;">
      {(t('settings.noResults') as (q: string) => string)(settingsSearch)}
    </div>
  {/if}
{:else}
  <div class="settings-layout">
    <div class="settings-tabs">
      <button class="settings-tab {settingsTab === 'general'    ? 'active' : ''}" on:click={() => settingsTab = 'general'}>{t('settings.tabs.general')}</button>
      <button class="settings-tab {settingsTab === 'appearance' ? 'active' : ''}" on:click={() => settingsTab = 'appearance'}>{t('settings.tabs.appearance')}</button>
      <button class="settings-tab {settingsTab === 'editor'     ? 'active' : ''}" on:click={() => settingsTab = 'editor'}>{t('settings.tabs.editor')}</button>
      <button class="settings-tab {settingsTab === 'agent'      ? 'active' : ''}" on:click={() => settingsTab = 'agent'}>{t('settings.tabs.agent')}</button>
      <button class="settings-tab {settingsTab === 'project'    ? 'active' : ''}" on:click={() => settingsTab = 'project'}>{t('settings.tabs.project')}</button>
      <button class="settings-tab {settingsTab === 'git'        ? 'active' : ''}" on:click={() => settingsTab = 'git'}>{t('settings.tabs.git')}</button>
      <button class="settings-tab {settingsTab === 'languageServers' ? 'active' : ''}" on:click={() => settingsTab = 'languageServers'}>{t('settings.tabs.languageServers')}</button>
      <button class="settings-tab {settingsTab === 'shortcuts'  ? 'active' : ''}" on:click={() => settingsTab = 'shortcuts'}>{t('settings.tabs.shortcuts')}</button>
      <button class="settings-tab {settingsTab === 'languages'  ? 'active' : ''}" on:click={() => settingsTab = 'languages'}>{t('settings.tabs.languages')}</button>
    </div>

    <div class="settings-content">
      {#if settingsTab === 'general'}
        <GeneralTab/>
      {:else if settingsTab === 'appearance'}
        <AppearanceTab/>
      {:else if settingsTab === 'agent'}
        <AgentTab/>
      {:else if settingsTab === 'editor'}
        <EditorTab/>
      {:else if settingsTab === 'shortcuts'}
        <ShortcutsTab/>
      {:else if settingsTab === 'project'}
        <ProjectTab/>
      {:else if settingsTab === 'languages'}
        <LanguagesTab/>
      {:else if settingsTab === 'languageServers'}
        <LanguageServersSection/>
      {:else if settingsTab === 'git'}
        <GitTab/>
      {/if}
    </div>
  </div>
{/if}

<style>
  /* Shared styles for settings rows/groups/toggles - used by all tab subcomponents */
  .settings-import-error {
    max-width: 560px;
    margin: 10px 0 0;
    padding: 8px 12px;
    font-size: 12px;
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--danger) 20%, transparent);
    border-radius: var(--r-sm);
  }

  :global(.settings-group) {
    margin-top: 28px;
    max-width: 560px;
  }

  :global(.settings-group-title) {
    font-size: 10.5px;
    font-family: var(--font-mono);
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fg-3);
    margin-bottom: 10px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--stroke-0);
  }

  :global(.settings-row) {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 11px 14px;
    background: var(--bg-2);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-md);
    margin-bottom: 6px;
  }

  :global(.settings-row-info) {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  :global(.settings-row-label) { font-size: 13px; color: var(--fg-0); }
  :global(.settings-row-desc)  { font-size: 11px; color: var(--fg-3); }
  :global(.settings-row-value) { font-family: var(--font-mono); font-size: 12px; color: var(--accent); white-space: nowrap; }

  :global(.settings-row-control) { display: flex; align-items: center; gap: 6px; }

  :global(.settings-number-input) {
    width: 64px;
    background: var(--bg-1);
    border: 1px solid var(--stroke-0);
    border-radius: 4px;
    color: var(--fg-0);
    font-size: 12px;
    font-family: var(--font-mono);
    padding: 4px 8px;
    outline: none;
    text-align: right;
  }
  :global(.settings-number-input:focus) { border-color: var(--accent); }
  :global(.settings-number-input::-webkit-inner-spin-button),
  :global(.settings-number-input::-webkit-outer-spin-button) { -webkit-appearance: none; }

  :global(.settings-row-unit) { font-size: 11px; color: var(--fg-3); font-family: var(--font-mono); }

  :global(.settings-reset-btn) {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    background: none;
    border: 1px solid var(--stroke-0);
    border-radius: 4px;
    color: var(--fg-3);
    cursor: pointer;
    padding: 0;
    transition: color .12s, border-color .12s;
  }
  :global(.settings-reset-btn:hover) { color: var(--fg-0); border-color: var(--fg-2); }

  :global(.settings-toggle) { display: flex; align-items: center; cursor: pointer; flex-shrink: 0; }
  :global(.settings-toggle input) { position: absolute; opacity: 0; width: 0; height: 0; }
  :global(.settings-toggle-track) {
    position: relative;
    width: 32px;
    height: 18px;
    background: var(--bg-3);
    border: 1px solid var(--stroke-0);
    border-radius: 9px;
    transition: background .15s, border-color .15s;
  }
  :global(.settings-toggle input:checked + .settings-toggle-track) {
    background: var(--accent);
    border-color: var(--accent);
  }
  :global(.settings-toggle-thumb) {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 12px;
    height: 12px;
    background: var(--fg-3);
    border-radius: 50%;
    transition: transform .15s, background .15s;
  }
  :global(.settings-toggle input:checked + .settings-toggle-track .settings-toggle-thumb) {
    transform: translateX(14px);
    background: #fff;
  }

  :global(.settings-section-reset) {
    display: flex;
    justify-content: flex-end;
    margin-top: 10px;
    max-width: 560px;
  }

  /* SettingsPanel-local styles */
  .settings-layout {
    display: flex;
    align-items: flex-start;
    gap: 32px;
    margin-top: 32px;
  }

  .settings-tabs {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 3px;
    background: var(--bg-0);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-sm);
    width: 180px;
    flex-shrink: 0;
    position: sticky;
    top: 0;
  }

  .settings-content {
    flex: 1;
    min-width: 0;
  }
  .settings-content :global(> .settings-group:first-child) {
    margin-top: 0;
  }

  .settings-tab {
    padding: 7px 12px;
    text-align: left;
    font-size: 12px;
    color: var(--fg-2);
    border-radius: 4px;
    transition: background .1s, color .1s;
    font-family: var(--font-ui);
  }
  .settings-tab:hover { color: var(--fg-0); }
  .settings-tab.active { background: var(--bg-3); color: var(--fg-0); }

  .settings-header-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 18px;
    max-width: 640px;
  }

  .settings-search-bar {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    background: var(--bg-0);
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-sm);
    color: var(--fg-3);
    transition: border-color 0.15s;
  }
  .settings-search-bar:focus-within {
    border-color: var(--accent-line);
    color: var(--fg-1);
  }

  .settings-search-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    font-size: 12px;
    font-family: var(--font-ui);
    color: var(--fg-0);
    min-width: 0;
  }
  .settings-search-input::placeholder { color: var(--fg-4); }

  .settings-io-btn { font-size: 12px; flex-shrink: 0; }

  .search-clear {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    color: var(--fg-3);
    display: flex;
    align-items: center;
  }
  .search-clear:hover { color: var(--fg-0); }

  .settings-search-results {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 16px;
    max-width: 560px;
  }

  .settings-search-result {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 10px 14px;
    background: var(--bg-2);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-md);
    cursor: pointer;
    text-align: left;
    transition: background .1s, border-color .1s;
  }
  .settings-search-result:hover {
    background: var(--bg-3);
    border-color: var(--stroke-1);
  }

  .ssr-breadcrumb {
    font-size: 11px;
    font-family: var(--font-mono);
    color: var(--accent);
    white-space: nowrap;
    flex-shrink: 0;
  }
</style>
