<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * Confirmation asked before regenerating the review guide. The guide is
   * replaced whole and the reading progress goes with it, so the reader is told
   * what they are about to lose rather than discovering it afterwards.
   */
  import { createEventDispatcher } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n';

  /** How many hunks are marked read today, to name what the reset costs. */
  export let seenHunks = 0;

  const dispatch = createEventDispatcher<{ confirm: void; close: void }>();
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="modal-backdrop"
  role="dialog"
  aria-modal="true"
  tabindex="-1"
  on:click={() => dispatch('close')}
  on:keydown={(e) => { if (e.key === 'Escape') dispatch('close'); if (e.key === 'Enter') dispatch('confirm'); }}
>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="modal rg-modal" on:click|stopPropagation role="presentation">
    <div class="modal-head">
      <div>
        <div class="step-count">{t('review.regenerateHeading')}</div>
        <h3>{t('review.regenerate')}</h3>
      </div>
      <button class="icon-btn close" on:click={() => dispatch('close')} aria-label={t('common.close') as string}>
        <Icon name="x" size={16}/>
      </button>
    </div>

    <div class="modal-body">
      <p class="rg-desc">{t('review.regenerateBody')}</p>
      {#if seenHunks > 0}
        <p class="rg-desc rg-warn">
          {(t('review.regenerateProgress') as (n: number) => string)(seenHunks)}
        </p>
      {/if}
    </div>

    <div class="modal-foot">
      <div class="spacer"></div>
      <button class="btn ghost" on:click={() => dispatch('close')}>{t('common.cancel')}</button>
      <button class="btn primary" on:click={() => dispatch('confirm')}>
        <Icon name="refresh" size={13}/> {t('review.regenerate')}
      </button>
    </div>
  </div>
</div>

<style>
  .rg-modal { width: min(460px, 92vw); }

  .rg-desc {
    font-size: 13px;
    color: var(--fg-2);
    line-height: 1.6;
    margin: 0;
  }

  .rg-warn { color: var(--fg-1); margin-top: 10px; }
</style>
