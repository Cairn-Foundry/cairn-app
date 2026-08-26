<script lang="ts">
  /**
   * Shown when a checkout is refused because the worktree carries uncommitted
   * changes. Stashing them is the one-click way out; committing is left to the
   * git view.
   */
  import { createEventDispatcher } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import { t } from '$lib/i18n';

  export let branch: string;
  export let isStashing = false;

  const dispatch = createEventDispatcher<{ close: void; stash: void }>();
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
  <div class="modal dirty-worktree-modal" on:click|stopPropagation role="presentation">
    <div class="modal-head">
      <div>
        <div class="step-count">{t('git.dirtyWorktree.heading')}</div>
        <h3>{(t('git.dirtyWorktree.title') as (branch: string) => string)(branch)}</h3>
      </div>
      <button class="icon-btn close" on:click={() => dispatch('close')} aria-label={t('common.close') as string}>
        <Icon name="x" size={16}/>
      </button>
    </div>
    <div class="modal-body">
      <p class="dw-desc">{t('git.dirtyWorktree.description')}</p>
    </div>
    <div class="modal-foot">
      <div class="spacer"></div>
      <button class="btn ghost" on:click={() => dispatch('close')}>{t('common.cancel')}</button>
      <button class="btn primary" disabled={isStashing} on:click={() => dispatch('stash')}>
        {#if isStashing}
          <Spinner size={13} stroke={1.5}/>
        {:else}
          <Icon name="box" size={14}/>
        {/if}
        {t('git.dirtyWorktree.stashAndSwitch')}
      </button>
    </div>
  </div>
</div>

<style>
  .dirty-worktree-modal { width: min(460px, 92vw); }

  .dw-desc {
    font-size: 13px;
    color: var(--fg-2);
    line-height: 1.6;
    margin: 0;
  }
</style>
