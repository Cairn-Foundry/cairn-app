<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '$lib/i18n';
  import Icon from '$lib/components/Icon.svelte';
  import Select from '$lib/components/Select.svelte';
  import SearchInput from '$lib/components/SearchInput.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import CopyButton from '$lib/components/CopyButton.svelte';
  import DeleteSkillModal from './DeleteSkillModal.svelte';
  import ProviderPicker from '$lib/components/home/ProviderPicker.svelte';
  import ProviderChips from '$lib/components/home/ProviderChips.svelte';
  import ProviderLogo from '$lib/components/home/agents/ProviderLogo.svelte';
  import { projects, loadProjects } from '$lib/stores/project';
  import { skills, skillsError, skillsLoading, loadSkills } from '$lib/stores/skills';
  import {
    addSkillResources, deleteSkill, deleteSkillResource, duplicateSkill, saveSkill,
    type Skill, type SkillScope,
  } from '$lib/services/skill-service';
  import { revealInFileManager } from '$lib/services/file-service';
  import { KNOWN_TOOLS } from '$lib/utils/agent/tools';
  import { slugifySkill, MAX_DESCRIPTION } from '$lib/utils/home/skills';
  import { cliProviders, loadCliProviders } from '$lib/stores/cli-providers';
  import { reachedProviders } from '$lib/services/cli-provider-service';
  import { markIdOf, sortProviders } from '$lib/utils/home/cli-providers';
  import type { CliProviderId } from '$lib/services/cli-provider-service';

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

  function initials(name: string): string {
    const words = name.split(/[-_\s]+/).filter(Boolean);
    if (words.length === 0) return '?';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
  }

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

<div class="ag-layout">
  <aside class="ag-master">
    <div class="ag-master-header">
      <span class="ag-master-title">{t('skills.title')}</span>
      <span class="master-actions">
        <button
          class="icon-btn"
          on:click={loadSkills}
          disabled={$skillsLoading}
          title={t('skills.refresh') as string}
        >
          {#if $skillsLoading}<Spinner size={12}/>{:else}<Icon name="refresh" size={13}/>{/if}
        </button>
        <button class="icon-btn" on:click={create} title={t('skills.new') as string}>
          <Icon name="plus" size={13}/>
        </button>
      </span>
    </div>

    <SearchInput bind:value={search} placeholder={t('skills.searchPlaceholder') as string}/>

    <div class="filters">
      {#each FILTERS as key (key)}
        {#if key === 'all' || counts[key] > 0}
          <button
            class="chip {scopeFilter === key ? 'active' : ''}"
            aria-pressed={scopeFilter === key}
            on:click={() => scopeFilter = key}
          >
            {filterLabel(key)}<span class="chip-count">{counts[key]}</span>
          </button>
        {/if}
      {/each}
    </div>

    <div class="filters agents">
      <button
        class="chip {providerFilter === 'all' ? 'active' : ''}"
        aria-pressed={providerFilter === 'all'}
        on:click={() => providerFilter = 'all'}
      >
        {t('cliProviders.allAgents')}
      </button>
      {#each $cliProviders as provider (provider.id)}
        {@const count = $skills.filter((s) => s.providers.includes(provider.id)).length}
        {#if count > 0}
          <button
            class="chip {providerFilter === provider.id ? 'active' : ''}"
            aria-pressed={providerFilter === provider.id}
            title={provider.label}
            on:click={() => providerFilter = provider.id}
          >
            <ProviderLogo id={markIdOf(provider.id)} size={12} fallback={provider.label.slice(0, 1)}/>
            <span class="chip-count">{count}</span>
          </button>
        {/if}
      {/each}
    </div>

    {#if $skillsLoading && $skills.length === 0}
      <div class="master-skeleton"><Skeleton lines={5} height={34} gap={4}/></div>
    {:else if $skills.length === 0}
      <p class="ag-master-empty">{t('skills.emptyTitle')}</p>
    {:else if visible.length === 0}
      <p class="ag-master-empty">{t('skills.noResults')}</p>
    {:else}
      {#each groups as group (group.scope)}
        <div class="group-label">{t(`skills.scope.${group.scope}`)}</div>
        {#each group.items as skill (skill.path)}
          <div class="skill-row {selectedPath === skill.path ? 'active' : ''}">
            <button
              class="ag-item {selectedPath === skill.path ? 'active' : ''}"
              aria-pressed={selectedPath === skill.path}
              on:click={() => select(skill)}
            >
              <span class="ag-item-info">
                <span class="ag-item-name">
                  {skill.name}
                  {#if skill.readOnly}<Icon name="lock" size={10}/>{/if}
                </span>
                <span class="ag-item-sub">{skill.description || scopeLabel(skill)}</span>
              </span>
            </button>
            {#if !skill.readOnly}
              <button
                class="icon-btn delete"
                on:click={() => deleteTarget = skill}
                title={t('skills.delete.heading') as string}
              >
                <Icon name="trash" size={12}/>
              </button>
            {/if}
          </div>
        {/each}
      {/each}
    {/if}
  </aside>

  <section class="ag-detail">
    {#if draft === null}
      <div class="ag-empty">
        <span class="ag-empty-icon"><Icon name="book" size={30} sw={1.2}/></span>
        <p class="ag-empty-title">{t('skills.emptyTitle')}</p>
        <p class="ag-empty-desc">{t('skills.emptyDesc')}</p>
        <div class="empty-actions">
          <button class="btn primary" on:click={create}>
            <Icon name="plus" size={12}/> {t('skills.new')}
          </button>
        </div>
      </div>
    {:else}
      {@const readOnly = selected?.readOnly ?? false}

      <div class="ag-head">
        <span class="ag-tile ag-tile-lg">{initials(slug || draft.name || '?')}</span>
        <div class="ag-head-text">
          <input
            class="ag-input name-input"
            type="text"
            aria-label={t('skills.fields.name') as string}
            placeholder={t('skills.fields.namePlaceholder') as string}
            disabled={readOnly}
            bind:value={draft.name}
          />
          <div class="head-meta">
            {#if slug}
              <code class="invoke selectable">/{slug}</code>
              <span class="ag-hint">{t('skills.invokeHint')}</span>
            {/if}
            {#if nameClash}
              <span class="ag-hint bad">{t('skills.nameClash')}</span>
            {/if}
          </div>
        </div>
        <div class="head-actions">
          {#if selected && !readOnly}
            <button class="btn ghost" on:click={() => duplicate(selected)} title={t('skills.duplicate') as string}>
              <Icon name="copy" size={13}/>
            </button>
          {/if}
          {#if selected}
            <button
              class="btn ghost"
              on:click={() => revealInFileManager(selected.path)}
              title={t('skills.reveal') as string}
            >
              <Icon name="folder-open" size={13}/>
            </button>
          {/if}
        </div>
      </div>

      {#if readOnly}
        <div class="banner">
          <Icon name="lock" size={13}/>
          <span>{(t('skills.pluginReadOnly') as (p: string) => string)(selected?.plugin ?? '')}</span>
        </div>
      {/if}

      {#if selected?.divergent}
        <div class="banner warn">
          <Icon name="alert" size={13}/>
          <span>{t('skills.divergent')}</span>
        </div>
      {/if}

      {#if error}
        <div class="banner bad"><Icon name="alert" size={13}/><span>{error}</span></div>
      {/if}

      <div class="ag-group">
        <div class="ag-group-title">{t('skills.groups.discovery')}</div>

        <div class="ag-card">
          <div class="ag-field">
            <div class="ag-card-info">
              <label class="ag-label" for="sk-desc">{t('skills.fields.description')}</label>
              <span class="ag-hint">{t('skills.fields.descriptionHint')}</span>
            </div>
            <textarea
              id="sk-desc"
              class="ag-textarea selectable"
              rows="3"
              disabled={readOnly}
              placeholder={t('skills.fields.descriptionPlaceholder') as string}
              bind:value={draft.description}
            ></textarea>
            <div class="counter {descriptionOver ? 'bad' : ''}">
              {draft.description.length} / {MAX_DESCRIPTION}
            </div>
            {#if draft.description.trim() === ''}
              <span class="ag-hint warn">{t('skills.fields.descriptionMissing')}</span>
            {:else if descriptionOver}
              <span class="ag-hint bad">{t('skills.fields.descriptionTooLong')}</span>
            {/if}
          </div>
        </div>

        <div class="ag-card">
          <div class="ag-field">
            <div class="ag-card-info">
              <label class="ag-label" for="sk-when">{t('skills.fields.whenToUse')}</label>
              <span class="ag-hint">{t('skills.fields.whenToUseHint')}</span>
            </div>
            <textarea
              id="sk-when"
              class="ag-textarea selectable"
              rows="2"
              disabled={readOnly}
              placeholder={t('skills.fields.whenToUsePlaceholder') as string}
              bind:value={draft.whenToUse}
            ></textarea>
          </div>
        </div>

        <div class="ag-card">
          <div class="ag-field">
            <div class="ag-card-info">
              <label class="ag-label" for="sk-paths">{t('skills.fields.paths')}</label>
              <span class="ag-hint">{t('skills.fields.pathsHint')}</span>
            </div>
            <input
              id="sk-paths"
              class="ag-input selectable"
              type="text"
              disabled={readOnly}
              placeholder="**/*.ts, **/migrations/**"
              bind:value={draft.paths}
            />
          </div>
        </div>

        <div class="ag-card">
          <div class="ag-card-head">
            <div class="ag-card-info">
              <span class="ag-label">{t('skills.fields.manualOnly')}</span>
              <span class="ag-hint">{t('skills.fields.manualOnlyHint')}</span>
            </div>
            <label class="ag-toggle">
              <input
                type="checkbox"
                disabled={readOnly}
                bind:checked={draft.disableModelInvocation}
              />
              <span class="ag-toggle-track"><span class="ag-toggle-thumb"></span></span>
            </label>
          </div>
        </div>
      </div>

      <div class="ag-group">
        <div class="ag-group-title">{t('skills.groups.instructions')}</div>
        <div class="ag-card">
          <div class="ag-field">
            <div class="ag-card-info">
              <label class="ag-label" for="sk-body">{t('skills.fields.body')}</label>
              <span class="ag-hint">{t('skills.fields.bodyHint')}</span>
            </div>
            <textarea
              id="sk-body"
              class="ag-textarea body-input selectable"
              rows="16"
              spellcheck="false"
              disabled={readOnly}
              placeholder={t('skills.fields.bodyPlaceholder') as string}
              bind:value={draft.body}
            ></textarea>
            <div class="counter">
              {(t('skills.bodyStats') as (w: number, l: number) => string)(
                draft.body.trim() ? draft.body.trim().split(/\s+/).length : 0,
                draft.body.split('\n').length,
              )}
            </div>
          </div>
        </div>
      </div>

      <div class="ag-group">
        <div class="ag-group-title">{t('skills.groups.tools')}</div>
        <div class="ag-card">
          <div class="ag-field">
            <div class="ag-card-info">
              <span class="ag-label">{t('skills.fields.allowedTools')}</span>
              <span class="ag-hint">{t('skills.fields.allowedToolsHint')}</span>
            </div>

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
            {:else}
              <span class="ag-hint">{t('skills.fields.allowedToolsEmpty')}</span>
            {/if}

            {#if !readOnly}
              <div class="inline-row">
                <input
                  class="ag-input selectable"
                  type="text"
                  list="skill-tools"
                  placeholder={t('skills.fields.allowedToolsPlaceholder') as string}
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
          </div>
        </div>
      </div>

      <div class="ag-group">
        <div class="ag-group-title">{t('skills.groups.location')}</div>
        <div class="ag-card row-card">
          <div class="row-fields">
            <div class="ag-field">
              <span class="ag-hint">{t('skills.fields.scope')}</span>
              {#if readOnly}
                <div class="ag-value">{selected?.plugin}</div>
              {:else}
                <Select
                  value={draft.scope}
                  options={scopeOptions}
                  ariaLabel={t('skills.fields.scope') as string}
                  on:change={(e) => setScope(e.detail as SkillScope)}
                />
              {/if}
            </div>
            {#if draft.scope === 'project' && !readOnly}
              <div class="ag-field">
                <span class="ag-hint">{t('skills.fields.project')}</span>
                <Select
                  value={draft.projectId}
                  options={projectOptions}
                  ariaLabel={t('skills.fields.project') as string}
                  on:change={(e) => setProject(e.detail)}
                />
              </div>
            {/if}
          </div>
          <span class="ag-hint">
            {draft.scope === 'global' ? t('skills.scope.globalHint') : t('skills.scope.projectHint')}
          </span>
        </div>

        <div class="ag-card">
          <div class="ag-card-info stacked">
            <span class="ag-label">{t('cliProviders.title')}</span>
            <span class="ag-hint">{t('skills.providersHint')}</span>
          </div>
          <ProviderPicker
            selected={draft.targets}
            {reached}
            {unavailable}
            disabled={readOnly}
            on:change={(e) => setTargets(e.detail)}
          />
        </div>

        {#if selected && selected.locations.length > 0}
          <div class="ag-card">
            <div class="ag-card-info stacked">
              <span class="ag-label">{t('skills.locations.title')}</span>
              <span class="ag-hint">{t('skills.locations.hint')}</span>
            </div>
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
      </div>

      {#if selected}
        <div class="ag-group">
          <div class="ag-group-title">{t('skills.groups.files')}</div>
          <div class="ag-card">
            <div class="ag-card-head">
              <div class="ag-card-info">
                <span class="ag-label">{t('skills.files.title')}</span>
                <span class="ag-hint">{t('skills.files.hint')}</span>
              </div>
              {#if !readOnly}
                <button class="btn" on:click={pickResources} disabled={busyResource === 'add'}>
                  {#if busyResource === 'add'}<Spinner size={11}/>{:else}<Icon name="plus" size={12}/>{/if}
                  {t('skills.files.add')}
                </button>
              {/if}
            </div>

            {#if selected.resources.length > 0}
              <div class="resources">
                {#each selected.resources as resource (resource.path)}
                  <div class="resource">
                    <Icon name="file" size={12}/>
                    <span class="resource-name selectable">{resource.name}</span>
                    <span class="resource-size">{formatSize(resource.size)}</span>
                    {#if !readOnly}
                      <button
                        class="icon-btn delete"
                        on:click={() => removeResource(resource.path)}
                        disabled={busyResource === resource.path}
                        title={t('common.remove') as string}
                      >
                        {#if busyResource === resource.path}
                          <Spinner size={11}/>
                        {:else}
                          <Icon name="trash" size={11}/>
                        {/if}
                      </button>
                    {/if}
                  </div>
                {/each}
              </div>
            {:else}
              <span class="ag-hint">{t('skills.files.empty')}</span>
            {/if}
          </div>
        </div>
      {/if}

      <div class="ag-group">
        <button class="ag-group-title advanced" on:click={() => advancedOpen = !advancedOpen}>
          <Icon name={advancedOpen ? 'chev-d' : 'chev-r'} size={11}/>
          {t('skills.groups.advanced')}
        </button>
        {#if advancedOpen}
          <div class="ag-card row-card">
            <div class="row-fields">
              <div class="ag-field">
                <span class="ag-hint">{t('skills.fields.model')}</span>
                <input
                  class="ag-input selectable"
                  type="text"
                  disabled={readOnly}
                  placeholder={t('skills.fields.modelPlaceholder') as string}
                  bind:value={draft.model}
                />
              </div>
              <div class="ag-field">
                <span class="ag-hint">{t('skills.fields.license')}</span>
                <input
                  class="ag-input selectable"
                  type="text"
                  disabled={readOnly}
                  placeholder="MIT"
                  bind:value={draft.license}
                />
              </div>
            </div>
          </div>
          <div class="ag-card">
            <div class="ag-field">
              <div class="ag-card-info">
                <label class="ag-label" for="sk-extra">{t('skills.fields.extra')}</label>
                <span class="ag-hint">{t('skills.fields.extraHint')}</span>
              </div>
              <textarea
                id="sk-extra"
                class="ag-textarea mono selectable"
                rows="4"
                spellcheck="false"
                disabled={readOnly}
                bind:value={draft.extraFrontmatter}
              ></textarea>
            </div>
          </div>
        {/if}
      </div>

      {#if !readOnly}
        <div class="save-bar" class:visible={dirty || selectedPath === null}>
          <span class="save-note">
            {#if nameClash}
              <span class="ag-hint bad">{t('skills.nameClash')}</span>
            {:else if !slug}
              <span class="ag-hint warn">{t('skills.nameRequired')}</span>
            {:else if draft.targets.length === 0}
              <span class="ag-hint warn">{t('cliProviders.pickOne')}</span>
            {:else if selectedPath === null}
              <span class="ag-hint">{(t('skills.willCreate') as (n: string) => string)(slug)}</span>
            {:else}
              <span class="ag-hint">{t('skills.unsaved')}</span>
            {/if}
          </span>
          <button class="btn ghost" on:click={() => selectedPath ? revert() : reset()} disabled={saving}>
            {selectedPath ? t('common.revert') : t('common.cancel')}
          </button>
          <button
            class="btn primary"
            on:click={save}
            disabled={saving || !slug || nameClash || draft.targets.length === 0}
          >
            {#if saving}<Spinner size={11}/>{:else}<Icon name="save" size={12}/>{/if}
            {t('common.save')}
          </button>
        </div>
      {/if}
    {/if}
  </section>
</div>

{#if $skillsError}
  <div class="banner bad floating"><Icon name="alert" size={13}/><span>{$skillsError}</span></div>
{/if}

{#if deleteTarget}
  <DeleteSkillModal
    name={deleteTarget.name}
    path={deleteTarget.path}
    on:close={() => deleteTarget = null}
    on:confirm={confirmDelete}
  />
{/if}

<style>
  .master-actions { display: flex; align-items: center; gap: 2px; }

  .icon-btn {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    flex-shrink: 0;
    padding: 0;
    background: none;
    border: 1px solid transparent;
    border-radius: var(--r-sm);
    color: var(--fg-3);
    cursor: pointer;
    transition: background .12s, color .12s, border-color .12s;
  }
  .icon-btn:hover:not(:disabled) { background: var(--bg-3); color: var(--fg-0); border-color: var(--stroke-0); }
  .icon-btn.delete:hover:not(:disabled) { background: var(--danger-weak); color: var(--danger); border-color: transparent; }
  .icon-btn:disabled { opacity: .5; cursor: default; }

  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 0 8px 8px;
  }
  .chip {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px;
    background: none;
    border: 1px solid var(--stroke-0);
    border-radius: 99px;
    font-size: 11px;
    color: var(--fg-2);
    cursor: pointer;
    font-family: var(--font-ui);
  }
  .chip:hover { background: var(--bg-3); color: var(--fg-0); }
  .chip.active { background: var(--accent-weak); border-color: var(--accent-line); color: var(--fg-0); }
  .chip-count { font-size: 10px; color: var(--fg-3); font-family: var(--font-mono); }

  .master-skeleton { padding: 4px 8px; }

  .group-label {
    padding: 10px 10px 4px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: .06em;
    text-transform: uppercase;
    color: var(--fg-4);
  }

  .skill-row {
    display: flex;
    align-items: center;
    gap: 2px;
    border-radius: var(--r-md);
  }
  .skill-row :global(.ag-item) { min-width: 0; }

  .name-input { font-size: 15px; font-weight: 600; }

  .head-meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 6px;
  }
  .invoke {
    padding: 2px 7px;
    background: var(--accent-weak);
    border: 1px solid var(--accent-line);
    border-radius: var(--r-sm);
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-0);
  }

  .head-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }

  /* Everything stacked in .ag-detail shares one column and one rhythm: the
     620px of .ag-group and its 28px above. A flex column never collapses
     margins, so only the top one is set here. */
  .banner {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 28px;
    max-width: 620px;
    padding: 9px 12px;
    background: var(--bg-3);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-md);
    font-size: 12px;
    color: var(--fg-2);
  }
  .banner.bad {
    background: var(--danger-weak);
    border-color: transparent;
    color: var(--danger);
  }
  .banner.warn {
    background: var(--warning-weak);
    border-color: transparent;
    color: var(--warning);
  }
  .banner.floating {
    position: fixed;
    right: 24px;
    bottom: 24px;
    z-index: 20;
    margin: 0;
    max-width: 420px;
  }

  .counter {
    align-self: flex-end;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--fg-4);
  }
  .counter.bad { color: var(--danger); }

  .body-input {
    min-height: 260px;
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.6;
  }
  .mono { font-family: var(--font-mono); font-size: 11px; }

  .tool-chips { display: flex; flex-wrap: wrap; gap: 5px; }
  .tool-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 4px 3px 8px;
    background: var(--bg-1);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-sm);
  }
  .tool-chip code { font-family: var(--font-mono); font-size: 11px; color: var(--fg-1); }
  .tool-chip button {
    display: grid;
    place-items: center;
    width: 15px;
    height: 15px;
    padding: 0;
    background: none;
    border: none;
    border-radius: var(--r-xs);
    color: var(--fg-3);
    cursor: pointer;
  }
  .tool-chip button:hover { background: var(--danger-weak); color: var(--danger); }

  .inline-row { display: flex; align-items: center; gap: 6px; }
  .inline-row .ag-input { flex: 1; min-width: 0; }

  .row-card { display: flex; flex-direction: column; gap: 10px; }
  .row-fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 10px;
  }

  .filters.agents { padding-top: 0; }
  .filters.agents .chip { gap: 4px; padding: 3px 7px; }

  .ag-card-info.stacked { margin-bottom: 10px; }

  .locations { display: flex; flex-direction: column; gap: 4px; }
  .location {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    padding: 5px 6px;
    border-radius: var(--r-sm);
  }
  .location:hover { background: var(--bg-1); }
  .location code {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-3);
  }

  .resources { display: flex; flex-direction: column; gap: 2px; }
  .resource {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 6px;
    border-radius: var(--r-sm);
    color: var(--fg-3);
  }
  .resource:hover { background: var(--bg-1); }
  .resource-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-1);
  }
  .resource-size { font-family: var(--font-mono); font-size: 10px; color: var(--fg-4); }

  .advanced {
    display: flex;
    align-items: center;
    gap: 5px;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
  }

  .save-bar {
    position: sticky;
    bottom: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 8px -4px -4px;
    padding: 12px 4px;
    background: linear-gradient(to top, var(--bg-0) 70%, transparent);
    opacity: 0;
    pointer-events: none;
    transition: opacity .14s;
  }
  .save-bar.visible { opacity: 1; pointer-events: auto; }
  .save-note { flex: 1; min-width: 0; }

  .empty-actions { display: flex; align-items: center; gap: 8px; }
</style>
