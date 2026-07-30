<script lang="ts">
  import Spinner from '$lib/components/Spinner.svelte';
  import { t } from '$lib/i18n';
  import { settings } from '$lib/stores/settings';
  import { checkForUpdates, openUpdateModal, updateState } from '$lib/stores/update';

  const ROWS = [
    { label: t('settings.general.rows.aiProvider.label') as string,        value: t('settings.general.rows.aiProvider.value') as string,        desc: t('settings.general.rows.aiProvider.desc') as string },
    { label: t('settings.general.rows.defaultBranch.label') as string,     value: t('settings.general.rows.defaultBranch.value') as string,     desc: t('settings.general.rows.defaultBranch.desc') as string },
    { label: t('settings.general.rows.worktreeLocation.label') as string,  value: t('settings.general.rows.worktreeLocation.value') as string,  desc: t('settings.general.rows.worktreeLocation.desc') as string },
    { label: t('settings.general.rows.formatOnStage.label') as string,     value: t('settings.general.rows.formatOnStage.value') as string,     desc: t('settings.general.rows.formatOnStage.desc') as string },
  ];

  $: update = $updateState;
</script>

<div class="settings-group">
  <div class="settings-group-title">{t('settings.general.groupTitle')}</div>
  {#each ROWS as s}
    <div class="settings-row">
      <div class="settings-row-info">
        <span class="settings-row-label">{s.label}</span>
        <span class="settings-row-desc">{s.desc}</span>
      </div>
      <span class="settings-row-value">{s.value}</span>
    </div>
  {/each}
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
