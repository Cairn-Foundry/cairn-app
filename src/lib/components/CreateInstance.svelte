<script lang="ts">
  /**
   * Multi-step modal creating an instance: ticket, then a new branch or an
   * existing one, then its git configuration. Dispatches `create` with the new
   * instance id. Blocking work is shown as a centered spinner over a dimmed body.
   */
  import { createEventDispatcher, onDestroy, onMount, tick } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import { t } from '$lib/i18n';
  import { activeProject } from '$lib/stores/project';
  import { spawnInstance, instances } from '$lib/stores/instance';
  import { listBranchesDetailed } from '$lib/services/instance-service';
  import { capabilitiesOf, loadProjectIntegrations, projectBindings } from '$lib/stores/integrations';
  import { settings } from '$lib/stores/settings';
  import {
    DEFAULT_TICKET_QUERY,
    resetTicketSearch,
    resolveTicketInput,
    searchTickets,
    setTicket,
    ticketSearch,
    transitionTicketToStatus,
  } from '$lib/stores/tracker';
  import type { Ticket, TicketQuery } from '$lib/types/integrations';
  import type { Instance, InstanceTicket } from '$lib/types/instance';
  import { matchesSearch } from '$lib/utils/files/files-search';
  import { slugify } from '$lib/utils/format';
  import { renderBranchTemplate } from '$lib/utils/integrations/branch-template';

  export let initialBranch = '';

  const dispatch = createEventDispatcher<{ close: void; create: { instanceId: string } }>();

  // step: 0 = ticket, 1 = mode, 2 = git config
  let step = 0;
  let mode: 'create' | 'existing' = 'create';
  let ticketId = '';
  let ticketTitle = '';
  let branchName = '';
  let baseBranch = 'main';
  let existingBranch = '';
  let availableBranches: string[] = [];
  let remoteBranches: string[] = [];
  let branchSearch = '';
  let isGitRepo = false;
  let creating = false;
  let error = '';
  let prevSlug = '';

  let refreshingBranches = false;

  let hasTracker = false;
  let transitionWarning = '';
  let createdInstanceId = '';
  let ticketMode: 'ticket' | 'manual' = 'manual';
  let selectedTicket: Ticket | null = null;
  let ticketQueryText = '';
  let ticketScope: TicketQuery['scope'] = DEFAULT_TICKET_QUERY.scope;
  let isResolvingTicket = false;
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  const TICKET_SCOPES: { id: TicketQuery['scope']; label: string }[] = [
    { id: 'assigned', label: t('createInstance.assignedToMe') as string },
    { id: 'created', label: t('createInstance.createdByMe') as string },
    { id: 'all', label: t('createInstance.allTickets') as string },
  ];

  let ticketListTab: 'available' | 'assigned' = 'available';

  // Tickets already tied to an instance of the current project, matched by
  // tracker key. Built from the instances, not the search results: the search
  // is paginated, so it never sees the whole picture.
  $: assignedTickets = dedupeAssignedTickets($instances);
  $: assignedTicketKeys = new Set(assignedTickets.map((tk) => tk.key ?? tk.id));
  $: availableTickets = $ticketSearch.results.filter((tk) => !assignedTicketKeys.has(tk.key));
  $: assignedShown = assignedTickets.filter((tk) =>
    matchesSearch(`${tk.key ?? tk.id} ${tk.title}`, ticketQueryText),
  );

  function dedupeAssignedTickets(list: Instance[]): InstanceTicket[] {
    const seen = new Set<string>();
    const out: InstanceTicket[] = [];
    for (const inst of list) {
      const key = inst.ticket.key ?? inst.ticket.id;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(inst.ticket);
    }
    return out;
  }

  const LOOKS_LIKE_TICKET_REF = /^(https?:\/\/\S+|#\d+|[a-z][a-z0-9]*-\d+)$/i;

  function runTicketSearch(page = 1) {
    if (!$activeProject) return;
    void searchTickets($activeProject.id, {
      ...DEFAULT_TICKET_QUERY,
      scope: ticketScope,
      text: ticketQueryText.trim(),
      page,
    });
  }

  function scheduleTicketSearch() {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => runTicketSearch(), 250);
  }

  function selectScope(scope: TicketQuery['scope']) {
    ticketScope = scope;
    runTicketSearch();
  }

  async function resolvePastedTicket() {
    const text = ticketQueryText.trim();
    if (!$activeProject || !LOOKS_LIKE_TICKET_REF.test(text)) return;
    isResolvingTicket = true;
    try {
      const ticket = await resolveTicketInput($activeProject.id, text);
      if (ticket) pickTicket(ticket);
    } catch {
      runTicketSearch();
    } finally {
      isResolvingTicket = false;
    }
  }

  function pickTicket(ticket: Ticket) {
    selectedTicket = ticket;
    ticketId = ticket.key;
    ticketTitle = ticket.title;
    error = '';
  }

  function clearSelectedTicket() {
    selectedTicket = null;
    ticketId = '';
    ticketTitle = '';
    branchName = '';
    prevSlug = '';
  }

  function switchTicketMode(next: 'ticket' | 'manual') {
    if (ticketMode === next) return;
    ticketMode = next;
    if (next === 'manual') clearSelectedTicket();
    else if ($ticketSearch.results.length === 0) runTicketSearch();
  }

  /** Loads local and remote branches, and picks a sensible base branch if the current one is gone. */
  async function loadBranchList() {
    if (!$activeProject) return;
    refreshingBranches = true;
    try {
      const { local, remote } = await listBranchesDetailed($activeProject.path);
      availableBranches = local;
      remoteBranches = remote;
      isGitRepo = true;
      const all = [...local, ...remote];
      if (!all.includes(baseBranch)) {
        if (local.includes('main')) baseBranch = 'main';
        else if (local.includes('master')) baseBranch = 'master';
        else if (local.length > 0) baseBranch = local[0];
        else if (remote.length > 0) baseBranch = remote[0];
      }
    } catch {
      availableBranches = [];
      remoteBranches = [];
      isGitRepo = false;
    } finally {
      refreshingBranches = false;
    }
  }

  const TICKET_SEGMENT = /^[a-z][a-z0-9]*-\d+$/i;

  /** Preselects the branch the modal was opened on, deriving the ticket id from its name when it carries one. */
  function applyInitialBranch() {
    const match = [initialBranch, ...remoteBranches.filter(r => r.endsWith(`/${initialBranch}`))]
      .find(b => availableBranches.includes(b) || remoteBranches.includes(b));
    if (!match) return;
    mode = 'existing';
    existingBranch = match;
    const segment = match.split('/').find(s => TICKET_SEGMENT.test(s));
    if (segment) ticketId = segment.toUpperCase();
  }

  onMount(async () => {
    const project = $activeProject;
    if (project) {
      try {
        await loadProjectIntegrations(project.id);
      } catch {}
      hasTracker = capabilitiesOf(project.id).tracker !== null;
      if (hasTracker && !initialBranch) {
        ticketMode = 'ticket';
        runTicketSearch();
      }
    }
    await loadBranchList();
    if (initialBranch) applyInitialBranch();
  });

  onDestroy(() => {
    if (searchTimer) clearTimeout(searchTimer);
    resetTicketSearch();
  });

  $: if (ticketId) {
    const slug = slugify(ticketId);
    const generated = selectedTicket
      ? renderBranchTemplate($settings.branchTemplate, { key: selectedTicket.key, slug, kind: selectedTicket.kind })
      : `feat/${slug}`;
    if (!branchName || branchName === prevSlug) branchName = generated;
    prevSlug = generated;
  }

  $: existingLocalName = remoteBranches.includes(existingBranch)
    ? existingBranch.split('/').slice(1).join('/')
    : existingBranch;

  $: effectiveBranch = mode === 'create' ? branchName : existingLocalName;

  $: worktreePath = `~/.cairn/worktrees/${effectiveBranch.replace(/\//g, '-')}`;

  $: totalSteps = 3;

  $: displayStep = step + 1;

  const stepMeta: Record<number, { label: string; title: string }> = {
    0: { label: t('createInstance.stepLabels.ticket') as string, title: t('createInstance.stepTitles.ticket') as string },
    1: { label: t('createInstance.stepLabels.mode') as string, title: t('createInstance.stepTitles.mode') as string },
    2: { label: t('createInstance.stepLabels.branch') as string, title: t('createInstance.stepTitles.branch') as string },
  };

  $: duplicateBranch = mode === 'create'
    && branchName.trim().length > 0
    && $instances.some(i => i.branch === branchName.trim());

  $: existingInUse = mode === 'existing'
    && existingLocalName.length > 0
    && $instances.some(i => i.branch === existingLocalName);

  $: canNext =
    step === 0 ? ticketId.trim().length > 0 && ticketTitle.trim().length > 0 :
    step === 1 ? isGitRepo :
    step === 2 ? (mode === 'create'
      ? isGitRepo && branchName.trim().length > 0 && !duplicateBranch
      : isGitRepo && existingBranch.length > 0 && !existingInUse) :
    true;

  function next() {
    error = '';
    step = Math.min(2, step + 1);
  }

  function back() {
    error = '';
    step = Math.max(0, step - 1);
  }

  $: dots = [0, 1, 2];

  /** Spawns the instance and its worktree; yields two frames first so the spinner is painted before the blocking call. */
  async function handleCreate() {
    if (!$activeProject) return;
    creating = true;
    error = '';
    await tick();
    await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    const ticket: InstanceTicket = selectedTicket
      ? {
          id: ticketId.trim(),
          title: ticketTitle.trim(),
          key: selectedTicket.key,
          url: selectedTicket.url,
          source: capabilitiesOf($activeProject.id).tracker?.kind ?? undefined,
          connectionId: $projectBindings.tracker?.connectionId,
        }
      : { id: ticketId.trim(), title: ticketTitle.trim() };
    try {
      const instance = await spawnInstance({
        id: crypto.randomUUID(),
        projectId: $activeProject.id,
        projectPath: $activeProject.path,
        ticket,
        ...(mode === 'create'
          ? { branch: branchName.trim(), baseBranch, linkExisting: false }
          : { branch: existingBranch, baseBranch: existingLocalName, linkExisting: true }),
      });
      if (selectedTicket) {
        setTicket(instance.projectId, instance.id, selectedTicket);
        const onCreate = $projectBindings.autoTransition.onCreate;
        if (onCreate) {
          try {
            await transitionTicketToStatus(instance.projectId, instance.id, onCreate);
          } catch {
            transitionWarning = t('createInstance.ticketTransitionFailed') as string;
            createdInstanceId = instance.id;
            creating = false;
            return;
          }
        }
      }
      dispatch('create', { instanceId: instance.id });
    } catch (err) {
      error = String(err);
      creating = false;
    }
  }
</script>

<div class="modal-backdrop" on:click={() => dispatch('close')} role="button" tabindex="-1" on:keydown={() => {}}>
  <div class="modal" on:click|stopPropagation role="presentation">
    <div class="modal-head">
      <div>
        <div class="step-count">{(t('common.stepOf') as (s: number, t: number) => string)(displayStep, totalSteps)} - {stepMeta[step].label}</div>
        <h3>{stepMeta[step].title}</h3>
      </div>
      <button class="icon-btn close" on:click={() => dispatch('close')}><Icon name="x" size={16}/></button>
    </div>

    <div class="modal-body" class:loading={creating}>
      {#if creating}
        <div class="creating-overlay">
          <Spinner size={28} stroke={3} trackColor="var(--stroke-1)" color="var(--accent)" />
          <span class="creating-label">{t('createInstance.settingUp')}</span>
        </div>
      {/if}

      {#if step === 0}
        {#if hasTracker}
          <div class="ticket-tabs" role="tablist">
            <button role="tab" aria-selected={ticketMode === 'ticket'} class="ticket-tab" class:active={ticketMode === 'ticket'} on:click={() => switchTicketMode('ticket')}>{t('createInstance.fromTicket')}</button>
            <button role="tab" aria-selected={ticketMode === 'manual'} class="ticket-tab" class:active={ticketMode === 'manual'} on:click={() => switchTicketMode('manual')}>{t('createInstance.manual')}</button>
          </div>
        {/if}
        {#if hasTracker && ticketMode === 'ticket'}
          {#if selectedTicket}
            <div class="selected-ticket">
              <div class="field-label">{t('createInstance.selectedTicket')}</div>
              <div class="selected-ticket-row">
                <span class="mono ticket-key">{selectedTicket.key}</span>
                <span class="ticket-title-text">{selectedTicket.title}</span>
                <span class="ticket-status">{selectedTicket.status}</span>
                <button class="btn ghost" type="button" on:click={clearSelectedTicket}>{t('createInstance.clearTicket')}</button>
              </div>
            </div>
          {:else}
            <div class="ticket-scopes">
              {#each TICKET_SCOPES as scope}
                <button class="ticket-scope" class:active={ticketScope === scope.id} type="button" on:click={() => selectScope(scope.id)}>{scope.label}</button>
              {/each}
              <button
                class="assigned-toggle"
                class:active={ticketListTab === 'assigned'}
                type="button"
                aria-pressed={ticketListTab === 'assigned'}
                on:click={() => ticketListTab = ticketListTab === 'assigned' ? 'available' : 'assigned'}
              >{t('createInstance.alreadyAssigned')}{assignedTickets.length > 0 ? ` (${assignedTickets.length})` : ''}</button>
            </div>
            <div class="branch-list-wrap">
              <div class="branch-search-row">
                <Icon name="search" size={13}/>
                <input
                  class="branch-search"
                  type="text"
                  bind:value={ticketQueryText}
                  placeholder={t('createInstance.pasteUrl') as string}
                  autocomplete="off"
                  on:input={scheduleTicketSearch}
                  on:paste={() => setTimeout(resolvePastedTicket, 0)}
                  on:keydown={(e) => e.key === 'Enter' && resolvePastedTicket()}
                />
                {#if isResolvingTicket}
                  <Spinner size={12} trackColor="var(--stroke-1)" color="var(--accent)"/>
                {/if}
              </div>
              <div class="branch-list ticket-list">
                {#if ticketListTab === 'assigned'}
                  {#if assignedShown.length === 0}
                    <div class="branch-empty">{t('createInstance.noAssignedTickets')}</div>
                  {/if}
                  {#each assignedShown as ticket (ticket.key ?? ticket.id)}
                    <div class="ticket-item assigned">
                      <span class="mono ticket-key">{ticket.key ?? ticket.id}</span>
                      <span class="ticket-title-text">{ticket.title}</span>
                    </div>
                  {/each}
                {:else if $ticketSearch.isSearching && $ticketSearch.results.length === 0}
                  <div class="ticket-skeleton"><Skeleton lines={4} height={14} gap={10}/></div>
                {:else if $ticketSearch.error}
                  <div class="branch-empty">{$ticketSearch.error.message}</div>
                {:else}
                  {#if availableTickets.length === 0}
                    <div class="branch-empty">{t('createInstance.noTickets')}</div>
                  {/if}
                  {#each availableTickets as ticket (ticket.id)}
                    <button class="ticket-item" type="button" on:click={() => pickTicket(ticket)}>
                      <span class="mono ticket-key">{ticket.key}</span>
                      <span class="ticket-title-text">{ticket.title}</span>
                      <span class="ticket-status">{ticket.status}</span>
                      {#if ticket.labels.length > 0}
                        <span class="ticket-labels">
                          {#each ticket.labels.slice(0, 3) as label}
                            <span class="ticket-label">{label}</span>
                          {/each}
                        </span>
                      {/if}
                    </button>
                  {/each}
                  {#if $ticketSearch.hasMore}
                    <button class="branch-item" type="button" disabled={$ticketSearch.isSearching} on:click={() => runTicketSearch($ticketSearch.query.page + 1)}>
                      {#if $ticketSearch.isSearching}
                        <Spinner size={12} trackColor="var(--stroke-1)" color="var(--accent)"/>
                      {:else}
                        <Icon name="chev-d" size={12}/>
                      {/if}
                    </button>
                  {/if}
                {/if}
              </div>
            </div>
          {/if}
        {:else}
          <div class="form-row">
            <label for="ticket-id">{t('createInstance.ticketId')}</label>
            <input id="ticket-id" type="text" bind:value={ticketId} placeholder={t('createInstance.ticketIdPlaceholder') as string} />
          </div>
          <div class="form-row">
            <label for="ticket-title">{t('createInstance.title')}</label>
            <input id="ticket-title" type="text" bind:value={ticketTitle} placeholder={t('createInstance.titlePlaceholder') as string} />
          </div>
        {/if}
      {/if}

      {#if step === 1}
        {#if isGitRepo}
          <div class="mode-grid">
            <button
              class="mode-card {mode === 'create' ? 'active' : ''}"
              on:click={() => mode = 'create'}
            >
              <span class="mode-icon"><Icon name="plus" size={22}/></span>
              <span class="mode-label">{t('createInstance.createBranch')}</span>
              <span class="mode-desc">{t('createInstance.createBranchDesc')}</span>
            </button>
            <button
              class="mode-card {mode === 'existing' ? 'active' : ''}"
              on:click={() => mode = 'existing'}
            >
              <span class="mode-icon"><Icon name="branch" size={22}/></span>
              <span class="mode-label">{t('createInstance.existingBranch')}</span>
              <span class="mode-desc">{t('createInstance.existingBranchDesc')}</span>
            </button>
          </div>
        {:else}
          <div class="info-box">
            <div class="info-icon"><Icon name="info" size={14}/></div>
            <div>{t('createInstance.notGitRepo')}</div>
          </div>
        {/if}
      {/if}

      {#if step === 2 && mode === 'create'}
        <div class="form-row">
          <div class="field-label">{t('createInstance.baseBranch')}</div>
          {#if availableBranches.length > 0 || remoteBranches.length > 0}
            {@const localMatches = availableBranches.filter(b => matchesSearch(b, branchSearch))}
            {@const remoteMatches = remoteBranches.filter(b => matchesSearch(b, branchSearch))}
            <div class="branch-list-wrap">
              <div class="branch-search-row">
                <Icon name="search" size={13}/>
                <input
                  class="branch-search"
                  type="text"
                  bind:value={branchSearch}
                  placeholder={t('createInstance.filterBranches') as string}
                  autocomplete="off"
                />
                <button
                  class="branch-refresh"
                  type="button"
                  title={t('createInstance.refreshBranches') as string}
                  disabled={refreshingBranches}
                  on:click={loadBranchList}
                >
                  {#if refreshingBranches}
                    <Spinner size={12} trackColor="var(--stroke-1)" color="var(--accent)"/>
                  {:else}
                    <Icon name="refresh" size={13}/>
                  {/if}
                </button>
              </div>
              <div class="branch-list">
                {#if localMatches.length === 0 && remoteMatches.length === 0}
                  <div class="branch-empty">{(t('createInstance.noBranchesMatch') as (q: string) => string)(branchSearch)}</div>
                {/if}
                {#if localMatches.length > 0}
                  <div class="branch-group-label">{t('createInstance.localBranches')}</div>
                  {#each localMatches as b}
                    <button
                      class="branch-item {baseBranch === b ? 'active' : ''}"
                      on:click={() => baseBranch = b}
                    >
                      <Icon name="branch" size={13}/>
                      <span class="branch-name">{b}</span>
                      {#if baseBranch === b}<Icon name="check" size={12}/>{/if}
                    </button>
                  {/each}
                {/if}
                {#if remoteMatches.length > 0}
                  <div class="branch-group-label">{t('createInstance.remoteBranches')}</div>
                  {#each remoteMatches as b}
                    <button
                      class="branch-item {baseBranch === b ? 'active' : ''}"
                      on:click={() => baseBranch = b}
                    >
                      <Icon name="branch" size={13}/>
                      <span class="branch-name">{b}</span>
                      {#if baseBranch === b}<Icon name="check" size={12}/>{/if}
                    </button>
                  {/each}
                {/if}
              </div>
            </div>
          {:else}
            <input id="base-branch" type="text" bind:value={baseBranch} placeholder={t('createInstance.baseBranchPlaceholder') as string} />
          {/if}
        </div>
        <div class="form-row">
          <label for="branch-name">{t('createInstance.newBranchName')}</label>
          <input
            id="branch-name"
            type="text"
            bind:value={branchName}
            class:input-error={duplicateBranch}
          />
          {#if duplicateBranch}
            <div class="field-error">
              <Icon name="info" size={12}/>
              {(t('createInstance.duplicateBranch') as (name: string) => string)(branchName.trim())}
            </div>
          {/if}
        </div>
        <div class="info-box">
          <div class="info-icon"><Icon name="info" size={14}/></div>
          <div>
            <strong style="color: var(--fg-0)">Cairn</strong> {t('createInstance.worktreeInfoPrefix')}
            <span class="mono" style="color: var(--fg-0)">{worktreePath}</span>.
            {t('createInstance.worktreeInfoSuffix')}
          </div>
        </div>
      {/if}

      {#if step === 2 && mode === 'existing'}
        <div class="form-row">
          <div class="field-label">{t('createInstance.selectExistingBranch')}</div>
          {#if availableBranches.length > 0 || remoteBranches.length > 0}
            {@const localMatches = availableBranches.filter(b => matchesSearch(b, branchSearch))}
            {@const remoteMatches = remoteBranches.filter(b => matchesSearch(b, branchSearch))}
            <div class="branch-list-wrap">
              <div class="branch-search-row">
                <Icon name="search" size={13}/>
                <input
                  class="branch-search"
                  type="text"
                  bind:value={branchSearch}
                  placeholder={t('createInstance.filterBranches') as string}
                  autocomplete="off"
                />
                <button
                  class="branch-refresh"
                  type="button"
                  title={t('createInstance.refreshBranches') as string}
                  disabled={refreshingBranches}
                  on:click={loadBranchList}
                >
                  {#if refreshingBranches}
                    <Spinner size={12} trackColor="var(--stroke-1)" color="var(--accent)"/>
                  {:else}
                    <Icon name="refresh" size={13}/>
                  {/if}
                </button>
              </div>
              <div class="branch-list">
                {#if localMatches.length === 0 && remoteMatches.length === 0}
                  <div class="branch-empty">{(t('createInstance.noBranchesMatch') as (q: string) => string)(branchSearch)}</div>
                {/if}
                {#if localMatches.length > 0}
                  <div class="branch-group-label">{t('createInstance.localBranches')}</div>
                  {#each localMatches as b}
                    {@const inUse = $instances.some(i => i.branch === b)}
                    <button
                      class="branch-item {existingBranch === b ? 'active' : ''}"
                      disabled={inUse}
                      title={inUse ? (t('createInstance.branchInUse') as (name: string) => string)(b) : ''}
                      on:click={() => existingBranch = b}
                    >
                      <Icon name="branch" size={13}/>
                      <span class="branch-name">{b}</span>
                      {#if existingBranch === b}<Icon name="check" size={12}/>{/if}
                    </button>
                  {/each}
                {/if}
                {#if remoteMatches.length > 0}
                  <div class="branch-group-label">{t('createInstance.remoteBranches')}</div>
                  {#each remoteMatches as b}
                    <button
                      class="branch-item {existingBranch === b ? 'active' : ''}"
                      on:click={() => existingBranch = b}
                    >
                      <Icon name="branch" size={13}/>
                      <span class="branch-name">{b}</span>
                      {#if existingBranch === b}<Icon name="check" size={12}/>{/if}
                    </button>
                  {/each}
                {/if}
              </div>
            </div>
          {:else}
            <div class="info-box">
              <div class="info-icon"><Icon name="info" size={14}/></div>
              <div>{t('createInstance.noExistingBranches')}</div>
            </div>
          {/if}
          {#if existingInUse}
            <div class="field-error">
              <Icon name="info" size={12}/>
              {(t('createInstance.branchInUse') as (name: string) => string)(existingLocalName)}
            </div>
          {/if}
        </div>
        {#if existingBranch.length > 0}
          <div class="info-box">
            <div class="info-icon"><Icon name="info" size={14}/></div>
            <div>
              <strong style="color: var(--fg-0)">Cairn</strong> {t('createInstance.worktreeInfoPrefix')}
              <span class="mono" style="color: var(--fg-0)">{worktreePath}</span>.
              {t('createInstance.worktreeInfoSuffix')}
            </div>
          </div>
        {/if}
      {/if}

      {#if transitionWarning}
        <div class="warning-box"><Icon name="info" size={13}/> {transitionWarning}</div>
      {/if}

      {#if error}
        <div class="error-box">{error}</div>
      {/if}

    </div>

    <div class="modal-foot">
      <div class="step-dots">
        {#each dots as d}
          <span class={d === step ? 'active' : (d < step ? 'done' : '')}></span>
        {/each}
      </div>
      <div class="spacer"></div>
      {#if step > 0 && !createdInstanceId}
        <button class="btn ghost" on:click={back} disabled={creating}>{t('common.back')}</button>
      {/if}
      {#if createdInstanceId}
        <button class="btn primary" on:click={() => dispatch('create', { instanceId: createdInstanceId })}>
          {t('common.continue')} <Icon name="chev-r" size={14}/>
        </button>
      {:else if step < 2}
        <button
          class="btn primary"
          disabled={!canNext}
          on:click={next}
          style={!canNext ? 'opacity: 0.4; cursor: not-allowed;' : ''}
        >
          {t('common.continue')} <Icon name="chev-r" size={14}/>
        </button>
      {:else}
        <button class="btn primary" on:click={handleCreate} disabled={creating || !isGitRepo}>
          {#if creating}
            <Spinner /> {t('common.creating')}
          {:else}
            <Icon name="plus" size={14}/> {t('createInstance.createInstance')}
          {/if}
        </button>
      {/if}
    </div>
  </div>
</div>

<style>
  :global(input.input-error) {
    border-color: var(--danger, oklch(0.62 0.18 15)) !important;
    box-shadow: 0 0 0 3px var(--danger-weak, oklch(0.28 0.06 15));
  }

  .mode-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }

  .mode-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    padding: 16px;
    background: var(--bg-0);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-md);
    cursor: pointer;
    text-align: left;
    transition: border-color 0.15s, background 0.15s;
    color: var(--fg-1);
  }

  .mode-card:hover {
    border-color: var(--fg-3);
    background: var(--bg-2);
  }

  .mode-card.active {
    border-color: var(--accent);
    background: var(--accent-weak);
  }

  .mode-icon {
    color: var(--fg-2);
    margin-bottom: 2px;
  }

  .mode-card.active .mode-icon { color: var(--accent); }

  .mode-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--fg-0);
  }

  .mode-desc {
    font-size: 11px;
    color: var(--fg-3);
    line-height: 1.5;
  }

  .field-error {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
    font-size: 12px;
    color: var(--danger, oklch(0.75 0.18 15));
  }

  .info-box {
    padding: 12px 14px;
    background: var(--bg-0);
    border-radius: var(--r-md);
    border: 1px solid var(--stroke-0);
    font-size: 12px;
    color: var(--fg-2);
    line-height: 1.55;
    display: flex;
    gap: 10px;
  }

  .info-icon { color: var(--accent); margin-top: 2px; }

  .error-box {
    margin-top: 12px;
    padding: 10px 14px;
    background: var(--bg-0);
    border: 1px solid var(--red, #e55);
    border-radius: var(--r-md);
    font-size: 12px;
    color: var(--red, #e55);
    font-family: var(--font-mono);
  }

  .ticket-tabs {
    display: flex;
    gap: 4px;
    margin-bottom: 12px;
    border-bottom: 1px solid var(--stroke-0);
  }
  .ticket-tab {
    padding: 6px 12px;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    color: var(--fg-3);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .ticket-tab:hover { color: var(--fg-0); }
  .ticket-tab.active { color: var(--fg-0); border-bottom-color: var(--accent); }

  .ticket-scopes {
    display: flex;
    gap: 4px;
    margin-bottom: 8px;
  }
  .ticket-scope {
    padding: 4px 10px;
    border-radius: 999px;
    border: 1px solid var(--stroke-0);
    background: var(--bg-0);
    color: var(--fg-2);
    font-size: 11px;
    cursor: pointer;
  }
  .ticket-scope:hover { color: var(--fg-0); border-color: var(--fg-3); }
  .ticket-scope.active { border-color: var(--accent); background: var(--accent-weak); color: var(--fg-0); }

  .ticket-list { max-height: 260px; }
  .ticket-skeleton { padding: 8px 10px; }

  .ticket-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    border-radius: var(--r-sm);
    border: none;
    background: none;
    color: var(--fg-2);
    font-size: 12px;
    cursor: pointer;
    text-align: left;
    min-width: 0;
  }
  .ticket-item:hover { background: var(--bg-3); color: var(--fg-0); }
  .assigned-toggle {
    margin-left: auto;
    border: none;
    background: none;
    color: var(--fg-3);
    font-size: 11px;
    cursor: pointer;
    padding: 3px 6px;
    border-radius: var(--r-sm);
  }
  .assigned-toggle:hover { color: var(--fg-1); }
  .assigned-toggle.active { color: var(--accent); background: var(--bg-3); }
  .ticket-item.assigned { cursor: default; opacity: 0.6; }
  .ticket-key { color: var(--accent); flex-shrink: 0; }
  .ticket-title-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--fg-0);
  }
  .ticket-status {
    flex-shrink: 0;
    font-size: 10px;
    font-family: var(--font-mono);
    color: var(--fg-3);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .ticket-labels { display: flex; gap: 4px; flex-shrink: 0; }
  .ticket-label {
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--bg-3);
    color: var(--fg-2);
    font-size: 10px;
  }

  .selected-ticket { display: flex; flex-direction: column; gap: 6px; }
  .selected-ticket-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border: 1px solid var(--accent);
    background: var(--accent-weak);
    border-radius: var(--r-md);
    font-size: 12px;
  }

  .warning-box {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 12px;
    padding: 10px 14px;
    background: var(--bg-0);
    border: 1px solid var(--warn, oklch(0.75 0.15 80));
    border-radius: var(--r-md);
    font-size: 12px;
    color: var(--warn, oklch(0.75 0.15 80));
  }

  .field-label {
    font-size: 11px;
    font-family: var(--font-mono);
    color: var(--fg-3);
    letter-spacing: 0.04em;
  }

  /* Branch list */
  .branch-list-wrap {
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-md);
    background: var(--bg-0);
    overflow: hidden;
  }

  .branch-search-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    border-bottom: 1px solid var(--stroke-0);
    color: var(--fg-3);
  }

  .branch-search {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    font-size: 12px;
    color: var(--fg-0);
    font-family: var(--font-ui);
  }
  .branch-search::placeholder { color: var(--fg-4); }

  .branch-refresh {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 24px;
    height: 24px;
    background: none;
    border: none;
    border-radius: var(--r-sm);
    color: var(--fg-3);
    cursor: pointer;
    transition: background 0.1s, color 0.1s;
  }
  .branch-refresh:hover { background: var(--bg-3); color: var(--fg-0); }
  .branch-refresh:disabled { cursor: default; opacity: 0.6; }

  .branch-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 148px;
    overflow-y: auto;
    padding: 4px;
  }

  .branch-empty {
    padding: 10px;
    font-size: 12px;
    color: var(--fg-3);
    text-align: center;
  }

  .branch-group-label {
    padding: 6px 10px 2px;
    font-size: 10px;
    font-family: var(--font-mono);
    color: var(--fg-4);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .branch-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    border-radius: var(--r-sm);
    border: none;
    background: none;
    color: var(--fg-2);
    font-size: 12px;
    font-family: var(--font-mono);
    cursor: pointer;
    text-align: left;
    transition: background 0.1s, color 0.1s;
  }
  .branch-item:hover { background: var(--bg-3); color: var(--fg-0); }
  .branch-item.active { background: var(--accent-weak); color: var(--fg-0); }
  .branch-item.active :global(svg) { color: var(--accent); }
  .branch-item:disabled { opacity: 0.45; cursor: not-allowed; }
  .branch-item:disabled:hover { background: none; color: var(--fg-2); }
  .branch-name { flex: 1; }

  /* Loading overlay */
  :global(.modal-body.loading) { position: relative; }

  .creating-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    background: var(--bg-1);
    border-radius: var(--r-md);
    z-index: 10;
  }

  .creating-label {
    font-size: 13px;
    color: var(--fg-2);
  }

</style>
