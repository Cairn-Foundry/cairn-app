<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * Confirmation before an irreversible action: a question for a title, what is
   * acted on in a framed `subject` slot, what follows from it in the default
   * slot, then Cancel and the confirming button, red. Dispatches `confirm` or
   * `close`; while `isBusy` nothing closes it.
   *
   * The slots share a few classes so every confirmation reads the same:
   * `cm-name` and `cm-sub` for the two lines of the subject, `cm-section` for a
   * titled block (an h3, then its content), `cm-list` for its rows and
   * `cm-note` for a closing line with its icon. `footStart` holds a second,
   * lesser way out at the left of the footer.
   */
  import { createEventDispatcher } from 'svelte';
  import { t } from '#lib/i18n';
  import Icon from '#lib/components/Icon.svelte';
  import Spinner from '#lib/components/Spinner.svelte';

  export let title: string;
  export let confirmLabel: string;
  export let isBusy = false;
  export let confirmIcon = 'trash';

  const dispatch = createEventDispatcher<{ close: void; confirm: void }>();

  function close() {
    if (!isBusy) dispatch('close');
  }
</script>

<svelte:window on:keydown={(e) => e.key === 'Escape' && close()} />

<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
<div
  class="modal-backdrop"
  role="dialog"
  aria-modal="true"
  aria-labelledby="cm-title"
  tabindex="-1"
  on:click={close}
  on:keydown={() => {}}
>
  <div class="modal cm-modal" on:click|stopPropagation role="presentation">
    <div class="modal-head cm-head">
      <h2 id="cm-title">{title}</h2>
      <button class="icon-btn close" on:click={close} aria-label={t('common.close') as string}>
        <Icon name="x" size={16}/>
      </button>
    </div>

    <div class="modal-body cm-body">
      {#if $$slots.subject}
        <div class="cm-subject"><slot name="subject"/></div>
      {/if}
      <slot/>
    </div>

    <div class="modal-foot">
      <slot name="footStart"/>
      <div class="spacer"></div>
      <button class="btn ghost" on:click={close} disabled={isBusy}>{t('common.cancel')}</button>
      <button class="btn cm-confirm" on:click={() => dispatch('confirm')} disabled={isBusy}>
        {#if isBusy}<Spinner size={12}/>{:else}<Icon name={confirmIcon} size={13}/>{/if}
        {confirmLabel}
      </button>
    </div>
  </div>
</div>

<style>
  .cm-modal { width: min(480px, 92vw); }
  .cm-head { padding-block: 16px; }
  .cm-head h2 {
    margin: 0;
    font-family: var(--font-ui);
    font-size: 15px;
    font-weight: 600;
    color: var(--fg-0);
  }
  .cm-body { display: flex; flex-direction: column; gap: 20px; padding: 20px 24px; }
  .cm-subject {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
    padding: 10px 12px;
    background: var(--bg-0);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-sm);
  }
  .cm-subject :global(.cm-text) { display: flex; flex-direction: column; min-width: 0; }
  .cm-modal :global(.cm-name) { font-size: 13px; font-weight: 500; color: var(--fg-0); }
  .cm-modal :global(.cm-sub) {
    font-size: 11.5px;
    color: var(--fg-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cm-modal :global(.cm-section h3) { margin: 0 0 10px; font-size: 12.5px; font-weight: 600; color: var(--fg-1); }
  .cm-modal :global(.cm-list) { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; list-style: none; }
  .cm-modal :global(.cm-list li) { display: flex; align-items: center; gap: 10px; min-width: 0; font-size: 13px; color: var(--fg-1); }
  .cm-modal :global(.cm-note) { display: flex; align-items: flex-start; gap: 8px; margin: 0; font-size: 12px; line-height: 1.5; color: var(--fg-3); }
  .cm-modal :global(.cm-note .ic) { flex: none; margin-top: 2px; }
  .cm-confirm { background: var(--danger); color: var(--bg-0); border-color: transparent; }
  .cm-confirm:hover { background: color-mix(in oklch, var(--danger) 88%, var(--fg-0)); color: var(--bg-0); }
</style>
