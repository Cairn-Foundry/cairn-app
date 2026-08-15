<script lang="ts">
  /**
   * Confirmation asked before running a command flagged `confirm`, showing the
   * steps it is about to execute.
   */
  import { createEventDispatcher } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n';
  import type { CustomCommand } from '$lib/services/custom-command-service';

  export let command: CustomCommand;

  const dispatch = createEventDispatcher<{ confirm: void; close: void }>();
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="modal-backdrop"
  role="dialog"
  aria-modal="true"
  tabindex="-1"
  on:click={() => dispatch('close')}
  on:keydown={(e) => { if (e.key === 'Escape') dispatch('close'); if (e.key === 'Enter') dispatch('confirm'); }}
>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="modal cc-modal" on:click|stopPropagation role="presentation">
    <div class="modal-head">
      <div>
        <div class="step-count">{t('commands.confirmHeading')}</div>
        <h3>{command.name}</h3>
      </div>
      <button class="icon-btn close" on:click={() => dispatch('close')} aria-label={t('common.close') as string}>
        <Icon name="x" size={16}/>
      </button>
    </div>

    <div class="modal-body">
      <ol class="cc-steps">
        {#each command.steps as step}
          <li class="mono selectable">{step}</li>
        {/each}
      </ol>
    </div>

    <div class="modal-foot">
      <div class="spacer"></div>
      <button class="btn ghost" on:click={() => dispatch('close')}>{t('common.cancel')}</button>
      <button class="btn primary" on:click={() => dispatch('confirm')}>
        <Icon name="play" size={13}/> {t('commands.run')}
      </button>
    </div>
  </div>
</div>

<style>
  .cc-modal { width: min(440px, 92vw); }

  .cc-steps {
    margin: 0;
    padding-left: 18px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .cc-steps li {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--fg-1);
    word-break: break-all;
  }
</style>
