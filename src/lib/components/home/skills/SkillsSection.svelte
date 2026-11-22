<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * Skill editor: browse skills by scope and provider, edit a draft of the SKILL.md frontmatter
   * and body, and manage the bundled resource files. The files are only written on save.
   */
  import { onMount } from 'svelte';
  import { t } from '#lib/i18n';
  import Icon from '#lib/components/Icon.svelte';
  import Select from '#lib/components/Select.svelte';
  import SearchInput from '#lib/components/SearchInput.svelte';
  import Spinner from '#lib/components/Spinner.svelte';
  import Skeleton from '#lib/components/Skeleton.svelte';
  import CopyButton from '#lib/components/CopyButton.svelte';
  import DeleteSkillModal from './DeleteSkillModal.svelte';
  import SplitPanel from '#lib/components/SplitPanel.svelte';
  import SearchEmpty from '#lib/components/SearchEmpty.svelte';
  import ProviderPicker from '#lib/components/home/ProviderPicker.svelte';
  import ProviderChips from '#lib/components/home/ProviderChips.svelte';
  import ProviderLogo from '#lib/components/home/agents/ProviderLogo.svelte';
  import { projects, loadProjects } from '#lib/stores/project';
  import { skills, skillsError, skillsLoading, loadSkills } from '#lib/stores/skills';
  import {
    addSkillResources, deleteSkill, deleteSkillResource, duplicateSkill, saveSkill,
    type Skill, type SkillScope,
  } from '#lib/services/skill-service';
  import { revealInFileManager } from '#lib/services/file-service';
  import { KNOWN_TOOLS } from '#lib/utils/agent/tools';
  import { slugifySkill, MAX_DESCRIPTION } from '#lib/utils/home/skills';
  import { cliProviders, loadCliProviders } from '#lib/stores/cli-providers';
  import { reachedProviders } from '#lib/services/cli-provider-service';
  import { sortProviders } from '#lib/utils/home/cli-providers';
  import type { CliProviderId } from '#lib/services/cli-provider-service';

  /** The editor's own copy: a file is only touched when Save is pressed. */
  interface Draft {
    name: string;
    description: string;
    whenToUse: string;
    allowedTools: string[];
    paths: string;
    model: string;
    license: string;
    disableModelInvocation: boolean;
    extraFrontmatter: string;
    body: string;
    scope: SkillScope;
    projectId: string;
    targets: CliProviderId[];
  }

  type Filter = 'all' | SkillScope;

  const FILTERS: Filter[] = ['all', 'global', 'project', 'plugin'];

  let selectedPath: string | null = null;
  let search = '';
  let scopeFilter: Filter = 'all';
  let draft: Draft | null = null;
  let pristine = '';
  let saving = false;
  let error = '';
  let toolDraft = '';
  let advancedOpen = false;
  let deleteTarget: Skill | null = null;
  let busyResource = '';
  let providerFilter: CliProviderId | 'all' = 'all';

  onMount(async () => {
    await Promise.all([loadProjects(), loadCliProviders()]);
    await loadSkills();
    if (!selectedPath) select($skills.find((s) => !s.readOnly) ?? $skills[0] ?? null);
  });

  $: selected = $skills.find((s) => s.path === selectedPath) ?? null;

  $: query = search.trim().toLowerCase();
  $: visible = $skills.filter((skill) => {
    if (scopeFilter !== 'all' && skill.scope !== scopeFilter) return false;
    if (providerFilter !== 'all' && !skill.providers.includes(providerFilter)) return false;
    if (!query) return true;
    return `${skill.name} ${skill.description} ${skill.projectName}`.toLowerCase().includes(query);
  });

  $: groups = (['global', 'project', 'plugin'] as SkillScope[])
    .map((scope) => ({ scope, items: visible.filter((s) => s.scope === scope) }))
    .filter((group) => group.items.length > 0);

  $: counts = {
    all: $skills.length,
    global: $skills.filter((s) => s.scope === 'global').length,
    project: $skills.filter((s) => s.scope === 'project').length,
    plugin: $skills.filter((s) => s.scope === 'plugin').length,
  };

  $: dirty = draft !== null && JSON.stringify(draft) !== pristine;
  $: slug = draft ? slugifySkill(draft.name) : '';
  $: nameClash = draft !== null && slug !== ''
    && $skills.some((s) =>
      s.path !== selectedPath
      && s.scope === draft!.scope
      && s.projectId === draft!.projectId
      && s.name === slug);
  $: descriptionOver = (draft?.description.length ?? 0) > MAX_DESCRIPTION;

  $: projectOptions = $projects.map((p) => ({ value: p.id, label: p.name }));
  $: scopeOptions = [
    { value: 'global', label: t('skills.scope.global') as string },
    ...($projects.length > 0 ? [{ value: 'project', label: t('skills.scope.project') as string }] : []),
  ];

  /** Copies a skill into an editable draft, arrays included so edits stay local. */
  function toDraft(skill: Skill): Draft {
    return {
      name: skill.name,
      description: skill.description,
      whenToUse: skill.whenToUse,
      allowedTools: [...skill.allowedTools],
      paths: skill.paths,
      model: skill.model,
      license: skill.license,
      disableModelInvocation: skill.disableModelInvocation,
      extraFrontmatter: skill.extraFrontmatter,
      body: skill.body,
      scope: skill.scope,
      projectId: skill.projectId,
      targets: sortProviders(skill.providers),
    };
  }

  function reset() {
    draft = null;
    pristine = '';
    selectedPath = null;
  }

  /** Opens a skill in the editor and records the pristine copy the dirty flag compares against. */
  function select(skill: Skill | null) {
    error = '';
    toolDraft = '';
    advancedOpen = false;
    if (!skill) {
      reset();
      return;
    }
    selectedPath = skill.path;
    draft = toDraft(skill);
    pristine = JSON.stringify(draft);
  }

  function revert() {
    if (selected) select(selected);
  }

  /** Starts a blank draft, defaulting its scope and target to whatever the list is filtered on. */
  function create() {
    const scope: SkillScope = $projects.length > 0 && scopeFilter === 'project' ? 'project' : 'global';
    draft = {
      name: '',
      description: '',
      whenToUse: '',
      allowedTools: [],
      paths: '',
      model: '',
      license: '',
      disableModelInvocation: false,
      extraFrontmatter: '',
      body: `# ${t('skills.newBodyHeading')}\n\n${t('skills.newBodyPlaceholder')}\n`,
      scope,
      projectId: scope === 'project' ? ($projects[0]?.id ?? '') : '',
      targets: providerFilter === 'all' ? ['claude-code'] : [providerFilter],
    };
    pristine = '';
    selectedPath = null;
    search = '';
    error = '';
  }

  /** Writes SKILL.md to every targeted location, then reselects it from the reloaded list. */
  async function save() {
    if (!draft || !slug || nameClash || draft.targets.length === 0) return;
    saving = true;
    error = '';
    try {
      const project = $projects.find((p) => p.id === draft!.projectId);
      const paths = await saveSkill({
        originalPaths: selected?.locations.map((l) => l.path) ?? [],
        targets: draft.targets,
        scope: draft.scope,
        projectId: draft.scope === 'project' ? draft.projectId : '',
        projectPath: draft.scope === 'project' ? (project?.path ?? '') : '',
        name: draft.name,
        description: draft.description,
        whenToUse: draft.whenToUse,
        allowedTools: draft.allowedTools,
        paths: draft.paths,
        model: draft.model,
        license: draft.license,
        disableModelInvocation: draft.disableModelInvocation,
        extraFrontmatter: draft.extraFrontmatter,
        body: draft.body,
      });
      await loadSkills();
      select($skills.find((s) => paths.includes(s.path)) ?? null);
    } catch (e) {
      error = String(e);
    } finally {
      saving = false;
    }
  }

  async function duplicate(skill: Skill) {
    try {
      const path = await duplicateSkill(
        skill.path,
        (t('skills.copyOf') as (n: string) => string)(skill.name),
      );
      await loadSkills();
      select($skills.find((s) => s.path === path) ?? null);
    } catch (e) {
      error = String(e);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const gone = deleteTarget.locations.map((l) => l.path);
    deleteTarget = null;
    try {
      await deleteSkill(gone);
      await loadSkills();
      if (selectedPath && gone.includes(selectedPath)) select($skills.find((s) => !s.readOnly) ?? null);
    } catch (e) {
      error = String(e);
    }
  }

  function addTool(raw: string) {
    if (!draft) return;
    const tool = raw.trim();
    if (!tool || draft.allowedTools.includes(tool)) return;
    draft.allowedTools = [...draft.allowedTools, tool];
    toolDraft = '';
  }

  function removeTool(tool: string) {
    if (!draft) return;
    draft.allowedTools = draft.allowedTools.filter((x) => x !== tool);
  }

  /** Copies files picked in the native dialog into the skill directory. */
  async function pickResources() {
    if (!selected) return;
    const { open } = await import('@tauri-apps/plugin-dialog');
    const picked = await open({ multiple: true, directory: false });
    if (!picked) return;
    busyResource = 'add';
    try {
      await addSkillResources(selected.path, Array.isArray(picked) ? picked : [picked]);
      await loadSkills();
    } catch (e) {
      error = String(e);
    } finally {
      busyResource = '';
    }
  }

  async function removeResource(path: string) {
    if (!selected) return;
    busyResource = path;
    try {
      await deleteSkillResource(selected.path, path);
      await loadSkills();
    } catch (e) {
      error = String(e);
    } finally {
      busyResource = '';
    }
  }

  /** Names the owner of the skill: its plugin, its project, or global. */
  function scopeLabel(skill: Skill): string {
    if (skill.scope === 'plugin') return skill.plugin;
    if (skill.scope === 'project') return skill.projectName;
    return t('skills.scope.global') as string;
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  $: toolSuggestions = KNOWN_TOOLS.filter((tool) => !draft?.allowedTools.includes(tool));

  /**
   * Which agents a save would actually reach: the registry answers, because a
   * write location is often read by agents that were never picked, and the
   * answer has to follow the ticks rather than the last saved state.
   */
  let reached: CliProviderId[] = [];
  $: void refreshReach(draft?.scope, $projects.find((p) => p.id === draft?.projectId)?.path ?? '', draft?.targets ?? []);

  async function refreshReach(
    scope: string | undefined,
    projectPath: string,
    targets: CliProviderId[],
  ) {
    if (!scope || targets.length === 0) {
      reached = [];
      return;
    }
    reached = await reachedProviders('skill', scope, projectPath, targets);
  }

  /** An agent with no skills directory in this scope cannot be a target. */
  $: unavailable = draft === null
    ? {}
    : Object.fromEntries(
        $cliProviders
          .filter((p) => draft!.scope === 'project' && !draft!.projectId)
          .map((p) => [p.id, t('skills.scope.needsProject') as string]),
      );

  function setTargets(next: CliProviderId[]) {
    if (draft) draft.targets = next;
  }

  function filterLabel(key: Filter): string {
    return (key === 'all' ? t('skills.filter.all') : t(`skills.scope.${key}`)) as string;
  }

  function setScope(scope: SkillScope) {
    if (!draft) return;
    draft.scope = scope;
    if (scope === 'project' && !draft.projectId) draft.projectId = $projects[0]?.id ?? '';
  }

  function setProject(id: string) {
    if (!draft) return;
    draft.projectId = id;
  }
</script>

{#if !$skillsLoading && $skills.length === 0 && draft === null}
  <header class="page-head"><h1>{t('skills.title')}</h1></header>
  <section class="page-empty">
    <Icon name="book" size={22}/>
    <h2>{t('skills.emptyTitle')}</h2>
    <p>{t('skills.emptyDesc')}</p>
    <button class="btn primary new-skill" on:click={create}>
      <Icon name="plus" size={12}/> {t('skills.new')}
    </button>
  </section>
{:else}
<SplitPanel title={t('skills.title') as string} count={$skills.length}>
  <svelte:fragment slot="list">
    <div class="list-tools">
      <SearchInput bind:value={search} placeholder={t('skills.searchPlaceholder') as string}/>
      <div class="filters">
        {#each FILTERS as key (key)}
          {#if key === 'all' || counts[key] > 0}
            <button
              class="chip"
              class:active={scopeFilter === key}
              aria-pressed={scopeFilter === key}
              on:click={() => scopeFilter = key}
            >
              {filterLabel(key)}<span class="chip-count">{counts[key]}</span>
            </button>
          {/if}
        {/each}
        {#each $cliProviders as provider (provider.id)}
          {@const count = $skills.filter((s) => s.providers.includes(provider.id)).length}
          {#if count > 0 && count < $skills.length}
            <button
              class="chip"
              class:active={providerFilter === provider.id}
              aria-pressed={providerFilter === provider.id}
              title={provider.label}
              on:click={() => providerFilter = providerFilter === provider.id ? 'all' : provider.id}
            >
              <ProviderLogo id={provider.id} size={11} fallback={provider.label.slice(0, 1)}/>
              <span class="chip-count">{count}</span>
            </button>
          {/if}
        {/each}
      </div>
    </div>

    <div class="list-items">
      {#if $skillsLoading && $skills.length === 0}
        <Skeleton lines={4} height={36} gap={6}/>
      {:else}
        {#each groups as group (group.scope)}
          <h2 class="group-label">{t(`skills.scope.${group.scope}`)}</h2>
          {#each group.items as skill (skill.path)}
            <button
              class="ag-item"
              class:is-active={selectedPath === skill.path}
              aria-pressed={selectedPath === skill.path}
              on:click={() => select(skill)}
            >
              <span class="tile"><Icon name={skill.readOnly ? 'lock' : 'book'} size={13}/></span>
              <span class="ag-item-text">
                <span class="ag-item-name">{skill.name}</span>
                <span class="ag-item-sub">{skill.scope === 'global' ? skill.description : scopeLabel(skill)}</span>
              </span>
            </button>
          {/each}
        {/each}
        {#if visible.length === 0 && $skills.length > 0}
          <SearchEmpty
            isCompact
            title={t('skills.noResults') as string}
            text={(query ? (t('skills.noResultsText') as (q: string) => string)(search.trim()) : t('skills.noResultsFiltered')) as string}
            clearLabel={(query ? t('common.clearSearch') : t('skills.clearFilters')) as string}
            on:clear={() => { search = ''; scopeFilter = 'all'; providerFilter = 'all'; }}
          />
        {/if}
        {#if draft && selectedPath === null}
          <button class="ag-item is-active" aria-pressed="true">
            <span class="tile"><Icon name="book" size={13}/></span>
            <span class="ag-item-text">
              <span class="ag-item-name">{slug || t('skills.new')}</span>
              <span class="ag-item-sub">{t('skills.new')}</span>
            </span>
          </button>
        {:else if visible.length > 0}
          <button class="ag-item new-skill" on:click={create}>
            <span class="tile is-dashed"><Icon name="plus" size={14}/></span>
            <span class="ag-item-name">{t('skills.new')}</span>
          </button>
        {/if}
      {/if}
    </div>
  </svelte:fragment>

  {#if draft === null}
    <div class="detail-none">
      <span class="none-tiles" aria-hidden="true">
        {#each $skills.slice(0, 3) as skill (skill.path)}
          <span class="tile is-large"><Icon name="book" size={16}/></span>
        {/each}
      </span>
      <h2>{t('skills.pickTitle')}</h2>
      <p>{t('skills.pickDesc')}</p>
      <button class="btn" on:click={create}>
        <Icon name="plus" size={12}/> {t('skills.new')}
      </button>
    </div>
  {:else}
    {@const readOnly = selected?.readOnly ?? false}

    <div class="detail-head">
      <span class="tile is-large"><Icon name={readOnly ? 'lock' : 'book'} size={18}/></span>
      <div class="detail-title">
        <div class="title-row">
          <h2>{slug || t('skills.new')}</h2>
          {#if slug}<code class="invoke selectable" title={t('skills.invokeHint') as string}>/{slug}</code>{/if}
        </div>
        <p>
          {#if readOnly}
            {(t('skills.pluginReadOnly') as (p: string) => string)(selected?.plugin ?? '')}
          {:else}
            {draft.scope === 'project' ? ($projects.find((p) => p.id === draft?.projectId)?.name ?? '') : t('skills.scope.global')}
          {/if}
        </p>
      </div>
      {#if selected}
        <div class="head-actions">
          {#if !readOnly}
            <button class="btn ghost icon-only" on:click={() => selected && duplicate(selected)} title={t('skills.duplicate') as string} aria-label={t('skills.duplicate') as string}>
              <Icon name="copy" size={13}/>
            </button>
          {/if}
          <button class="btn ghost icon-only" on:click={() => selected && revealInFileManager(selected.path)} title={t('skills.reveal') as string} aria-label={t('skills.reveal') as string}>
            <Icon name="folder-open" size={13}/>
          </button>
          {#if !readOnly}
            <button class="btn ghost icon-only delete" on:click={() => deleteTarget = selected} title={t('skills.delete.heading') as string} aria-label={t('skills.delete.heading') as string}>
              <Icon name="trash" size={13}/>
            </button>
          {/if}
        </div>
      {/if}
    </div>

    <div class="detail-body">
      <section class="section">
        <h3>{t('skills.groups.discovery')}</h3>

        <div class="field">
          <label class="label" for="sk-name">{t('skills.fields.name')}</label>
          <div class="control">
            <input
              id="sk-name"
              class="input name-input selectable"
              type="text"
              disabled={readOnly}
              placeholder={t('skills.fields.namePlaceholder') as string}
              bind:value={draft.name}
            />
            {#if nameClash}<span class="hint bad">{t('skills.nameClash')}</span>{/if}
          </div>
        </div>

        <div class="field">
          <label class="label" for="sk-desc">{t('skills.fields.description')}</label>
          <div class="control">
            <textarea
              id="sk-desc"
              class="input textarea selectable"
              rows="3"
              disabled={readOnly}
              placeholder={t('skills.fields.descriptionPlaceholder') as string}
              bind:value={draft.description}
            ></textarea>
            <div class="control-foot">
              {#if draft.description.trim() === ''}
                <span class="hint warn">{t('skills.fields.descriptionMissing')}</span>
              {:else if descriptionOver}
                <span class="hint bad">{t('skills.fields.descriptionTooLong')}</span>
              {:else}
                <span class="hint">{t('skills.fields.descriptionHint')}</span>
              {/if}
              <span class="counter" class:bad={descriptionOver}>{draft.description.length} / {MAX_DESCRIPTION}</span>
            </div>
          </div>
        </div>

        <div class="field">
          <label class="label" for="sk-when">{t('skills.fields.whenToUse')}</label>
          <textarea
            id="sk-when"
            class="input textarea selectable"
            rows="2"
            disabled={readOnly}
            placeholder={t('skills.fields.whenToUsePlaceholder') as string}
            bind:value={draft.whenToUse}
          ></textarea>
        </div>

        <div class="field">
          <label class="label" for="sk-paths">{t('skills.fields.paths')}</label>
          <div class="control">
            <input
              id="sk-paths"
              class="input mono selectable"
              type="text"
              disabled={readOnly}
              placeholder="**/*.ts, **/migrations/**"
              bind:value={draft.paths}
            />
            <span class="hint">{t('skills.fields.pathsHint')}</span>
          </div>
        </div>

        <div class="field">
          <span class="label">{t('skills.fields.manualOnly')}</span>
          <div class="toggle-row">
            <label class="ag-toggle">
              <input type="checkbox" disabled={readOnly} bind:checked={draft.disableModelInvocation}/>
              <span class="ag-toggle-track"><span class="ag-toggle-thumb"></span></span>
            </label>
            <span class="hint">{t('skills.fields.manualOnlyHint')}</span>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="section-head">
          <h3>{t('skills.fields.body')}</h3>
          <div class="spacer"></div>
          <span class="counter">
            {(t('skills.bodyStats') as (w: number, l: number) => string)(
              draft.body.trim() ? draft.body.trim().split(/\s+/).length : 0,
              draft.body.split('\n').length,
            )}
          </span>
          <CopyButton value={draft.body} size={13}/>
        </div>
        <textarea
          id="sk-body"
          class="input textarea body-input selectable"
          spellcheck="false"
          disabled={readOnly}
          aria-label={t('skills.fields.body') as string}
          placeholder={t('skills.fields.bodyPlaceholder') as string}
          bind:value={draft.body}
        ></textarea>
      </section>

      <section class="section">
        <h3>{t('skills.groups.tools')}</h3>
        <div class="field">
          <span class="label">{t('skills.fields.allowedTools')}</span>
          <div class="control">
            {#if !readOnly}
              <div class="inline-row">
                <input
                  class="input selectable"
                  type="text"
                  list="skill-tools"
                  placeholder={(draft.allowedTools.length === 0 ? t('skills.fields.allowedToolsEmpty') : t('skills.fields.allowedToolsPlaceholder')) as string}
                  bind:value={toolDraft}
                  on:keydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTool(toolDraft); } }}
                />
                <datalist id="skill-tools">
                  {#each toolSuggestions as tool}<option value={tool}></option>{/each}
                </datalist>
                <button class="btn" on:click={() => addTool(toolDraft)} disabled={!toolDraft.trim()}>
                  <Icon name="plus" size={12}/> {t('common.add')}
                </button>
              </div>
            {/if}
            {#if draft.allowedTools.length > 0}
              <div class="tool-chips">
                {#each draft.allowedTools as tool (tool)}
                  <span class="tool-chip">
                    <code>{tool}</code>
                    {#if !readOnly}
                      <button on:click={() => removeTool(tool)} aria-label={t('common.remove') as string}>
                        <Icon name="x" size={9}/>
                      </button>
                    {/if}
                  </span>
                {/each}
              </div>
            {:else if readOnly}
              <span class="hint">{t('skills.fields.allowedToolsEmpty')}</span>
            {/if}
          </div>
        </div>
      </section>

      {#if selected}
        <section class="section">
          <div class="section-head">
            <h3>{t('skills.files.title')}</h3>
            <div class="spacer"></div>
            {#if !readOnly}
              <button class="btn add-files" on:click={pickResources} disabled={busyResource === 'add'}>
                {#if busyResource === 'add'}<Spinner size={11}/>{:else}<Icon name="plus" size={12}/>{/if}
                {t('skills.files.add')}
              </button>
            {/if}
          </div>
          {#if selected.resources.length > 0}
            <div class="resources">
              {#each selected.resources as resource (resource.path)}
                <div class="resource">
                  <Icon name="file" size={13}/>
                  <span class="resource-name selectable">{resource.name}</span>
                  <span class="resource-size">{formatSize(resource.size)}</span>
                  {#if !readOnly}
                    <button
                      class="btn ghost icon-only delete"
                      on:click={() => removeResource(resource.path)}
                      disabled={busyResource === resource.path}
                      title={t('common.remove') as string}
                      aria-label={t('common.remove') as string}
                    >
                      {#if busyResource === resource.path}<Spinner size={11}/>{:else}<Icon name="trash" size={12}/>{/if}
                    </button>
                  {/if}
                </div>
              {/each}
            </div>
          {:else}
            <p class="hint section-note">{t('skills.files.empty')}</p>
          {/if}
        </section>
      {/if}

      <section class="section">
        <h3>{t('skills.groups.location')}</h3>
        <div class="field">
          <span class="label">{t('skills.fields.scope')}</span>
          <div class="control">
            {#if readOnly}
              <span class="value">{selected?.plugin}</span>
            {:else}
              <Select
                value={draft.scope}
                options={scopeOptions}
                ariaLabel={t('skills.fields.scope') as string}
                on:change={(e) => setScope(e.detail as SkillScope)}
              />
              <span class="hint">
                {draft.scope === 'global' ? t('skills.scope.globalHint') : t('skills.scope.projectHint')}
              </span>
            {/if}
          </div>
        </div>
        {#if draft.scope === 'project' && !readOnly}
          <div class="field">
            <span class="label">{t('skills.fields.project')}</span>
            <Select
              value={draft.projectId}
              options={projectOptions}
              ariaLabel={t('skills.fields.project') as string}
              on:change={(e) => setProject(e.detail)}
            />
          </div>
        {/if}

        <div class="field is-stacked">
          <span class="label">{t('cliProviders.title')}</span>
          <ProviderPicker
            selected={draft.targets}
            {reached}
            {unavailable}
            disabled={readOnly}
            on:change={(e) => setTargets(e.detail)}
          />
        </div>

        {#if selected && selected.locations.length > 0}
          <div class="field is-stacked">
            <span class="label">{t('skills.locations.title')}</span>
            <div class="locations">
              {#each selected.locations as location (location.path)}
                <div class="location">
                  <ProviderChips providers={location.providers} size={12}/>
                  <code class="selectable">{location.path}</code>
                  <CopyButton value={location.path}/>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </section>

      <section class="section">
        <button class="advanced" aria-expanded={advancedOpen} on:click={() => advancedOpen = !advancedOpen}>
          <Icon name={advancedOpen ? 'chev-d' : 'chev-r'} size={12}/>
          {t('skills.groups.advanced')}
        </button>
        {#if advancedOpen}
          <div class="field">
            <label class="label" for="sk-model">{t('skills.fields.model')}</label>
            <input id="sk-model" class="input selectable" type="text" disabled={readOnly} placeholder={t('skills.fields.modelPlaceholder') as string} bind:value={draft.model}/>
          </div>
          <div class="field">
            <label class="label" for="sk-license">{t('skills.fields.license')}</label>
            <input id="sk-license" class="input selectable" type="text" disabled={readOnly} placeholder="MIT" bind:value={draft.license}/>
          </div>
          <div class="field is-stacked">
            <label class="label" for="sk-extra">{t('skills.fields.extra')}</label>
            <textarea id="sk-extra" class="input textarea mono selectable" rows="4" spellcheck="false" disabled={readOnly} bind:value={draft.extraFrontmatter}></textarea>
            <span class="hint">{t('skills.fields.extraHint')}</span>
          </div>
        {/if}
      </section>
    </div>

    {#if selected?.divergent || error}
      <div class="notices">
        {#if selected?.divergent}
          <div class="banner warn"><Icon name="alert" size={13}/><span>{t('skills.divergent')}</span></div>
        {/if}
        {#if error}
          <div class="banner bad"><Icon name="alert" size={13}/><span>{error}</span></div>
        {/if}
      </div>
    {/if}

    {#if !readOnly && (dirty || selectedPath === null)}
      <div class="save-bar">
        <span class="save-note">
          {#if nameClash}
            <span class="hint bad">{t('skills.nameClash')}</span>
          {:else if !slug}
            <span class="hint warn">{t('skills.nameRequired')}</span>
          {:else if draft.targets.length === 0}
            <span class="hint warn">{t('cliProviders.pickOne')}</span>
          {:else if selectedPath === null}
            <span class="hint">{(t('skills.willCreate') as (n: string) => string)(slug)}</span>
          {:else}
            <span class="hint">{t('skills.unsaved')}</span>
          {/if}
        </span>
        <button class="btn ghost" on:click={() => selectedPath ? revert() : reset()} disabled={saving}>
          {selectedPath ? t('common.revert') : t('common.cancel')}
        </button>
        <button class="btn primary" on:click={save} disabled={saving || !slug || nameClash || draft.targets.length === 0}>
          {#if saving}<Spinner size={11}/>{/if}
          {t('common.save')}
        </button>
      </div>
    {/if}
  {/if}
</SplitPanel>
{/if}

{#if $skillsError}
  <div class="banner bad floating"><Icon name="alert" size={13}/><span>{$skillsError}</span></div>
{/if}

{#if deleteTarget}
  <DeleteSkillModal
    skill={deleteTarget}
    on:close={() => deleteTarget = null}
    on:confirm={confirmDelete}
  />
{/if}

<style>
  /* -- page head -- */
  .page-head { margin-bottom: 32px; }
  .page-head h1 {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0;
    font-family: var(--font-ui);
    font-size: 18px;
    font-weight: 600;
    color: var(--fg-0);
  }

  .page-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 64px 0;
    text-align: center;
    color: var(--fg-3);
  }
  .page-empty h2 { margin: 8px 0 0; font-size: 15px; font-weight: 600; color: var(--fg-0); }
  .page-empty p { max-width: 56ch; margin: 0 0 8px; font-size: 13px; line-height: 1.55; color: var(--fg-2); }

  /* -- list -- */
  .list-tools { display: flex; flex-direction: column; gap: 8px; padding: 12px 12px 4px; }
  .list-tools :global(.ag-search) { height: 28px; box-sizing: border-box; margin: 0; }
  .filters { display: flex; flex-wrap: wrap; gap: 4px; }
  .chip {
    display: flex;
    align-items: center;
    gap: 5px;
    height: 22px;
    padding: 0 8px;
    border: 1px solid var(--stroke-0);
    border-radius: 11px;
    font-size: 11.5px;
    color: var(--fg-2);
  }
  .chip:hover { color: var(--fg-0); }
  .chip.active { background: var(--bg-3); border-color: var(--stroke-1); color: var(--fg-0); }
  .chip-count { font-size: 11px; color: var(--fg-3); }

  .list-items {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-height: 0;
    padding: 4px 12px 12px;
    overflow-y: auto;
  }
  .group-label { margin: 12px 10px 6px; font-size: 11.5px; font-weight: 500; color: var(--fg-3); }
  .ag-item {
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
  .ag-item:hover { background: var(--bg-2); }
  .ag-item.is-active { background: var(--bg-2); color: var(--fg-0); }
  .ag-item-text { display: flex; flex: 1; flex-direction: column; min-width: 0; }
  .ag-item-name,
  .ag-item-sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ag-item-name { font-size: 13px; font-weight: 500; }
  .ag-item-sub { font-size: 11.5px; color: var(--fg-3); }


  /* -- detail -- */
  .detail-none {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 32px;
    text-align: center;
    color: var(--fg-3);
  }
  .detail-none h2 { margin: 0; font-size: 14px; font-weight: 600; color: var(--fg-0); }
  .detail-none p { max-width: 42ch; margin: 0 0 8px; font-size: 12.5px; line-height: 1.55; }

  .detail-head {
    display: flex;
    flex: none;
    align-items: center;
    gap: 12px;
    padding: 16px 24px;
    border-bottom: 1px solid var(--stroke-0);
  }
  .detail-title { flex: 1; min-width: 0; }
  .title-row { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .title-row h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: var(--fg-0);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .detail-title p { margin: 3px 0 0; font-size: 12px; color: var(--fg-3); }
  .invoke {
    flex: none;
    padding: 0 6px;
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 18px;
    color: var(--fg-2);
    border: 1px solid var(--stroke-1);
    border-radius: 4px;
  }
  .head-actions { display: flex; flex: none; align-items: center; gap: 2px; }
  .icon-only { width: 28px; height: 28px; padding: 0; justify-content: center; }
  .icon-only.delete:hover { background: var(--danger-weak); color: var(--danger); }

  .detail-body { flex: 1; min-height: 0; overflow-y: auto; padding-bottom: 12px; }
  .section { padding: 20px 24px 6px; }
  .section + .section { border-top: 1px solid var(--stroke-0); }
  .section h3 { margin: 0 0 16px; font-size: 13px; font-weight: 600; color: var(--fg-0); }
  .section-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
  .section-head h3 { margin: 0; }
  .section-note { margin: 0 0 14px; }
  .spacer { flex: 1; }

  .field {
    display: grid;
    grid-template-columns: 172px minmax(0, 1fr);
    align-items: start;
    column-gap: 12px;
    margin-bottom: 14px;
  }
  .field.is-stacked { grid-template-columns: minmax(0, 1fr); row-gap: 10px; }
  .label { padding-top: 7px; font-size: 12.5px; color: var(--fg-2); }
  .field.is-stacked .label { padding-top: 0; }
  .control { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .control-foot { display: flex; align-items: baseline; gap: 12px; }
  .control-foot .hint { flex: 1; }
  .input {
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
  .input:focus { border-color: var(--accent-line); }
  .input::placeholder { color: var(--fg-4); opacity: 1; }
  .textarea { height: auto; padding: 8px 10px; line-height: 1.5; resize: vertical; }
  .body-input {
    min-height: 260px;
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.6;
    resize: vertical;
  }
  .mono { font-family: var(--font-mono); font-size: 12px; }
  .hint { font-size: 12px; line-height: 1.5; color: var(--fg-3); }
  .hint.warn { color: var(--warning); }
  .hint.bad { color: var(--danger); }
  .counter { font-size: 11.5px; color: var(--fg-3); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .counter.bad { color: var(--danger); }


  .tool-chips { display: flex; flex-wrap: wrap; gap: 5px; }
  .tool-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 24px;
    padding: 0 4px 0 8px;
    background: var(--bg-2);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-sm);
  }
  .tool-chip code { font-family: var(--font-mono); font-size: 11.5px; color: var(--fg-1); }
  .tool-chip button {
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
    padding: 0;
    border-radius: 3px;
    color: var(--fg-3);
  }
  .tool-chip button:hover { background: var(--danger-weak); color: var(--danger); }
  .inline-row { display: flex; align-items: center; gap: 8px; }
  .inline-row .input { flex: 1; min-width: 0; }
  .inline-row .btn { flex: none; height: 32px; }

  .locations { display: flex; flex-direction: column; gap: 2px; }
  .location { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 4px 0; }
  .location code {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--fg-2);
  }

  .advanced {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0;
    margin-bottom: 14px;
    font-size: 13px;
    font-weight: 600;
    color: var(--fg-1);
  }
  .advanced:hover { color: var(--fg-0); }

  .notices { display: flex; flex: none; flex-direction: column; gap: 8px; padding: 0 24px 16px; }
  .banner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 12px;
    border-radius: var(--r-sm);
    font-size: 12px;
  }
  .banner.bad { background: var(--danger-weak); color: var(--danger); }
  .banner.warn { background: var(--warning-weak); color: var(--warning); }
  .banner.floating { position: fixed; right: 24px; bottom: 24px; z-index: 20; max-width: 420px; }

  .save-bar {
    display: flex;
    flex: none;
    align-items: center;
    gap: 8px;
    padding: 12px 24px;
    border-top: 1px solid var(--stroke-0);
    background: var(--bg-0);
  }
  .save-note { flex: 1; min-width: 0; }
  .tile {
    display: grid;
    flex: none;
    place-items: center;
    width: 28px;
    height: 28px;
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-sm);
    background: var(--bg-2);
    color: var(--fg-2);
  }
  .tile.is-large { width: 40px; height: 40px; border-radius: var(--r-md); color: var(--fg-1); }
  .tile.is-dashed { border-style: dashed; border-color: var(--stroke-1); background: transparent; color: var(--fg-3); }
  .none-tiles { display: flex; gap: 8px; margin-bottom: 12px; }
  .ag-item.new-skill { color: var(--fg-2); }
  .ag-item.new-skill:hover { color: var(--fg-0); }
  .toggle-row { display: flex; align-items: center; gap: 12px; padding-top: 4px; }
  .value { padding-top: 7px; font-size: 13px; color: var(--fg-1); }
  .add-files { height: 28px; }
  .resources { display: flex; flex-direction: column; gap: 2px; }
  .resource { display: flex; align-items: center; gap: 10px; min-height: 32px; color: var(--fg-3); }
  .resource-name { flex: 1; min-width: 0; font-family: var(--font-mono); font-size: 12px; color: var(--fg-1); }
  .resource-size { font-size: 11.5px; color: var(--fg-3); font-variant-numeric: tabular-nums; }
</style>
