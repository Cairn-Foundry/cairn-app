<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * Update modal: release notes, then download and install progress. Closing is
   * blocked while the update is downloading or installing.
   */
  import Icon from '$lib/components/Icon.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import UpdateProgress from '$lib/components/layout/UpdateProgress.svelte';
  import { t } from '$lib/i18n';
  import { closeUpdateModal, installUpdate, updateState } from '$lib/stores/update';
  import { formatBytes } from '$lib/utils/format';

  $: state = $updateState;
  $: isBusy = state.phase === 'downloading' || state.phase === 'installing';
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="modal-backdrop"
  role="dialog"
  aria-modal="true"
  tabindex="-1"
  on:click={() => { if (!isBusy) closeUpdateModal(); }}
  on:keydown={(e) => { if (e.key === 'Escape' && !isBusy) closeUpdateModal(); }}
>
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="modal update-modal" on:click={(e) => e.stopPropagation()} role="presentation">
    <div class="modal-head">
      <div>
        <div class="step-count">{t('update.heading')}</div>
        <h3>{t('update.modalTitle')}</h3>
      </div>
      {#if !isBusy}
        <button class="icon-btn close" on:click={closeUpdateModal} aria-label={t('common.close') as string}>
          <Icon name="x" size={16}/>
        </button>
      {/if}
    </div>

    <div class="modal-body">
      <div class="versions">
        <span class="version selectable">{__APP_VERSION__ ?? 'dev'}</span>
        <Icon name="chev-r" size={14}/>
        <span class="version next selectable">{state.version}</span>
      </div>

      {#if state.notes}
        <div class="notes-title">{t('update.notesTitle')}</div>
        <div class="notes selectable">{state.notes}</div>
      {/if}

      {#if state.phase === 'downloading'}
        <div class="progress">
          <UpdateProgress downloaded={state.downloaded} total={state.total}/>
          <div class="bytes">
            {formatBytes(state.downloaded)}{state.total ? ` / ${formatBytes(state.total)}` : ''}
          </div>
        </div>
      {/if}

      {#if state.phase === 'error' && state.error}
        <div class="error selectable">{state.error}</div>
      {/if}
    </div>

    <div class="modal-foot">
      <div class="spacer"></div>
      {#if !isBusy}
        <button class="btn ghost" on:click={closeUpdateModal}>{t('update.later')}</button>
      {/if}
      <button
        class="btn primary"
        disabled={isBusy}
        aria-label={isBusy ? t('update.ariaInstalling') as string : undefined}
        on:click={() => void installUpdate()}
      >
        {#if isBusy}
          <Spinner size={12}/>
        {:else}
          <Icon name="download" size={14}/> {t('update.install')}
        {/if}
      </button>
    </div>
  </div>
</div>

<style>
  .update-modal { width: min(480px, 92vw); }
  .versions {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--fg-3);
  }
  .version {
    font-family: var(--font-mono);
    font-size: 13px;
  }
  .version.next {
    color: var(--accent);
    font-weight: 600;
  }
  .notes-title {
    margin-top: 18px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--fg-3);
  }
  .notes {
    margin-top: 8px;
    max-height: 220px;
    overflow-y: auto;
    white-space: pre-wrap;
    font-size: 12px;
    line-height: 1.6;
    color: var(--fg-2);
    padding: 10px 12px;
    background: var(--bg-2);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-sm);
  }
  .progress { margin-top: 18px; }
  .bytes {
    margin-top: 6px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-3);
  }
  .error {
    margin-top: 16px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--danger);
  }
</style>
