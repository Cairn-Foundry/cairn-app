<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n';
  import type { ProjectFolder } from '$lib/types/project';

  export let folder: ProjectFolder;

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
        <div class="step-count">{t('deleteFolder.heading')}</div>
        <h3>{(t('deleteFolder.title') as (name: string) => string)(folder.name)}</h3>
      </div>
      <button class="icon-btn close" on:click={() => dispatch('close')} aria-label={t('common.close') as string}>
        <Icon name="x" size={16}/>
      </button>
    </div>
    <div class="modal-body">
      <p class="del-desc">{t('deleteFolder.description')}</p>
    </div>
    <div class="modal-foot">
      <div class="spacer"></div>
      <button class="btn ghost" on:click={() => dispatch('close')}>{t('common.cancel')}</button>
      <button class="btn danger" on:click={() => dispatch('confirm')}>
        <Icon name="trash" size={14}/> {t('deleteFolder.deleteFolder')}
      </button>
    </div>
  </div>
</div>

<style>
  .del-modal { width: min(440px, 92vw); }
  .del-desc {
    font-size: 13px;
    color: var(--fg-2);
    line-height: 1.6;
    margin: 0;
  }
</style>
