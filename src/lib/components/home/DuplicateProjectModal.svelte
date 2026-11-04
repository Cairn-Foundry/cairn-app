<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * Copies a project's folder on disk under a new name and location, and
   * registers the copy as a new project. Dispatches `close`.
   */
  import { createEventDispatcher } from 'svelte';
  import Icon from '#lib/components/Icon.svelte';
  import Spinner from '#lib/components/Spinner.svelte';
  import ProjectColorPicker from '#lib/components/ProjectColorPicker.svelte';
  import ProjectPreviewPill from '#lib/components/ProjectPreviewPill.svelte';
  import { duplicateProjectInStore } from '#lib/stores/project';
  import { t } from '#lib/i18n';
  import type { Project } from '#lib/types/project';

  export let project: Project;

  const dispatch = createEventDispatcher<{ close: void }>();

  const separator = project.path.includes('\\') && !project.path.includes('/') ? '\\' : '/';
  const segments = project.path.replace(/[\\/]+$/, '').split(/[\\/]/);
  const sourceFolder = segments.at(-1) ?? '';

  let name = (t('duplicateProject.defaultName') as (n: string) => string)(project.name);
  let color = project.color;
  let folderName = `${sourceFolder}-copy`;
  let destParent = segments.slice(0, -1).join(separator) || separator;
  let isCopying = false;
  let error = '';

  $: canSubmit = name.trim().length > 0 && folderName.trim().length > 0
    && !/[\\/]/.test(folderName) && destParent.trim().length > 0;
  $: destination = `${destParent.replace(/[\\/]+$/, '')}${separator}${folderName.trim()}`;

  async function pickDestination() {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const picked = await open({ directory: true, defaultPath: destParent });
    if (typeof picked === 'string') destParent = picked;
  }

  async function submit() {
    if (!canSubmit || isCopying) return;
    isCopying = true;
    error = '';
    try {
      await duplicateProjectInStore(project.id, {
        name: name.trim(),
        color,
        destParent: destParent.trim(),
        folderName: folderName.trim(),
      });
      dispatch('close');
    } catch (e) {
      error = String(e);
    } finally {
      isCopying = false;
    }
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && !isCopying) dispatch('close');
    if (e.key === 'Enter' && canSubmit) void submit();
  }
</script>

<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
<div
  class="modal-backdrop"
  role="dialog"
  aria-modal="true"
  tabindex="-1"
  on:click={() => { if (!isCopying) dispatch('close'); }}
  on:keydown={handleKey}
>
  <div class="modal dp-modal" on:click|stopPropagation role="presentation">
    <div class="modal-head">
      <div>
        <div class="step-count">{t('duplicateProject.heading')}</div>
        <h3>{(t('duplicateProject.title') as (n: string) => string)(project.name)}</h3>
      </div>
      <button class="icon-btn close" on:click={() => dispatch('close')} disabled={isCopying} aria-label={t('common.close') as string}>
        <Icon name="x" size={16}/>
      </button>
    </div>

    <div class="modal-body">
      <p class="dp-hint">{t('duplicateProject.hint')}</p>

      <div class="form-section">
        <label class="dp-label" for="dup-name">{t('editProject.projectName')} <span class="req">*</span></label>
        <input id="dup-name" class="dp-input" bind:value={name} disabled={isCopying} autocomplete="off"/>
      </div>

      <div class="form-section">
        <div class="dp-label">{t('editProject.color')}</div>
        <ProjectColorPicker bind:color idSuffix="duplicate" />
      </div>

      <div class="form-section">
        <label class="dp-label" for="dup-folder">{t('duplicateProject.folderName')} <span class="req">*</span></label>
        <input id="dup-folder" class="dp-input mono" bind:value={folderName} disabled={isCopying} autocomplete="off" spellcheck="false"/>
      </div>

      <div class="form-section">
        <label class="dp-label" for="dup-dest">{t('duplicateProject.destination')}</label>
        <div class="dp-row">
          <input id="dup-dest" class="dp-input mono" bind:value={destParent} disabled={isCopying} autocomplete="off" spellcheck="false"/>
          <button class="btn ghost" on:click={pickDestination} disabled={isCopying}>
            <Icon name="folder" size={14}/> {t('duplicateProject.browse')}
          </button>
        </div>
        <p class="dp-result">{t('duplicateProject.result')} <code class="selectable">{destination}</code></p>
      </div>

      <ProjectPreviewPill name={name || project.name} {color} />

      {#if error}
        <div class="dp-error" role="alert">
          <Icon name="info" size={14}/> {error}
        </div>
      {/if}
    </div>

    <div class="modal-foot">
      <div class="spacer"></div>
      <button class="btn ghost" on:click={() => dispatch('close')} disabled={isCopying}>{t('common.cancel')}</button>
      <button class="btn primary" disabled={!canSubmit || isCopying} aria-busy={isCopying} on:click={submit}>
        {#if isCopying}<Spinner size={12}/>{:else}<Icon name="copy" size={14}/>{/if}
        {t('duplicateProject.duplicate')}
      </button>
    </div>
  </div>
</div>

<style>
  .dp-modal { width: min(520px, 92vw); }
  .dp-hint {
    font-size: 13px;
    color: var(--fg-3);
    margin: 0 0 20px;
    line-height: 1.55;
  }
  .form-section { margin-bottom: 20px; }
  .dp-label {
    display: block;
    font-size: 11px;
    font-weight: 700;
    color: var(--fg-3);
    letter-spacing: 0.07em;
    text-transform: uppercase;
    margin-bottom: 8px;
  }
  .req { color: var(--accent); }
  .dp-row { display: flex; gap: 8px; }
  .dp-input {
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    background: var(--bg-0);
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-sm);
    padding: 10px 12px;
    font-size: 14px;
    color: var(--fg-0);
    font-family: var(--font-ui);
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .dp-input:focus {
    border-color: var(--accent-line);
    box-shadow: 0 0 0 3px var(--accent-weak);
  }
  .dp-input.mono { font-family: var(--font-mono); font-size: 13px; }
  .dp-result {
    margin: 8px 0 0;
    font-size: 12px;
    color: var(--fg-3);
    overflow-wrap: anywhere;
  }
  .dp-result code { color: var(--fg-1); }
  .dp-error {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin-top: 16px;
    padding: 10px 14px;
    background: var(--danger-weak, oklch(0.28 0.06 15));
    border: 1px solid var(--danger, oklch(0.62 0.18 15));
    border-radius: var(--r-md);
    font-size: 12px;
    color: var(--danger, oklch(0.75 0.18 15));
    line-height: 1.5;
  }
</style>
