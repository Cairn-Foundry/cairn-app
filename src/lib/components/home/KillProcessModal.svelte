<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * Confirmation before stopping a process: the process, every port it frees,
   * and what a stop costs. Dispatches `confirm` with the chosen strength - the
   * forced stop sits apart at the left - or `close`.
   */
  import { createEventDispatcher } from 'svelte';
  import Icon from '#lib/components/Icon.svelte';
  import ConfirmModal from '#lib/components/ConfirmModal.svelte';
  import { t } from '#lib/i18n';
  import { shortCommand, type ProcessPorts } from '#lib/utils/home/ports';

  export let target: ProcessPorts;

  const dispatch = createEventDispatcher<{ close: void; confirm: { force: boolean } }>();

  $: command = shortCommand(target.process, target.command);
</script>

<ConfirmModal
  title={(t('home.ports.killTitle') as (name: string) => string)(target.process || String(target.pid))}
  confirmLabel={t('home.ports.killConfirm') as string}
  confirmIcon="x"
  on:close
  on:confirm={() => dispatch('confirm', { force: false })}
>
  <button slot="footStart" class="btn ghost" on:click={() => dispatch('confirm', { force: true })}>
    {t('home.ports.forceKill')}
  </button>

  <svelte:fragment slot="subject">
    <span class="kp-tile"><Icon name="terminal" size={14}/></span>
    <span class="cm-text">
      <span class="cm-name">{target.process || '-'} <span class="kp-pid">PID {target.pid}</span></span>
      {#if command}<span class="cm-sub kp-cmd selectable" title={target.command}>{command}</span>{/if}
    </span>
  </svelte:fragment>

  <section class="cm-section">
    <h3>{t('home.ports.freedTitle')}</h3>
    <div class="kp-ports">
      {#each target.ports as held (held.port)}
        <code class="kp-port selectable">:{held.port}</code>
      {/each}
    </div>
  </section>

  <p class="cm-note">
    <Icon name="alert" size={13}/>
    {t('home.ports.killDescription')}
  </p>
</ConfirmModal>

<style>
  .kp-tile {
    display: grid;
    flex: none;
    place-items: center;
    width: 28px;
    height: 28px;
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-sm);
    background: var(--bg-2);
    color: var(--fg-2);
  }
  .kp-pid { margin-left: 6px; font-family: var(--font-mono); font-size: 11.5px; font-weight: 400; color: var(--fg-3); }
  .kp-cmd { font-family: var(--font-mono); }
  .kp-ports { display: flex; flex-wrap: wrap; gap: 6px; }
  .kp-port {
    padding: 0 7px;
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 22px;
    color: var(--fg-1);
    background: var(--bg-2);
    border: 1px solid var(--stroke-0);
    border-radius: 4px;
  }
</style>
