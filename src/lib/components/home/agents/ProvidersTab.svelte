<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * The coding CLIs Cairn found on this machine.
   *
   * Detection only: no key to store, no model to pick, no default to set. A CLI
   * is configured with its own commands and its own config file, and Cairn runs
   * it as it is - so the one useful thing this page can say is whether it is
   * installed, which version, and where the binary came from.
   */
  import { onMount } from 'svelte';
  import CopyButton from '#lib/components/CopyButton.svelte';
  import Icon from '#lib/components/Icon.svelte';
  import Skeleton from '#lib/components/Skeleton.svelte';
  import ProviderLogo from '#lib/components/home/agents/ProviderLogo.svelte';
  import SettingsGroup from '#lib/components/home/settings/SettingsGroup.svelte';
  import { t } from '#lib/i18n';
  import { SETTINGS_SCHEMA } from '#lib/utils/home/settings-schema';
  import { type CliProviderDef, listCliProviders } from '#lib/services/cli-provider-service';

  let providers: CliProviderDef[] = [];
  let ready = false;

  /**
   * From the cache on open, freshly detected when the button asks. Detection
   * runs every installed CLI to read its version, so it is not something to
   * repeat each time the page is visited.
   */
  async function load(refresh = false) {
    if (refresh) ready = false;
    providers = await listCliProviders(refresh).catch(() => []);
    ready = true;
  }

  onMount(() => {
    void load();
  });

  $: installedCount = providers.filter((p) => p.installed).length;
</script>

<SettingsGroup group={SETTINGS_SCHEMA.providers.clis}>
  <svelte:fragment slot="actions">
    <span class="providers-count">
      {(t('home.providers.installedCount') as (n: number, total: number) => string)(
        installedCount,
        providers.length,
      )}
    </span>
    <button class="btn ghost" on:click={() => void load(true)} disabled={!ready}>
      <Icon name="refresh" size={12}/> {t('home.providers.refresh')}
    </button>
  </svelte:fragment>

  {#if !ready}
    <Skeleton lines={5} height={56} gap={10}/>
  {:else}
    {#each providers as provider (provider.id)}
      <div class="prov-card" class:absent={!provider.installed}>
        <span class="prov-mark">
          <ProviderLogo id={provider.id} size={20} fallback={provider.label.slice(0, 1)}/>
        </span>

        <div class="prov-text">
          <span class="prov-name">
            {provider.label}
            {#if provider.installed}
              <span class="prov-badge ok">{t('home.providers.installed')}</span>
            {:else}
              <span class="prov-badge">{t('home.providers.absent')}</span>
            {/if}
          </span>

          {#if provider.installed}
            {#if provider.version}
              <span class="prov-line selectable">{provider.version}</span>
            {/if}
            {#if provider.path}
              <span class="prov-line prov-path">
                <span class="selectable">{provider.path}</span>
                <CopyButton value={provider.path}/>
              </span>
            {/if}
          {/if}
        </div>
      </div>
    {/each}
  {/if}
</SettingsGroup>

<style>
  .providers-count { font-size: 12px; color: var(--fg-3); }

  .prov-card {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 14px 0;
  }
  .prov-card + .prov-card { border-top: 1px solid var(--stroke-0); }
  .prov-card.absent { align-items: center; }

  .prov-card.absent .prov-mark,
  .prov-card.absent .prov-name { opacity: 0.55; }

  .prov-mark {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    flex-shrink: 0;
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-sm);
    background: var(--bg-2);
    color: var(--fg-1);
    font-size: 13px;
    font-weight: 600;
  }

  .prov-text {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  .prov-name {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--fg-0);
  }

  .prov-badge {
    padding: 0 7px;
    font-size: 11px;
    line-height: 18px;
    border: 1px solid var(--stroke-1);
    border-radius: 9px;
    color: var(--fg-3);
  }

  .prov-badge.ok {
    border-color: currentColor;
    color: var(--success);
  }

  .prov-line {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    font-size: 12px;
    color: var(--fg-3);
  }

  .prov-path .selectable {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
  }
</style>
