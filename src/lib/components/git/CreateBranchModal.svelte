<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * Names a new branch cut from a starting point, then checks it out. Opened
   * from the branch list, the header branch switcher and a tag in the graph, so
   * the starting point may be a branch or a tag; the latter is kept among the
   * choices even though no branch list holds it.
   * Dispatches `close`, and `created` with the new branch name.
   */
  import { createEventDispatcher, onMount } from 'svelte';
  import Icon from '#lib/components/Icon.svelte';
  import Select from '#lib/components/Select.svelte';
  import Spinner from '#lib/components/Spinner.svelte';
  import { t } from '#lib/i18n';
  import { createBranch, git } from '#lib/stores/git';
  import { errorMessage } from '#lib/utils/error-message';

  export let from: string;
  export let name = '';

  const dispatch = createEventDispatcher<{ close: void; created: string }>();

  let error = '';
  let isCreating = false;
  let input: HTMLInputElement;

  $: branchChoices = [...$git.branches, ...$git.remoteBranches];
  $: choices = branchChoices.includes(from) ? branchChoices : [from, ...branchChoices];

  onMount(() => {
    input?.focus();
    input?.select();
  });

  function close() {
    if (!isCreating) dispatch('close');
  }

  async function confirm() {
    const trimmed = name.trim();
    if (!from || !trimmed || isCreating) return;
    isCreating = true;
    error = '';
    try {
      await createBranch(trimmed, from);
      dispatch('created', trimmed);
    } catch (e) {
      error = errorMessage(e);
    } finally {
      isCreating = false;
    }
  }
</script>

<svelte:window on:keydown={(e) => e.key === 'Escape' && close()}/>

<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
<div class="modal-backdrop" role="dialog" aria-modal="true" tabindex="-1" on:click={close} on:keydown={() => {}}>
  <div class="modal cb-modal" on:click|stopPropagation role="presentation">
    <div class="modal-head">
      <div>
        <div class="step-count">GIT</div>
        <h3>{t('git.branchList.create')}</h3>
      </div>
      <button class="icon-btn close" on:click={close} aria-label={t('common.close') as string}>
        <Icon name="x" size={16}/>
      </button>
    </div>
    <div class="modal-body">
      <label class="cb-base">
        <span>{t('git.branchList.createFrom')}</span>
        <Select
          bind:value={from}
          options={choices.map((b) => ({ value: b, label: b }))}
          ariaLabel={t('git.branchList.createFrom') as string}
        />
      </label>
      <input
        class="cb-input"
        bind:this={input}
        bind:value={name}
        aria-label={t('git.branchList.newName') as string}
        placeholder={t('git.branchNamePlaceholder') as string}
        on:keydown={(e) => e.key === 'Enter' && confirm()}
      />
      {#if error}<div class="cb-error">{error}</div>{/if}
    </div>
    <div class="modal-foot">
      <div class="spacer"></div>
      <button class="btn ghost" disabled={isCreating} on:click={close}>{t('common.cancel')}</button>
      <button class="btn primary" disabled={isCreating || !name.trim()} on:click={confirm}>
        {#if isCreating}<Spinner size={11}/>{:else}{t('git.branchList.createAction')}{/if}
      </button>
    </div>
  </div>
</div>

<style>
  .cb-modal { width: min(440px, 92vw); }
  .cb-base {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
    font-size: 12px;
    color: var(--fg-2);
  }
  .cb-base :global(.select) { flex: 1; min-width: 0; }
  .cb-input {
    background: var(--bg-0);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-sm);
    color: var(--fg-0);
    font-family: var(--font-mono);
    font-size: 12.5px;
    padding: 8px 10px;
    outline: none;
    transition: border-color .12s;
    width: 100%;
    box-sizing: border-box;
  }
  .cb-input:focus { border-color: var(--accent); }
  .cb-input::placeholder { color: var(--fg-4); }
  .cb-error {
    margin-top: 10px;
    font-size: 11.5px;
    color: var(--danger, #e5534b);
    white-space: pre-wrap;
  }
</style>
