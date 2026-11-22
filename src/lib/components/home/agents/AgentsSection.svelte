<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * Editor for native agent definitions (the .md files the CLI agents read), across every scope
   * and every targeted provider. Edits go to a local draft; the files are only written on save.
   */
  import { onMount } from 'svelte';
  import { t } from '#lib/i18n';
  import Icon from '#lib/components/Icon.svelte';
  import Select from '#lib/components/Select.svelte';
  import SearchInput from '#lib/components/SearchInput.svelte';
  import Spinner from '#lib/components/Spinner.svelte';
  import Skeleton from '#lib/components/Skeleton.svelte';
  import CopyButton from '#lib/components/CopyButton.svelte';
  import DeleteAgentModal from './DeleteAgentModal.svelte';
  import SplitPanel from '#lib/components/SplitPanel.svelte';
  import SearchEmpty from '#lib/components/SearchEmpty.svelte';
  import ProviderPicker from '#lib/components/home/ProviderPicker.svelte';
  import ProviderChips from '#lib/components/home/ProviderChips.svelte';
  import ProviderLogo from './ProviderLogo.svelte';
  import { projects, loadProjects } from '#lib/stores/project';
  import {
    loadNativeAgents,
    nativeAgents, nativeAgentsError, nativeAgentsLoading,
  } from '#lib/stores/native-agents';
  import {
    deleteNativeAgent, duplicateNativeAgent, saveNativeAgent,
    type NativeAgent, type NativeAgentScope,
  } from '#lib/services/native-agent-service';
  import { revealInFileManager } from '#lib/services/file-service';
  import { KNOWN_TOOLS } from '#lib/utils/agent/tools';
  import { cliProviders, loadCliProviders } from '#lib/stores/cli-providers';
  import { effortsOf, permissionModesOf } from '#lib/components/home/agents/cli-options';
  import { skills as skillList, loadSkills } from '#lib/stores/skills';
  import { effortLabel, permissionModeLabel } from '#lib/utils/agent/run-options';
  import { reachedProviders, type CliProviderId } from '#lib/services/cli-provider-service';
  import { sortProviders } from '#lib/utils/home/cli-providers';
  import { agentSlug, AGENT_COLORS, MAX_DESCRIPTION } from '#lib/utils/home/native-agents';

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
    await Promise.all([loadProjects(), loadCliProviders(), loadSkills()]);
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
   * The CLIs that will read this definition, so the fields below offer what they
   * accept. Their vocabularies are declared, not probed: Cairn no longer runs a
   * provider to ask it.
   */
  $: capabilityProviders = draft?.targets ?? [];

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
   *
   * A value a CLI no longer declares is kept as its own entry rather than
   * dropped, so opening a definition never silently clears what it holds.
   */
  function optionsWithCurrent(
    values: readonly string[],
    current: string,
    label: (value: string) => string,
  ): { value: string; label: string }[] {
    const options = [
      { value: '', label: t('agentDefs.fields.inherit') as string },
      ...values.map((value) => ({ value, label: label(value) })),
    ];
    if (current && !options.some((o) => o.value === current)) {
      options.push({ value: current, label: current });
    }
    return options;
  }

  $: effortOptions = optionsWithCurrent(
    unionOf(capabilityProviders.map((id) => [...effortsOf(id)]), (level) => level),
    draft?.effort ?? '',
    effortLabel,
  );

  $: permissionOptions = optionsWithCurrent(
    unionOf(capabilityProviders.map((id) => [...permissionModesOf(id)]), (mode) => mode),
    draft?.permissionMode ?? '',
    permissionModeLabel,
  );

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

<header class="ag-page-head">
  <h1>
    {t('home.agents.title')}
    {#if $nativeAgents.length > 0}<span class="head-count">{$nativeAgents.length}</span>{/if}
  </h1>
</header>

{#if !$nativeAgentsLoading && $nativeAgents.length === 0 && draft === null}
  <section class="page-empty">
    <Icon name="agent" size={22}/>
    <h2>{t('agentDefs.emptyTitle')}</h2>
    <p>{t('agentDefs.emptyDesc')}</p>
    <button class="btn primary new-agent" on:click={create}>
      <Icon name="plus" size={12}/> {t('agentDefs.new')}
    </button>
  </section>
{:else}
<SplitPanel>
  <svelte:fragment slot="list">
    <div class="list-tools">
      <SearchInput bind:value={search} placeholder={t('agentDefs.searchPlaceholder') as string}/>
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
          {@const count = $nativeAgents.filter((a) => a.providers.includes(provider.id)).length}
          {#if count > 0 && count < $nativeAgents.length}
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
      {#if $nativeAgentsLoading && $nativeAgents.length === 0}
        <Skeleton lines={4} height={36} gap={6}/>
      {:else}
        {#each groups as group (group.scope)}
          <h2 class="group-label">{t(`agentDefs.scope.${group.scope}`)}</h2>
          {#each group.items as agent (agent.path)}
            <button
              class="ag-item"
              class:is-active={selectedPath === agent.path}
              aria-pressed={selectedPath === agent.path}
              on:click={() => select(agent)}
            >
              <span class="avatar" style={agent.color ? `--agent: ${agent.color}` : ''}>{initials(agent.name)}</span>
              <span class="ag-item-text">
                <span class="ag-item-name">{agent.name}</span>
                <span class="ag-item-sub">{agent.scope === 'project' ? agent.projectName : agent.description}</span>
              </span>
            </button>
          {/each}
        {/each}
        {#if visible.length === 0 && $nativeAgents.length > 0}
          <SearchEmpty
            isCompact
            title={t('agentDefs.noResults') as string}
            text={(query ? (t('agentDefs.noResultsText') as (q: string) => string)(search.trim()) : t('agentDefs.noResultsFiltered')) as string}
            clearLabel={(query ? t('common.clearSearch') : t('agentDefs.clearFilters')) as string}
            on:clear={() => { search = ''; scopeFilter = 'all'; providerFilter = 'all'; }}
          />
        {/if}
        {#if draft && selectedPath === null}
          <button class="ag-item is-active" aria-pressed="true">
            <span class="avatar" style={draft.color ? `--agent: ${draft.color}` : ''}>{initials(slug || '?')}</span>
            <span class="ag-item-text">
              <span class="ag-item-name">{slug || t('agentDefs.new')}</span>
              <span class="ag-item-sub">{t('agentDefs.new')}</span>
            </span>
          </button>
        {:else if visible.length > 0 || $nativeAgents.length === 0}
          <button class="ag-item new-agent" on:click={create}>
            <span class="avatar is-dashed"><Icon name="plus" size={14}/></span>
            <span class="ag-item-name">{t('agentDefs.new')}</span>
          </button>
        {/if}
      {/if}
    </div>
  </svelte:fragment>

  {#if draft === null}
    <div class="detail-none">
      <span class="none-avatars" aria-hidden="true">
        {#each $nativeAgents.slice(0, 3) as agent (agent.path)}
          <span class="avatar is-large" style={agent.color ? `--agent: ${agent.color}` : ''}>{initials(agent.name)}</span>
        {/each}
      </span>
      <h2>{t('agentDefs.pickTitle')}</h2>
      <p>{t('agentDefs.pickDesc')}</p>
      <button class="btn" on:click={create}>
        <Icon name="plus" size={12}/> {t('agentDefs.new')}
      </button>
    </div>
  {:else}
    <div class="detail-head">
      <span class="avatar is-large" style={draft.color ? `--agent: ${draft.color}` : ''}>{initials(slug || draft.name || '?')}</span>
      <div class="detail-title">
        <div class="title-row">
          <h2>{slug || t('agentDefs.new')}</h2>
          {#if slug}<code class="invoke selectable" title={t('agentDefs.invokeHint') as string}>@{slug}</code>{/if}
        </div>
        <p>{draft.scope === 'project' ? ($projects.find((p) => p.id === draft?.projectId)?.name ?? '') : t('agentDefs.scope.global')}</p>
      </div>
      {#if selected}
        <div class="head-actions">
          <button class="btn ghost icon-only" on:click={() => selected && duplicate(selected)} title={t('agentDefs.duplicate') as string} aria-label={t('agentDefs.duplicate') as string}>
            <Icon name="copy" size={13}/>
          </button>
          <button class="btn ghost icon-only" on:click={() => selected && revealInFileManager(selected.path)} title={t('agentDefs.reveal') as string} aria-label={t('agentDefs.reveal') as string}>
            <Icon name="folder-open" size={13}/>
          </button>
          <button class="btn ghost icon-only delete" on:click={() => deleteTarget = selected} title={t('agentDefs.delete.heading') as string} aria-label={t('agentDefs.delete.heading') as string}>
            <Icon name="trash" size={13}/>
          </button>
        </div>
      {/if}
    </div>

    <div class="detail-body">
      <section class="section">
        <h3>{t('agentDefs.groups.identity')}</h3>

        <div class="field">
          <label class="label" for="ag-name">{t('agentDefs.fields.name')}</label>
          <div class="control">
            <input
              id="ag-name"
              class="input name-input selectable"
              type="text"
              placeholder={t('agentDefs.fields.namePlaceholder') as string}
              bind:value={draft.name}
            />
            {#if nameClash}<span class="hint bad">{t('agentDefs.nameClash')}</span>{/if}
          </div>
        </div>

        <div class="field">
          <label class="label" for="ag-desc">{t('agentDefs.fields.description')}</label>
          <div class="control">
            <textarea
              id="ag-desc"
              class="input textarea selectable"
              rows="3"
              placeholder={t('agentDefs.fields.descriptionPlaceholder') as string}
              bind:value={draft.description}
            ></textarea>
            <div class="control-foot">
              {#if draft.description.trim() === ''}
                <span class="hint warn">{t('agentDefs.fields.descriptionMissing')}</span>
              {:else if descriptionOver}
                <span class="hint bad">{t('agentDefs.fields.descriptionTooLong')}</span>
              {:else}
                <span class="hint">{t('agentDefs.fields.descriptionHint')}</span>
              {/if}
              <span class="counter" class:bad={descriptionOver}>{draft.description.length} / {MAX_DESCRIPTION}</span>
            </div>
          </div>
        </div>

        <div class="field">
          <span class="label">{t('agentDefs.fields.color')}</span>
          <div class="color-swatches">
            {#each AGENT_COLORS as color (color)}
              <button
                class="swatch"
                class:active={draft.color === color}
                style="background: {color}"
                aria-label={color}
                aria-pressed={draft.color === color}
                on:click={() => { if (draft) draft.color = color; }}
              ></button>
            {/each}
          </div>
        </div>
      </section>

      <section class="section">
        <div class="section-head">
          <h3>{t('agentDefs.fields.systemPrompt')}</h3>
          <div class="spacer"></div>
          <span class="counter">
            {(t('agentDefs.promptStats') as (w: number, l: number) => string)(
              draft.systemPrompt.trim() ? draft.systemPrompt.trim().split(/\s+/).length : 0,
              draft.systemPrompt.split('\n').length,
            )}
          </span>
          <CopyButton value={draft.systemPrompt} size={13}/>
        </div>
        <textarea
          id="ag-prompt"
          class="input textarea body-input selectable"
          spellcheck="false"
          aria-label={t('agentDefs.fields.systemPrompt') as string}
          placeholder={t('agentDefs.fields.systemPromptPlaceholder') as string}
          bind:value={draft.systemPrompt}
        ></textarea>
      </section>

      <section class="section">
        <h3>{t('agentDefs.groups.behaviour')}</h3>

        {#if capabilityProviders.length === 0}
          <p class="hint section-note">{t('agentDefs.fields.pickProviderFirst')}</p>
        {:else}
          <div class="field">
            <label class="label" for="ag-model">{t('agentDefs.fields.model')}</label>
            <!-- Typed rather than picked: Cairn no longer asks a provider what
                 models it serves, and the CLI rejects an unknown id itself with
                 a better message than a stale list could. -->
            <input
              id="ag-model"
              class="input selectable"
              value={draft.model}
              placeholder={t('agentDefs.fields.modelPlaceholder') as string}
              on:input={(e) => { if (draft) draft.model = e.currentTarget.value; }}
            />
          </div>
          <div class="field">
            <span class="label">{t('agentDefs.fields.effort')}</span>
            <Select
              value={draft.effort}
              options={effortOptions}
              ariaLabel={t('agentDefs.fields.effort') as string}
              on:change={(e) => { if (draft) draft.effort = e.detail; }}
            />
          </div>
          <div class="field">
            <span class="label">{t('agentDefs.fields.permissionMode')}</span>
            <Select
              value={draft.permissionMode}
              options={permissionOptions}
              ariaLabel={t('agentDefs.fields.permissionMode') as string}
              on:change={(e) => { if (draft) draft.permissionMode = e.detail; }}
            />
          </div>
        {/if}

        <div class="field">
          <label class="label" for="ag-memory">{t('agentDefs.fields.memory')}</label>
          <div class="control">
            <input
              id="ag-memory"
              class="input selectable"
              type="text"
              list="agent-memory"
              placeholder={t('agentDefs.fields.inherit') as string}
              bind:value={draft.memory}
            />
            <span class="hint">{t('agentDefs.fields.memoryHint')}</span>
          </div>
          <datalist id="agent-memory">
            {#each MEMORY_VALUES as value}<option value={value}></option>{/each}
          </datalist>
        </div>

        {#each [
          { list: 'agent-tools', label: t('agentDefs.fields.tools'), values: draft.tools, empty: t('agentDefs.fields.toolsEmpty'), placeholder: t('agentDefs.fields.toolsPlaceholder'), suggestions: toolSuggestions, isTools: true },
          { list: 'agent-skills', label: t('agentDefs.fields.skills'), values: draft.skills, empty: t('agentDefs.fields.skillsEmpty'), placeholder: t('agentDefs.fields.skillsPlaceholder'), suggestions: skillOptions, isTools: false },
        ] as picker (picker.list)}
          <div class="field">
            <span class="label">{picker.label}</span>
            <div class="control">
              {#if picker.values.length > 0}
                <div class="tool-chips">
                  {#each picker.values as value (value)}
                    <span class="tool-chip">
                      <code>{value}</code>
                      <button on:click={() => picker.isTools ? removeTool(value) : removeSkill(value)} aria-label={t('common.remove') as string}>
                        <Icon name="x" size={9}/>
                      </button>
                    </span>
                  {/each}
                </div>
              {/if}
              <div class="inline-row">
                {#if picker.isTools}
                  <input
                    class="input selectable"
                    type="text"
                    list={picker.list}
                    placeholder={(picker.values.length === 0 ? picker.empty : picker.placeholder) as string}
                    bind:value={toolDraft}
                    on:keydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTool(toolDraft); } }}
                  />
                  <button class="btn" on:click={() => addTool(toolDraft)} disabled={!toolDraft.trim()}>
                    <Icon name="plus" size={12}/> {t('common.add')}
                  </button>
                {:else}
                  <input
                    class="input selectable"
                    type="text"
                    list={picker.list}
                    placeholder={(picker.values.length === 0 ? picker.empty : picker.placeholder) as string}
                    bind:value={skillDraft}
                    on:keydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSkill(skillDraft); } }}
                  />
                  <button class="btn" on:click={() => addSkill(skillDraft)} disabled={!skillDraft.trim()}>
                    <Icon name="plus" size={12}/> {t('common.add')}
                  </button>
                {/if}
              </div>
            </div>
            <datalist id={picker.list}>
              {#each picker.suggestions as option}<option value={option}></option>{/each}
            </datalist>
          </div>
        {/each}
      </section>

      <section class="section">
        <h3>{t('agentDefs.groups.location')}</h3>

        <div class="field">
          <span class="label">{t('agentDefs.fields.scope')}</span>
          <div class="control">
            <Select
              value={draft.scope}
              options={scopeOptions}
              ariaLabel={t('agentDefs.fields.scope') as string}
              on:change={(e) => setScope(e.detail as NativeAgentScope)}
            />
            <span class="hint">
              {draft.scope === 'global' ? t('agentDefs.scope.globalHint') : t('agentDefs.scope.projectHint')}
            </span>
          </div>
        </div>
        {#if draft.scope === 'project'}
          <div class="field">
            <span class="label">{t('agentDefs.fields.project')}</span>
            <Select
              value={draft.projectId}
              options={projectOptions}
              ariaLabel={t('agentDefs.fields.project') as string}
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
            on:change={(e) => setTargets(e.detail)}
          />
        </div>

        {#if selected && selected.locations.length > 0}
          <div class="field is-stacked">
            <span class="label">{t('agentDefs.locations.title')}</span>
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
          {t('agentDefs.groups.advanced')}
        </button>
        {#if advancedOpen}
          <div class="field is-stacked advanced-body">
            <label class="label" for="ag-extra">{t('agentDefs.fields.extraFrontmatter')}</label>
            <textarea
              id="ag-extra"
              class="input textarea mono selectable"
              rows="4"
              spellcheck="false"
              bind:value={draft.extraFrontmatter}
            ></textarea>
            <span class="hint">{t('agentDefs.fields.extraFrontmatterHint')}</span>
          </div>
        {/if}
      </section>
    </div>

    {#if selected?.divergent || error}
      <div class="notices">
        {#if selected?.divergent}
          <div class="banner warn"><Icon name="alert" size={13}/><span>{t('agentDefs.divergent')}</span></div>
        {/if}
        {#if error}
          <div class="banner bad"><Icon name="alert" size={13}/><span>{error}</span></div>
        {/if}
      </div>
    {/if}

    {#if dirty || selectedPath === null}
      <div class="save-bar">
        <span class="save-note">
          {#if nameClash}
            <span class="hint bad">{t('agentDefs.nameClash')}</span>
          {:else if !slug}
            <span class="hint warn">{t('agentDefs.nameRequired')}</span>
          {:else if draft.targets.length === 0}
            <span class="hint warn">{t('cliProviders.pickOne')}</span>
          {:else if selectedPath === null}
            <span class="hint">{(t('agentDefs.willCreate') as (n: string) => string)(slug)}</span>
          {:else}
            <span class="hint">{t('agentDefs.unsaved')}</span>
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
          {#if saving}<Spinner size={11}/>{/if}
          {t('common.save')}
        </button>
      </div>
    {/if}
  {/if}
</SplitPanel>
{/if}

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
  /* -- page head -- */
  .ag-page-head { margin-bottom: 32px; }
  .ag-page-head h1 {
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
  .ag-item.new-agent { color: var(--fg-2); }
  .ag-item.new-agent:hover { color: var(--fg-0); }
  .ag-item-text { display: flex; flex: 1; flex-direction: column; min-width: 0; }
  .ag-item-name,
  .ag-item-sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ag-item-name { font-size: 13px; font-weight: 500; }
  .ag-item-sub { font-size: 11.5px; color: var(--fg-3); }

  /* The agent's own colour, toned down so the initials stay readable in both themes. */
  .avatar {
    --agent: var(--fg-3);
    display: grid;
    flex: none;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: var(--r-sm);
    /* srgb, not oklch: mixing two hues in oklch walks the hue wheel between
       them, and a purple on the warm background came out red. */
    background: color-mix(in srgb, var(--agent) 22%, var(--bg-1));
    border: 1px solid color-mix(in srgb, var(--agent) 45%, var(--bg-1));
    font-size: 10.5px;
    font-weight: 600;
    color: var(--fg-0);
  }
  .avatar.is-large { width: 40px; height: 40px; border-radius: var(--r-md); font-size: 13px; }
  .avatar.is-dashed { background: transparent; border: 1px dashed var(--stroke-1); color: var(--fg-3); }

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
  .none-avatars { display: flex; gap: 8px; margin-bottom: 12px; opacity: 0.7; }
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

  .color-swatches { display: flex; flex-wrap: wrap; gap: 8px; padding-top: 4px; }
  .swatch { width: 22px; height: 22px; padding: 0; border: 1px solid var(--stroke-1); border-radius: 50%; }
  .swatch.active { border-color: var(--fg-0); box-shadow: 0 0 0 2px var(--bg-1), 0 0 0 3px var(--fg-0); }

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
</style>
