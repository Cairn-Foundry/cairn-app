<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * The AI assists Cairn offers outside the Agent step, and the prompt each one
   * asks with.
   *
   * Each feature picks the CLI that answers it and, optionally, the model. The
   * list is short on purpose: only a CLI that takes a JSON schema as a flag and
   * is held to it can serve an assist, since the answer is read back as fields
   * rather than as prose. The Agent step is the opposite - it runs whichever CLI
   * the user chose, and reads none of its output.
   */
  import { onMount } from 'svelte';
  import { t } from '$lib/i18n';
  import Icon from '$lib/components/Icon.svelte';
  import ProviderLogo from '$lib/components/home/agents/ProviderLogo.svelte';
  import Select from '$lib/components/Select.svelte';
  import { AI_FEATURES, ASSIST_CLIS, MODEL_SUGGESTIONS, resolveAiFeature, type AiFeatureId } from '$lib/utils/home/ai-features';
  import { anyAssistCliInstalled, cliProviders, isAssistCliInstalled, loadCliProviders } from '$lib/stores/cli-providers';
  import { settings } from '$lib/stores/settings';
  import type { AiFeatureAssignment } from '$lib/services/settings-service';

  let editingTemplate: AiFeatureId | null = null;
  let templateDraft = '';

  onMount(() => {
    void loadCliProviders();
  });

  $: labelOf = (id: string): string => $cliProviders.find((p) => p.id === id)?.label ?? id;
  $: assignments = $settings.aiFeatures ?? {};

  /**
   * Reactive rather than a plain function: the template only re-reads a call
   * when its arguments change, so a plain one kept the assignments it saw at
   * mount and a feature changed from here stopped refreshing its own card.
   */
  $: assignmentOf = (id: AiFeatureId): AiFeatureAssignment =>
    assignments[id] ?? { providerId: '', model: '', promptTemplate: '' };

  function setAssignment(id: AiFeatureId, fields: Partial<AiFeatureAssignment>) {
    const next = { ...assignmentOf(id), ...fields };
    void settings.save({ aiFeatures: { ...assignments, [id]: next } });
  }

  function openTemplate(id: AiFeatureId) {
    templateDraft = resolveAiFeature(id, assignments, $isAssistCliInstalled).promptTemplate;
    editingTemplate = id;
  }

  function saveTemplate() {
    if (!editingTemplate) return;
    setAssignment(editingTemplate, { promptTemplate: templateDraft });
    editingTemplate = null;
  }

  function resetTemplate(id: AiFeatureId) {
    setAssignment(id, { promptTemplate: '' });
    templateDraft = AI_FEATURES.find((f) => f.id === id)?.defaultPromptTemplate ?? '';
  }

  $: isCustomTemplate = (id: AiFeatureId): boolean =>
    (assignmentOf(id).promptTemplate ?? '').trim() !== '';
</script>

<div class="features">
  {#if !$anyAssistCliInstalled}
    <div class="feat-empty">
      <Icon name="alert" size={16}/>
      <span>{t('home.features.noAssistCli')}</span>
    </div>
  {/if}

  {#each ASSIST_CLIS as id (id)}
    <datalist id={`models-${id}`}>
      {#each MODEL_SUGGESTIONS[id] ?? [] as model (model)}
        <option value={model}></option>
      {/each}
    </datalist>
  {/each}

  {#each AI_FEATURES as feature (feature.id)}
    {@const resolved = resolveAiFeature(feature.id, assignments, $isAssistCliInstalled)}
    <div class="feat-card">
      <div class="feat-head">
        <span class="feat-icon"><Icon name={feature.icon} size={16}/></span>
        <div class="feat-text">
          <span class="feat-name">{t(`home.features.defs.${feature.id}.label`)}</span>
          <span class="feat-desc">{t(`home.features.defs.${feature.id}.desc`)}</span>
        </div>
        {#if !feature.runsProvider}
          <span class="feat-badge">{t('home.features.handsToAgent')}</span>
        {/if}
      </div>

      {#if feature.runsProvider}
        <div class="feat-pickers">
          <label class="feat-field">
            <span class="feat-field-label">{t('home.features.provider')}</span>
            <span class="feat-select">
              <span class="feat-logo">
                <ProviderLogo id={resolved.providerId} size={13} fallback={labelOf(resolved.providerId).slice(0, 1)}/>
              </span>
              <Select
                value={resolved.providerId}
                options={ASSIST_CLIS.map((id) => ({ value: id, label: labelOf(id) }))}
                ariaLabel={t('home.features.provider') as string}
                on:change={(e) => setAssignment(feature.id, { providerId: e.detail })}
              />
            </span>
          </label>

          <label class="feat-field">
            <span class="feat-field-label">{t('home.features.model')}</span>
            <input
              class="selectable"
              list={`models-${resolved.providerId}`}
              value={assignmentOf(feature.id).model ?? ''}
              placeholder={t('home.features.modelDefault') as string}
              on:change={(e) => setAssignment(feature.id, { model: e.currentTarget.value.trim() })}
            />
          </label>
        </div>

        {#if resolved.unavailable}
          <div class="feat-resolved">
            <Icon name="alert" size={12}/>
            <span class="bad">{(t('home.features.assistCliMissing') as (name: string) => string)(labelOf(resolved.providerId))}</span>
          </div>
        {/if}
      {/if}

      {#if feature.defaultPromptTemplate}
        {#if editingTemplate === feature.id}
          <textarea
            class="feat-template selectable"
            rows="10"
            bind:value={templateDraft}
            aria-label={t('home.features.promptTemplate') as string}
          ></textarea>
          <div class="feat-template-hint">{t('home.features.promptPlaceholders')}</div>
          <div class="feat-actions">
            <button class="btn" on:click={saveTemplate}>
              <Icon name="check" size={12}/> {t('home.features.saveTemplate')}
            </button>
            <button class="btn ghost" on:click={() => (editingTemplate = null)}>
              {t('home.features.cancel')}
            </button>
            <div class="spacer"></div>
            <button class="btn ghost" on:click={() => resetTemplate(feature.id)}>
              <Icon name="undo" size={12}/> {t('home.features.resetTemplate')}
            </button>
          </div>
        {:else}
          <div class="feat-actions">
            <button class="btn ghost" on:click={() => openTemplate(feature.id)}>
              <Icon name="edit" size={12}/> {t('home.features.editTemplate')}
            </button>
            {#if isCustomTemplate(feature.id)}
              <span class="feat-badge">{t('home.features.customTemplate')}</span>
            {/if}
          </div>
        {/if}
      {/if}
    </div>
  {/each}
</div>

<style>
  .features {
    display: flex;
    flex-direction: column;
    gap: 12px;
    max-width: 720px;
  }

  .feat-empty {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--danger);
    font-size: 12px;
  }

  .feat-card {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg-1);
  }

  .feat-head {
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }

  .feat-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    flex: none;
    border-radius: 8px;
    background: var(--bg-2);
    color: var(--fg-2);
  }

  .feat-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }

  .feat-name {
    font-size: 13px;
    font-weight: 600;
  }

  .feat-desc {
    font-size: 12px;
    color: var(--fg-3);
  }

  .feat-pickers {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }

  .feat-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    flex: 1 1 180px;
  }

  .feat-field-label {
    font-size: 11px;
    color: var(--fg-3);
  }

  .feat-select {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  /* The logo sits beside the trigger, which takes the rest of the row. */
  .feat-select :global(.select) {
    flex: 1;
    min-width: 0;
  }

  .feat-field input {
    padding: 8px 10px;
    box-sizing: border-box;
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-sm);
    background: var(--bg-0);
    color: var(--fg-0);
    font-size: 13px;
    font-family: var(--font-ui);
  }

  .feat-field input:focus {
    outline: none;
    border-color: var(--accent-line);
    box-shadow: 0 0 0 3px var(--accent-weak);
  }

  .feat-badge {
    padding: 2px 7px;
    border: 1px solid var(--border);
    border-radius: 999px;
    font-size: 10px;
    color: var(--fg-3);
    white-space: nowrap;
  }

  .feat-resolved {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--fg-2);
  }

  .feat-logo {
    display: flex;
    align-items: center;
  }

  .feat-resolved .bad {
    color: var(--danger);
  }

  .feat-template {
    width: 100%;
    padding: 9px 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-0);
    color: var(--fg-1);
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.5;
    resize: vertical;
  }

  .feat-template:focus {
    outline: none;
    border-color: var(--accent);
  }

  .feat-template-hint {
    font-size: 11px;
    color: var(--fg-3);
    font-family: var(--font-mono);
  }

  .feat-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .spacer {
    flex: 1;
  }
</style>
