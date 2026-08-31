<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * Home-screen card announcing a pending app update and opening the update modal.
   */
  import Icon from '$lib/components/Icon.svelte';
  import UpdateProgress from '$lib/components/layout/UpdateProgress.svelte';
  import { t } from '$lib/i18n';
  import { hasPendingUpdate, openUpdateModal, updateState } from '$lib/stores/update';

  $: state = $updateState;
</script>

{#if $hasPendingUpdate}
  <div class="update-card">
    <div class="head">
      <Icon name="download" size={13}/>
      <span class="title">{t('update.cardTitle')}</span>
    </div>
    <div class="version selectable">{state.version}</div>
    {#if state.phase === 'downloading'}
      <UpdateProgress downloaded={state.downloaded} total={state.total} thin/>
    {:else}
      <button class="action" on:click={openUpdateModal}>{t('update.cardAction')}</button>
    {/if}
  </div>
{/if}

<style>
  .update-card {
    margin: 0 8px 8px;
    padding: 10px;
    background: var(--accent-weak);
    border: 1px solid var(--accent-line);
    border-radius: var(--r-md);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--accent);
  }
  .title {
    font-size: 11px;
    font-weight: 600;
    line-height: 1.3;
  }
  .version {
    margin: 4px 0 8px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-2);
  }
  .action {
    width: 100%;
    padding: 5px 8px;
    background: var(--accent);
    border: none;
    border-radius: var(--r-sm);
    color: white;
    font-family: var(--font-ui);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
  }
  .action:hover { background: var(--accent-hover); }
</style>
