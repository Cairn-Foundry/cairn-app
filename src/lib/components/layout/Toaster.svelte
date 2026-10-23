<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * The toasts of `stores/toasts.ts`, newest on top. Past `max`, the rest fold
   * into one line that `onMore` handles.
   */
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n';
  import { dismissToast, openToast, toasts } from '$lib/stores/toasts';

  interface Props {
    max?: number;
    onMore?: () => void;
  }

  const { max = 3, onMore }: Props = $props();

  let shown = $derived($toasts.slice(0, max));
  let hidden = $derived($toasts.length - shown.length);
</script>

{#if $toasts.length}
  <div class="toaster" role="region" aria-label={t('toasts.region') as string} aria-live="polite">
    {#each shown as toast (toast.id)}
      <div class="toast {toast.tone ?? 'accent'}">
        <button class="toast-main" onclick={() => openToast(toast)} disabled={!toast.onOpen}>
          <span class="kicker"><span class="dot"></span>{toast.kicker}</span>
          <span class="title">{toast.title}</span>
          {#if toast.body}<span class="body">{toast.body}</span>{/if}
        </button>
        <button
          class="toast-close"
          title={t('toasts.dismiss') as string}
          aria-label={t('toasts.dismiss') as string}
          onclick={() => dismissToast(toast.id)}
        >
          <Icon name="x" size={12}/>
        </button>
      </div>
    {/each}
    {#if hidden > 0}
      <button class="more" onclick={() => onMore?.()}>
        {(t('toasts.more') as (n: number) => string)(hidden)}
      </button>
    {/if}
  </div>
{/if}

<style>
  .toaster {
    position: fixed;
    top: calc(var(--titlebar-h, 0px) + 12px);
    right: 14px;
    z-index: 600;
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 300px;
    max-width: calc(100vw - 28px);
  }
  .toast {
    position: relative;
    background: var(--bg-2);
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-md);
    box-shadow: 0 20px 60px oklch(0 0 0 / 0.5);
    animation: pop .2s;
  }
  .toast-main {
    display: flex;
    flex-direction: column;
    gap: 3px;
    width: 100%;
    padding: 10px 30px 10px 12px;
    text-align: left;
    border-radius: inherit;
  }
  .toast-main:not(:disabled):hover { background: var(--bg-3); }
  .toast-main:disabled { cursor: default; }
  .kicker {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    font-weight: 600;
    color: var(--tone);
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--tone);
    flex: none;
  }
  .toast.accent { --tone: var(--accent); }
  .toast.warning { --tone: var(--warning); }
  .toast.success { --tone: var(--success); }
  .title {
    font-size: 12.5px;
    color: var(--fg-0);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .body {
    font-size: 11.5px;
    color: var(--fg-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .toast-close {
    position: absolute;
    top: 6px;
    right: 6px;
    display: inline-flex;
    padding: 4px;
    border-radius: var(--r-sm);
    color: var(--fg-3);
  }
  .toast-close:hover { background: var(--bg-4); color: var(--fg-0); }
  .more {
    align-self: flex-end;
    padding: 6px 10px;
    font-size: 11.5px;
    color: var(--fg-2);
    background: var(--bg-2);
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-md);
  }
  .more:hover { background: var(--bg-3); color: var(--fg-0); }
  @media (prefers-reduced-motion: reduce) {
    .toast { animation: none; }
  }
</style>
