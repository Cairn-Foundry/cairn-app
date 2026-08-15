<script lang="ts">
  /**
   * Asks for the title of the duplicated instance, and whether to carry the working changes over.
   * Dispatches `confirm` with { title, copyWorkingChanges }.
   */
  import { createEventDispatcher, tick } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n';
  import type { Instance } from '$lib/types/instance';

  export let instance: Instance;
  export let defaultTitle: string;

  let title = defaultTitle;
  let copyWorkingChanges = true;
  let titleInput: HTMLInputElement | null = null;

  const dispatch = createEventDispatcher<{
    close: void;
    confirm: { title: string; copyWorkingChanges: boolean };
  }>();

  /** Action preselecting the suggested title, so typing replaces it outright. */
  function autoSelect(node: HTMLInputElement) {
    tick().then(() => node.select());
  }

  function handleSubmit() {
    if (!title.trim()) return;
    dispatch('confirm', { title: title.trim(), copyWorkingChanges });
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Enter') handleSubmit();
    else if (e.key === 'Escape') dispatch('close');
  }
</script>

<svelte:window on:keydown={handleKey}/>

<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
<div
  class="modal-backdrop"
  role="dialog"
  aria-modal="true"
  tabindex="-1"
  on:click={() => dispatch('close')}
  on:keydown={(e) => e.key === 'Escape' && dispatch('close')}
>
  <div class="modal dup-modal" on:click|stopPropagation role="presentation">
    <div class="modal-head">
      <div>
        <div class="step-count">{t('manageInstances.duplicateModal.heading')}</div>
        <h3>{instance.ticket.title}</h3>
      </div>
      <button class="icon-btn close" on:click={() => dispatch('close')} aria-label={t('common.close') as string}>
        <Icon name="x" size={16}/>
      </button>
    </div>

    <div class="modal-body dup-body">
      <label class="dup-field">
        <span class="dup-label">{t('manageInstances.duplicateModal.titleLabel')}</span>
        <input
          bind:this={titleInput}
          use:autoSelect
          bind:value={title}
          class="dup-input"
          placeholder={t('manageInstances.duplicateModal.titlePlaceholder') as string}
          autocomplete="off"
        />
      </label>

      <label class="dup-toggle">
        <div class="dup-toggle-text">
          <span class="dup-label">{t('manageInstances.duplicateModal.copyChangesLabel')}</span>
          <span class="dup-desc">{t('manageInstances.duplicateModal.copyChangesDesc')}</span>
        </div>
        <button
          type="button"
          class="toggle-btn"
          class:on={copyWorkingChanges}
          on:click={() => copyWorkingChanges = !copyWorkingChanges}
          aria-pressed={copyWorkingChanges}
          aria-label={t('manageInstances.duplicateModal.copyChangesLabel') as string}
        >
          <span class="toggle-thumb"></span>
        </button>
      </label>
    </div>

    <div class="modal-foot">
      <div class="spacer"></div>
      <button class="btn ghost" on:click={() => dispatch('close')}>{t('common.cancel')}</button>
      <button class="btn primary" disabled={!title.trim()} on:click={handleSubmit}>
        <Icon name="copy" size={13}/>
        {t('manageInstances.duplicateModal.confirm')}
      </button>
    </div>
  </div>
</div>

<style>
  .dup-modal { width: min(460px, 92vw); }

  .dup-body {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .dup-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .dup-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--fg-2);
  }

  .dup-input {
    width: 100%;
    background: var(--bg-3);
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-sm);
    color: var(--fg-0);
    font-size: 13px;
    font-family: var(--font-ui);
    padding: 7px 10px;
    outline: none;
    transition: border-color 0.15s;
    box-sizing: border-box;
  }
  .dup-input:focus { border-color: var(--accent); }

  .dup-toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    cursor: pointer;
  }

  .dup-toggle-text {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .dup-desc {
    font-size: 11.5px;
    color: var(--fg-3);
    line-height: 1.5;
  }

  .toggle-btn {
    flex-shrink: 0;
    width: 36px;
    height: 20px;
    border-radius: 10px;
    border: none;
    background: var(--bg-4);
    cursor: pointer;
    position: relative;
    transition: background 0.15s;
    padding: 0;
  }
  .toggle-btn.on { background: var(--accent); }

  .toggle-thumb {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--fg-0);
    transition: transform 0.15s;
  }
  .toggle-btn.on .toggle-thumb { transform: translateX(16px); }
</style>
