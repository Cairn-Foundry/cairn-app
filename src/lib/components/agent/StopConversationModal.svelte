<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * Confirmation before a CLI still running a command of its own is stopped.
   * Only shown in that case: a quiet CLI is stopped straight away.
   */
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n';

  interface Props {
    title: string;
    onClose: () => void;
    onConfirm: () => void;
  }

  const { title, onClose, onConfirm }: Props = $props();
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
        <h3>{(t('agent.stopTitle') as (name: string) => string)(title)}</h3>
      </div>
      <button class="icon-btn close" onclick={onClose} aria-label={t('common.close') as string}>
        <Icon name="x" size={16}/>
      </button>
    </div>
    <div class="modal-body">
      <p class="stop-desc">{t('agent.stopDescription')}</p>
    </div>
    <div class="modal-foot">
      <div class="spacer"></div>
      <button class="btn ghost" onclick={onClose}>{t('common.cancel')}</button>
      <button class="btn danger" onclick={onConfirm}>
        <Icon name="stop" size={14}/> {t('agent.stop')}
      </button>
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
