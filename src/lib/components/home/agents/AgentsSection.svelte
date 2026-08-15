<script lang="ts">
  /**
   * Editor for native agent definitions (the .md files the CLI agents read), across every scope
   * and every targeted provider. Edits go to a local draft; the files are only written on save.
   */
  import { onMount } from 'svelte';
  import { t } from '$lib/i18n';
  import Icon from '$lib/components/Icon.svelte';
  import Select from '$lib/components/Select.svelte';
  import SearchInput from '$lib/components/SearchInput.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import CopyButton from '$lib/components/CopyButton.svelte';
  import DeleteAgentModal from './DeleteAgentModal.svelte';
  import ProviderPicker from '$lib/components/home/ProviderPicker.svelte';
  import ProviderChips from '$lib/components/home/ProviderChips.svelte';
  import ProviderLogo from './ProviderLogo.svelte';
  import { projects, loadProjects } from '$lib/stores/project';
  import {
    loadNativeAgents,
    nativeAgents, nativeAgentsError, nativeAgentsLoading,
  } from '$lib/stores/native-agents';
  import {
    deleteNativeAgent, duplicateNativeAgent, saveNativeAgent,
    type NativeAgent, type NativeAgentScope,
  } from '$lib/services/native-agent-service';
  import { revealInFileManager } from '$lib/services/file-service';
  import { KNOWN_TOOLS } from '$lib/utils/agent/tools';
  import { cliProviders, loadCliProviders } from '$lib/stores/cli-providers';
  import {
    effortsOf, loadAiProviders, modelsOf, permissionModesOf, providerCapabilities,
    refreshProviderModels,
  } from '$lib/stores/ai-providers';
  import { skills as skillList, loadSkills } from '$lib/stores/skills';
  import { effortLabel, permissionModeLabel } from '$lib/utils/agent/run-options';
  import { reachedProviders, type CliProviderId } from '$lib/services/cli-provider-service';
  import { catalogueIdOf, sortProviders } from '$lib/utils/home/cli-providers';
  import { agentSlug, AGENT_COLORS, MAX_DESCRIPTION } from '$lib/utils/home/native-agents';

  /** The editor's own copy: a file is only touched when Save is pressed. */
  interface Draft {
    name: string;
    description: string;
    model: string;
    effort: string;
    permissionMode: string;
    memory: string;
    skills: string[];
    color: string;
    tools: string[];
    extraFrontmatter: string;
    systemPrompt: string;
    scope: NativeAgentScope;
    projectId: string;
    targets: CliProviderId[];
  }

  type Filter = 'all' | NativeAgentScope;

  const FILTERS: Filter[] = ['all', 'global', 'project'];
  /** Values seen in definitions the CLI loads. It documents no list, so this
   * suggests rather than restricts. */
  const MEMORY_VALUES = ['project', 'user', 'local'];

  let selectedPath: string | null = null;
  let search = '';
  let scopeFilter: Filter = 'all';
  let draft: Draft | null = null;
  let pristine = '';
  let saving = false;
  let error = '';
  let toolDraft = '';
  let skillDraft = '';
  let advancedOpen = false;
  let deleteTarget: NativeAgent | null = null;
  let providerFilter: CliProviderId | 'all' = 'all';

  onMount(async () => {
    await Promise.all([loadProjects(), loadCliProviders(), loadAiProviders(), loadSkills()]);
    await loadNativeAgents();
    if (!selectedPath) select($nativeAgents[0] ?? null);
  });

  $: selected = $nativeAgents.find((a) => a.path === selectedPath) ?? null;

  $: query = search.trim().toLowerCase();
  $: visible = $nativeAgents.filter((agent) => {
    if (scopeFilter !== 'all' && agent.scope !== scopeFilter) return false;
    if (providerFilter !== 'all' && !agent.providers.includes(providerFilter)) return false;
    if (!query) return true;
    return `${agent.name} ${agent.description} ${agent.projectName}`.toLowerCase().includes(query);
  });

  $: groups = (['global', 'project'] as NativeAgentScope[])
    .map((scope) => ({ scope, items: visible.filter((a) => a.scope === scope) }))
    .filter((group) => group.items.length > 0);

  $: counts = {
    all: $nativeAgents.length,
    global: $nativeAgents.filter((a) => a.scope === 'global').length,
    project: $nativeAgents.filter((a) => a.scope === 'project').length,
  };

  $: dirty = draft !== null && JSON.stringify(draft) !== pristine;
  $: slug = draft ? agentSlug(draft.name) : '';
  $: nameClash = draft !== null && slug !== ''
    && $nativeAgents.some((a) =>
      a.path !== selectedPath
      && a.scope === draft!.scope
      && a.projectId === draft!.projectId
      && a.name === slug);
  $: descriptionOver = (draft?.description.length ?? 0) > MAX_DESCRIPTION;

  $: projectOptions = $projects.map((p) => ({ value: p.id, label: p.name }));
  $: scopeOptions = [
    { value: 'global', label: t('agentDefs.scope.global') as string },
    ...($projects.length > 0
      ? [{ value: 'project', label: t('agentDefs.scope.project') as string }]
      : []),
  ];

  /**
   * The catalogues to offer from: what each provider that will read this
   * definition says it accepts. A definition holds one value, so several
   * providers offer the union of theirs - a value only one of them knows is
   * still worth being able to pick.
   */
  $: capabilityProviders = (draft?.targets ?? []).map(catalogueIdOf);

  $: void capabilityProviders.forEach((id) => {
    if (!$providerCapabilities[id]) void refreshProviderModels(id);
  });

  /** Merges the catalogues of several providers, keeping the first entry of each key. */
  function unionOf<T>(lists: T[][], key: (item: T) => string): T[] {
    const seen = new Set<string>();
    const out: T[] = [];
    for (const item of lists.flat()) {
      if (seen.has(key(item))) continue;
      seen.add(key(item));
      out.push(item);
    }
    return out;
  }

  /**
   * An empty first entry everywhere: a definition that says nothing about a
   * field lets the session decide, which is a real choice and has to be
   * expressible after picking a value.
   */
  $: modelOptions = [
    { value: '', label: t('agentDefs.fields.inherit') as string },
    ...unionOf(
      capabilityProviders.map((id) => modelsOf(id, $providerCapabilities)),
      (m) => m.id,
    ).map((m) => ({ value: m.id, label: m.label || m.id })),
    ...(draft?.model &&
    !capabilityProviders.some((id) =>
      modelsOf(id, $providerCapabilities).some((m) => m.id === draft?.model),
    )
      ? [{ value: draft.model, label: draft.model }]
      : []),
  ];

  $: effortOptions = [
    { value: '', label: t('agentDefs.fields.inherit') as string },
    ...unionOf(
      capabilityProviders.map((id) =>
        effortsOf(id, $providerCapabilities, draft?.effort ?? ''),
      ),
      (level) => level,
    ).map((level) => ({ value: level, label: effortLabel(level) })),
  ];

  $: permissionOptions = [
    { value: '', label: t('agentDefs.fields.inherit') as string },
    ...unionOf(
      capabilityProviders.map((id) =>
        permissionModesOf(id, $providerCapabilities, draft?.permissionMode ?? ''),
      ),
      (mode) => mode,
    ).map((mode) => ({ value: mode, label: permissionModeLabel(mode) })),
  ];

  /** Skills already on disk, so the picker offers names that resolve. */
  $: skillOptions = Array.from(new Set($skillList.map((s) => s.name)))
    .filter((name) => !draft?.skills.includes(name))
    .sort();

  /** Copies an agent into an editable draft, arrays included so edits stay local. */
  function toDraft(agent: NativeAgent): Draft {
    return {
      name: agent.name,
      description: agent.description,
      model: agent.model,
      effort: agent.effort,
      permissionMode: agent.permissionMode,
      memory: agent.memory,
      skills: [...agent.skills],
      color: agent.color,
      tools: [...agent.tools],
      extraFrontmatter: agent.extraFrontmatter,
      systemPrompt: agent.systemPrompt,
      scope: agent.scope,
      projectId: agent.projectId,
      targets: sortProviders(agent.providers),
    };
  }

  function reset() {
    draft = null;
    pristine = '';
    selectedPath = null;
  }

  /** Opens an agent in the editor and records the pristine copy the dirty flag compares against. */
  function select(agent: NativeAgent | null) {
    error = '';
    toolDraft = '';
    skillDraft = '';
    advancedOpen = false;
    if (!agent) {
      reset();
      return;
    }
    selectedPath = agent.path;
    draft = toDraft(agent);
    pristine = JSON.stringify(draft);
  }

  function revert() {
    if (selected) select(selected);
  }

  /** Starts a blank draft, defaulting its scope and target to whatever the list is filtered on. */
  function create() {
    const scope: NativeAgentScope =
      $projects.length > 0 && scopeFilter === 'project' ? 'project' : 'global';
    draft = {
      name: '',
      description: '',
      model: '',
      effort: '',
      permissionMode: '',
      memory: '',
      skills: [],
      color: AGENT_COLORS[0],
      tools: [],
      extraFrontmatter: '',
      systemPrompt: `${t('agentDefs.newPromptPlaceholder')}\n`,
      scope,
      projectId: scope === 'project' ? ($projects[0]?.id ?? '') : '',
      targets: providerFilter === 'all' ? ['claude-code'] : [providerFilter],
    };
    pristine = '';
    selectedPath = null;
    search = '';
    error = '';
  }

  /** Writes the definition to every targeted location, then reselects it from the reloaded list. */
  async function save() {
    if (!draft || !slug || nameClash || draft.targets.length === 0) return;
    saving = true;
    error = '';
    try {
      const project = $projects.find((p) => p.id === draft!.projectId);
      const paths = await saveNativeAgent({
        originalPaths: selected?.locations.map((l) => l.path) ?? [],
        targets: draft.targets,
        scope: draft.scope,
        projectId: draft.scope === 'project' ? draft.projectId : '',
        projectPath: draft.scope === 'project' ? (project?.path ?? '') : '',
        name: draft.name,
        description: draft.description,
        model: draft.model,
        effort: draft.effort,
        permissionMode: draft.permissionMode,
        memory: draft.memory,
        skills: draft.skills,
        color: draft.color,
        tools: draft.tools,
        extraFrontmatter: draft.extraFrontmatter,
        systemPrompt: draft.systemPrompt,
      });
      await loadNativeAgents();
      select($nativeAgents.find((a) => paths.includes(a.path)) ?? null);
    } catch (e) {
      error = String(e);
    } finally {
      saving = false;
    }
  }

  async function duplicate(agent: NativeAgent) {
    try {
      const path = await duplicateNativeAgent(
        agent.path,
        (t('agentDefs.copyOf') as (n: string) => string)(agent.name),
      );
      await loadNativeAgents();
      select($nativeAgents.find((a) => a.path === path) ?? null);
    } catch (e) {
      error = String(e);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const gone = deleteTarget.locations.map((l) => l.path);
    deleteTarget = null;
    try {
      await deleteNativeAgent(gone);
      await loadNativeAgents();
      if (selectedPath && gone.includes(selectedPath)) select($nativeAgents[0] ?? null);
    } catch (e) {
      error = String(e);
    }
  }

  function addTool(raw: string) {
    if (!draft) return;
    const tool = raw.trim();
    if (!tool || draft.tools.includes(tool)) return;
    draft.tools = [...draft.tools, tool];
    toolDraft = '';
  }

  function removeTool(tool: string) {
    if (!draft) return;
    draft.tools = draft.tools.filter((x) => x !== tool);
  }

  function addSkill(raw: string) {
    if (!draft) return;
    const skill = raw.trim();
    if (!skill || draft.skills.includes(skill)) return;
    draft.skills = [...draft.skills, skill];
    skillDraft = '';
  }

  function removeSkill(skill: string) {
    if (!draft) return;
    draft.skills = draft.skills.filter((x) => x !== skill);
  }

  /** Two letters for the avatar, taken from the first two words of the name. */
  function initials(name: string): string {
    const words = name.split(/[-_\s]+/).filter(Boolean);
    if (words.length === 0) return '?';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
  }

  function scopeLabel(agent: NativeAgent): string {
    return agent.scope === 'project'
      ? agent.projectName
      : (t('agentDefs.scope.global') as string);
  }

  $: toolSuggestions = KNOWN_TOOLS.filter((tool) => !draft?.tools.includes(tool));

  /**
   * Which agents a save would actually reach: the registry answers, because a
   * write location is often read by agents that were never picked, and the
   * answer has to follow the ticks rather than the last saved state.
   */
  let reached: CliProviderId[] = [];
  $: void refreshReach(
    draft?.scope,
    $projects.find((p) => p.id === draft?.projectId)?.path ?? '',
    draft?.targets ?? [],
  );

  async function refreshReach(
    scope: string | undefined,
    projectPath: string,
    targets: CliProviderId[],
  ) {
    if (!scope || targets.length === 0) {
      reached = [];
      return;
    }
    reached = await reachedProviders('agent', scope, projectPath, targets);
  }

  /**
   * An agent with no roster at all cannot be a target, and neither can one
   * whose project has not been chosen yet. The picker says which, rather than
   * offering a tile that fails on save.
   */
  $: unavailable = draft === null
    ? {}
    : Object.fromEntries(
        $cliProviders
          .filter(
            (p) =>
              !rosterProviders.includes(p.id) ||
              (draft!.scope === 'project' && !draft!.projectId),
          )
          .map((p) => [
            p.id,
            (rosterProviders.includes(p.id)
              ? t('agentDefs.scope.needsProject')
              : t('agentDefs.noRoster')) as string,
          ]),
      );

  /** The providers that read a definition directory at all. */
  $: rosterProviders = Array.from(
    new Set($nativeAgents.flatMap((a) => a.providers)),
  ).concat('claude-code' as CliProviderId);

  function setTargets(next: CliProviderId[]) {
    if (draft) draft.targets = next;
  }

  function filterLabel(key: Filter): string {
    return (key === 'all' ? t('agentDefs.filter.all') : t(`agentDefs.scope.${key}`)) as string;
  }

  function setScope(scope: NativeAgentScope) {
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
      <span class="ag-master-title">{t('agentDefs.title')}</span>
      <span class="master-actions">
        <button
          class="icon-btn"
          on:click={loadNativeAgents}
          disabled={$nativeAgentsLoading}
          title={t('agentDefs.refresh') as string}
        >
          {#if $nativeAgentsLoading}<Spinner size={12}/>{:else}<Icon name="refresh" size={13}/>{/if}
        </button>
        <button class="icon-btn" on:click={create} title={t('agentDefs.new') as string}>
          <Icon name="plus" size={13}/>
        </button>
      </span>
    </div>

    <SearchInput bind:value={search} placeholder={t('agentDefs.searchPlaceholder') as string}/>

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
        {@const count = $nativeAgents.filter((a) => a.providers.includes(provider.id)).length}
        {#if count > 0}
          <button
            class="chip {providerFilter === provider.id ? 'active' : ''}"
            aria-pressed={providerFilter === provider.id}
            title={provider.label}
            on:click={() => providerFilter = provider.id}
          >
            <ProviderLogo id={catalogueIdOf(provider.id)} size={12} fallback={provider.label.slice(0, 1)}/>
            <span class="chip-count">{count}</span>
          </button>
        {/if}
      {/each}
    </div>

    {#if $nativeAgentsLoading && $nativeAgents.length === 0}
      <div class="master-skeleton"><Skeleton lines={5} height={34} gap={4}/></div>
    {:else if $nativeAgents.length === 0}
      <p class="ag-master-empty">{t('agentDefs.emptyTitle')}</p>
    {:else if visible.length === 0}
      <p class="ag-master-empty">{t('agentDefs.noResults')}</p>
    {:else}
      {#each groups as group (group.scope)}
        <div class="group-label">{t(`agentDefs.scope.${group.scope}`)}</div>
        {#each group.items as agent (agent.path)}
          <div class="agent-row {selectedPath === agent.path ? 'active' : ''}">
            <button
              class="ag-item {selectedPath === agent.path ? 'active' : ''}"
              aria-pressed={selectedPath === agent.path}
              on:click={() => select(agent)}
            >
              <span class="ag-item-info">
                <span class="ag-item-name">
                  {#if agent.color}
                    <span class="mention-dot" style="background: {agent.color}"></span>
                  {/if}
                  {agent.name}
                </span>
                <span class="ag-item-sub">{agent.description || scopeLabel(agent)}</span>
              </span>
            </button>
            <button
              class="icon-btn delete"
              on:click={() => deleteTarget = agent}
              title={t('agentDefs.delete.heading') as string}
            >
              <Icon name="trash" size={12}/>
            </button>
          </div>
        {/each}
      {/each}
    {/if}
  </aside>

  <section class="ag-detail">
    {#if draft === null}
      <div class="ag-empty">
        <span class="ag-empty-icon"><Icon name="agent" size={30} sw={1.2}/></span>
        <p class="ag-empty-title">{t('agentDefs.emptyTitle')}</p>
        <p class="ag-empty-desc">{t('agentDefs.emptyDesc')}</p>
        <div class="empty-actions">
          <button class="btn primary" on:click={create}>
            <Icon name="plus" size={12}/> {t('agentDefs.new')}
          </button>
        </div>
      </div>
    {:else}
      <div class="ag-head">
        <span class="ag-tile ag-tile-lg" style={draft.color ? `background: ${draft.color}` : ''}>
          {initials(slug || draft.name || '?')}
        </span>
        <div class="ag-head-text">
          <input
            class="ag-input name-input"
            type="text"
            aria-label={t('agentDefs.fields.name') as string}
            placeholder={t('agentDefs.fields.namePlaceholder') as string}
            bind:value={draft.name}
          />
          <div class="head-meta">
            {#if slug}
              <code class="invoke selectable">@{slug}</code>
              <span class="ag-hint">{t('agentDefs.invokeHint')}</span>
            {/if}
            {#if nameClash}
              <span class="ag-hint bad">{t('agentDefs.nameClash')}</span>
            {/if}
          </div>
        </div>
        <div class="head-actions">
          {#if selected}
            <button class="btn ghost" on:click={() => duplicate(selected)} title={t('agentDefs.duplicate') as string}>
              <Icon name="copy" size={13}/>
            </button>
            <button
              class="btn ghost"
              on:click={() => revealInFileManager(selected.path)}
              title={t('agentDefs.reveal') as string}
            >
              <Icon name="folder-open" size={13}/>
            </button>
          {/if}
        </div>
      </div>

      {#if selected?.divergent}
        <div class="banner warn">
          <Icon name="alert" size={13}/>
          <span>{t('agentDefs.divergent')}</span>
        </div>
      {/if}

      {#if error}
        <div class="banner bad"><Icon name="alert" size={13}/><span>{error}</span></div>
      {/if}

      <div class="ag-group">
        <div class="ag-group-title">{t('agentDefs.groups.identity')}</div>

        <div class="ag-card">
          <div class="ag-field">
            <div class="ag-card-info">
              <label class="ag-label" for="ag-desc">{t('agentDefs.fields.description')}</label>
              <span class="ag-hint">{t('agentDefs.fields.descriptionHint')}</span>
            </div>
            <textarea
              id="ag-desc"
              class="ag-textarea selectable"
              rows="3"
              placeholder={t('agentDefs.fields.descriptionPlaceholder') as string}
              bind:value={draft.description}
            ></textarea>
            <div class="counter {descriptionOver ? 'bad' : ''}">
              {draft.description.length} / {MAX_DESCRIPTION}
            </div>
            {#if draft.description.trim() === ''}
              <span class="ag-hint warn">{t('agentDefs.fields.descriptionMissing')}</span>
            {:else if descriptionOver}
              <span class="ag-hint bad">{t('agentDefs.fields.descriptionTooLong')}</span>
            {/if}
          </div>
        </div>

        <div class="ag-card">
          <div class="ag-field">
            <div class="ag-card-info">
              <span class="ag-label">{t('agentDefs.fields.color')}</span>
              <span class="ag-hint">{t('agentDefs.fields.colorHint')}</span>
            </div>
            <div class="color-swatches">
              {#each AGENT_COLORS as color (color)}
                <button
                  class="swatch {draft.color === color ? 'active' : ''}"
                  style="background: {color}"
                  aria-label={color}
                  aria-pressed={draft.color === color}
                  on:click={() => { if (draft) draft.color = color; }}
                ></button>
              {/each}
            </div>
          </div>
        </div>
      </div>

      <div class="ag-group">
        <div class="ag-group-title">{t('agentDefs.groups.instructions')}</div>
        <div class="ag-card">
          <div class="ag-field">
            <div class="ag-card-info">
              <label class="ag-label" for="ag-prompt">{t('agentDefs.fields.systemPrompt')}</label>
              <span class="ag-hint">{t('agentDefs.fields.systemPromptHint')}</span>
            </div>
            <textarea
              id="ag-prompt"
              class="ag-textarea body-input selectable"
              rows="16"
              spellcheck="false"
              placeholder={t('agentDefs.fields.systemPromptPlaceholder') as string}
              bind:value={draft.systemPrompt}
            ></textarea>
            <div class="counter">
              {(t('agentDefs.promptStats') as (w: number, l: number) => string)(
                draft.systemPrompt.trim() ? draft.systemPrompt.trim().split(/\s+/).length : 0,
                draft.systemPrompt.split('\n').length,
              )}
            </div>
          </div>
        </div>
      </div>

      <div class="ag-group">
        <div class="ag-group-title">{t('agentDefs.groups.tools')}</div>
        <div class="ag-card">
          <div class="ag-field">
            <div class="ag-card-info">
              <span class="ag-label">{t('agentDefs.fields.tools')}</span>
              <span class="ag-hint">{t('agentDefs.fields.toolsHint')}</span>
            </div>

            {#if draft.tools.length > 0}
              <div class="tool-chips">
                {#each draft.tools as tool (tool)}
                  <span class="tool-chip">
                    <code>{tool}</code>
                    <button on:click={() => removeTool(tool)} aria-label={t('common.remove') as string}>
                      <Icon name="x" size={9}/>
                    </button>
                  </span>
                {/each}
              </div>
            {:else}
              <span class="ag-hint">{t('agentDefs.fields.toolsEmpty')}</span>
            {/if}

            <div class="inline-row">
              <input
                class="ag-input selectable"
                type="text"
                list="agent-tools"
                placeholder={t('agentDefs.fields.toolsPlaceholder') as string}
                bind:value={toolDraft}
                on:keydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTool(toolDraft); } }}
              />
              <datalist id="agent-tools">
                {#each toolSuggestions as tool}<option value={tool}></option>{/each}
              </datalist>
              <button class="btn" on:click={() => addTool(toolDraft)} disabled={!toolDraft.trim()}>
                <Icon name="plus" size={12}/> {t('common.add')}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="ag-group">
        <div class="ag-group-title">{t('agentDefs.groups.location')}</div>
        <div class="ag-card row-card">
          <div class="row-fields">
            <div class="ag-field">
              <span class="ag-hint">{t('agentDefs.fields.scope')}</span>
              <Select
                value={draft.scope}
                options={scopeOptions}
                ariaLabel={t('agentDefs.fields.scope') as string}
                on:change={(e) => setScope(e.detail as NativeAgentScope)}
              />
            </div>
            {#if draft.scope === 'project'}
              <div class="ag-field">
                <span class="ag-hint">{t('agentDefs.fields.project')}</span>
                <Select
                  value={draft.projectId}
                  options={projectOptions}
                  ariaLabel={t('agentDefs.fields.project') as string}
                  on:change={(e) => setProject(e.detail)}
                />
              </div>
            {/if}
          </div>
          <span class="ag-hint">
            {draft.scope === 'global'
              ? t('agentDefs.scope.globalHint')
              : t('agentDefs.scope.projectHint')}
          </span>
        </div>

        <div class="ag-card">
          <div class="ag-card-info stacked">
            <span class="ag-label">{t('cliProviders.title')}</span>
            <span class="ag-hint">{t('agentDefs.providersHint')}</span>
          </div>
          <ProviderPicker
            selected={draft.targets}
            {reached}
            {unavailable}
            on:change={(e) => setTargets(e.detail)}
          />
        </div>

        {#if selected && selected.locations.length > 0}
          <div class="ag-card">
            <div class="ag-card-info stacked">
              <span class="ag-label">{t('agentDefs.locations.title')}</span>
              <span class="ag-hint">{t('agentDefs.locations.hint')}</span>
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

      <div class="ag-group">
        <button class="ag-group-title advanced" on:click={() => advancedOpen = !advancedOpen}>
          <Icon name={advancedOpen ? 'chev-d' : 'chev-r'} size={11}/>
          {t('agentDefs.groups.advanced')}
        </button>
        {#if advancedOpen}
          {#if capabilityProviders.length === 0}
            <div class="ag-card">
              <span class="ag-hint">{t('agentDefs.fields.pickProviderFirst')}</span>
            </div>
          {:else}
            <div class="ag-card row-card">
              <div class="row-fields">
                <div class="ag-field">
                  <span class="ag-hint">{t('agentDefs.fields.model')}</span>
                  <Select
                    value={draft.model}
                    options={modelOptions}
                    ariaLabel={t('agentDefs.fields.model') as string}
                    on:change={(e) => { if (draft) draft.model = e.detail; }}
                  />
                </div>
                <div class="ag-field">
                  <span class="ag-hint">{t('agentDefs.fields.effort')}</span>
                  <Select
                    value={draft.effort}
                    options={effortOptions}
                    ariaLabel={t('agentDefs.fields.effort') as string}
                    on:change={(e) => { if (draft) draft.effort = e.detail; }}
                  />
                </div>
                <div class="ag-field">
                  <span class="ag-hint">{t('agentDefs.fields.permissionMode')}</span>
                  <Select
                    value={draft.permissionMode}
                    options={permissionOptions}
                    ariaLabel={t('agentDefs.fields.permissionMode') as string}
                    on:change={(e) => { if (draft) draft.permissionMode = e.detail; }}
                  />
                </div>
              </div>
              <span class="ag-hint">{t('agentDefs.fields.capabilitiesHint')}</span>
            </div>
          {/if}

          <div class="ag-card">
            <div class="ag-field">
              <div class="ag-card-info">
                <span class="ag-label">{t('agentDefs.fields.skills')}</span>
                <span class="ag-hint">{t('agentDefs.fields.skillsHint')}</span>
              </div>

              {#if draft.skills.length > 0}
                <div class="tool-chips">
                  {#each draft.skills as skill (skill)}
                    <span class="tool-chip">
                      <code>{skill}</code>
                      <button on:click={() => removeSkill(skill)} aria-label={t('common.remove') as string}>
                        <Icon name="x" size={9}/>
                      </button>
                    </span>
                  {/each}
                </div>
              {:else}
                <span class="ag-hint">{t('agentDefs.fields.skillsEmpty')}</span>
              {/if}

              <div class="inline-row">
                <input
                  class="ag-input selectable"
                  type="text"
                  list="agent-skills"
                  placeholder={t('agentDefs.fields.skillsPlaceholder') as string}
                  bind:value={skillDraft}
                  on:keydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSkill(skillDraft); } }}
                />
                <datalist id="agent-skills">
                  {#each skillOptions as skill}<option value={skill}></option>{/each}
                </datalist>
                <button class="btn" on:click={() => addSkill(skillDraft)} disabled={!skillDraft.trim()}>
                  <Icon name="plus" size={12}/> {t('common.add')}
                </button>
              </div>
            </div>
          </div>

          <div class="ag-card">
            <div class="ag-field">
              <div class="ag-card-info">
                <label class="ag-label" for="ag-memory">{t('agentDefs.fields.memory')}</label>
                <span class="ag-hint">{t('agentDefs.fields.memoryHint')}</span>
              </div>
              <input
                id="ag-memory"
                class="ag-input selectable"
                type="text"
                list="agent-memory"
                placeholder={t('agentDefs.fields.inherit') as string}
                bind:value={draft.memory}
              />
              <datalist id="agent-memory">
                {#each MEMORY_VALUES as value}<option value={value}></option>{/each}
              </datalist>
            </div>
          </div>

          <div class="ag-card">
            <div class="ag-field">
              <div class="ag-card-info">
                <label class="ag-label" for="ag-extra">{t('agentDefs.fields.extraFrontmatter')}</label>
                <span class="ag-hint">{t('agentDefs.fields.extraFrontmatterHint')}</span>
              </div>
              <textarea
                id="ag-extra"
                class="ag-textarea mono selectable"
                rows="4"
                spellcheck="false"
                bind:value={draft.extraFrontmatter}
              ></textarea>
            </div>
          </div>
        {/if}
      </div>

      <div class="save-bar" class:visible={dirty || selectedPath === null}>
        <span class="save-note">
          {#if nameClash}
            <span class="ag-hint bad">{t('agentDefs.nameClash')}</span>
          {:else if !slug}
            <span class="ag-hint warn">{t('agentDefs.nameRequired')}</span>
          {:else if draft.targets.length === 0}
            <span class="ag-hint warn">{t('cliProviders.pickOne')}</span>
          {:else if selectedPath === null}
            <span class="ag-hint">{(t('agentDefs.willCreate') as (n: string) => string)(slug)}</span>
          {:else}
            <span class="ag-hint">{t('agentDefs.unsaved')}</span>
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
  </section>
</div>

{#if $nativeAgentsError}
  <div class="banner bad floating"><Icon name="alert" size={13}/><span>{$nativeAgentsError}</span></div>
{/if}

{#if deleteTarget}
  <DeleteAgentModal
    name={deleteTarget.name}
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

  .agent-row {
    display: flex;
    align-items: center;
    gap: 2px;
    border-radius: var(--r-md);
  }
  .agent-row :global(.ag-item) { min-width: 0; }

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
  .color-swatches { display: flex; flex-wrap: wrap; gap: 6px; }

  .swatch {
    border: 1px solid var(--stroke-1);
    border-radius: 6px;
    cursor: pointer;
    height: 22px;
    padding: 0;
    width: 22px;
  }

  .swatch.active { border-color: var(--fg-0); box-shadow: 0 0 0 2px var(--bg-2); }

  .mention-dot {
    border-radius: 50%;
    display: inline-block;
    height: 8px;
    width: 8px;
  }
</style>
