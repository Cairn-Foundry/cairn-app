<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /** Confirmation before removing a container or taking a Compose project down. */
  import { createEventDispatcher } from 'svelte';
  import Icon from '#lib/components/Icon.svelte';
  import { t } from '#lib/i18n';

  export let kind: 'remove' | 'down';
  export let name: string;
  export let containers: string[] = [];

  const dispatch = createEventDispatcher<{ close: void; confirm: void }>();
</script>

<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
<div
  class="modal-backdrop"
  role="dialog"
  aria-modal="true"
  tabindex="-1"
  on:click={() => dispatch('close')}
  on:keydown={(e) => e.key === 'Escape' && dispatch('close')}
>
  <div class="modal confirm-modal" on:click|stopPropagation role="presentation">
    <div class="modal-head">
      <div>
        <div class="step-count">{t(`home.containers.confirm.${kind}Heading`)}</div>
        <h3>{(t(`home.containers.confirm.${kind}Title`) as (n: string) => string)(name)}</h3>
      </div>
      <button class="icon-btn close" on:click={() => dispatch('close')} aria-label={t('common.close') as string}>
        <Icon name="x" size={16}/>
      </button>
    </div>
    <div class="modal-body">
      <p class="desc">{t(`home.containers.confirm.${kind}Description`)}</p>
      {#if containers.length > 0}
        <ul class="names">
          {#each containers as c (c)}
            <li class="mono selectable">{c}</li>
          {/each}
        </ul>
      {/if}
    </div>
    <div class="modal-foot">
      <div class="spacer"></div>
      <button class="btn ghost" on:click={() => dispatch('close')}>{t('common.cancel')}</button>
      <button class="btn danger" on:click={() => dispatch('confirm')}>
        <Icon name={kind === 'remove' ? 'trash' : 'stop'} size={14}/>
        {t(`home.containers.action.${kind}`)}
      </button>
    </div>
  </div>
</div>

<style>
  .confirm-modal { width: min(480px, 92vw); }
  .desc {
    font-size: 13px;
    color: var(--fg-2);
    line-height: 1.6;
    margin: 0 0 12px;
  }
  .names {
    margin: 0;
    padding: 8px 10px;
    list-style: none;
    background: var(--bg-2);
    border-radius: var(--r-sm);
    max-height: 180px;
    overflow-y: auto;
  }
  .names li {
    font-size: 12px;
    color: var(--fg-1);
    line-height: 1.7;
  }
  .mono { font-family: var(--font-mono); }
</style>
