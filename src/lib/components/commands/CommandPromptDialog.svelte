<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n';

  export let commandName: string;
  export let labels: string[];

  const dispatch = createEventDispatcher<{ submit: Record<string, string>; close: void }>();

  let answers: Record<string, string> = Object.fromEntries(labels.map(l => [l, '']));

  function autofocus(node: HTMLInputElement, isFirst: boolean) {
    if (isFirst) node.focus();
  }

  function submit() {
    dispatch('submit', answers);
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Escape') dispatch('close');
    if (e.key === 'Enter') submit();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="modal-backdrop"
  role="dialog"
  aria-modal="true"
  tabindex="-1"
  on:click={() => dispatch('close')}
  on:keydown={handleKey}
>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="modal cp-modal" on:click|stopPropagation role="presentation">
    <div class="modal-head">
      <div>
        <div class="step-count">{commandName}</div>
        <h3>{t('commands.promptHeading')}</h3>
      </div>
      <button class="icon-btn close" on:click={() => dispatch('close')} aria-label={t('common.close') as string}>
        <Icon name="x" size={16}/>
      </button>
    </div>

    <div class="modal-body">
      {#each labels as label, i}
        <div class="cp-field">
          <label class="cp-label" for="prompt-{i}">{label}</label>
          <input
            id="prompt-{i}"
            class="cp-input selectable"
            bind:value={answers[label]}
            use:autofocus={i === 0}
            autocomplete="off"
          />
        </div>
      {/each}
    </div>

    <div class="modal-foot">
      <div class="spacer"></div>
      <button class="btn ghost" on:click={() => dispatch('close')}>{t('common.cancel')}</button>
      <button class="btn primary" on:click={submit}>
        <Icon name="play" size={13}/> {t('commands.run')}
      </button>
    </div>
  </div>
</div>

<style>
  .cp-modal { width: min(400px, 92vw); }

  .cp-field { margin-bottom: 14px; }

  .cp-label {
    display: block;
    font-size: 11px;
    font-weight: 700;
    color: var(--fg-3);
    letter-spacing: 0.07em;
    text-transform: uppercase;
    margin-bottom: 8px;
  }

  .cp-input {
    width: 100%;
    box-sizing: border-box;
    background: var(--bg-0);
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-sm);
    padding: 9px 11px;
    font-size: 13px;
    color: var(--fg-0);
    font-family: var(--font-mono);
    outline: none;
  }
  .cp-input:focus { border-color: var(--accent-line); box-shadow: 0 0 0 3px var(--accent-weak); }
</style>
