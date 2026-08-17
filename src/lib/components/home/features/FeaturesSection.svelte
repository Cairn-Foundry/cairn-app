<script lang="ts">
  /**
   * Which provider serves each AI assist. Only CLI providers are offered: they
   * explore the worktree themselves, which is what lets the commit assist read
   * the staged diff instead of being handed one, and they need no API key.
   */
  import { onMount } from 'svelte';
  import { t } from '$lib/i18n';
  import Icon from '$lib/components/Icon.svelte';
  import Select from '$lib/components/Select.svelte';
  import ProviderLogo from '$lib/components/home/agents/ProviderLogo.svelte';
  import { AI_FEATURES, assignableProviders, resolveAiFeature, type AiFeatureId } from '$lib/utils/home/ai-features';
  import { providerById } from '$lib/components/home/agents/providers-data';
  import { groupModelFamilies } from '$lib/utils/agent/model-families';
  import { aiProviders, loadAiProviders, modelsOf, providerCapabilities, refreshProviderModels } from '$lib/stores/ai-providers';
  import { settings } from '$lib/stores/settings';
  import type { AiFeatureAssignment } from '$lib/services/settings-service';

  let editingTemplate: AiFeatureId | null = null;
  let templateDraft = '';

  onMount(async () => {
    await loadAiProviders();
    for (const provider of assignableProviders($aiProviders)) {
      void refreshProviderModels(provider.id);
    }
  });

  $: available = assignableProviders($aiProviders);
  $: assignments = $settings.aiFeatures ?? {};

  function assignmentOf(id: AiFeatureId): AiFeatureAssignment {
    return assignments[id] ?? { providerId: '', model: '', promptTemplate: '' };
  }

  function setAssignment(id: AiFeatureId, fields: Partial<AiFeatureAssignment>) {
    const next = { ...assignmentOf(id), ...fields };
    void settings.save({ aiFeatures: { ...assignments, [id]: next } });
  }

  /** Changing provider drops the model with it: a model id belongs to one CLI. */
  function pickProvider(id: AiFeatureId, providerId: string) {
    setAssignment(id, { providerId, model: '' });
  }

  function providerOptions(): { value: string; label: string }[] {
    return [
      { value: '', label: t('home.features.useDefaultProvider') as string },
      ...available.map((p) => ({ value: p.id, label: p.name })),
    ];
  }

  /** Families first, then anything already pinned that the CLI no longer reports. */
  function modelOptions(providerId: string, current: string): { value: string; label: string }[] {
    const options = [{ value: '', label: t('home.features.useProviderModel') as string }];
    for (const family of groupModelFamilies(modelsOf(providerId, $providerCapabilities))) {
      options.push({ value: family.models[0].id, label: family.label });
    }
    if (current && !options.some((o) => o.value === current)) {
      options.push({ value: current, label: current });
    }
    return options;
  }

  function openTemplate(id: AiFeatureId) {
    templateDraft = resolveAiFeature(id, assignments, $aiProviders).promptTemplate;
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

  function isCustomTemplate(id: AiFeatureId): boolean {
    return (assignmentOf(id).promptTemplate ?? '').trim() !== '';
  }
</script>

<div class="features">
  {#if available.length === 0}
    <div class="feat-empty">
      <Icon name="alert" size={16}/>
      <span>{t('home.features.noProvider')}</span>
    </div>
  {/if}

  {#each AI_FEATURES as feature (feature.id)}
    {@const assignment = assignmentOf(feature.id)}
    {@const resolved = resolveAiFeature(feature.id, assignments, $aiProviders)}
    {@const def = providerById(resolved.providerId)}
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
        <div class="feat-fields">
          <div class="feat-field">
            <span class="feat-label">{t('home.features.provider')}</span>
            <Select
              value={assignment.providerId}
              options={providerOptions()}
              ariaLabel={t('home.features.provider') as string}
              disabled={available.length === 0}
              on:change={(e) => pickProvider(feature.id, e.detail)}
            />
          </div>
          <div class="feat-field">
            <span class="feat-label">{t('home.features.model')}</span>
            <Select
              value={assignment.model}
              options={modelOptions(resolved.providerId, assignment.model)}
              ariaLabel={t('home.features.model') as string}
              disabled={resolved.unavailable}
              on:change={(e) => setAssignment(feature.id, { model: e.detail })}
            />
          </div>
        </div>

        <div class="feat-resolved">
          {#if resolved.unavailable}
            <Icon name="alert" size={12}/>
            <span class="bad">{t('home.features.noProvider')}</span>
          {:else}
            <span class="feat-logo">
              <ProviderLogo id={resolved.providerId} size={13} fallback={def?.logo ?? ''}/>
            </span>
            <span>{def?.name ?? resolved.providerId}</span>
            <span class="dim">
              {resolved.model || t('home.features.useProviderModel')}
            </span>
          {/if}
        </div>
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

  .feat-badge {
    padding: 2px 7px;
    border: 1px solid var(--border);
    border-radius: 999px;
    font-size: 10px;
    color: var(--fg-3);
    white-space: nowrap;
  }

  .feat-fields {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }

  .feat-field {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }

  .feat-label {
    font-size: 11px;
    color: var(--fg-3);
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

  .feat-resolved .dim {
    color: var(--fg-3);
    font-family: var(--font-mono);
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
