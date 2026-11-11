<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * Confirmation before a CLI is stopped. Stopping is only confirmed when the
   * CLI is running a command of its own; handing a running CLI over to the
   * system terminal is always confirmed, since it ends the run inside Cairn.
   */
  import Icon from '#lib/components/Icon.svelte';
  import { t } from '#lib/i18n';

  interface Props {
    title: string;
    mode?: 'stop' | 'detach';
    onClose: () => void;
    onConfirm: () => void;
  }

  const { title, mode = 'stop', onClose, onConfirm }: Props = $props();
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="modal-backdrop"
  role="dialog"
  aria-modal="true"
  tabindex="-1"
  onclick={onClose}
  onkeydown={(e) => e.key === 'Escape' && onClose()}
>
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="modal stop-modal" onclick={(e) => e.stopPropagation()} role="presentation">
    <div class="modal-head">
      <div>
        <div class="step-count">{t('agent.stopHeading')}</div>
        <h3>{(t(mode === 'detach' ? 'agent.detachTitle' : 'agent.stopTitle') as (name: string) => string)(title)}</h3>
      </div>
      <button class="icon-btn close" onclick={onClose} aria-label={t('common.close') as string}>
        <Icon name="x" size={16}/>
      </button>
    </div>
    <div class="modal-body">
      <p class="stop-desc">{t(mode === 'detach' ? 'agent.detachDescription' : 'agent.stopDescription')}</p>
    </div>
    <div class="modal-foot">
      <div class="spacer"></div>
      <button class="btn ghost" onclick={onClose}>{t('common.cancel')}</button>
      {#if mode === 'detach'}
        <button class="btn primary" onclick={onConfirm}>
          <Icon name="terminal" size={14}/> {t('agent.detachConfirm')}
        </button>
      {:else}
        <button class="btn danger" onclick={onConfirm}>
          <Icon name="stop" size={14}/> {t('agent.stop')}
        </button>
      {/if}
    </div>
  </div>
</div>

<style>
  .stop-modal { width: min(460px, 92vw); }
  .stop-desc {
    font-size: 13px;
    color: var(--fg-2);
    line-height: 1.6;
    margin: 0;
  }
</style>
