<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * Search field with its icon and clear button. `value` is bound, so the parent
   * owns the query and the filtering.
   */
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n';

  export let value = '';
  export let placeholder = '';
  export let ariaLabel = '';
</script>

<div class="ag-search">
  <Icon name="search" size={12}/>
  <input
    class="selectable"
    type="text"
    bind:value
    {placeholder}
    aria-label={ariaLabel || placeholder}
    spellcheck="false"
  />
  {#if value}
    <button
      class="ag-search-clear"
      aria-label={t('common.clear') as string}
      title={t('common.clear') as string}
      on:click={() => { value = ''; }}
    >
      <Icon name="x" size={11}/>
    </button>
  {/if}
</div>

<style>
  /* The shared class carries an uneven margin from where it grew up; a field
     that is a component of its own sits evenly in whatever holds it. */
  .ag-search { margin: 8px; }
</style>
