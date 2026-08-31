<script lang="ts">
  /**
   * General settings: the AI master switch, app updates and the installation of
   * the `cairn` command line helper.
   */
  import Spinner from '$lib/components/Spinner.svelte';
  import { t } from '$lib/i18n';
  import { settings } from '$lib/stores/settings';
  import { checkForUpdates, openUpdateModal, updateState } from '$lib/stores/update';
  import { onMount } from 'svelte';
  import { getCliStatus, installCli, uninstallCli, type CliStatus } from '$lib/services/cli-service';
  import { showWelcomeTour } from '$lib/stores/ui.js';

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
</script>

<div class="settings-group">
  <div class="settings-group-title">{t('settings.general.ai.groupTitle')}</div>
  <div class="settings-row">
    <div class="settings-row-info">
      <span class="settings-row-label">{t('settings.general.ai.enable')}</span>
      <span class="settings-row-desc">{t('settings.general.ai.enableDesc')}</span>
    </div>
    <label class="settings-toggle" aria-label={t('settings.general.ai.enable') as string}>
      <input
        type="checkbox"
        checked={$settings.aiEnabled}
        on:change={(e) => settings.save({ aiEnabled: (e.target as HTMLInputElement).checked })}
      />
      <span class="settings-toggle-track"><span class="settings-toggle-thumb"></span></span>
    </label>
  </div>
</div>

<div class="settings-group">
  <div class="settings-group-title">{t('settings.general.cli.groupTitle')}</div>
  <div class="settings-row">
    <div class="settings-row-info">
      <span class="settings-row-label">{t('settings.general.cli.install')}</span>
      <span class="settings-row-desc">
        {#if cliError}
          {cliError}
        {:else if cli?.installed && cli.path}
          {(t('settings.general.cli.installedAt') as (path: string) => string)(cli.path)}
        {:else if cli && !cli.launcherAvailable}
          {t('settings.general.cli.unavailable')}
        {:else}
          {t('settings.general.cli.installDesc')}
        {/if}
      </span>
    </div>
    {#if cliBusy}
      <span class="checking" aria-label={t('settings.general.cli.install') as string}>
        <Spinner size={12}/>
      </span>
    {:else}
      <button class="btn" disabled={!cli || (!cli.installed && !cli.launcherAvailable)} on:click={() => void toggleCli()}>
        {cli?.installed ? t('settings.general.cli.uninstall') : t('settings.general.cli.install')}
      </button>
    {/if}
  </div>
</div>

<div class="settings-group">
  <div class="settings-group-title">{t('settings.general.welcome.groupTitle')}</div>
  <div class="settings-row">
    <div class="settings-row-info">
      <span class="settings-row-label">{t('settings.general.welcome.replay')}</span>
      <span class="settings-row-desc">{t('settings.general.welcome.replayDesc')}</span>
    </div>
    <button class="btn" on:click={() => showWelcomeTour.set(true)}>
      {t('settings.general.welcome.replayAction')}
    </button>
  </div>
</div>

<div class="settings-group">
  <div class="settings-group-title">{t('settings.general.updates.groupTitle')}</div>
  <div class="settings-row">
    <div class="settings-row-info">
      <span class="settings-row-label">{t('settings.general.updates.currentVersion')}</span>
      <span class="settings-row-desc">{t('settings.general.updates.currentVersionDesc')}</span>
    </div>
    <span class="settings-row-value selectable">v{__APP_VERSION__ ?? 'dev'}</span>
  </div>
  <div class="settings-row">
    <div class="settings-row-info">
      <span class="settings-row-label">{t('settings.general.updates.autoCheck')}</span>
      <span class="settings-row-desc">{t('settings.general.updates.autoCheckDesc')}</span>
    </div>
    <label class="settings-toggle" aria-label={t('settings.general.updates.autoCheck') as string}>
      <input
        type="checkbox"
        checked={$settings.autoCheckUpdates}
        on:change={(e) => settings.save({ autoCheckUpdates: (e.target as HTMLInputElement).checked })}
      />
      <span class="settings-toggle-track"><span class="settings-toggle-thumb"></span></span>
    </label>
  </div>
  <div class="settings-row">
    <div class="settings-row-info">
      <span class="settings-row-label">{t('settings.general.updates.check')}</span>
      <span class="settings-row-desc">
        {#if update.phase === 'error' && update.error}
          {update.error}
        {:else if update.phase === 'idle' && update.lastCheckedAt}
          {t('update.upToDate')}
        {:else}
          {t('settings.general.updates.checkDesc')}
        {/if}
      </span>
    </div>
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
  </div>
</div>

<style>
  .checking {
    display: inline-flex;
    align-items: center;
    padding: 0 12px;
    color: var(--fg-2);
  }
</style>
