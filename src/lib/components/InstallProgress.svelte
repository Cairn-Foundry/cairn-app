<script lang="ts">
  /**
   * Progress banner for a long install, showing the last output line and the
   * elapsed time. `startedAt` is a timestamp, ticked once a second here.
   */
  import { onDestroy } from 'svelte';
  import UpdateProgress from '$lib/components/layout/UpdateProgress.svelte';
  import { t } from '$lib/i18n';

  export let line = '';
  export let startedAt: number;
  export let onCancel: (() => void) | undefined = undefined;

  let now = Date.now();
  const timer = setInterval(() => { now = Date.now(); }, 1000);
  onDestroy(() => clearInterval(timer));

  $: elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));
  $: label = elapsed < 60
    ? `${elapsed}s`
    : `${Math.floor(elapsed / 60)}m ${String(elapsed % 60).padStart(2, '0')}s`;
</script>

<div class="install-progress">
  <UpdateProgress downloaded={0} total={null} thin/>
  <div class="foot">
    <span class="line selectable">{line}</span>
    <span class="elapsed">{label}</span>
    {#if onCancel}
      <button type="button" class="btn ghost cancel" on:click={onCancel}>
        {t('common.cancel')}
      </button>
    {/if}
  </div>
</div>

<style>
  .install-progress { display: flex; flex-direction: column; gap: 6px; }
  .foot {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .line {
    flex: 1;
    min-width: 0;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .elapsed {
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-4);
  }
  .cancel { flex-shrink: 0; padding: 2px 8px; font-size: 11px; }
</style>
