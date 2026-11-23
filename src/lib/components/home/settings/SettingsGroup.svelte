<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * A titled block of a settings tab, drawn from its entry in SETTINGS_SCHEMA.
   * Draws nothing on a platform the group is not available on. `actions` sits
   * at the end of the title line.
   */
  import { t } from '#lib/i18n';
  import type { SettingGroupDef } from '#lib/utils/home/settings-schema';

  export let group: SettingGroupDef;
  /** Replaces the declared description with a line that depends on state. */
  export let note: string | null = null;

  $: desc = note ?? (group.desc ? (t(group.desc) as string) : '');
</script>

{#if group.isAvailable !== false}
  <div class="settings-group">
    <div class="settings-group-head">
      <div class="settings-group-title">{t(group.title)}</div>
      {#if $$slots.actions}<div class="settings-group-actions"><slot name="actions"/></div>{/if}
    </div>
    {#if desc}<p class="settings-group-desc">{desc}</p>{/if}
    <slot/>
  </div>
{/if}
