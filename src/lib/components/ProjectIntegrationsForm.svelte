<script lang="ts">
  /**
   * Binding block shared by the project modals: which connection serves the
   * tracker, the forge and the CI, the project key or repository path of each,
   * and the two opt-in ticket transitions. Edits `bindings` in place through
   * `bind:`; the parent decides when to persist. Renders nothing without any
   * connection.
   */
  import { onDestroy, onMount } from 'svelte';
  import { t } from '$lib/i18n';
  import Icon from '$lib/components/Icon.svelte';
  import Select from '$lib/components/Select.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import { connections, kindDescriptors, loadConnections, loadKinds } from '$lib/stores/integrations';
  import { listTrackerProjects, suggestProjectIntegrations, trackerListStatuses } from '$lib/services/integration-service';
  import type { Capability, ProjectIntegrations, TrackerProject, TrackerStatus } from '$lib/types/integrations';
  import { parseRemoteUrl } from '$lib/utils/git/remote-url';

  export let projectId = '';
  export let remoteUrl = '';
  export let bindings: ProjectIntegrations;

  const NONE = '';
  const PICKER_DEBOUNCE_MS = 250;

  let suggestion: ProjectIntegrations | null = null;
  let isSuggestionDismissed = false;
  let pickerText = '';
  let pickerResults: TrackerProject[] = [];
  let isPickerOpen = false;
  let isPickerLoading = false;
  let pickerTimer: ReturnType<typeof setTimeout> | null = null;
  let suggestedFor = '';

  onMount(async () => {
    await Promise.all([loadKinds(), loadConnections()]);
  });

  onDestroy(() => {
    if (pickerTimer) clearTimeout(pickerTimer);
  });

  $: remotePath = parseRemoteUrl(remoteUrl)?.path ?? '';
  $: remoteHost = parseRemoteUrl(remoteUrl)?.host ?? '';
  $: hasBindings = bindings.tracker !== null || bindings.forge !== null || bindings.ci !== null;
  $: if (remoteUrl && remoteUrl !== suggestedFor && $connections.length > 0) void suggest(remoteUrl);

  async function suggest(url: string) {
    suggestedFor = url;
    try {
      const next = await suggestProjectIntegrations(projectId, url);
      const isEmpty = next.tracker === null && next.forge === null && next.ci === null;
      suggestion = isEmpty ? null : next;
    } catch {
      suggestion = null;
    }
  }

  $: suggestedLabel = suggestion
    ? connectionLabel(suggestion.forge?.connectionId ?? suggestion.tracker?.connectionId ?? '')
    : '';
  $: showSuggestion = suggestion !== null && !isSuggestionDismissed && !hasBindings;

  function connectionLabel(id: string): string {
    return $connections.find((c) => c.id === id)?.label ?? '';
  }

  function optionsFor(
    capability: Capability,
    all: typeof $connections,
    descriptors: typeof $kindDescriptors,
  ) {
    const providing = all.filter((c) =>
      descriptors.find((d) => d.kind === c.kind)?.provides.includes(capability));
    return [
      { value: NONE, label: t('integrations.bindings.none') as string },
      ...providing.map((c) => ({ value: c.id, label: c.label })),
    ];
  }

  $: trackerOptions = optionsFor('tracker', $connections, $kindDescriptors);
  $: forgeOptions = optionsFor('forge', $connections, $kindDescriptors);
  $: ciOptions = optionsFor('ci', $connections, $kindDescriptors);
  $: trackerConnection = $connections.find((c) => c.id === bindings.tracker?.connectionId) ?? null;
  $: trackerDescriptor = $kindDescriptors.find((d) => d.kind === trackerConnection?.kind) ?? null;
  $: isRepoTracker = trackerDescriptor?.provides.includes('forge') ?? false;

  function acceptSuggestion() {
    if (!suggestion) return;
    bindings = { ...suggestion, autoTransition: bindings.autoTransition };
    isSuggestionDismissed = true;
  }

  function setTracker(connectionId: string) {
    if (connectionId === NONE) {
      bindings = { ...bindings, tracker: null };
      return;
    }
    const kind = $connections.find((c) => c.id === connectionId)?.kind;
    const providesForge = $kindDescriptors.find((d) => d.kind === kind)?.provides.includes('forge') ?? false;
    const key = providesForge ? remotePath : '';
    bindings = { ...bindings, tracker: { connectionId, projectKey: key, label: key } };
    pickerText = '';
    pickerResults = [];
  }

  function setRepo(capability: 'forge' | 'ci', connectionId: string) {
    if (connectionId === NONE) {
      bindings = { ...bindings, [capability]: null };
      return;
    }
    const other = capability === 'forge' ? bindings.ci : bindings.forge;
    const repoPath = other?.connectionId === connectionId ? other.repoPath : remotePath;
    bindings = { ...bindings, [capability]: { connectionId, repoPath } };
  }

  function setRepoPath(capability: 'forge' | 'ci', repoPath: string) {
    const current = bindings[capability];
    if (!current) return;
    const otherKey = capability === 'forge' ? 'ci' : 'forge';
    const other = bindings[otherKey];
    const isShared = other?.connectionId === current.connectionId;
    bindings = {
      ...bindings,
      [capability]: { ...current, repoPath },
      ...(isShared && other ? { [otherKey]: { ...other, repoPath } } : {}),
    };
  }

  function setProjectKey(projectKey: string, label = projectKey) {
    if (!bindings.tracker) return;
    bindings = { ...bindings, tracker: { ...bindings.tracker, projectKey, label } };
  }

  function onPickerInput(text: string) {
    setProjectKey(text);
    pickerText = text;
    isPickerOpen = true;
    if (pickerTimer) clearTimeout(pickerTimer);
    pickerTimer = setTimeout(() => void searchProjects(text), PICKER_DEBOUNCE_MS);
  }

  async function searchProjects(text: string) {
    const connectionId = bindings.tracker?.connectionId;
    if (!connectionId) return;
    isPickerLoading = true;
    try {
      const results = await listTrackerProjects(connectionId, text);
      if (text === pickerText) pickerResults = results;
    } catch {
      pickerResults = [];
    } finally {
      isPickerLoading = false;
    }
  }

  function pickProject(project: TrackerProject) {
    setProjectKey(project.key, project.label);
    pickerText = project.key;
    isPickerOpen = false;
  }

  let trackerStatuses: TrackerStatus[] = [];
  let isLoadingStatuses = false;
  let statusesFetchedFor = '';

  $: if (projectId && bindings.tracker && bindings.tracker.connectionId !== statusesFetchedFor) {
    void fetchStatuses();
  }
  $: if (!bindings.tracker) {
    trackerStatuses = [];
    statusesFetchedFor = '';
  }

  async function fetchStatuses() {
    if (!projectId || !bindings.tracker) return;
    const connectionId = bindings.tracker.connectionId;
    statusesFetchedFor = connectionId;
    isLoadingStatuses = true;
    try {
      trackerStatuses = await trackerListStatuses(projectId);
    } catch {
      trackerStatuses = [];
    } finally {
      isLoadingStatuses = false;
    }
  }

  $: transitionOptions = [
    { value: '', label: t('integrations.bindings.transitionNone') as string },
    ...trackerStatuses.map(s => ({ value: s.name, label: s.name })),
  ];

  function setTransition(field: 'onCreate' | 'onFinalize', value: string) {
    bindings = {
      ...bindings,
      autoTransition: { ...bindings.autoTransition, [field]: value === '' ? null : value },
    };
  }
</script>

{#if $connections.length > 0}
  <div class="pi-block">
    <div class="pi-title">{t('integrations.bindings.title')}</div>
    <p class="pi-desc">{t('integrations.bindings.desc')}</p>

    {#if showSuggestion}
      <div class="pi-suggest">
        <Icon name="link" size={13}/>
        <span class="pi-suggest-text">
          {(t('integrations.bindings.suggest') as (h: string, l: string) => string)(remoteHost, suggestedLabel)}
        </span>
        <button class="btn primary" on:click={acceptSuggestion}>{t('integrations.bindings.accept')}</button>
        <button class="btn ghost" on:click={() => isSuggestionDismissed = true}>{t('integrations.bindings.dismiss')}</button>
      </div>
    {/if}

    <div class="pi-grid">
      <div class="pi-field">
        <span class="pi-label">{t('integrations.bindings.tracker')}</span>
        {#if trackerOptions.length > 1}
          <Select
            value={bindings.tracker?.connectionId ?? NONE}
            options={trackerOptions}
            ariaLabel={t('integrations.bindings.tracker') as string}
            on:change={(e) => setTracker(e.detail)}
          />
        {:else}
          <span class="pi-hint">{t('integrations.bindings.noConnectionForKind')}</span>
        {/if}
      </div>

      <div class="pi-field">
        <span class="pi-label">{t('integrations.bindings.forge')}</span>
        {#if forgeOptions.length > 1}
          <Select
            value={bindings.forge?.connectionId ?? NONE}
            options={forgeOptions}
            ariaLabel={t('integrations.bindings.forge') as string}
            on:change={(e) => setRepo('forge', e.detail)}
          />
        {:else}
          <span class="pi-hint">{t('integrations.bindings.noConnectionForKind')}</span>
        {/if}
      </div>

      <div class="pi-field">
        <span class="pi-label">{t('integrations.bindings.ci')}</span>
        {#if ciOptions.length > 1}
          <Select
            value={bindings.ci?.connectionId ?? NONE}
            options={ciOptions}
            ariaLabel={t('integrations.bindings.ci') as string}
            on:change={(e) => setRepo('ci', e.detail)}
          />
        {:else}
          <span class="pi-hint">{t('integrations.bindings.noConnectionForKind')}</span>
        {/if}
      </div>
    </div>

    {#if bindings.tracker}
      <div class="pi-field pi-picker">
        <label class="pi-label" for="pi-tracker-project">{t('integrations.bindings.trackerProject')}</label>
        <div class="pi-input-row">
          <input
            id="pi-tracker-project"
            class="pi-input mono selectable"
            type="text"
            autocomplete="off"
            spellcheck="false"
            placeholder={isRepoTracker
              ? (t('integrations.bindings.repoPathPlaceholder') as string)
              : (t('integrations.bindings.trackerProjectKeyPlaceholder') as string)}
            value={bindings.tracker.projectKey}
            on:input={(e) => onPickerInput(e.currentTarget.value)}
            on:focus={() => { isPickerOpen = true; if (pickerResults.length === 0) void searchProjects(bindings.tracker?.projectKey ?? ''); }}
            on:blur={() => setTimeout(() => (isPickerOpen = false), 150)}
          />
          {#if isPickerLoading}<span class="pi-input-spinner"><Spinner size={11}/></span>{/if}
        </div>
        {#if isPickerOpen && pickerResults.length > 0}
          <div class="pi-results" role="listbox">
            {#each pickerResults as project (project.key)}
              <button
                class="pi-result"
                role="option"
                aria-selected={project.key === bindings.tracker.projectKey}
                on:mousedown|preventDefault={() => pickProject(project)}
              >
                <code>{project.key}</code>
                <span>{project.label}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    {#if bindings.forge}
      <div class="pi-field">
        <label class="pi-label" for="pi-forge-path">{t('integrations.bindings.forge')} - {t('integrations.bindings.repoPath')}</label>
        <input
          id="pi-forge-path"
          class="pi-input mono selectable"
          type="text"
          autocomplete="off"
          spellcheck="false"
          placeholder={t('integrations.bindings.repoPathPlaceholder') as string}
          value={bindings.forge.repoPath}
          on:input={(e) => setRepoPath('forge', e.currentTarget.value)}
        />
      </div>
    {/if}

    {#if bindings.ci && (!bindings.forge || bindings.ci.connectionId !== bindings.forge.connectionId)}
      <div class="pi-field">
        <label class="pi-label" for="pi-ci-path">{t('integrations.bindings.ci')} - {t('integrations.bindings.repoPath')}</label>
        <input
          id="pi-ci-path"
          class="pi-input mono selectable"
          type="text"
          autocomplete="off"
          spellcheck="false"
          placeholder={t('integrations.bindings.repoPathPlaceholder') as string}
          value={bindings.ci.repoPath}
          on:input={(e) => setRepoPath('ci', e.currentTarget.value)}
        />
      </div>
    {/if}

    {#if bindings.tracker}
      <div class="pi-transitions">
        <span class="pi-label">{t('integrations.bindings.autoTransition')}</span>
        <p class="pi-hint">{t('integrations.bindings.transitionHint')}</p>
        {#if isLoadingStatuses}
          <div class="pi-status-loading"><Spinner size={11}/></div>
        {:else}
          <div class="pi-transition">
            <span class="pi-transition-label">{t('integrations.bindings.autoTransitionOnCreate')}</span>
            <Select
              value={bindings.autoTransition.onCreate ?? ''}
              options={transitionOptions}
              ariaLabel={t('integrations.bindings.autoTransitionOnCreate') as string}
              on:change={(e) => setTransition('onCreate', e.detail)}
            />
          </div>
          <div class="pi-transition">
            <span class="pi-transition-label">{t('integrations.bindings.autoTransitionOnFinalize')}</span>
            <Select
              value={bindings.autoTransition.onFinalize ?? ''}
              options={transitionOptions}
              ariaLabel={t('integrations.bindings.autoTransitionOnFinalize') as string}
              on:change={(e) => setTransition('onFinalize', e.detail)}
            />
          </div>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .pi-block { margin-bottom: 20px; }
  .pi-title {
    font-size: 11px;
    font-weight: 700;
    color: var(--fg-3);
    letter-spacing: 0.07em;
    text-transform: uppercase;
    margin-bottom: 6px;
  }
  .pi-desc { margin: 0 0 16px; font-size: 12px; color: var(--fg-3); line-height: 1.5; }

  .pi-suggest {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 12px;
    padding: 9px 12px;
    background: var(--accent-weak);
    border: 1px solid var(--accent-line);
    border-radius: var(--r-md);
    font-size: 12px;
    color: var(--fg-1);
  }
  .pi-suggest-text { flex: 1; min-width: 160px; }

  .pi-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 12px;
    margin-bottom: 18px;
  }
  .pi-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; position: relative; }
  .pi-grid .pi-field { margin-bottom: 0; }
  .pi-label { font-size: 11px; font-weight: 600; color: var(--fg-2); }
  .pi-hint { margin: 0; font-size: 11px; color: var(--fg-3); line-height: 1.5; }

  .pi-input {
    width: 100%;
    box-sizing: border-box;
    background: var(--bg-0);
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-sm);
    padding: 7px 10px;
    font-size: 12.5px;
    color: var(--fg-0);
    font-family: var(--font-ui);
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .pi-input.mono { font-family: var(--font-mono); font-size: 12px; }
  .pi-input:focus { border-color: var(--accent-line); box-shadow: 0 0 0 3px var(--accent-weak); }
  .pi-input::placeholder { color: var(--fg-4); opacity: 1; }

  .pi-input-row { position: relative; }
  .pi-input-spinner {
    position: absolute;
    right: 10px;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    color: var(--fg-3);
  }

  .pi-results {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    z-index: 5;
    max-height: 200px;
    overflow-y: auto;
    margin-top: 4px;
    padding: 4px;
    background: var(--bg-2);
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-md);
    box-shadow: 0 12px 30px oklch(0 0 0 / 0.35);
  }
  .pi-result {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    background: none;
    border: none;
    border-radius: var(--r-sm);
    text-align: left;
    cursor: pointer;
    color: var(--fg-1);
    font-family: var(--font-ui);
    font-size: 12px;
  }
  .pi-result:hover, .pi-result[aria-selected="true"] { background: var(--bg-3); color: var(--fg-0); }
  .pi-result code { flex-shrink: 0; font-family: var(--font-mono); font-size: 11px; color: var(--fg-0); }
  .pi-result span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--fg-3); }

  .pi-transitions { display: flex; flex-direction: column; gap: 10px; margin-top: 8px; }
  .pi-transition { display: flex; flex-direction: column; gap: 4px; }
  .pi-transition-label { font-size: 11.5px; color: var(--fg-2); }
  .pi-status-loading { display: flex; align-items: center; padding: 8px 0; color: var(--fg-3); }
</style>
