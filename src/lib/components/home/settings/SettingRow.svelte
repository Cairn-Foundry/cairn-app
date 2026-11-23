<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * One setting, drawn from its entry in SETTINGS_SCHEMA: the label and the
   * line under it on the left, the control (default slot) on the right.
   * `after-label` holds a value read beside the label, such as a version.
   */
  import { t } from '#lib/i18n';
  import type { SettingRowDef } from '#lib/utils/home/settings-schema';

  export let row: SettingRowDef;
  /** Replaces the declared description with a line that depends on state. */
  export let note: string | null = null;

  $: desc = note ?? (row.desc ? (t(row.desc) as string) : '');
</script>

<div class="settings-row">
  <div class="settings-row-info">
    <span class="settings-row-label">{t(row.label)}<slot name="after-label"/></span>
    {#if desc}<span class="settings-row-desc">{desc}</span>{/if}
  </div>
  <slot/>
</div>
