<script lang="ts">
  /**
   * Modal asking for the name of a new project folder.
   * Dispatches `confirm` with the trimmed name, `close` otherwise.
   */
  import { createEventDispatcher } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n';

  const dispatch = createEventDispatcher<{ close: void; confirm: string }>();

  let name = '';

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    dispatch('confirm', trimmed);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') submit();
    else if (e.key === 'Escape') dispatch('close');
  }
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
  <div class="modal create-folder-modal" on:click|stopPropagation role="presentation">
    <div class="modal-head">
      <div>
        <div class="step-count">{t('home.projects.folders.modal.heading')}</div>
        <h3>{t('home.projects.folders.modal.title')}</h3>
      </div>
      <button class="icon-btn close" on:click={() => dispatch('close')} aria-label={t('common.close') as string}>
        <Icon name="x" size={16}/>
      </button>
    </div>

    <div class="modal-body">
      <label class="field-label" for="folder-name">{t('home.projects.folders.modal.nameLabel')}</label>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        id="folder-name"
        class="field-input"
        bind:value={name}
        placeholder={t('home.projects.folders.modal.namePlaceholder') as string}
        on:keydown={handleKeydown}
        autofocus
      />
    </div>

    <div class="modal-foot">
      <div class="spacer"></div>
      <button class="btn ghost" on:click={() => dispatch('close')}>{t('common.cancel')}</button>
      <button class="btn primary" disabled={!name.trim()} on:click={submit}>
        <Icon name="plus" size={14}/> {t('home.projects.folders.modal.create')}
      </button>
    </div>
  </div>
</div>

<style>
  .create-folder-modal { width: min(400px, 92vw); }

  .field-label {
    display: block;
    font-size: 12px;
    color: var(--fg-3);
    margin-bottom: 6px;
    font-family: var(--font-ui);
  }

  .field-input {
    width: 100%;
    box-sizing: border-box;
    background: var(--bg-0);
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-sm);
    padding: 8px 10px;
    font-size: 13px;
    font-family: var(--font-ui);
    color: var(--fg-0);
    outline: none;
    transition: border-color 0.15s;
  }
  .field-input:focus {
    border-color: var(--accent-line);
  }
  .field-input::placeholder { color: var(--fg-4); }
</style>
