<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * Edits a registered project, in three tabs drawn as the rail of the creation
   * modal: its name, colour and location; its git identity and branch names;
   * its integrations. Each tab of the rail recalls what it holds. Everything is
   * saved at once; dispatches `close`.
   */
  import { createEventDispatcher, onMount, tick } from 'svelte';
  import Icon from '#lib/components/Icon.svelte';
  import ProjectIntegrationsForm from '#lib/components/ProjectIntegrationsForm.svelte';
  import Spinner from '#lib/components/Spinner.svelte';
  import ProjectColorPicker from '#lib/components/ProjectColorPicker.svelte';
  import GitProfileSelect from '#lib/components/GitProfileSelect.svelte';
  import { t } from '#lib/i18n';
  import { editProject, relocateProjectInStore, setGitProfile } from '#lib/stores/project';
  import { settings } from '#lib/stores/settings';
  import { DEFAULT_BRANCH_TEMPLATE, renderBranchTemplate } from '#lib/utils/integrations/branch-template';
  import { bindingsByProject, EMPTY_BINDINGS, loadProjectIntegrations, saveProjectIntegrations } from '#lib/stores/integrations';
  import { getRemoteUrl } from '#lib/services/git-service';
  import type { Project } from '#lib/types/project';
  import type { ProjectIntegrations } from '#lib/types/integrations';

  type Tab = 'identity' | 'git' | 'integrations';

  export let project: Project;
  export let initialTab: Tab = 'identity';

  const dispatch = createEventDispatcher<{ close: void }>();

  const TABS: Tab[] = ['identity', 'git', 'integrations'];
  const TAB_ICONS: Record<Tab, string> = { identity: 'edit', git: 'branch', integrations: 'link' };

  let activeTab: Tab = initialTab;

  let name = project.name;
  let color = project.color;
  let path = project.path;
  let branchTemplate = project.branchTemplate ?? '';
  /** A profile deleted since it was picked reads as the default. */
  const initialProfileId = $settings.gitProfiles.some((p) => p.id === project.gitProfileId) ? project.gitProfileId ?? '' : '';
  let gitProfileId = initialProfileId;
  let loading = false;
  let error = '';
  let remoteUrl = '';
  let bindings: ProjectIntegrations = EMPTY_BINDINGS;
  let pristineBindings = JSON.stringify(EMPTY_BINDINGS);

  onMount(async () => {
    const [, remote] = await Promise.all([
      loadProjectIntegrations(project.id).catch(() => undefined),
      getRemoteUrl(project.path).catch(() => ''),
    ]);
    remoteUrl = remote;
    bindings = $bindingsByProject[project.id] ?? EMPTY_BINDINGS;
    pristineBindings = JSON.stringify(bindings);
  });

  $: hasBindingChanges = JSON.stringify(bindings) !== pristineBindings;
  $: hasProfileChange = gitProfileId !== initialProfileId;
  $: globalTemplate = $settings.branchTemplate?.trim() || DEFAULT_BRANCH_TEMPLATE;
  /** Empty means "no override": the project follows the global template again. */
  $: templateOverride = branchTemplate.trim() || null;
  $: hasTemplateChange = templateOverride !== (project.branchTemplate?.trim() || null);
  $: templatePreview = renderBranchTemplate(branchTemplate.trim() || globalTemplate, {
    key: 'APP-214',
    slug: 'drop-stale-sessions-on-logout',
    kind: 'Bug',
  });
  $: canSave = name.trim().length > 0
    && (name.trim() !== project.name || color !== project.color || path !== project.path || hasTemplateChange || hasProfileChange || hasBindingChanges);

  $: profileLabel = $settings.gitProfiles.find((p) => p.id === gitProfileId)?.label ?? (t('git.profileDefault') as string);
  $: linkedCount = [bindings.tracker, bindings.forge, bindings.ci].filter((b) => b !== null).length;
  $: summaries = {
    identity: name.trim() || project.name,
    git: profileLabel,
    integrations: linkedCount === 0
      ? t('addProject.noIntegration') as string
      : (t('addProject.linkedIntegrations') as (n: number) => string)(linkedCount),
  } satisfies Record<Tab, string>;

  const TEMPLATE_VARS = ['kind', 'key', 'slug'] as const;
  let templateInput: HTMLInputElement | null = null;

  /** Puts the variable where the caret is, and the caret right after it. */
  async function insertVariable(variable: (typeof TEMPLATE_VARS)[number]) {
    const token = `{{${variable}}}`;
    const start = templateInput?.selectionStart ?? branchTemplate.length;
    const end = templateInput?.selectionEnd ?? branchTemplate.length;
    branchTemplate = branchTemplate.slice(0, start) + token + branchTemplate.slice(end);
    await tick();
    templateInput?.focus();
    templateInput?.setSelectionRange(start + token.length, start + token.length);
  }

  async function pickLocation() {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const picked = await open({ directory: true, defaultPath: path });
    if (typeof picked === 'string') path = picked;
  }

  async function save() {
    if (!canSave || loading) return;
    loading = true;
    error = '';
    try {
      if (path !== project.path) await relocateProjectInStore(project.id, path);
      if (name.trim() !== project.name || color !== project.color || hasTemplateChange) {
        await editProject(project.id, name.trim(), color, templateOverride);
      }
      if (hasProfileChange) await setGitProfile(project.id, gitProfileId);
      if (hasBindingChanges) await saveProjectIntegrations(project.id, bindings);
      dispatch('close');
    } catch (err) {
      error = String(err);
    } finally {
      loading = false;
    }
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && !loading) dispatch('close');
    if (e.key === 'Enter' && (e.target as HTMLElement).closest('button')) return;
    if (e.key === 'Enter' && canSave && !loading) void save();
  }
</script>

<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
<div
  class="modal-backdrop"
  role="dialog"
  aria-modal="true"
  aria-labelledby="ep-title"
  tabindex="-1"
  on:click={() => { if (!loading) dispatch('close'); }}
  on:keydown={handleKey}
>
  <div class="modal ep-modal" on:click|stopPropagation role="presentation">

    <div class="modal-head ep-head">
      <h2 id="ep-title">{t('editProject.heading')}</h2>
      <button class="icon-btn close" on:click={() => dispatch('close')} disabled={loading} aria-label={t('common.close') as string}>
        <Icon name="x" size={16}/>
      </button>
    </div>

    <div class="ep-main">
      <div class="ep-tabs" role="tablist">
        {#each TABS as tab (tab)}
          <button
            class="ep-tab"
            class:active={activeTab === tab}
            role="tab"
            aria-selected={activeTab === tab}
            on:click={() => activeTab = tab}
          >
            <Icon name={TAB_ICONS[tab]} size={14}/>
            <span class="ep-tab-text">
              <span class="ep-tab-label">{t(`editProject.tabs.${tab}`)}</span>
              <span class="ep-tab-sub">
                {#if tab === 'identity'}<span class="ep-swatch" style="background: {color}"></span>{/if}
                <span class="ep-tab-value">{summaries[tab]}</span>
              </span>
            </span>
          </button>
        {/each}
      </div>

      <div class="modal-body ep-body" role="tabpanel">
        <h3>{t(`editProject.titles.${activeTab}`)}</h3>

        {#if activeTab === 'identity'}
          <div class="form-section">
            <label class="ep-label" for="edit-name">{t('editProject.projectName')}</label>
            <input id="edit-name" class="ep-input" bind:value={name} placeholder={project.name} autocomplete="off"/>
          </div>

          <div class="form-section">
            <div class="ep-label is-over-swatches">{t('editProject.color')}</div>
            <ProjectColorPicker bind:color idSuffix="edit" />
          </div>

          <div class="form-section">
            <label class="ep-label" for="edit-path">{t('editProject.location')}</label>
            <div class="path-row">
              <input id="edit-path" class="ep-input mono selectable" bind:value={path} spellcheck="false" autocomplete="off"/>
              <button class="btn" on:click={pickLocation} disabled={loading}>
                <Icon name="folder" size={14}/> {t('addProject.browse')}
              </button>
            </div>
            <p class="ep-field-hint">{t('editProject.locationHint')}</p>
          </div>
        {:else if activeTab === 'git'}
          <GitProfileSelect bind:value={gitProfileId} label={t('editProject.gitProfile') as string} hint={t('editProject.gitProfileHint') as string} />

          <div class="form-section">
            <label class="ep-label" for="edit-branch-template">{t('editProject.branchTemplate')}</label>
            <input
              id="edit-branch-template"
              class="ep-input mono"
              bind:value={branchTemplate}
              placeholder={globalTemplate}
              spellcheck="false"
              autocomplete="off"
              bind:this={templateInput}
            />
            <div class="ep-vars">
              {#each TEMPLATE_VARS as variable (variable)}
                <button
                  class="ep-var"
                  title={t('editProject.branchVarInsert') as string}
                  on:click={() => insertVariable(variable)}
                >
                  <code>{`{{${variable}}}`}</code>
                  <span>{t(`editProject.branchVars.${variable}`)}</span>
                </button>
              {/each}
            </div>
            <p class="ep-preview">
              {branchTemplate.trim() ? t('editProject.branchTemplatePreview') : t('editProject.branchTemplateGlobal')}
              <span class="selectable">{templatePreview}</span>
            </p>
          </div>
        {:else}
          <ProjectIntegrationsForm projectId={project.id} {remoteUrl} bind:bindings isTitled={false} />
        {/if}

        {#if error}
          <div class="ep-error" role="alert">
            <Icon name="info" size={14}/> {error}
          </div>
        {/if}
      </div>
    </div>

    <div class="modal-foot">
      <div class="spacer"></div>
      <button class="btn ghost" on:click={() => dispatch('close')} disabled={loading}>{t('common.cancel')}</button>
      <button class="btn primary" disabled={!canSave || loading} on:click={save}>
        {#if loading}<Spinner /> {t('common.saving')}{:else}{t('editProject.saveChanges')}{/if}
      </button>
    </div>

  </div>
</div>

<style>
  .ep-modal {
    width: min(760px, 92vw);
    height: min(560px, 86vh);
  }
  .ep-head { padding-block: 14px; }
  .ep-head h2 {
    margin: 0;
    font-family: var(--font-serif);
    font-size: 22px;
    font-weight: 400;
    line-height: 1;
    color: var(--fg-0);
  }

  .ep-main {
    flex: 1;
    display: grid;
    grid-template-columns: 216px minmax(0, 1fr);
    min-height: 0;
  }

  /* -- tabs rail -- */
  .ep-tabs {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 16px 10px;
    background: var(--bg-0);
    border-right: 1px solid var(--stroke-0);
  }
  .ep-tab {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    width: 100%;
    padding: 8px 12px;
    border-radius: var(--r-sm);
    color: var(--fg-2);
    text-align: left;
    box-shadow: inset 2px 0 0 transparent;
  }
  .ep-tab :global(.ic) { flex: none; margin-top: 2px; }
  .ep-tab:hover { background: var(--bg-2); color: var(--fg-0); }
  /* Square on the left, where the accent bar of the active tab runs. */
  .ep-tab.active {
    border-radius: 0 var(--r-sm) var(--r-sm) 0;
    background: var(--bg-2);
    color: var(--fg-0);
    box-shadow: inset 2px 0 0 var(--accent);
  }
  .ep-tab-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .ep-tab-label { font-size: 13px; line-height: 18px; }
  .ep-tab.active .ep-tab-label { font-weight: 600; }
  .ep-tab-sub { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 11.5px; color: var(--fg-3); }
  .ep-tab-value { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ep-swatch { flex: none; width: 7px; height: 7px; border-radius: 2px; }

  /* -- content -- */
  .ep-body { padding: 24px 32px; }
  .ep-body h3 { margin: 0 0 20px; font-size: 15px; font-weight: 600; color: var(--fg-0); }
  .form-section { margin-bottom: 24px; }
  .ep-label {
    display: block;
    margin-bottom: 10px;
    font-size: 12px;
    font-weight: 500;
    color: var(--fg-2);
  }
  .ep-label.is-over-swatches { margin-bottom: 14px; }
  .ep-input {
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
  .ep-input:focus { border-color: var(--accent-line); }
  .ep-input::placeholder { color: var(--fg-4); opacity: 1; }
  .ep-input.mono { font-family: var(--font-mono); font-size: 12.5px; }
  .path-row { display: flex; gap: 8px; }
  .path-row .btn { flex: none; height: 32px; }
  .ep-field-hint { margin: 8px 0 0; font-size: 12px; line-height: 1.5; color: var(--fg-3); }
  .ep-vars { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .ep-var {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 24px;
    padding: 0 8px;
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-sm);
    background: var(--bg-2);
    font-size: 12px;
    color: var(--fg-3);
  }
  .ep-var code { font-family: var(--font-mono); font-size: 11.5px; color: var(--fg-1); }
  .ep-var:hover { border-color: var(--stroke-1); color: var(--fg-1); }
  .ep-preview {
    margin: 12px 0 0;
    font-size: 12px;
    color: var(--fg-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ep-preview span { font-family: var(--font-mono); color: var(--fg-1); }

  .ep-error {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin-top: 16px;
    padding: 10px 12px;
    background: var(--danger-weak);
    border: 1px solid var(--danger);
    border-radius: var(--r-sm);
    font-size: 12px;
    line-height: 1.5;
    color: var(--danger);
  }
</style>
