<script lang="ts">
  /**
   * Modal renaming a project and changing its accent colour. Saving is disabled
   * until something actually differs from the current project.
   */
  import { createEventDispatcher, onMount } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import ProjectIntegrationsForm from '$lib/components/ProjectIntegrationsForm.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import ProjectColorPicker from '$lib/components/ProjectColorPicker.svelte';
  import { t } from '$lib/i18n';
  import ProjectPreviewPill from '$lib/components/ProjectPreviewPill.svelte';
  import { editProject } from '$lib/stores/project';
  import { bindingsByProject, EMPTY_BINDINGS, loadProjectIntegrations, saveProjectIntegrations } from '$lib/stores/integrations';
  import { getRemoteUrl } from '$lib/services/git-service';
  import type { Project } from '$lib/types/project';
  import type { ProjectIntegrations } from '$lib/types/integrations';

  export let project: Project;

  const dispatch = createEventDispatcher<{ close: void }>();

  let name = project.name;
  let color = project.color;
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
  $: canSave = name.trim().length > 0
    && (name.trim() !== project.name || color !== project.color || hasBindingChanges);

  async function save() {
    if (!canSave || loading) return;
    loading = true;
    error = '';
    try {
      if (name.trim() !== project.name || color !== project.color) {
        await editProject(project.id, name.trim(), color);
      }
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
    if (e.key === 'Enter' && canSave && !loading) save();
  }
</script>

<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
<div
  class="modal-backdrop"
  role="dialog"
  aria-modal="true"
  tabindex="-1"
  on:click={() => { if (!loading) dispatch('close'); }}
  on:keydown={handleKey}
>
  <div class="modal ep-modal" on:click|stopPropagation role="presentation">

    <div class="modal-head">
      <div>
        <div class="step-count">{t('editProject.heading')}</div>
        <h3>{t('editProject.subheading')}</h3>
      </div>
      <button class="icon-btn close" on:click={() => dispatch('close')} disabled={loading} aria-label={t('common.close') as string}>
        <Icon name="x" size={16}/>
      </button>
    </div>

    <div class="modal-body">
      <div class="form-section">
        <label class="ep-label" for="edit-name">
          {t('editProject.projectName')} <span class="req">*</span>
        </label>
        <input
          id="edit-name"
          class="ep-input"
          bind:value={name}
          placeholder={project.name}
          autocomplete="off"
        />
      </div>

      <div class="form-section">
        <div class="ep-label">{t('editProject.color')}</div>
        <ProjectColorPicker bind:color idSuffix="edit" />
      </div>

      <ProjectPreviewPill name={name || project.name} {color} />

      <div class="form-section bindings">
        <ProjectIntegrationsForm projectId={project.id} {remoteUrl} bind:bindings />
      </div>

      {#if error}
        <div class="ep-error" role="alert">
          <Icon name="info" size={14}/> {error}
        </div>
      {/if}
    </div>

    <div class="modal-foot">
      <div class="spacer"></div>
      <button class="btn ghost" on:click={() => dispatch('close')} disabled={loading}>{t('common.cancel')}</button>
      <button class="btn primary" disabled={!canSave || loading} on:click={save}>
        {#if loading}
          <Spinner /> {t('common.saving')}
        {:else}
          <Icon name="check" size={14}/> {t('editProject.saveChanges')}
        {/if}
      </button>
    </div>

  </div>
</div>

<style>
  .ep-modal { width: min(440px, 92vw); }

  .form-section { margin-bottom: 20px; }
  .form-section.bindings { margin-top: 20px; margin-bottom: 0; }
  .ep-label {
    display: block;
    font-size: 11px;
    font-weight: 700;
    color: var(--fg-3);
    letter-spacing: 0.07em;
    text-transform: uppercase;
    margin-bottom: 8px;
  }
  .req { color: var(--accent); }

  .ep-input {
    width: 100%;
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
  .ep-input:focus {
    border-color: var(--accent-line);
    box-shadow: 0 0 0 3px var(--accent-weak);
  }
  .ep-input::placeholder { color: var(--fg-4); opacity: 1; }




  .ep-error {
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
