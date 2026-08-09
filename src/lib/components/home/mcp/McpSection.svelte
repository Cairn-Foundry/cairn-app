<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '$lib/i18n';
  import Icon from '$lib/components/Icon.svelte';
  import Select from '$lib/components/Select.svelte';
  import SearchInput from '$lib/components/SearchInput.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import CopyButton from '$lib/components/CopyButton.svelte';
  import KeyValueEditor from './KeyValueEditor.svelte';
  import DeleteMcpModal from './DeleteMcpModal.svelte';
  import ImportMcpModal from './ImportMcpModal.svelte';
  import ProviderPicker from '$lib/components/home/ProviderPicker.svelte';
  import ProviderChips from '$lib/components/home/ProviderChips.svelte';
  import ProviderLogo from '$lib/components/home/agents/ProviderLogo.svelte';
  import { projects, loadProjects } from '$lib/stores/project';
  import { mcpServers, mcpError, mcpLoading, loadMcpServers } from '$lib/stores/mcp';
  import {
    deleteMcpServer, exportMcpServers, saveMcpServer, setMcpApproval, testMcpServer,
    type McpProbe, type McpScope, type McpServer, type McpTransport,
  } from '$lib/services/mcp-service';
  import { revealInFileManager } from '$lib/services/file-service';
  import { originOf, transportIcon } from '$lib/utils/home/mcp';
  import { cliProviders, loadCliProviders } from '$lib/stores/cli-providers';
  import { reachedProviders } from '$lib/services/cli-provider-service';
  import { markIdOf, sortProviders } from '$lib/utils/home/cli-providers';
  import type { CliProviderId } from '$lib/services/cli-provider-service';

  type Filter = 'all' | McpScope;

  const FILTERS: Filter[] = ['all', 'user', 'local', 'project'];

  let selectedId: string | null = null;
  let search = '';
  let scopeFilter: Filter = 'all';
  let draft: McpServer | null = null;
  let pristine = '';
  let argsText = '';
  let saving = false;
  let error = '';
  let deleteTarget: McpServer | null = null;
  let importOpen = false;
  let testing = false;
  let probes: Record<string, McpProbe> = {};
  let toolsOpen = false;
  let providerFilter: CliProviderId | 'all' = 'all';

  onMount(async () => {
    await Promise.all([loadProjects(), loadCliProviders()]);
    await loadMcpServers();
    if (!selectedId) select($mcpServers[0] ?? null);
  });

  $: selected = $mcpServers.find((s) => s.id === selectedId) ?? null;

  $: query = search.trim().toLowerCase();
  $: visible = $mcpServers.filter((server) => {
    if (scopeFilter !== 'all' && server.scope !== scopeFilter) return false;
    if (providerFilter !== 'all' && !server.providers.includes(providerFilter)) return false;
    if (!query) return true;
    return `${server.name} ${server.command} ${server.url} ${server.projectName}`
      .toLowerCase()
      .includes(query);
  });

  $: groups = (['user', 'local', 'project'] as McpScope[])
    .map((scope) => ({ scope, items: visible.filter((s) => s.scope === scope) }))
    .filter((group) => group.items.length > 0);

  $: counts = {
    all: $mcpServers.length,
    user: $mcpServers.filter((s) => s.scope === 'user').length,
    local: $mcpServers.filter((s) => s.scope === 'local').length,
    project: $mcpServers.filter((s) => s.scope === 'project').length,
  };

  $: dirty = draft !== null
    && (JSON.stringify(draft) !== pristine || argsText !== (draft.args ?? []).join('\n'));

  $: nameClash = draft !== null
    && draft.name.trim() !== ''
    && $mcpServers.some((s) =>
      s.id !== selectedId
      && s.scope === draft!.scope
      && s.projectId === draft!.projectId
      && s.name === draft!.name.trim());

  $: incomplete = draft !== null
    && (draft.name.trim() === ''
      || (draft.transport === 'stdio' ? draft.command.trim() === '' : draft.url.trim() === '')
      || (draft.scope !== 'user' && !draft.projectId)
      || draft.targets.length === 0);

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
    reached = await reachedProviders('mcp', scope, projectPath, targets);
  }

  /**
   * An agent can only be a target where it has a configuration of that kind:
   * the private per-project list belongs to Claude Code alone.
   */
  $: unavailable = draft === null
    ? {}
    : Object.fromEntries(
        $cliProviders
          .filter((p) =>
            (draft!.scope !== 'user' && !draft!.projectId)
            || (draft!.scope === 'local' && !p.hasLocalScope))
          .map((p) => [
            p.id,
            (draft!.scope !== 'user' && !draft!.projectId)
              ? (t('mcp.scope.needsProject') as string)
              : (t('mcp.scope.localOnlyClaude') as string),
          ]),
      );

  /** Only Codex and Vibe carry an off switch on the entry itself. */
  $: hasOffSwitch = draft !== null
    && (draft.targets.includes('codex') || draft.targets.includes('vibe'));

  function setTargets(next: CliProviderId[]) {
    if (draft) draft.targets = next;
  }

  $: probe = probes[selectedId ?? 'draft'];

  $: projectOptions = $projects.map((p) => ({ value: p.id, label: p.name }));
  $: scopeOptions = [
    { value: 'user', label: t('mcp.scope.user') as string },
    ...($projects.length > 0
      ? [
          { value: 'local', label: t('mcp.scope.local') as string },
          { value: 'project', label: t('mcp.scope.project') as string },
        ]
      : []),
  ];
  const transportOptions = [
    { value: 'stdio', label: 'stdio' },
    { value: 'http', label: 'HTTP' },
    { value: 'sse', label: 'SSE' },
  ];

  function select(server: McpServer | null) {
    error = '';
    toolsOpen = false;
    if (!server) {
      draft = null;
      pristine = '';
      selectedId = null;
      argsText = '';
      return;
    }
    selectedId = server.id;
    draft = structuredClone(server);
    pristine = JSON.stringify(draft);
    argsText = server.args.join('\n');
  }

  function create() {
    const scope: McpScope = scopeFilter !== 'all' && $projects.length > 0 ? scopeFilter : 'user';
    draft = {
      id: '',
      name: '',
      scope,
      projectId: scope === 'user' ? '' : ($projects[0]?.id ?? ''),
      projectName: '',
      projectPath: '',
      transport: 'stdio',
      command: '',
      args: [],
      env: {},
      url: '',
      headers: {},
      enabled: true,
      approval: '',
      targets: providerFilter === 'all' ? ['claude-code'] : [providerFilter],
      locations: [],
      providers: [],
      divergent: false,
      sourcePath: '',
    };
    pristine = '';
    argsText = '';
    selectedId = null;
    search = '';
    error = '';
    toolsOpen = false;
  }

  function withProject(server: McpServer): McpServer {
    const project = $projects.find((p) => p.id === server.projectId);
    return {
      ...server,
      name: server.name.trim(),
      args: argsText.split('\n').map((a) => a.trim()).filter(Boolean),
      projectId: server.scope === 'user' ? '' : server.projectId,
      projectPath: server.scope === 'user' ? '' : (project?.path ?? ''),
    };
  }

  async function save() {
    if (!draft || incomplete || nameClash) return;
    saving = true;
    error = '';
    try {
      const next = withProject(draft);
      await saveMcpServer(selected, next);
      await loadMcpServers();
      const id = `${next.scope}:${next.projectId}:${next.name}`;
      select($mcpServers.find((s) => s.id === id) ?? null);
    } catch (e) {
      error = String(e);
    } finally {
      saving = false;
    }
  }

  function duplicate(server: McpServer) {
    const copy = structuredClone(server);
    copy.id = '';
    copy.name = (t('mcp.copyOf') as (n: string) => string)(server.name);
    copy.approval = '';
    draft = copy;
    pristine = '';
    argsText = copy.args.join('\n');
    selectedId = null;
    error = '';
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const gone = deleteTarget;
    deleteTarget = null;
    try {
      await deleteMcpServer(gone);
      await loadMcpServers();
      if (selectedId === gone.id) select($mcpServers[0] ?? null);
    } catch (e) {
      error = String(e);
    }
  }

  async function toggleApproval(server: McpServer, approved: boolean) {
    try {
      await setMcpApproval(server.projectPath, server.name, approved);
      await loadMcpServers();
    } catch (e) {
      error = String(e);
    }
  }

  async function runTest() {
    if (!draft) return;
    const key = selectedId ?? 'draft';
    testing = true;
    error = '';
    try {
      probes = { ...probes, [key]: await testMcpServer(withProject(draft)) };
      toolsOpen = false;
    } catch (e) {
      error = String(e);
    } finally {
      testing = false;
    }
  }

  async function exportAll() {
    const raw = await exportMcpServers(visible);
    const { save: saveDialog } = await import('@tauri-apps/plugin-dialog');
    const target = await saveDialog({ defaultPath: 'mcp-servers.json' });
    if (!target) return;
    const { writeFile } = await import('$lib/services/file-service');
    await writeFile(target, raw);
  }

  function filterLabel(key: Filter): string {
    return (key === 'all' ? t('mcp.filter.all') : t(`mcp.scope.${key}`)) as string;
  }

  function setTransport(transport: McpTransport) {
    if (draft) draft.transport = transport;
  }

  function setScope(scope: McpScope) {
    if (!draft) return;
    draft.scope = scope;
    if (scope !== 'user' && !draft.projectId) draft.projectId = $projects[0]?.id ?? '';
  }

  function setProject(id: string) {
    if (draft) draft.projectId = id;
  }

  function setPairs(field: 'env' | 'headers', pairs: Record<string, string>) {
    if (draft) draft[field] = pairs;
  }

  function setEnabled(enabled: boolean) {
    if (draft) draft.enabled = enabled;
  }

  function subtitleOf(server: McpServer): string {
    if (server.transport === 'stdio') {
      return [server.command, ...server.args].join(' ').trim() || '-';
    }
    return originOf(server.url);
  }
</script>

<div class="ag-layout">
  <aside class="ag-master">
    <div class="ag-master-header">
      <span class="ag-master-title">{t('mcp.title')}</span>
      <span class="master-actions">
        <button
          class="icon-btn"
          on:click={loadMcpServers}
          disabled={$mcpLoading}
          title={t('mcp.refresh') as string}
        >
          {#if $mcpLoading}<Spinner size={12}/>{:else}<Icon name="refresh" size={13}/>{/if}
        </button>
        <button class="icon-btn" on:click={() => importOpen = true} title={t('mcp.import.title') as string}>
          <Icon name="download" size={13}/>
        </button>
        <button
          class="icon-btn"
          on:click={exportAll}
          disabled={visible.length === 0}
          title={t('mcp.export') as string}
        >
          <Icon name="upload" size={13}/>
        </button>
        <button class="icon-btn" on:click={create} title={t('mcp.new') as string}>
          <Icon name="plus" size={13}/>
        </button>
      </span>
    </div>

    <SearchInput bind:value={search} placeholder={t('mcp.searchPlaceholder') as string}/>

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
        {@const count = $mcpServers.filter((s) => s.providers.includes(provider.id)).length}
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

    {#if $mcpLoading && $mcpServers.length === 0}
      <div class="master-skeleton"><Skeleton lines={5} height={34} gap={4}/></div>
    {:else if $mcpServers.length === 0}
      <p class="ag-master-empty">{t('mcp.emptyTitle')}</p>
    {:else if visible.length === 0}
      <p class="ag-master-empty">{t('mcp.noResults')}</p>
    {:else}
      {#each groups as group (group.scope)}
        <div class="group-label">{t(`mcp.scope.${group.scope}`)}</div>
        {#each group.items as server (server.id)}
          <div class="server-row">
            <button
              class="ag-item {selectedId === server.id ? 'active' : ''}"
              aria-pressed={selectedId === server.id}
              on:click={() => select(server)}
            >
              <span class="ag-tile"><Icon name={transportIcon(server.transport)} size={14}/></span>
              <span class="ag-item-info">
                <span class="ag-item-name">
                  {server.name}
                  {#if probes[server.id]}
                    <span class="ag-dot {probes[server.id].ok ? 'ok' : 'ko'}"></span>
                  {/if}
                </span>
                <span class="ag-item-sub">{subtitleOf(server)}</span>
              </span>
              {#if server.approval === 'rejected'}
                <span class="row-flag off">{t('mcp.approval.rejectedShort')}</span>
              {:else if server.approval === 'pending'}
                <span class="row-flag">{t('mcp.approval.pendingShort')}</span>
              {/if}
            </button>
            <button
              class="icon-btn delete"
              on:click={() => deleteTarget = server}
              title={t('mcp.delete.heading') as string}
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
        <span class="ag-empty-icon"><Icon name="link" size={30} sw={1.2}/></span>
        <p class="ag-empty-title">{t('mcp.emptyTitle')}</p>
        <p class="ag-empty-desc">{t('mcp.emptyDesc')}</p>
        <div class="empty-actions">
          <button class="btn primary" on:click={create}>
            <Icon name="plus" size={12}/> {t('mcp.new')}
          </button>
          <button class="btn" on:click={() => importOpen = true}>
            <Icon name="download" size={12}/> {t('mcp.import.title')}
          </button>
        </div>
      </div>
    {:else}
      <div class="ag-head">
        <span class="ag-tile ag-tile-lg"><Icon name={transportIcon(draft.transport)} size={20}/></span>
        <div class="ag-head-text">
          <input
            class="ag-input name-input"
            type="text"
            aria-label={t('mcp.fields.name') as string}
            placeholder={t('mcp.fields.namePlaceholder') as string}
            bind:value={draft.name}
          />
          <div class="head-meta">
            <span class="ag-badge">{draft.transport}</span>
            {#if nameClash}
              <span class="ag-hint bad">{t('mcp.nameClash')}</span>
            {:else if draft.name.trim()}
              <span class="ag-hint">
                {(t('mcp.toolPrefix') as (p: string) => string)(`mcp__${draft.name.trim()}__`)}
              </span>
            {/if}
          </div>
        </div>
        <div class="head-actions">
          {#if selected}
            <button class="btn ghost" on:click={() => duplicate(selected)} title={t('common.duplicate') as string}>
              <Icon name="copy" size={13}/>
            </button>
            <button
              class="btn ghost"
              on:click={() => revealInFileManager(selected.sourcePath)}
              title={t('mcp.reveal') as string}
            >
              <Icon name="folder-open" size={13}/>
            </button>
          {/if}
          <button class="btn" on:click={runTest} disabled={testing || incomplete}>
            {#if testing}<Spinner size={11}/>{:else}<Icon name="zap" size={12}/>{/if}
            {t('mcp.test')}
          </button>
        </div>
      </div>

      {#if selected?.divergent}
        <div class="banner warn">
          <Icon name="alert" size={13}/>
          <span>{t('mcp.divergent')}</span>
        </div>
      {/if}

      {#if error}
        <div class="banner bad"><Icon name="alert" size={13}/><span>{error}</span></div>
      {/if}

      {#if probe}
        <div class="probe {probe.ok ? 'ok' : 'ko'}">
          <div class="probe-head">
            <Icon name={probe.ok ? 'check' : 'alert'} size={14}/>
            <span class="probe-title">
              {#if probe.ok}
                {probe.serverName || t('mcp.probe.connected')}
                {#if probe.serverVersion}<span class="probe-version">{probe.serverVersion}</span>{/if}
              {:else}
                {t('mcp.probe.failed')}
              {/if}
            </span>
            <span class="probe-time">{probe.durationMs} ms</span>
          </div>

          {#if probe.ok}
            <div class="probe-stats">
              <span><strong>{probe.tools.length}</strong> {t('mcp.probe.tools')}</span>
              <span><strong>{probe.promptCount}</strong> {t('mcp.probe.prompts')}</span>
              <span><strong>{probe.resourceCount}</strong> {t('mcp.probe.resources')}</span>
              {#if probe.protocolVersion}
                <span class="probe-proto">{t('mcp.probe.protocol')} {probe.protocolVersion}</span>
              {/if}
            </div>
            {#if probe.partial}
              <p class="probe-note">{t('mcp.probe.partial')}</p>
            {/if}
            {#if probe.tools.length > 0}
              <button class="probe-toggle" on:click={() => toolsOpen = !toolsOpen}>
                <Icon name={toolsOpen ? 'chev-d' : 'chev-r'} size={11}/>
                {t('mcp.probe.showTools')}
              </button>
              {#if toolsOpen}
                <div class="tool-list">
                  {#each probe.tools as tool (tool.name)}
                    <div class="tool">
                      <code class="selectable">{tool.name}</code>
                      {#if tool.description}<span>{tool.description}</span>{/if}
                    </div>
                  {/each}
                </div>
              {/if}
            {/if}
          {:else}
            <p class="probe-note">{probe.error}</p>
            {#if probe.logs}
              <pre class="probe-logs selectable">{probe.logs}</pre>
            {/if}
          {/if}
        </div>
      {/if}

      <div class="ag-group">
        <div class="ag-group-title">{t('mcp.groups.connection')}</div>

        <div class="ag-card row-card">
          <div class="ag-field">
            <span class="ag-hint">{t('mcp.fields.transport')}</span>
            <Select
              value={draft.transport}
              options={transportOptions}
              ariaLabel={t('mcp.fields.transport') as string}
              on:change={(e) => setTransport(e.detail as McpTransport)}
            />
          </div>
          <span class="ag-hint">{t(`mcp.transportHint.${draft.transport}`)}</span>
        </div>

        {#if draft.transport === 'stdio'}
          <div class="ag-card">
            <div class="ag-field">
              <div class="ag-card-info">
                <label class="ag-label" for="mcp-command">{t('mcp.fields.command')}</label>
                <span class="ag-hint">{t('mcp.fields.commandHint')}</span>
              </div>
              <input
                id="mcp-command"
                class="ag-input selectable"
                type="text"
                spellcheck="false"
                placeholder="npx"
                bind:value={draft.command}
              />
            </div>
          </div>

          <div class="ag-card">
            <div class="ag-field">
              <div class="ag-card-info">
                <label class="ag-label" for="mcp-args">{t('mcp.fields.args')}</label>
                <span class="ag-hint">{t('mcp.fields.argsHint')}</span>
              </div>
              <textarea
                id="mcp-args"
                class="ag-textarea mono selectable"
                rows="3"
                spellcheck="false"
                placeholder={'-y\nmy-mcp-server'}
                bind:value={argsText}
              ></textarea>
            </div>
          </div>

          <div class="ag-card">
            <div class="ag-field">
              <div class="ag-card-info">
                <span class="ag-label">{t('mcp.fields.env')}</span>
                <span class="ag-hint">{t('mcp.fields.envHint')}</span>
              </div>
              <KeyValueEditor
                pairs={draft.env}
                secret
                keyPlaceholder="API_KEY"
                valuePlaceholder={t('mcp.fields.valuePlaceholder') as string}
                on:change={(e) => setPairs('env', e.detail)}
              />
            </div>
          </div>
        {:else}
          <div class="ag-card">
            <div class="ag-field">
              <div class="ag-card-info">
                <label class="ag-label" for="mcp-url">{t('mcp.fields.url')}</label>
                <span class="ag-hint">{t('mcp.fields.urlHint')}</span>
              </div>
              <input
                id="mcp-url"
                class="ag-input selectable"
                type="text"
                spellcheck="false"
                placeholder="https://example.com/mcp"
                bind:value={draft.url}
              />
            </div>
          </div>

          <div class="ag-card">
            <div class="ag-field">
              <div class="ag-card-info">
                <span class="ag-label">{t('mcp.fields.headers')}</span>
                <span class="ag-hint">{t('mcp.fields.headersHint')}</span>
              </div>
              <KeyValueEditor
                pairs={draft.headers}
                secret
                keyPlaceholder="Authorization"
                valuePlaceholder={t('mcp.fields.valuePlaceholder') as string}
                on:change={(e) => setPairs('headers', e.detail)}
              />
            </div>
          </div>
        {/if}
      </div>

      <div class="ag-group">
        <div class="ag-group-title">{t('mcp.groups.availability')}</div>

        <div class="ag-card row-card">
          <div class="row-fields">
            <div class="ag-field">
              <span class="ag-hint">{t('mcp.fields.scope')}</span>
              <Select
                value={draft.scope}
                options={scopeOptions}
                ariaLabel={t('mcp.fields.scope') as string}
                on:change={(e) => setScope(e.detail as McpScope)}
              />
            </div>
            {#if draft.scope !== 'user'}
              <div class="ag-field">
                <span class="ag-hint">{t('mcp.fields.project')}</span>
                <Select
                  value={draft.projectId}
                  options={projectOptions}
                  ariaLabel={t('mcp.fields.project') as string}
                  on:change={(e) => setProject(e.detail)}
                />
              </div>
            {/if}
          </div>
          <span class="ag-hint">{t(`mcp.scopeHint.${draft.scope}`)}</span>
        </div>

        <div class="ag-card">
          <div class="ag-card-info stacked">
            <span class="ag-label">{t('cliProviders.title')}</span>
            <span class="ag-hint">{t('mcp.providersHint')}</span>
          </div>
          <ProviderPicker
            selected={draft.targets}
            {reached}
            {unavailable}
            on:change={(e) => setTargets(e.detail)}
          />
        </div>

        {#if hasOffSwitch}
          <div class="ag-card">
            <div class="ag-card-head">
              <div class="ag-card-info">
                <span class="ag-label">{t('mcp.fields.enabled')}</span>
                <span class="ag-hint">{t('mcp.fields.enabledHint')}</span>
              </div>
              <label class="ag-toggle">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  on:change={(e) => setEnabled(e.currentTarget.checked)}
                />
                <span class="ag-toggle-track"><span class="ag-toggle-thumb"></span></span>
              </label>
            </div>
          </div>
        {/if}

        {#if selected && selected.locations.length > 0}
          <div class="ag-card">
            <div class="ag-card-info stacked">
              <span class="ag-label">{t('mcp.locations.title')}</span>
              <span class="ag-hint">{t('mcp.locations.hint')}</span>
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

        {#if selected && selected.scope === 'project'}
          <div class="ag-card">
            <div class="ag-card-head">
              <div class="ag-card-info">
                <span class="ag-label">{t('mcp.approval.title')}</span>
                <span class="ag-hint">{t(`mcp.approval.${selected.approval || 'pending'}Hint`)}</span>
              </div>
              <div class="segmented">
                <button
                  class:active={selected.approval === 'approved'}
                  on:click={() => toggleApproval(selected, true)}
                >
                  {t('mcp.approval.approve')}
                </button>
                <button
                  class:active={selected.approval === 'rejected'}
                  on:click={() => toggleApproval(selected, false)}
                >
                  {t('mcp.approval.reject')}
                </button>
              </div>
            </div>
          </div>
        {/if}
      </div>

      <div class="save-bar" class:visible={dirty || selectedId === null}>
        <span class="save-note">
          {#if nameClash}
            <span class="ag-hint bad">{t('mcp.nameClash')}</span>
          {:else if draft.targets.length === 0}
            <span class="ag-hint warn">{t('cliProviders.pickOne')}</span>
          {:else if incomplete}
            <span class="ag-hint warn">{t('mcp.incomplete')}</span>
          {:else if selectedId === null}
            <span class="ag-hint">{t('mcp.willCreate')}</span>
          {:else}
            <span class="ag-hint">{t('mcp.unsaved')}</span>
          {/if}
        </span>
        <button
          class="btn ghost"
          on:click={() => selected ? select(selected) : select(null)}
          disabled={saving}
        >
          {selected ? t('common.revert') : t('common.cancel')}
        </button>
        <button class="btn primary" on:click={save} disabled={saving || incomplete || nameClash}>
          {#if saving}<Spinner size={11}/>{:else}<Icon name="save" size={12}/>{/if}
          {t('common.save')}
        </button>
      </div>
    {/if}
  </section>
</div>

{#if $mcpError}
  <div class="banner bad floating"><Icon name="alert" size={13}/><span>{$mcpError}</span></div>
{/if}

{#if deleteTarget}
  <DeleteMcpModal
    name={deleteTarget.name}
    sourcePath={deleteTarget.sourcePath}
    on:close={() => deleteTarget = null}
    on:confirm={confirmDelete}
  />
{/if}

{#if importOpen}
  <ImportMcpModal
    on:close={() => importOpen = false}
    on:imported={async (e) => {
      importOpen = false;
      await loadMcpServers();
      const first = $mcpServers.find((s) => s.name === e.detail[0]);
      if (first) select(first);
    }}
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

  .server-row {
    display: flex;
    align-items: center;
    gap: 2px;
    border-radius: var(--r-md);
  }
  .server-row :global(.ag-item) { min-width: 0; }

  .row-flag {
    flex-shrink: 0;
    padding: 1px 6px;
    background: var(--warning-weak);
    border-radius: 99px;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: .04em;
    color: var(--warning);
  }
  .row-flag.off { background: var(--danger-weak); color: var(--danger); }

  .name-input { font-size: 15px; font-weight: 600; }

  .head-meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 6px;
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
    border-radius: var(--r-md);
    font-size: 12px;
  }
  .banner.bad { background: var(--danger-weak); color: var(--danger); }
  .banner.warn { background: var(--warning-weak); color: var(--warning); }
  .banner.floating {
    position: fixed;
    right: 24px;
    bottom: 24px;
    z-index: 20;
    margin: 0;
    max-width: 420px;
  }

  .probe {
    margin-top: 28px;
    max-width: 620px;
    padding: 12px 14px;
    background: var(--bg-2);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-md);
  }
  .probe.ok { border-color: color-mix(in oklch, var(--success) 40%, transparent); }
  .probe.ko { border-color: color-mix(in oklch, var(--danger) 40%, transparent); }

  .probe-head {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--fg-1);
  }
  .probe.ok .probe-head { color: var(--success); }
  .probe.ko .probe-head { color: var(--danger); }
  .probe-title { flex: 1; min-width: 0; font-size: 13px; font-weight: 600; }
  .probe-version {
    margin-left: 6px;
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 400;
    color: var(--fg-3);
  }
  .probe-time { font-family: var(--font-mono); font-size: 11px; color: var(--fg-3); }

  .probe-stats {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    margin-top: 10px;
    font-size: 12px;
    color: var(--fg-2);
  }
  .probe-stats strong { color: var(--fg-0); font-variant-numeric: tabular-nums; }
  .probe-proto { font-family: var(--font-mono); font-size: 11px; color: var(--fg-3); }

  .probe-note {
    margin: 10px 0 0;
    font-size: 12px;
    line-height: 1.6;
    color: var(--fg-2);
  }

  .probe-toggle {
    display: flex;
    align-items: center;
    gap: 5px;
    margin-top: 10px;
    padding: 0;
    background: none;
    border: none;
    font-size: 12px;
    color: var(--fg-2);
    cursor: pointer;
    font-family: var(--font-ui);
  }
  .probe-toggle:hover { color: var(--fg-0); }

  .tool-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 8px;
    max-height: 260px;
    overflow-y: auto;
  }
  .tool {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 4px 6px;
    border-radius: var(--r-sm);
  }
  .tool:hover { background: var(--bg-1); }
  .tool code {
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-0);
  }
  .tool span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
    color: var(--fg-3);
  }

  .probe-logs {
    margin: 10px 0 0;
    padding: 8px 10px;
    max-height: 160px;
    overflow: auto;
    background: var(--bg-0);
    border-radius: var(--r-sm);
    font-family: var(--font-mono);
    font-size: 10px;
    line-height: 1.5;
    color: var(--fg-3);
    white-space: pre-wrap;
  }

  .row-card { display: flex; flex-direction: column; gap: 10px; }
  .row-fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 10px;
  }

  .mono { font-family: var(--font-mono); font-size: 11px; line-height: 1.6; }

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

  .segmented {
    display: flex;
    flex-shrink: 0;
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-sm);
    overflow: hidden;
  }
  .segmented button {
    padding: 5px 12px;
    background: none;
    border: none;
    font-size: 12px;
    color: var(--fg-2);
    cursor: pointer;
    font-family: var(--font-ui);
  }
  .segmented button:hover { background: var(--bg-3); color: var(--fg-0); }
  .segmented button.active { background: var(--accent-weak); color: var(--fg-0); }

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
