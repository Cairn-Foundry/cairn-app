<script lang="ts">
  /**
   * Confirmation before deleting a skill directory.
   */
  import { createEventDispatcher } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n';

  export let name: string;
  export let path: string;

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
  <div class="modal del-modal" on:click|stopPropagation role="presentation">
    <div class="modal-head">
      <div>
        <div class="step-count">{t('skills.delete.heading')}</div>
        <h3>{(t('skills.delete.title') as (n: string) => string)(name)}</h3>
      </div>
      <button class="icon-btn close" on:click={() => dispatch('close')} aria-label={t('common.close') as string}>
        <Icon name="x" size={16}/>
      </button>
    </div>
    <div class="modal-body">
      <p class="del-desc">{t('skills.delete.description')}</p>
      <code class="del-path selectable">{path}</code>
    </div>
    <div class="modal-foot">
      <div class="spacer"></div>
      <button class="btn ghost" on:click={() => dispatch('close')}>{t('common.cancel')}</button>
      <button class="btn danger" on:click={() => dispatch('confirm')}>
        <Icon name="trash" size={14}/> {t('skills.delete.confirm')}
      </button>
    </div>
  </div>
</div>

<style>
  .del-modal { width: min(460px, 92vw); }
  .del-desc {
    margin: 0 0 12px;
    font-size: 13px;
    color: var(--fg-2);
    line-height: 1.6;
  }
  .del-path {
    display: block;
    padding: 8px 10px;
    background: var(--bg-1);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-sm);
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-2);
    word-break: break-all;
  }
</style>
