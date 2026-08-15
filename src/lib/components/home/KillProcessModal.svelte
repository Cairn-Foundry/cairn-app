<script lang="ts">
  /**
   * Confirmation before stopping a process holding a port. Dispatches `confirm`
   * with the chosen strength, or `close`.
   */
  import { createEventDispatcher } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n';
  import type { ListeningPort } from '$lib/services/ports-service';

  export let port: ListeningPort;

  const dispatch = createEventDispatcher<{ close: void; confirm: { force: boolean } }>();
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
  <div class="modal kill-modal" on:click|stopPropagation role="presentation">
    <div class="modal-head">
      <div>
        <div class="step-count">{t('home.ports.killHeading')}</div>
        <h3>{(t('home.ports.killTitle') as (name: string) => string)(port.process || String(port.pid))}</h3>
      </div>
      <button class="icon-btn close" on:click={() => dispatch('close')} aria-label={t('common.close') as string}>
        <Icon name="x" size={16}/>
      </button>
    </div>
    <div class="modal-body">
      <p class="kill-desc">{t('home.ports.killDescription')}</p>
      <dl class="facts">
        <div>
          <dt>{t('home.ports.col.port')}</dt>
          <dd class="mono selectable">{port.port}</dd>
        </div>
        <div>
          <dt>{t('home.ports.col.pid')}</dt>
          <dd class="mono selectable">{port.pid}</dd>
        </div>
        {#if port.command}
          <div class="wide">
            <dt>{t('home.ports.col.command')}</dt>
            <dd class="mono selectable">{port.command}</dd>
          </div>
        {/if}
      </dl>
    </div>
    <div class="modal-foot">
      <button class="btn ghost" on:click={() => dispatch('confirm', { force: true })}>
        {t('home.ports.forceKill')}
      </button>
      <div class="spacer"></div>
      <button class="btn ghost" on:click={() => dispatch('close')}>{t('common.cancel')}</button>
      <button class="btn danger" on:click={() => dispatch('confirm', { force: false })}>
        <Icon name="x" size={14}/> {t('home.ports.kill')}
      </button>
    </div>
  </div>
</div>

<style>
  .kill-modal { width: min(480px, 92vw); }
  .kill-desc {
    font-size: 13px;
    color: var(--fg-2);
    line-height: 1.6;
    margin: 0 0 14px;
  }
  .facts {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px 16px;
    margin: 0;
  }
  .facts .wide { grid-column: 1 / -1; }
  dt {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--fg-3);
    margin-bottom: 2px;
  }
  dd {
    margin: 0;
    font-size: 12px;
    color: var(--fg-1);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mono { font-family: var(--font-mono); }
</style>
