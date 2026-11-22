<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * The AI assists Cairn offers outside the Agent step, and the prompt each one
   * asks with.
   *
   * The assists are listed on the left, the selected one edited on the right:
   * the CLI that answers it, optionally the model, and its prompt.
   *
   * Each feature picks the CLI that answers it and, optionally, the model. The
   * list is short on purpose: only a CLI that takes a JSON schema as a flag and
   * is held to it can serve an assist, since the answer is read back as fields
   * rather than as prose. The Agent step is the opposite - it runs whichever CLI
   * the user chose, and reads none of its output.
   */
  import { onMount, tick } from 'svelte';
  import { t } from '#lib/i18n';
  import Icon from '#lib/components/Icon.svelte';
  import ProviderLogo from '#lib/components/home/agents/ProviderLogo.svelte';
  import Select from '#lib/components/Select.svelte';
  import SplitPanel from '#lib/components/SplitPanel.svelte';
  import CopyButton from '#lib/components/CopyButton.svelte';
  import { AI_FEATURES, ASSIST_CLIS, MODEL_SUGGESTIONS, resolveAiFeature, type AiFeatureId } from '#lib/utils/home/ai-features';
  import { anyAssistCliInstalled, cliProviders, isAssistCliInstalled, loadCliProviders } from '#lib/stores/cli-providers';
  import { settings } from '#lib/stores/settings';
  import type { AiFeatureAssignment } from '#lib/services/settings-service';

  /** Assists that write text themselves first, then those that hand a prompt to the Agent step. */
  const ORDERED = [...AI_FEATURES.filter((f) => f.runsProvider), ...AI_FEATURES.filter((f) => !f.runsProvider)];

  let selectedId: AiFeatureId = ORDERED[0].id;
  let templateDraft = '';
  let draftFor: AiFeatureId | null = null;
  let templateArea: HTMLTextAreaElement | null = null;

  onMount(() => {
    void loadCliProviders();
  });

  $: labelOf = (id: string): string => $cliProviders.find((p) => p.id === id)?.label ?? id;
  $: assignments = $settings.aiFeatures ?? {};
  $: selected = AI_FEATURES.find((f) => f.id === selectedId) ?? ORDERED[0];
  $: resolved = resolveAiFeature(selected.id, assignments, $isAssistCliInstalled);
  /** The draft follows the selected assist until the user starts typing in it. */
  $: if (draftFor !== selected.id) {
    templateDraft = resolved.promptTemplate;
    draftFor = selected.id;
  }
  $: isDraftDirty = templateDraft !== resolved.promptTemplate;
  /** The placeholders the default prompt uses, offered as buttons under the editor. */
  $: variables = [...new Set(selected.defaultPromptTemplate.match(/\{\{[a-z.]+\}\}/gi) ?? [])];

  /**
   * Reactive rather than a plain function: the template only re-reads a call
   * when its arguments change, so a plain one kept the assignments it saw at
   * mount and a feature changed from here stopped refreshing its own entry.
   */
  $: assignmentOf = (id: AiFeatureId): AiFeatureAssignment =>
    assignments[id] ?? { providerId: '', model: '', promptTemplate: '' };

  $: isCustomTemplate = (id: AiFeatureId): boolean =>
    (assignmentOf(id).promptTemplate ?? '').trim() !== '';

  $: summaryOf = (id: AiFeatureId): string => {
    const feature = AI_FEATURES.find((f) => f.id === id);
    if (!feature?.runsProvider) return t('home.features.agentStep') as string;
    const entry = resolveAiFeature(id, assignments, $isAssistCliInstalled);
    return entry.model ? `${labelOf(entry.providerId)}, ${entry.model}` : labelOf(entry.providerId);
  };

  function setAssignment(id: AiFeatureId, fields: Partial<AiFeatureAssignment>) {
    const next = { ...assignmentOf(id), ...fields };
    void settings.save({ aiFeatures: { ...assignments, [id]: next } });
  }

  function select(id: AiFeatureId) {
    selectedId = id;
  }

  function saveTemplate() {
    const isDefault = templateDraft.trim() === selected.defaultPromptTemplate.trim();
    setAssignment(selected.id, { promptTemplate: isDefault ? '' : templateDraft });
  }

  function cancelTemplate() {
    templateDraft = resolved.promptTemplate;
  }

  function resetTemplate() {
    setAssignment(selected.id, { promptTemplate: '' });
    templateDraft = selected.defaultPromptTemplate;
  }

  /** Puts the variable where the caret is, and the caret right after it. */
  async function insertVariable(token: string) {
    const start = templateArea?.selectionStart ?? templateDraft.length;
    const end = templateArea?.selectionEnd ?? templateDraft.length;
    templateDraft = templateDraft.slice(0, start) + token + templateDraft.slice(end);
    await tick();
    templateArea?.focus();
    templateArea?.setSelectionRange(start + token.length, start + token.length);
  }
</script>

{#each ASSIST_CLIS as id (id)}
  <datalist id={`models-${id}`}>
    {#each MODEL_SUGGESTIONS[id] ?? [] as model (model)}
      <option value={model}></option>
    {/each}
  </datalist>
{/each}

<header class="ft-head">
  <h1>{t('home.features.title')}<span class="head-count">{AI_FEATURES.length}</span></h1>
</header>

{#if !$anyAssistCliInstalled}
  <div class="ft-banner">
    <Icon name="alert" size={14}/>
    <span>{t('home.features.noAssistCli')}</span>
  </div>
{/if}

<SplitPanel listWidth={256}>
  <svelte:fragment slot="list">
    <div class="ft-list">
      {#each [true, false] as runsProvider (runsProvider)}
        <h2 class="ft-group">{runsProvider ? t('home.features.groupWrites') : t('home.features.groupHandsOver')}</h2>
        {#each ORDERED.filter((f) => f.runsProvider === runsProvider) as feature (feature.id)}
          <button
            class="ft-item"
            class:is-active={selectedId === feature.id}
            aria-pressed={selectedId === feature.id}
            on:click={() => select(feature.id)}
          >
            <span class="ft-tile"><Icon name={feature.icon} size={14}/></span>
            <span class="ft-item-text">
              <span class="ft-item-name">{t(`home.features.defs.${feature.id}.label`)}</span>
              <span class="ft-item-sub">{summaryOf(feature.id)}</span>
            </span>
            {#if isCustomTemplate(feature.id)}
              <span class="ft-custom" title={t('home.features.customTemplate') as string}>
                <Icon name="edit" size={11}/>
              </span>
            {/if}
          </button>
        {/each}
      {/each}
    </div>
  </svelte:fragment>

  <div class="ft-detail-head">
    <span class="ft-tile is-large"><Icon name={selected.icon} size={18}/></span>
    <div class="ft-detail-title">
      <h2>{t(`home.features.defs.${selected.id}.label`)}</h2>
      <p>{t(`home.features.defs.${selected.id}.desc`)}</p>
    </div>
  </div>

  <div class="ft-detail-body feat-card">
    {#if selected.runsProvider}
      <section class="ft-section">
        <h3>{t('home.features.answeredBy')}</h3>
        <div class="ft-field">
          <span class="ft-label">{t('home.features.provider')}</span>
          <span class="feat-select">
            <span class="feat-logo">
              <ProviderLogo id={resolved.providerId} size={14} fallback={labelOf(resolved.providerId).slice(0, 1)}/>
            </span>
            <Select
              value={resolved.providerId}
              options={ASSIST_CLIS.map((id) => ({ value: id, label: labelOf(id) }))}
              ariaLabel={t('home.features.provider') as string}
              on:change={(e) => setAssignment(selected.id, { providerId: e.detail })}
            />
          </span>
        </div>
        <div class="ft-field">
          <label class="ft-label" for="ft-model">{t('home.features.model')}</label>
          <!-- The empty slot stands where the provider logo sits, so both fields line up. -->
          <span class="feat-select">
            <span class="feat-logo is-spacer"></span>
            <input
              id="ft-model"
              class="ft-input selectable"
              list={`models-${resolved.providerId}`}
              value={assignmentOf(selected.id).model ?? ''}
              placeholder={t('home.features.modelDefault') as string}
              on:change={(e) => setAssignment(selected.id, { model: e.currentTarget.value.trim() })}
            />
          </span>
        </div>
        {#if resolved.unavailable}
          <p class="ft-warn">
            <Icon name="alert" size={12}/>
            <span class="bad">{(t('home.features.assistCliMissing') as (name: string) => string)(labelOf(resolved.providerId))}</span>
          </p>
        {/if}
      </section>
    {:else}
      <p class="ft-note">
        <Icon name="agent" size={14}/>
        {t('home.features.handsToAgentNote')}
      </p>
    {/if}

    {#if selected.defaultPromptTemplate}
      <section class="ft-section ft-prompt">
        <div class="ft-section-head">
          <h3>{t('home.features.promptTemplate')}</h3>
          {#if isCustomTemplate(selected.id)}
            <span class="ft-badge">{t('home.features.customTemplate')}</span>
          {/if}
          <div class="spacer"></div>
          {#if isCustomTemplate(selected.id)}
            <button class="ft-link" on:click={resetTemplate}>
              <Icon name="undo" size={12}/> {t('home.features.resetTemplate')}
            </button>
          {/if}
          <CopyButton value={templateDraft} size={13}/>
        </div>
        <textarea
          class="ft-template selectable"
          bind:value={templateDraft}
          bind:this={templateArea}
          spellcheck="false"
          aria-label={t('home.features.promptTemplate') as string}
        ></textarea>
        {#if variables.length > 0}
          <div class="ft-vars">
            {#each variables as variable (variable)}
              <button class="ft-var" title={t('editProject.branchVarInsert') as string} on:click={() => insertVariable(variable)}>
                <code>{variable}</code>
              </button>
            {/each}
          </div>
        {/if}
      </section>
    {/if}
  </div>

  {#if isDraftDirty}
    <div class="ft-save-bar">
      <div class="spacer"></div>
      <button class="btn ghost" on:click={cancelTemplate}>{t('home.features.cancel')}</button>
      <button class="btn primary" on:click={saveTemplate}>{t('home.features.saveTemplate')}</button>
    </div>
  {/if}
</SplitPanel>

<style>
  .ft-head { margin-bottom: 32px; }
  .ft-head h1 {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0;
    font-family: var(--font-ui);
    font-size: 18px;
    font-weight: 600;
    color: var(--fg-0);
  }
  .head-count {
    padding: 1px 8px;
    font-size: 11.5px;
    font-weight: 400;
    line-height: 1.6;
    color: var(--fg-2);
    background: var(--bg-3);
    border-radius: 10px;
  }
  .ft-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 16px;
    padding: 9px 12px;
    border-radius: var(--r-sm);
    background: var(--danger-weak);
    font-size: 12px;
    color: var(--danger);
  }

  /* -- list -- */
  .ft-list {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-height: 0;
    padding: 8px 12px 12px;
    overflow-y: auto;
  }
  .ft-group {
    margin: 12px 10px 6px;
    font-size: 11.5px;
    font-weight: 500;
    color: var(--fg-3);
  }
  .ft-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-width: 0;
    flex-shrink: 0;
    padding: 7px 10px;
    border-radius: var(--r-sm);
    text-align: left;
    color: var(--fg-1);
  }
  .ft-item:hover { background: var(--bg-2); }
  .ft-item.is-active { background: var(--bg-2); color: var(--fg-0); }
  .ft-item-text { display: flex; flex: 1; flex-direction: column; min-width: 0; }
  .ft-item-name,
  .ft-item-sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ft-item-name { font-size: 13px; font-weight: 500; }
  .ft-item-sub { font-size: 11.5px; color: var(--fg-3); }
  .ft-custom { display: flex; flex: none; color: var(--fg-3); }
  .ft-tile {
    display: grid;
    flex: none;
    place-items: center;
    width: 28px;
    height: 28px;
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-sm);
    background: var(--bg-2);
    color: var(--fg-1);
  }
  .ft-tile.is-large { width: 40px; height: 40px; border-radius: var(--r-md); }

  /* -- detail -- */
  .ft-detail-head {
    display: flex;
    flex: none;
    align-items: center;
    gap: 12px;
    padding: 16px 24px;
    border-bottom: 1px solid var(--stroke-0);
  }
  .ft-detail-title { min-width: 0; }
  .ft-detail-title h2 { margin: 0; font-size: 15px; font-weight: 600; color: var(--fg-0); }
  .ft-detail-title p { margin: 3px 0 0; font-size: 12px; line-height: 1.5; color: var(--fg-3); }
  .ft-detail-body { display: flex; flex: 1; flex-direction: column; min-height: 0; overflow-y: auto; }

  .ft-section { padding: 20px 24px 6px; }
  .ft-section + .ft-section { border-top: 1px solid var(--stroke-0); }
  .ft-section h3 { margin: 0 0 16px; font-size: 13px; font-weight: 600; color: var(--fg-0); }
  .ft-section-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
  .ft-section-head h3 { margin: 0; }
  .ft-field {
    display: grid;
    grid-template-columns: 172px minmax(0, 1fr) 28px;
    align-items: center;
    column-gap: 12px;
    margin-bottom: 14px;
  }
  .ft-field > :nth-child(2) { grid-column: 2; }
  .ft-label { font-size: 12.5px; color: var(--fg-2); }
  .feat-select { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .feat-select :global(.select) { flex: 1; min-width: 0; }
  .feat-logo { display: flex; flex: none; align-items: center; justify-content: center; width: 16px; }
  .ft-input {
    width: 100%;
    box-sizing: border-box;
    height: 32px;
    padding: 0 10px;
    background: var(--bg-0);
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-sm);
    font-family: var(--font-ui);
    font-size: 13px;
    color: var(--fg-0);
    outline: none;
  }
  .ft-input:focus { border-color: var(--accent-line); }
  .ft-input::placeholder { color: var(--fg-4); opacity: 1; }
  .ft-warn { display: flex; align-items: center; gap: 6px; margin: 0 0 14px; font-size: 12px; }
  .bad { color: var(--danger); }
  .ft-note {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    padding: 16px 24px;
    font-size: 12.5px;
    color: var(--fg-2);
  }
  .ft-note + .ft-section { border-top: 1px solid var(--stroke-0); }

  .ft-prompt { display: flex; flex: 1; flex-direction: column; min-height: 260px; padding-bottom: 16px; }
  .ft-badge {
    padding: 0 7px;
    font-size: 11px;
    line-height: 18px;
    color: var(--fg-2);
    border: 1px solid var(--stroke-1);
    border-radius: 10px;
  }
  .spacer { flex: 1; }
  .ft-link { display: inline-flex; align-items: center; gap: 5px; padding: 0; font-size: 12.5px; color: var(--fg-2); }
  .ft-link:hover { color: var(--fg-0); }
  .ft-template {
    flex: 1;
    width: 100%;
    min-height: 200px;
    box-sizing: border-box;
    padding: 10px 12px;
    background: var(--bg-0);
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-sm);
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.6;
    color: var(--fg-1);
    resize: none;
    outline: none;
  }
  .ft-template:focus { border-color: var(--accent-line); }
  .ft-vars { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .ft-var {
    height: 24px;
    padding: 0 8px;
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-sm);
    background: var(--bg-2);
  }
  .ft-var code { font-family: var(--font-mono); font-size: 11.5px; color: var(--fg-1); }
  .ft-var:hover { border-color: var(--stroke-1); }

  .ft-save-bar {
    display: flex;
    flex: none;
    align-items: center;
    gap: 8px;
    padding: 12px 24px;
    border-top: 1px solid var(--stroke-0);
    background: var(--bg-0);
  }
</style>
