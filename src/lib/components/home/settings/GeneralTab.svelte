<script lang="ts">
  import { t } from '$lib/i18n';

  const ROWS = [
    { label: t('settings.general.rows.aiProvider.label') as string,        value: t('settings.general.rows.aiProvider.value') as string,        desc: t('settings.general.rows.aiProvider.desc') as string },
    { label: t('settings.general.rows.defaultBranch.label') as string,     value: t('settings.general.rows.defaultBranch.value') as string,     desc: t('settings.general.rows.defaultBranch.desc') as string },
    { label: t('settings.general.rows.worktreeLocation.label') as string,  value: t('settings.general.rows.worktreeLocation.value') as string,  desc: t('settings.general.rows.worktreeLocation.desc') as string },
    { label: t('settings.general.rows.formatOnStage.label') as string,     value: t('settings.general.rows.formatOnStage.value') as string,     desc: t('settings.general.rows.formatOnStage.desc') as string },
  ];
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
