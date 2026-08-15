<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Select from '$lib/components/Select.svelte';
  import { t } from '$lib/i18n';
  import type { EnvScope, EnvVariable } from '$lib/services/env-service';
  import { isReservedEnvKey, isValidEnvKey, RESERVED_KEY_PREFIX } from '$lib/utils/env/env-file';

  export let variable: EnvVariable;
  export let scope: EnvScope;
  export let isNew = false;
  export let canUseInstance = true;

  const dispatch = createEventDispatcher<{
    save: { variable: EnvVariable; scope: EnvScope };
    close: void;
  }>();

  let draft: EnvVariable = { ...variable };
  let draftScope: EnvScope = scope;
  let revealed = !draft.secret;

  $: scopeOptions = [
    { value: 'global', label: t('env.scope.global') as string },
    { value: 'project', label: t('env.scope.project') as string },
    ...(canUseInstance
      ? [{ value: 'instance', label: t('env.scope.instance') as string }]
      : []),
  ];

  $: if (draftScope === 'instance' && draft.perInstance) draft.perInstance = false;

  $: keyError = !draft.key.trim()
    ? ''
    : !isValidEnvKey(draft.key.trim())
      ? (t('env.errorInvalidKey') as string)
      : isReservedEnvKey(draft.key.trim())
        ? ((t('env.errorReservedKey') as (p: string) => string)(RESERVED_KEY_PREFIX))
        : '';

  $: canSave = draft.key.trim().length > 0 && keyError === '';

  function commit() {
    if (!canSave) return;
    dispatch('save', {
      variable: { ...draft, key: draft.key.trim() },
      scope: draftScope,
    });
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="modal-backdrop"
  role="dialog"
  aria-modal="true"
  tabindex="-1"
  on:click={() => dispatch('close')}
  on:keydown={(e) => e.key === 'Escape' && dispatch('close')}
>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="modal ee-modal" on:click|stopPropagation role="presentation">
    <div class="modal-head">
      <div>
        <div class="step-count">{t(`env.scope.${draftScope}`)}</div>
        <h3>{isNew ? t('env.newVariable') : t('env.editVariable')}</h3>
      </div>
      <button class="icon-btn close" on:click={() => dispatch('close')} aria-label={t('common.close') as string}>
        <Icon name="x" size={16}/>
      </button>
    </div>

    <div class="modal-body">
      <div class="ee-field">
        <span class="ee-label">{t('env.scopeField')}</span>
        <Select
          value={draftScope}
          options={scopeOptions}
          ariaLabel={t('env.scopeField') as string}
          on:change={(e) => (draftScope = e.detail as EnvScope)}
        />
        <span class="ee-hint">{t('env.scopeFieldHint')}</span>
      </div>

      <label class="ee-field">
        <span class="ee-label">{t('env.key')}</span>
        <!-- svelte-ignore a11y_autofocus -->
        <input
          class="ee-input mono selectable"
          class:invalid={keyError !== ''}
          bind:value={draft.key}
          autofocus
          spellcheck="false"
          autocapitalize="off"
          placeholder="DATABASE_URL"
        />
        {#if keyError}<span class="ee-error">{keyError}</span>{/if}
      </label>

      {#if !(draftScope !== 'instance' && draft.perInstance)}
        <label class="ee-field">
          <span class="ee-label">{t('env.value')}</span>
          <span class="ee-value-row">
            {#if revealed}
              <textarea class="ee-input mono selectable" bind:value={draft.value} spellcheck="false"></textarea>
            {:else}
              <input class="ee-input mono selectable" type="password" bind:value={draft.value} spellcheck="false"/>
            {/if}
            <button
              class="ee-reveal"
              type="button"
              title={(revealed ? t('env.hide') : t('env.reveal')) as string}
              aria-label={(revealed ? t('env.hide') : t('env.reveal')) as string}
              on:click={() => revealed = !revealed}
            >
              <Icon name={revealed ? 'eye' : 'lock'} size={13}/>
            </button>
          </span>
          <span class="ee-hint">{t('env.valueHint')}</span>
        </label>
      {/if}

      <label class="ee-toggle">
        <input type="checkbox" bind:checked={draft.secret}/>
        <span>
          <span class="ee-toggle-name">{t('env.secret')}</span>
          <span class="ee-hint">{t('env.secretHint')}</span>
        </span>
      </label>

      {#if draftScope !== 'instance'}
        <label class="ee-toggle">
          <input type="checkbox" bind:checked={draft.perInstance}/>
          <span>
            <span class="ee-toggle-name">{t('env.perInstance')}</span>
            <span class="ee-hint">{t('env.perInstanceHint')}</span>
          </span>
        </label>

        {#if draft.perInstance}
          <label class="ee-field">
            <span class="ee-label">{t('env.defaultValue')}</span>
            <input
              class="ee-input mono selectable"
              bind:value={draft.defaultValue}
              spellcheck="false"
              placeholder={t('env.defaultValuePlaceholder') as string}
            />
            <span class="ee-hint">{t('env.defaultValueHint')}</span>
          </label>
        {/if}
      {/if}

      <label class="ee-toggle">
        <input type="checkbox" bind:checked={draft.enabled}/>
        <span>
          <span class="ee-toggle-name">{t('env.enabled')}</span>
          <span class="ee-hint">{t('env.enabledHint')}</span>
        </span>
      </label>
    </div>

    <div class="modal-foot">
      <div class="spacer"></div>
      <button class="btn ghost" on:click={() => dispatch('close')}>{t('common.cancel')}</button>
      <button class="btn primary" disabled={!canSave} on:click={commit}>{t('common.save')}</button>
    </div>
  </div>
</div>

<style>
  .ee-modal { width: min(520px, 94vw); --reveal-size: 30px; }


  .ee-input {
    width: 100%;
    box-sizing: border-box;
    background: var(--bg-0);
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-sm);
    padding: 8px 10px;
    font-size: 13px;
    color: var(--fg-0);
    font-family: var(--font-ui);
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .ee-input:focus { border-color: var(--accent-line); box-shadow: 0 0 0 3px var(--accent-weak); }
  .ee-input::placeholder { color: var(--fg-4); }
  .ee-input.mono { font-family: var(--font-mono); font-size: 12px; }
  .ee-input:disabled { opacity: 0.5; cursor: default; }

  .ee-field { display: flex; flex-direction: column; gap: 5px; margin-bottom: 14px; }

  .ee-label {
    font-size: 11px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--fg-3);
  }

  .ee-value-row { display: flex; align-items: flex-start; gap: 6px; }
  .ee-value-row .ee-input {
    flex: 1;
    min-width: var(--reveal-size);
    height: var(--reveal-size);
    min-height: var(--reveal-size);
    resize: vertical;
  }

  .ee-reveal {
    display: grid;
    place-items: center;
    width: var(--reveal-size);
    height: var(--reveal-size);
    flex-shrink: 0;
    padding: 0;
    background: transparent;
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-sm);
    color: var(--fg-3);
    cursor: pointer;
  }
  .ee-reveal:hover { background: var(--bg-2); color: var(--fg-0); }

  .ee-hint { font-size: 11px; color: var(--fg-4); line-height: 1.5; }
  .ee-error { font-size: 11px; color: var(--danger, oklch(0.62 0.18 15)); }

  .ee-input.invalid { border-color: var(--danger, oklch(0.62 0.18 15)); }

  .ee-toggle {
    display: flex;
    align-items: flex-start;
    gap: 9px;
    padding: 8px 0;
    cursor: pointer;
  }
  .ee-toggle span { display: flex; flex-direction: column; gap: 2px; }
  .ee-toggle-name { font-size: 12.5px; color: var(--fg-1); }
</style>
