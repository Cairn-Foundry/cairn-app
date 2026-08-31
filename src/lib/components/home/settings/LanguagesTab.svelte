<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * Interface language picker, searchable over both the native and the English name.
   */
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n';
  import { getLocale, setLocale, LOCALE_META } from '$lib/i18n';
  import type { Locale } from '$lib/i18n';

  const currentLocale = getLocale();

  let search = '';

  const allLocales: { locale: Locale; nativeName: string; englishName: string }[] =
    (Object.entries(LOCALE_META) as [Locale, { nativeName: string; englishName: string }][]).map(
      ([locale, meta]) => ({ locale, ...meta }),
    );

  $: filtered = search.trim()
    ? allLocales.filter(
        (l) =>
          l.nativeName.toLowerCase().includes(search.toLowerCase()) ||
          l.englishName.toLowerCase().includes(search.toLowerCase()) ||
          l.locale.toLowerCase().includes(search.toLowerCase()),
      )
    : allLocales;
</script>

<div class="settings-group">
  <div class="settings-group-title">{t('settings.languages.groupTitle')}</div>

  <div class="lang-search-bar">
    <Icon name="search" size={13} />
    <input
      class="lang-search-input"
      bind:value={search}
      placeholder={t('settings.languages.searchPlaceholder') as string}
      aria-label={t('settings.languages.searchAriaLabel') as string}
    />
    {#if search}
      <button
        class="search-clear"
        on:click={() => (search = '')}
        aria-label={t('settings.languages.clearSearch') as string}
      >
        <Icon name="x" size={11} />
      </button>
    {/if}
  </div>

  {#if filtered.length === 0}
    <div style="margin-top: 16px; color: var(--fg-3); font-size: 13px;">
      {(t('settings.languages.noResults') as (q: string) => string)(search)}
    </div>
  {:else}
    <div class="lang-list">
      {#each filtered as item}
        {@const isActive = item.locale === currentLocale}
        <button
          class="lang-row"
          class:lang-active={isActive}
          on:click={() => !isActive && setLocale(item.locale)}
          disabled={isActive}
        >
          <div class="lang-info">
            <span class="lang-native">{item.nativeName}</span>
            {#if item.nativeName !== item.englishName}
              <span class="lang-english">{item.englishName}</span>
            {/if}
          </div>
          <span class="lang-code">{item.locale}</span>
          {#if isActive}
            <span class="lang-active-badge">{t('settings.languages.active')}</span>
          {:else}
            <span class="lang-apply-hint">{t('settings.languages.apply')}</span>
          {/if}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .lang-search-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    background: var(--bg-0);
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-sm);
    color: var(--fg-3);
    transition: border-color 0.15s;
    max-width: 560px;
    margin-bottom: 12px;
  }
  .lang-search-bar:focus-within {
    border-color: var(--accent-line);
    color: var(--fg-1);
  }

  .lang-search-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    font-size: 12px;
    font-family: var(--font-ui);
    color: var(--fg-0);
    min-width: 0;
  }
  .lang-search-input::placeholder { color: var(--fg-4); }

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

  .lang-list {
    display: flex;
    flex-direction: column;
    gap: 5px;
    max-width: 560px;
  }

  .lang-row {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 11px 14px;
    background: var(--bg-2);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-md);
    cursor: pointer;
    text-align: left;
    transition: background 0.1s, border-color 0.1s;
  }
  .lang-row:not(:disabled):hover {
    background: var(--bg-3);
    border-color: var(--stroke-1);
  }
  .lang-row:not(:disabled):hover .lang-apply-hint {
    opacity: 1;
  }
  .lang-row.lang-active {
    border-color: var(--accent-line);
    background: var(--accent-weak);
    cursor: default;
  }

  .lang-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .lang-native {
    font-size: 13px;
    color: var(--fg-0);
  }

  .lang-english {
    font-size: 11px;
    color: var(--fg-3);
  }

  .lang-code {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-3);
    flex-shrink: 0;
  }

  .lang-active-badge {
    font-size: 11px;
    font-family: var(--font-mono);
    color: var(--accent);
    flex-shrink: 0;
  }

  .lang-apply-hint {
    font-size: 11px;
    color: var(--fg-3);
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.1s;
  }
</style>
