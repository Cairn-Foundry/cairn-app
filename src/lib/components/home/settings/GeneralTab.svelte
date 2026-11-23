<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * General settings: the AI master switch, app updates and the installation of
   * the `cairn` command line helper.
   */
  import Spinner from '#lib/components/Spinner.svelte';
  import SettingsGroup from './SettingsGroup.svelte';
  import SettingRow from './SettingRow.svelte';
  import { SETTINGS_SCHEMA } from '#lib/utils/home/settings-schema';
  import { t } from '#lib/i18n';
  import { settings } from '#lib/stores/settings';
  import { checkForUpdates, openUpdateModal, updateState } from '#lib/stores/update';
  import { onMount } from 'svelte';
  import { getCliStatus, installCli, uninstallCli, type CliStatus } from '#lib/services/cli-service';
  import { showWelcomeTour } from '#lib/stores/ui.js';

  let cli: CliStatus | null = null;
  let cliBusy = false;
  let cliError = '';

  onMount(async () => {
    try { cli = await getCliStatus(); } catch {}
  });

  async function toggleCli() {
    cliBusy = true;
    cliError = '';
    try {
      cli = cli?.installed ? await uninstallCli() : await installCli();
    } catch (e) {
      cliError = String(e);
    } finally {
      cliBusy = false;
    }
  }

  $: update = $updateState;

  $: cliNote = cliError
    || (cli?.installed && cli.path
      ? (t('settings.general.cli.installedAt') as (path: string) => string)(cli.path)
      : cli && !cli.launcherAvailable
        ? (t('settings.general.cli.unavailable') as string)
        : null);

  $: updateNote = update.phase === 'error' && update.error
    ? update.error
    : update.phase === 'idle' && update.lastCheckedAt
      ? (t('update.upToDate') as string)
      : '';
</script>

<SettingsGroup group={SETTINGS_SCHEMA.general.ai}>
  <SettingRow row={SETTINGS_SCHEMA.general.ai.rows.enable}>
    <label class="settings-toggle" aria-label={t('settings.general.ai.enable') as string}>
      <input
        type="checkbox"
        checked={$settings.aiEnabled}
        on:change={(e) => settings.save({ aiEnabled: (e.target as HTMLInputElement).checked })}
      />
      <span class="settings-toggle-track"><span class="settings-toggle-thumb"></span></span>
    </label>
  </SettingRow>
  <SettingRow row={SETTINGS_SCHEMA.general.ai.rows.notifications}>
    <label class="settings-toggle" aria-label={t('settings.general.ai.notifications') as string}>
      <input
        type="checkbox"
        checked={$settings.agentNotifications}
        disabled={!$settings.aiEnabled}
        on:change={(e) => settings.save({ agentNotifications: (e.target as HTMLInputElement).checked })}
      />
      <span class="settings-toggle-track"><span class="settings-toggle-thumb"></span></span>
    </label>
  </SettingRow>
  <SettingRow row={SETTINGS_SCHEMA.general.ai.rows.toasts}>
    <label class="settings-toggle" aria-label={t('settings.general.ai.toasts') as string}>
      <input
        type="checkbox"
        checked={$settings.agentToasts}
        disabled={!$settings.aiEnabled}
        on:change={(e) => settings.save({ agentToasts: (e.target as HTMLInputElement).checked })}
      />
      <span class="settings-toggle-track"><span class="settings-toggle-thumb"></span></span>
    </label>
  </SettingRow>
</SettingsGroup>

<SettingsGroup group={SETTINGS_SCHEMA.general.cli}>
  <SettingRow row={SETTINGS_SCHEMA.general.cli.rows.command} note={cliNote}>
    {#if cliBusy}
      <span class="checking" aria-label={t('settings.general.cli.label') as string}>
        <Spinner size={12}/>
      </span>
    {:else}
      <button class="btn" disabled={!cli || (!cli.installed && !cli.launcherAvailable)} on:click={() => void toggleCli()}>
        {cli?.installed ? t('settings.general.cli.uninstall') : t('settings.general.cli.install')}
      </button>
    {/if}
  </SettingRow>
</SettingsGroup>

<SettingsGroup group={SETTINGS_SCHEMA.general.welcome}>
  <SettingRow row={SETTINGS_SCHEMA.general.welcome.rows.replay}>
    <button class="btn" on:click={() => showWelcomeTour.set(true)}>
      {t('settings.general.welcome.replayAction')}
    </button>
  </SettingRow>
</SettingsGroup>

<SettingsGroup group={SETTINGS_SCHEMA.general.updates}>
  <SettingRow row={SETTINGS_SCHEMA.general.updates.rows.version} note={updateNote}>
    <span slot="after-label" class="version selectable">{__APP_VERSION__ ?? 'dev'}</span>
    {#if update.phase === 'available'}
      <button class="btn primary" on:click={openUpdateModal}>
        {(t('update.installVersion') as (version: string) => string)(update.version ?? '')}
      </button>
    {:else if update.phase === 'checking'}
      <span class="checking" aria-label={t('update.ariaChecking') as string}>
        <Spinner size={12}/>
      </span>
    {:else}
      <button class="btn" on:click={() => void checkForUpdates()}>
        {t('settings.general.updates.check')}
      </button>
    {/if}
  </SettingRow>
  <SettingRow row={SETTINGS_SCHEMA.general.updates.rows.autoCheck}>
    <label class="settings-toggle" aria-label={t('settings.general.updates.autoCheck') as string}>
      <input
        type="checkbox"
        checked={$settings.autoCheckUpdates}
        on:change={(e) => settings.save({ autoCheckUpdates: (e.target as HTMLInputElement).checked })}
      />
      <span class="settings-toggle-track"><span class="settings-toggle-thumb"></span></span>
    </label>
  </SettingRow>
</SettingsGroup>

<style>
  .version { margin-left: 6px; font-family: var(--font-mono); font-size: 12px; color: var(--fg-2); }
  .checking {
    display: inline-flex;
    align-items: center;
    padding: 0 12px;
    color: var(--fg-2);
  }
</style>
