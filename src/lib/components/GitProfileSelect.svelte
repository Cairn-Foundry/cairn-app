<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  import Select from '#lib/components/Select.svelte';
  import { settings } from '#lib/stores/settings';
  import { t } from '#lib/i18n';

  export let value = '';
  export let label: string;
  export let hint: string;

  $: options = [
    { value: '', label: t('git.profileDefault') as string },
    ...$settings.gitProfiles.map((p) => ({ value: p.id, label: p.label })),
  ];
</script>

{#if $settings.gitProfiles.length > 0}
  <div class="gps">
    <div class="gps-label">{label}</div>
    <Select bind:value {options} ariaLabel={label} />
    <p class="gps-hint">{hint}</p>
  </div>
{/if}

<style>
  .gps { margin-bottom: 24px; }
  .gps-label {
    display: block;
    margin-bottom: 10px;
    font-size: 12px;
    font-weight: 500;
    color: var(--fg-2);
  }
  .gps-hint {
    margin: 8px 0 0;
    font-size: 12px;
    color: var(--fg-3);
    line-height: 1.5;
  }
</style>
