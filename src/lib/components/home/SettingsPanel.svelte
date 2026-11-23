<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * Settings screen on the shared split panel: the tabs and the cross-tab search in the
   * list column, the tab on screen beside them, import/export of the whole settings file
   * in the title row.
   */
  import Icon from '#lib/components/Icon.svelte';
  import SplitPanel from '#lib/components/SplitPanel.svelte';
  import SearchInput from '#lib/components/SearchInput.svelte';
  import SearchEmpty from '#lib/components/SearchEmpty.svelte';
  import { createEventDispatcher } from 'svelte';
  import { t } from '#lib/i18n';
  import { aiEnabled, settings } from '#lib/stores/settings';
  import GeneralTab from './settings/GeneralTab.svelte';
  import AppearanceTab from './settings/AppearanceTab.svelte';
  import EditorTab from './settings/EditorTab.svelte';
  import ShortcutsTab from './settings/ShortcutsTab.svelte';
  import ProjectTab from './settings/ProjectTab.svelte';
  import LanguagesTab from './settings/LanguagesTab.svelte';
  import LanguageServersSection from './LanguageServersSection.svelte';
  import ProvidersTab from './agents/ProvidersTab.svelte';
  import GitTab from './settings/GitTab.svelte';
  import { writeFile } from '#lib/services/file-service';
  import { searchSettings, type SettingsTab, type SettingEntry } from '#lib/utils/home/settings-registry';

  export let settingsTab: SettingsTab = 'general';

  const dispatch = createEventDispatcher<{ openSection: string }>();

  const TABS: { id: SettingsTab; icon: string }[] = [
    { id: 'general', icon: 'settings' },
    { id: 'appearance', icon: 'eye' },
    { id: 'editor', icon: 'file-code' },
    { id: 'project', icon: 'folder' },
    { id: 'git', icon: 'branch' },
    { id: 'languageServers', icon: 'server' },
    { id: 'providers', icon: 'cloud' },
    { id: 'shortcuts', icon: 'command' },
    { id: 'languages', icon: 'globe' },
  ];

  let settingsSearch = '';
  let importFileInput: HTMLInputElement;
  let importError = '';

  $: settingsResults = searchSettings(settingsSearch).filter((entry) => entry.tab !== 'providers' || $aiEnabled);
  $: isSearching = settingsSearch.trim() !== '';
  $: visibleTabs = TABS.filter((tab) => tab.id !== 'providers' || $aiEnabled);
  $: if (!$aiEnabled && settingsTab === 'providers') settingsTab = 'general';

  function selectTab(tab: SettingsTab) {
    settingsSearch = '';
    settingsTab = tab;
  }

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

<SplitPanel title={t('settings.title') as string}>
  <svelte:fragment slot="actions">
    <button class="btn ghost icon-only settings-io-btn" on:click={exportSettings} title={t('settings.exportTitle') as string} aria-label={t('settings.exportTitle') as string}>
      <Icon name="download" size={13}/>
    </button>
    <button class="btn ghost icon-only settings-io-btn" on:click={() => importFileInput.click()} title={t('settings.importTitle') as string} aria-label={t('settings.importTitle') as string}>
      <Icon name="upload" size={13}/>
    </button>
    <input
      bind:this={importFileInput}
      type="file"
      accept=".json"
      hidden
      on:change={handleImportFile}
    />
  </svelte:fragment>

  <svelte:fragment slot="list">
    <div class="list-tools">
      <SearchInput
        bind:value={settingsSearch}
        placeholder={t('settings.searchPlaceholder') as string}
        ariaLabel={t('settings.searchAriaLabel') as string}
      />
    </div>
    <nav class="list-items" aria-label={t('settings.title') as string}>
      {#each visibleTabs as tab (tab.id)}
        <button
          class="ag-item settings-tab"
          class:is-active={!isSearching && settingsTab === tab.id}
          aria-current={!isSearching && settingsTab === tab.id}
          on:click={() => selectTab(tab.id)}
        >
          <span class="tile"><Icon name={tab.icon} size={13}/></span>
          <span class="ag-item-text"><span class="ag-item-name">{t(`settings.tabs.${tab.id}`)}</span></span>
        </button>
      {/each}
    </nav>
  </svelte:fragment>

  {#if isSearching}
    <header class="detail-head">
      <div class="detail-title">
        <div class="title-row"><h2>{t('settings.resultsTitle')}</h2></div>
        <p class="selectable">{settingsSearch.trim()}</p>
      </div>
    </header>
    <div class="detail-body">
      {#if settingsResults.length > 0}
        <div class="settings-body settings-search-results">
          {#each settingsResults as entry}
            <button class="settings-search-result" on:click={() => goToSettingEntry(entry)}>
              <span class="settings-row-info">
                <span class="settings-row-label">{entry.label}</span>
                {#if entry.desc}<span class="settings-row-desc">{entry.desc}</span>{/if}
              </span>
              <span class="ssr-breadcrumb">{entry.homeSection ? entry.group : `${t(`settings.tabs.${entry.tab}`)} / ${entry.group}`}</span>
              <Icon name="chev-r" size={12}/>
            </button>
          {/each}
        </div>
      {:else}
        <SearchEmpty
          title={t('settings.noResultsTitle') as string}
          text={(t('settings.noResults') as (q: string) => string)(settingsSearch.trim())}
          clearLabel={t('common.clearSearch') as string}
          on:clear={() => settingsSearch = ''}
        />
      {/if}
    </div>
  {:else}
    <header class="detail-head">
      <div class="detail-title">
        <div class="title-row"><h2>{t(`settings.tabs.${settingsTab}`)}</h2></div>
        <p>{t(`settings.tabDescs.${settingsTab}`)}</p>
      </div>
    </header>
    {#if importError}
      <div class="notices"><div class="banner bad" role="alert"><Icon name="alert" size={13}/><span class="settings-import-error">{importError}</span></div></div>
    {/if}
    <div class="detail-body">
      <div class="settings-body">
        {#if settingsTab === 'general'}
          <GeneralTab/>
        {:else if settingsTab === 'appearance'}
          <AppearanceTab/>
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
        {:else if settingsTab === 'providers'}
          <ProvidersTab/>
        {/if}
      </div>
    </div>
  {/if}
</SplitPanel>

<style>
  /* Shared styles for settings rows/groups/toggles - used by all tab subcomponents */
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

  /* -- the settings screen --
     The shared rows above stay as they are for the other screens that borrow
     them (formatting); inside this screen they lie flat in the detail column. */
  .settings-body { max-width: 760px; padding: 4px 24px 12px; }
  .settings-body :global(.settings-group) { max-width: none; margin-top: 0; padding: 22px 0 16px; }
  .settings-body :global(.settings-group + .settings-group) { border-top: 1px solid var(--stroke-0); }
  .settings-body :global(.settings-group-head) {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 20px;
  }
  .settings-body :global(.settings-group-head:has(+ .settings-group-desc)) { margin-bottom: 6px; }
  .settings-body :global(.settings-group-title) {
    margin: 0;
    padding: 0;
    border: none;
    font-family: var(--font-ui);
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0;
    text-transform: none;
    color: var(--fg-0);
  }
  .settings-body :global(.settings-group-actions) { display: flex; align-items: center; gap: 6px; margin-left: auto; }
  .settings-body :global(.settings-group-desc) { margin: 0 0 20px; font-size: 12px; line-height: 1.5; color: var(--fg-3); }
  .settings-body :global(.settings-row) {
    margin: 0;
    padding: 16px 0;
    background: none;
    border: none;
    border-radius: 0;
  }
  .settings-body :global(.settings-row + .settings-row) { border-top: 1px solid var(--stroke-0); }
  .settings-body :global(.settings-group-head + .settings-row),
  .settings-body :global(.settings-group-desc + .settings-row) { padding-top: 0; }
  .settings-body :global(.settings-group > .settings-row:last-child) { padding-bottom: 0; }
  .settings-body :global(.settings-row-info) { gap: 6px; }
  .settings-body :global(.settings-row-desc) { font-size: 12px; line-height: 1.5; }
  .settings-body :global(.settings-section-reset) { max-width: none; }

  .settings-search-results { display: flex; flex-direction: column; padding-top: 8px; }
  .settings-search-result {
    display: flex;
    align-items: center;
    gap: 12px;
    width: calc(100% + 20px);
    padding: 12px 10px;
    margin: 0 -10px;
    border-radius: var(--r-sm);
    text-align: left;
    color: var(--fg-3);
  }
  .settings-search-result:hover { background: var(--bg-2); color: var(--fg-1); }
  .ssr-breadcrumb { flex-shrink: 0; font-size: 11.5px; color: var(--fg-3); white-space: nowrap; }
</style>
