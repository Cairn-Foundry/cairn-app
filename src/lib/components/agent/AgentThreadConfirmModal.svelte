<script lang="ts">
  /**
   * Confirmation modal before an agent thread is deleted from the runs panel.
   * `name` is the agent being dropped; dispatches close and confirm.
   */
  import { createEventDispatcher } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n';

  export let name: string;

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
  <div class="modal agent-thread-modal" on:click|stopPropagation role="presentation">
    <div class="modal-head">
      <div>
        <div class="step-count">{t('agents.deleteModal.heading')}</div>
        <h3>{(t('agents.deleteModal.title') as (n: string) => string)(name)}</h3>
      </div>
      <button class="icon-btn close" on:click={() => dispatch('close')} aria-label={t('common.close') as string}>
        <Icon name="x" size={16}/>
      </button>
    </div>
    <div class="modal-body">
      <p class="confirm-desc">{t('agents.deleteModal.description')}</p>
      <p class="confirm-desc keeps">{t('agents.deleteModal.keeps')}</p>
    </div>
    <div class="modal-foot">
      <div class="spacer"></div>
      <button class="btn ghost" on:click={() => dispatch('close')}>{t('common.cancel')}</button>
      <button class="btn danger" on:click={() => dispatch('confirm')}>
        <Icon name="trash" size={14}/>
        {t('agents.deleteThread')}
      </button>
    </div>
  </div>
</div>

<style>
  .agent-thread-modal { width: min(440px, 92vw); }

  .confirm-desc {
    color: var(--fg-1);
    font-size: 13px;
    line-height: 1.6;
    margin: 0;
  }

  .confirm-desc.keeps {
    color: var(--fg-3);
    font-size: 12px;
    margin-top: 8px;
  }
</style>
