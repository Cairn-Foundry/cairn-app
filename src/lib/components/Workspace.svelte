<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy, tick } from 'svelte';
  import { activeScreen, activeStep, quickOpenVisible, commandPaletteVisible, terminalActive, commandsActive, envActive, showTool } from '$lib/stores/ui.js';
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n';
  import CairnLogo from '$lib/components/layout/CairnLogo.svelte';
  import FilesView from '$lib/components/files/FilesView.svelte';
  import AgentView from '$lib/components/agent/AgentView.svelte';
  import ReviewView from '$lib/components/review/ReviewView.svelte';
  import TestsView from '$lib/components/tests/TestsView.svelte';
  import GitView from '$lib/components/git/GitView.svelte';
  import CiCdView from '$lib/components/cicd/CiCdView.svelte';
  import TerminalView from '$lib/components/terminal/TerminalView.svelte';
  import CommandsView from '$lib/components/commands/CommandsView.svelte';
  import EnvView from '$lib/components/env/EnvView.svelte';
  import PinnedCommandsPanel from '$lib/components/commands/PinnedCommandsPanel.svelte';
  import CommandPromptDialog from '$lib/components/commands/CommandPromptDialog.svelte';
  import CommandConfirmDialog from '$lib/components/commands/CommandConfirmDialog.svelte';
  import { pendingLaunch, cancelPendingLaunch, confirmPendingLaunch, requestCommandLaunch, commandRuns } from '$lib/stores/command-run';
  import { globalCommands, loadCommands, projectCommands } from '$lib/stores/custom-command';
  import type { CustomCommand } from '$lib/services/custom-command-service';
  import ToolsPanel from '$lib/components/layout/ToolsPanel.svelte';
  import { hasPendingUpdate, openUpdateModal } from '$lib/stores/update';
  import QuickOpen from '$lib/components/files/QuickOpen.svelte';
  import CommandPalette from '$lib/components/files/CommandPalette.svelte';
  import { shortcuts, activeShortcuts, matchesShortcut, bindingToLabels, SHORTCUT_DEFS } from '$lib/stores/shortcuts';
  import type { ShortcutId } from '$lib/types/shortcuts';
  import { computeTabInsertIndex } from '$lib/utils/files/files-tab-drag';
  import { clickOutside } from '$lib/utils/click-outside';
  import type { FileNode, QuickSearchHit } from '$lib/services/file-service';
  import { matchesSearch } from '$lib/utils/files/files-search';

  import type { Instance } from '$lib/types/instance';
  import { instances, baseInstance, isBaseInstance, isArchivedInstance, BASE_INSTANCE_ID } from '$lib/stores/instance';
  import { activateInstance, activeProject } from '$lib/stores/project';
  import { settings } from '$lib/stores/settings';
  import { gitFileCounts, gitHasConflicts } from '$lib/stores/git';
  import { agentBusy, agentDone, agentCompletionPing, agentActivityKey } from '$lib/stores/agent-activity';
  import ManageInstances from '$lib/components/ManageInstances.svelte';
  import FinalizeInstance from '$lib/components/FinalizeInstance.svelte';
  import ShortcutReference from '$lib/components/ShortcutReference.svelte';

  export let openProjects: { id: string; name: string; color: string }[];
  export let activeProjectId: string;
  export let activeInstance: Instance | null = null;

  let showInstanceMenu = false;
  let showManageModal = false;
  let showFinalizeModal = false;
  let showShortcuts = false;
  let showTools = false;
  let showPinned = false;
  let filesView: FilesView;
  let instanceSearch = '';
  let instanceSearchEl: HTMLInputElement | null = null;

  async function openInstanceMenu() {
    instanceSearch = '';
    showInstanceMenu = !showInstanceMenu;
    if (showInstanceMenu) {
      await tick();
      instanceSearchEl?.focus();
    }
  }

  let quickOpenTree: FileNode[] = [];
  $: if ($quickOpenVisible) quickOpenTree = filesView?.getTree() ?? [];

  let lastCompletionPing = 0;
  let selectorAlert = false;
  let selectorAlertTimer: ReturnType<typeof setTimeout> | null = null;
  $: if ($agentCompletionPing !== lastCompletionPing) {
    lastCompletionPing = $agentCompletionPing;
    if (lastCompletionPing > 0) {
      selectorAlert = true;
      if (selectorAlertTimer) clearTimeout(selectorAlertTimer);
      selectorAlertTimer = setTimeout(() => { selectorAlert = false; }, 1900);
    }
  }
  $: activeInstanceDone = activeInstance
    ? !!$agentDone[agentActivityKey(activeInstance.projectId, activeInstance.id)]
    : false;

  async function handleQuickOpen(hit: QuickSearchHit) {
    openStep('files');
    quickOpenVisible.set(false);
    await tick();
    if (hit.isDir) filesView?.revealDirectory(hit.path);
    else filesView?.openFileByPath(hit.path);
  }

  function selectTool(id: string) {
    showTool(id as 'terminal' | 'commands' | 'env');
    showTools = false;
    showPinned = false;
  }

  function closeSidebarPanels() {
    showTools = false;
    showPinned = false;
  }

  function togglePinned() {
    showPinned = !showPinned;
    if (showPinned) showTools = false;
  }

  function toggleTools() {
    showTools = !showTools;
    if (showTools) showPinned = false;
  }

  function openStep(id: string) {
    activeStep.set(id as any);
    showTool(null);
  }

  async function toggleFullscreen() {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      await win.setFullscreen(!(await win.isFullscreen()));
      await checkFullscreen();
    } catch {}
  }

  /**
   * Actions the workspace owns rather than the editor. Everything else is an
   * editor action and goes down to FilesView.
   */
  const APP_ACTIONS: ShortcutId[] = [
    'toggleFullscreen', 'toggleTools', 'openTerminal', 'openCommands',
    'openEnv', 'goHome', 'reloadEditor', 'reloadProject',
  ];

  async function runAction(id: string) {
    switch (id) {
      case 'toggleFullscreen': await toggleFullscreen(); break;
      case 'toggleTools':      if (activeInstance) toggleTools(); break;
      case 'openTerminal':     if (activeInstance) selectTool('terminal'); break;
      case 'openCommands':     if (activeInstance) selectTool('commands'); break;
      case 'openEnv':          if (activeInstance) selectTool('env'); break;
      case 'goHome':           dispatch('goHome'); break;
      default:                 await filesView?.executeAction(id); break;
    }
  }

  function handleAppKey(e: KeyboardEvent) {
    for (const id of APP_ACTIONS) {
      if (!matchesShortcut(e, $activeShortcuts[id])) continue;
      if (id !== 'toggleFullscreen' && $activeScreen !== 'workspace') return;
      e.preventDefault();
      void runAction(id);
      return;
    }
  }

  $: toolActive = $terminalActive || $commandsActive || $envActive;

  $: if (activeProjectId) void loadCommands(activeProjectId);

  $: paletteCommands = [
    ...$globalCommands,
    ...($projectCommands[activeProjectId] ?? []),
  ];

  $: globalPinned = $globalCommands.filter(c => c.pinned);
  $: projectPinned = ($projectCommands[activeProjectId] ?? []).filter(c => c.pinned);
  $: pinnedCommands = [...globalPinned, ...projectPinned];

  $: hasRunningPinned = Object.values($commandRuns).some(
    r =>
      r.projectId === activeProjectId &&
      r.instanceId === activeInstance?.id &&
      pinnedCommands.some(c => c.id === r.commandId),
  );

  async function runCommandFromPalette(command: CustomCommand) {
    commandPaletteVisible.set(false);
    if (!$activeProject || !activeInstance) return;
    await requestCommandLaunch(command, $activeProject, activeInstance);
  }

  async function selectInstance(id: string) {
    showInstanceMenu = false;
    instanceSearch = '';
    await activateInstance(activeProjectId, id);
  }

  const dispatch = createEventDispatcher<{
    projectChange: string;
    closeProject: string;
    addProject: void;
    goHome: void;
    goSettings: void;
    goShortcuts: void;
    goGitSettings: void;
    createInstance: { branch?: string };
    reorderTabs: string[];
  }>();

  let dragSrcIndex: number | null = null;
  let insertIndex: number | null = null;
  let didDrag = false;
  let dragActive = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let tabsRowEl: HTMLElement | null = null;

  const DRAG_THRESHOLD = 6;

  function tabPointerDown(e: PointerEvent, index: number) {
    if ((e.target as Element).closest('button')) return;
    e.preventDefault();
    dragSrcIndex = index;
    insertIndex = index;
    didDrag = false;
    dragActive = false;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function tabPointerMove(e: PointerEvent) {
    if (dragSrcIndex === null) return;
    if (!dragActive) {
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
      dragActive = true;
      document.body.classList.add('dragging');
    }
    const next = computeTabInsertIndex(tabsRowEl, e.clientX, { selector: '.project-tab' });
    insertIndex = next;
    didDrag = true;
  }

  function tabPointerUp() {
    if (dragSrcIndex === null || insertIndex === null) return;
    if (dragActive) {
      const isNoop = insertIndex === dragSrcIndex || insertIndex === dragSrcIndex + 1;
      if (!isNoop) {
        const reordered = openProjects.map((p) => p.id);
        const [moved] = reordered.splice(dragSrcIndex, 1);
        const adjustedInsert = insertIndex > dragSrcIndex ? insertIndex - 1 : insertIndex;
        reordered.splice(adjustedInsert, 0, moved);
        dispatch('reorderTabs', reordered);
      }
    }
    dragSrcIndex = null;
    insertIndex = null;
    dragActive = false;
    document.body.classList.remove('dragging');
  }

  $: STEPS = $settings.workflowTabs
    .slice()
    .sort((a, b) => a.order - b.order)
    .filter(t => t.enabled)
    .map(t => ({ id: t.key, label: t.name, icon: t.icon }));

  const doneSteps = new Set<string>();

  // Detect macOS and fullscreen state to adjust traffic-light clearance
  let isMac = false;
  let isFullscreen = false;

  async function checkFullscreen() {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      isFullscreen = await getCurrentWindow().isFullscreen();
    } catch {}
  }

  let unlistenFullscreen: (() => void) | undefined;

  onMount(async () => {
    isMac = navigator.userAgent.includes('Mac');
    if (!isMac) return;
    await checkFullscreen();
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      unlistenFullscreen = await getCurrentWindow().onResized(() => checkFullscreen());
    } catch {}
  });

  onDestroy(() => {
    unlistenFullscreen?.();
    if (selectorAlertTimer) clearTimeout(selectorAlertTimer);
  });

  $: tabsPadding = isMac && !isFullscreen ? '76px' : '8px';

  $: baseInst = $activeProject ? baseInstance($activeProject) : null;

  $: instanceGroups = (() => {
    const list = $instances.filter(i => !isArchivedInstance(i));
    const byId = new Map(list.map(i => [i.id, i]));
    const placed = new Set<string>();
    const result: Array<{ inst: typeof list[0]; depth: number }> = [];

    function placeSubtree(inst: typeof list[0], depth: number) {
      if (placed.has(inst.id)) return;
      result.push({ inst, depth });
      placed.add(inst.id);
      for (const child of list) {
        if (child.parentInstanceId === inst.id) placeSubtree(child, depth + 1);
      }
    }

    for (const inst of list) {
      if (!placed.has(inst.id) && !byId.has(inst.parentInstanceId ?? '')) {
        placeSubtree(inst, 0);
      }
    }
    return result;
  })();

  $: instanceGroupsFiltered = instanceSearch
    ? instanceGroups.filter(({ inst }) =>
        matchesSearch(inst.ticket.id, instanceSearch) ||
        matchesSearch(inst.ticket.title, instanceSearch)
      )
    : instanceGroups;
</script>

<svelte:window on:keydown={handleAppKey}/>

<div class="workspace">
  <!-- Project tabs - padding-left clears native macOS traffic lights -->
  <div class="tabs-row" style="padding-left: {tabsPadding};" bind:this={tabsRowEl}>
    <button class="brand-chip" on:click={() => dispatch('goHome')} title={t('workspace.homeTitle') as string}>
      <CairnLogo size={18}/>
      <span>Cairn</span>
    </button>
    <div class="tab-divider"></div>
    <div class="tabs-scroll">
    {#each openProjects as p, i}
      {#if dragActive && dragSrcIndex !== null && insertIndex === i && !(insertIndex === dragSrcIndex || insertIndex === dragSrcIndex + 1)}
        <div class="drop-indicator"></div>
      {/if}
      <div
        class="project-tab {p.id === activeProjectId ? 'active' : ''} {dragActive && dragSrcIndex === i ? 'dragging' : ''}"
        role="tab"
        tabindex="0"
        on:pointerdown={(e) => tabPointerDown(e, i)}
        on:pointermove={tabPointerMove}
        on:pointerup={tabPointerUp}
        on:click={() => { if (!didDrag) dispatch('projectChange', p.id); didDrag = false; }}
        on:keydown={(e) => e.key === 'Enter' && dispatch('projectChange', p.id)}
      >
        <span class="dot" style="background: {p.color}"></span>
        <span>{p.name}</span>
        <button class="close" on:click|stopPropagation={() => dispatch('closeProject', p.id)}>
          <Icon name="x" size={11}/>
        </button>
      </div>
    {/each}
    {#if dragActive && dragSrcIndex !== null && insertIndex === openProjects.length && insertIndex !== dragSrcIndex + 1}
      <div class="drop-indicator"></div>
    {/if}
    <button class="tab-add" on:click={() => dispatch('addProject')}>
      <Icon name="plus" size={12}/> {t('workspace.addProject')}
    </button>
    </div>
    <div class="spacer" data-tauri-drag-region></div>
    <button class="icon-btn" aria-label={t('workspace.ariaSearch') as string} on:click={() => quickOpenVisible.set(true)}><Icon name="search" size={14}/></button>
    <button class="icon-btn" aria-label={t('workspace.ariaCommandPalette') as string} on:click={() => filesView?.openCommandPalette()}><Icon name="command" size={14}/></button>
    <button class="icon-btn" aria-label={t('workspace.ariaKeyboardShortcuts') as string} on:click={() => showShortcuts = true}><Icon name="help" size={14}/></button>
    <button class="icon-btn" aria-label={t('workspace.ariaSettings') as string} on:click={() => dispatch('goSettings')}><Icon name="settings" size={14}/></button>
  </div>

  <!-- Instance header -->
  <div class="instance-header">
    {#if activeInstance}
      <div class="instance-switcher-wrap" use:clickOutside={() => { showInstanceMenu = false; instanceSearch = ''; }}>
        <button class="instance-switcher {isBaseInstance(activeInstance.id) ? 'is-base' : ''}" class:agent-alert={selectorAlert} on:click={openInstanceMenu}>
          {#if isBaseInstance(activeInstance.id)}
            <Icon name="folder" size={12}/>
            <span>{activeInstance.ticket.title}</span>
          {:else}
            <Icon name="ticket" size={12}/>
            <span class="mono">{activeInstance.ticket.id}</span>
          {/if}
          {#if activeInstanceDone}
            <span class="agent-done-dot" title={t('workspace.agentFinished') as string}></span>
          {/if}
          <Icon name="chev-d" size={11}/>
        </button>
        {#if showInstanceMenu}
          <div class="instance-menu">
            <div class="instance-menu-search">
              <Icon name="search" size={11}/>
              <input
                bind:this={instanceSearchEl}
                bind:value={instanceSearch}
                class="instance-menu-search-input"
                placeholder={t('manageInstances.searchPlaceholder') as string}
                autocomplete="off"
                on:keydown={(e) => e.key === 'Escape' && (showInstanceMenu = false)}
              />
            </div>
            <button
              class="instance-menu-item instance-menu-base {activeInstance?.id === BASE_INSTANCE_ID ? 'active' : ''}"
              on:click={() => selectInstance(BASE_INSTANCE_ID)}
            >
              <Icon name="folder" size={13}/>
              <span>{baseInst?.ticket.title}</span>
              {#if baseInst && $agentBusy[agentActivityKey(baseInst.projectId, baseInst.id)]}
                <span class="agent-busy-dot" title={t('workspace.agentRunning') as string}></span>
              {:else if baseInst && $agentDone[agentActivityKey(baseInst.projectId, baseInst.id)]}
                <span class="agent-done-dot" title={t('workspace.agentFinished') as string}></span>
              {/if}
            </button>
            <div class="instance-menu-divider"></div>
            {#if instanceGroupsFiltered.length > 0}
              <div class="instance-menu-group">{t('workspace.instancesGroup')}</div>
              {#each instanceGroupsFiltered as { inst, depth }}
                <button
                  class="instance-menu-item {inst.id === activeInstance?.id ? 'active' : ''}"
                  style="padding-left: {10 + depth * 12}px"
                  on:click={() => selectInstance(inst.id)}
                >
                  <span class="mono">{inst.ticket.id}</span>
                  <span class="instance-menu-title">{inst.ticket.title}</span>
                  {#if $agentBusy[agentActivityKey(inst.projectId, inst.id)]}
                    <span class="agent-busy-dot" title={t('workspace.agentRunning') as string}></span>
                  {:else if $agentDone[agentActivityKey(inst.projectId, inst.id)]}
                    <span class="agent-done-dot" title={t('workspace.agentFinished') as string}></span>
                  {/if}
                </button>
              {/each}
              <div class="instance-menu-divider"></div>
            {/if}
            <button class="instance-menu-item instance-menu-new" on:click={() => { showInstanceMenu = false; dispatch('createInstance', {}); }}>
              <Icon name="plus" size={11}/>
              <span>{t('workspace.newInstance')}</span>
            </button>
            <div class="instance-menu-divider"></div>
            <button class="instance-menu-item instance-menu-manage" on:click={() => { showInstanceMenu = false; showManageModal = true; }}>
              <Icon name="settings" size={11}/>
              <span>{t('workspace.manageInstances')}</span>
            </button>
          </div>
        {/if}
      </div>

      {#if !isBaseInstance(activeInstance.id)}
        <div class="instance-title">
          <span class="ticket-name">{activeInstance.ticket.title}</span>
        </div>

        {#if activeInstance.branch}
          <div class="branch-info">
            <Icon name="branch" size={11}/>
            <span class="target">{activeInstance.branch}</span>
          </div>
        {/if}

        <div class="instance-actions">
          <button class="btn primary" on:click={() => showFinalizeModal = true}>
            <Icon name="check" size={13}/> {t('workspace.finalizeInstance')}
          </button>
        </div>
      {/if}
    {:else}
      {#if $instances.length > 0}
        <button class="create-instance-btn" on:click={() => showManageModal = true}>
          <Icon name="branch" size={13}/>
          {t('workspace.switchInstance')}
        </button>
      {/if}
      <button class="create-instance-btn" on:click={() => dispatch('createInstance', {})}>
        <Icon name="plus" size={13}/>
        {t('workspace.createInstance')}
      </button>
    {/if}
  </div>

  <!-- Content -->
  <div class="content-row">
    <div class="sidebar-wrap" use:clickOutside={closeSidebarPanels}>
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions a11y_click_events_have_key_events -->
    <aside
      class="sidebar"
      class:sidebar-empty={!activeInstance}
      on:click={(e) => { if (!(e.target as Element).closest('.tools-toggle, .pinned-toggle')) closeSidebarPanels(); }}
    >
      {#each STEPS as s}
        <button
          class="step {$activeStep === s.id && !toolActive ? 'active' : ''} {doneSteps.has(s.id) ? 'done' : ''}"
          disabled={!activeInstance}
          on:click={() => openStep(s.id)}
        >
          <span class="icon"><Icon name={s.icon} size={20}/></span>
          <span class="label">{s.label}</span>
          {#if s.id === 'git' && $gitHasConflicts}
            <span class="conflict-dot" title={t('git.conflictsToResolve') as string}></span>
          {/if}
          {#if doneSteps.has(s.id)}
            <span class="check"><Icon name="check" size={11}/></span>
          {:else if s.id === 'git' && $gitFileCounts.total > 0}
            <span class="git-badge" title={`${$gitFileCounts.unstaged} unstaged, ${$gitFileCounts.staged} staged`}>
              {#if $gitFileCounts.unstaged > 0}<span class="seg unstaged">{$gitFileCounts.unstaged}</span>{/if}
              {#if $gitFileCounts.staged > 0}<span class="seg staged">{$gitFileCounts.staged}</span>{/if}
            </span>
          {/if}
        </button>
      {/each}
      <div class="divider"></div>
      <div class="spacer"></div>
      <button
        class="step pinned-toggle {showPinned ? 'active' : ''}"
        disabled={!activeInstance}
        aria-label={t('commands.pinnedTitle') as string}
        on:click={togglePinned}
      >
        <span class="icon"><Icon name="command" size={18}/></span>
        <span class="label">{t('commands.pinnedLabel')}</span>
        {#if hasRunningPinned}
          <span class="running-dot" title={t('commands.statusRunning') as string}></span>
        {/if}
      </button>
      <button
        class="step tools-toggle {showTools || toolActive ? 'active' : ''}"
        disabled={!activeInstance}
        aria-label={t('workspace.ariaTools') as string}
        title={`${t('workspace.toolsLabel')} (${bindingToLabels($shortcuts.toggleTools).join('')})`}
        on:click={toggleTools}
      >
        <span class="icon"><Icon name="grid" size={18}/></span>
        <span class="label">{t('workspace.toolsLabel')}</span>
      </button>
      {#if $hasPendingUpdate}
        <button
          class="step update-toggle"
          aria-label={t('update.cardTitle') as string}
          on:click={openUpdateModal}
        >
          <span class="icon"><Icon name="download" size={18}/></span>
          <span class="label">{t('update.sidebarLabel')}</span>
          <span class="running-dot" title={t('update.cardTitle') as string}></span>
        </button>
      {/if}
    </aside>

    {#if showTools && activeInstance}
      <ToolsPanel
        activeTool={$terminalActive ? 'terminal' : $commandsActive ? 'commands' : $envActive ? 'env' : null}
        on:close={() => showTools = false}
        on:select={(e) => selectTool(e.detail)}
      />
    {/if}

    {#if showPinned && activeInstance}
      <PinnedCommandsPanel
        {globalPinned}
        {projectPinned}
        on:close={() => showPinned = false}
        on:manage={() => selectTool('commands')}
      />
    {/if}
    </div>

    <main class="main">
      <div class="step-view" class:step-hidden={toolActive || $activeStep !== 'files'}><FilesView bind:this={filesView} onGoSettings={() => dispatch('goSettings')} /></div>
      <div class="step-view" class:step-hidden={toolActive || $activeStep !== 'agent'}><AgentView/></div>
      <div class="step-view" class:step-hidden={toolActive || $activeStep !== 'review'}><ReviewView/></div>
      <div class="step-view" class:step-hidden={toolActive || $activeStep !== 'tests'}><TestsView/></div>
      <div class="step-view" class:step-hidden={toolActive || $activeStep !== 'git'}><GitView on:openFile={async (e) => { openStep('files'); await tick(); filesView?.openFileByPath(e.detail); }} on:fileDiscarded={(e) => filesView?.reloadFileByPath(e.detail)} on:filesChanged={() => filesView?.reloadOpenFiles()} on:goGitSettings={() => dispatch('goGitSettings')} on:createInstanceFromRef={(e) => dispatch('createInstance', { branch: e.detail })}/></div>
      <div class="step-view" class:step-hidden={toolActive || $activeStep !== 'cicd'}><CiCdView/></div>
      <div class="step-view" class:step-hidden={!$terminalActive}><TerminalView/></div>
      <div class="step-view" class:step-hidden={!$commandsActive}><CommandsView/></div>
      <div class="step-view" class:step-hidden={!$envActive}><EnvView/></div>
      {#if !activeInstance}
        <div class="no-instance">
          <div class="no-instance-inner">
            <div class="no-instance-icon">
              <Icon name="cairn" size={48}/>
            </div>
            {#if $instances.length > 0}
              <h2 class="no-instance-headline">{t('workspace.noInstanceHasOthersHeadline')}</h2>
              <p class="no-instance-sub">{t('workspace.noInstanceHasOthersSub')}</p>
              <div class="no-instance-actions">
                <button class="btn primary no-instance-cta" on:click={() => showManageModal = true}>
                  <Icon name="branch" size={14}/>
                  {t('workspace.switchInstance')}
                </button>
                <button class="btn no-instance-cta" on:click={() => dispatch('createInstance', {})}>
                  <Icon name="plus" size={14}/>
                  {t('workspace.noInstanceCta')}
                </button>
              </div>
            {:else}
              <h2 class="no-instance-headline">{t('workspace.noInstanceHeadline')}</h2>
              <p class="no-instance-sub">{t('workspace.noInstanceSub')}</p>
              <button class="btn primary no-instance-cta" on:click={() => dispatch('createInstance', {})}>
                <Icon name="plus" size={14}/>
                {t('workspace.noInstanceCta')}
              </button>
            {/if}
          </div>
        </div>
      {/if}
    </main>
  </div>
</div>

{#if $quickOpenVisible}
  <QuickOpen
    tree={quickOpenTree}
    worktreePath={activeInstance?.worktreePath ?? ''}
    onOpen={handleQuickOpen}
    onClose={() => quickOpenVisible.set(false)}
  />
{/if}

{#if $commandPaletteVisible}
  <CommandPalette
    shortcuts={$shortcuts}
    shortcutDefs={SHORTCUT_DEFS}
    customCommands={paletteCommands}
    onClose={() => commandPaletteVisible.set(false)}
    onAction={(id) => { commandPaletteVisible.set(false); void runAction(id); }}
    onRunCommand={runCommandFromPalette}
  />
{/if}

{#if showManageModal}
  <ManageInstances
    activeInstanceId={activeInstance?.id ?? null}
    on:close={() => showManageModal = false}
    on:newInstance={() => { showManageModal = false; dispatch('createInstance', {}); }}
  />
{/if}

{#if showFinalizeModal && activeInstance && !isBaseInstance(activeInstance.id)}
  <FinalizeInstance
    instance={activeInstance}
    on:close={() => showFinalizeModal = false}
    on:openGit={() => openStep('git')}
  />
{/if}

{#if $pendingLaunch}
  {#if $pendingLaunch.prompts.length > 0}
    <CommandPromptDialog
      commandName={$pendingLaunch.command.name}
      labels={$pendingLaunch.prompts}
      on:submit={(e) => confirmPendingLaunch(e.detail)}
      on:close={cancelPendingLaunch}
    />
  {:else}
    <CommandConfirmDialog
      command={$pendingLaunch.command}
      on:confirm={() => confirmPendingLaunch()}
      on:close={cancelPendingLaunch}
    />
  {/if}
{/if}

{#if showShortcuts}
  <ShortcutReference
    on:close={() => showShortcuts = false}
    on:goSettings={() => { showShortcuts = false; dispatch('goShortcuts'); }}
  />
{/if}

<style>
  .instance-switcher-wrap { position: relative; }

  .instance-menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 100;
    background: var(--bg-2);
    border: 1px solid var(--stroke-0);
    border-radius: 6px;
    padding: 4px;
    min-width: 200px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
  }

  .instance-menu-search {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    margin-bottom: 4px;
    border-bottom: 1px solid var(--stroke-0);
    color: var(--fg-4);
  }

  .instance-menu-search-input {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    font-size: 12px;
    font-family: var(--font-ui);
    color: var(--fg-0);
    min-width: 0;
  }
  .instance-menu-search-input::placeholder { color: var(--fg-4); }

  .instance-menu-item {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    padding: 6px 10px;
    background: none;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    text-align: left;
    color: var(--fg-2);
    font-size: 12px;
  }
  .instance-menu-item:hover { background: var(--bg-4); color: var(--fg-0); }
  .instance-menu-item.active { background: var(--accent-weak); color: var(--fg-0); }

  .agent-busy-dot {
    position: absolute;
    right: 10px;
    top: 50%;
    transform: translateY(-50%);
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
    animation: agent-pulse 1.5s ease-in-out infinite;
  }
  @keyframes agent-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.35; }
  }

  .agent-done-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--fg-0);
    flex-shrink: 0;
  }
  .instance-menu-item .agent-done-dot {
    position: absolute;
    right: 10px;
    top: 50%;
    transform: translateY(-50%);
  }

  .instance-switcher.agent-alert {
    animation: agent-alert-flash 0.6s ease-in-out 3;
  }
  @keyframes agent-alert-flash {
    0%, 100% { border-color: var(--stroke-0); box-shadow: none; }
    50% {
      border-color: var(--fg-0);
      box-shadow: 0 0 0 3px color-mix(in oklch, var(--fg-0) 30%, transparent);
    }
  }

  .instance-menu-title { font-size: 11px; color: var(--fg-3); }

  .instance-menu-base {
    flex-direction: row;
    align-items: center;
    gap: 8px;
    color: var(--fg-1);
  }
  .instance-menu-base :global(svg) { color: var(--fg-3); flex-shrink: 0; }
  .instance-menu-base.active :global(svg) { color: var(--accent); }

  .instance-menu-group {
    padding: 4px 10px 2px;
    font-size: 10px;
    font-family: var(--font-mono);
    color: var(--fg-4);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .instance-menu-divider { height: 1px; background: var(--stroke-0); margin: 4px 0; }

  .instance-menu-new {
    flex-direction: row;
    align-items: center;
    gap: 6px;
    color: var(--fg-3);
    font-size: 12px;
  }
  .instance-menu-new:hover { color: var(--fg-0); }

  .instance-menu-manage {
    flex-direction: row;
    align-items: center;
    gap: 6px;
    color: var(--fg-3);
    font-size: 12px;
  }
  .instance-menu-manage:hover { color: var(--fg-0); }

  .create-instance-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 12px;
    background: var(--bg-3);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-sm);
    color: var(--fg-2);
    font-size: 12px;
    cursor: pointer;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }
  .create-instance-btn:hover {
    background: var(--accent-weak);
    border-color: var(--accent);
    color: var(--fg-0);
  }

  .no-instance {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-0);
    padding: 40px 24px;
    z-index: 10;
  }

  .no-instance-inner {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    max-width: 420px;
    gap: 0;
  }

  .no-instance-icon {
    color: var(--fg-4);
    margin-bottom: 24px;
    opacity: 0.6;
  }

  .no-instance-headline {
    font-family: var(--font-serif);
    font-weight: 400;
    font-size: 28px;
    color: var(--fg-0);
    margin: 0 0 12px;
    letter-spacing: -0.02em;
    line-height: 1.15;
  }

  .no-instance-sub {
    font-size: 13px;
    color: var(--fg-3);
    line-height: 1.6;
    margin: 0 0 28px;
    max-width: 340px;
  }

  .no-instance-cta {
    padding: 10px 22px;
    font-size: 13px;
  }

  .no-instance-actions {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    justify-content: center;
  }

  .sidebar-wrap { display: contents; }

  .step .running-dot {
    position: absolute;
    top: 6px;
    left: 6px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 2px var(--bg-1);
    animation: sidebar-run-pulse 1.5s ease-in-out infinite;
  }
  @keyframes sidebar-run-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.35; }
  }

  .sidebar-empty .step {
    opacity: 0.3;
    pointer-events: none;
  }
  .sidebar-empty .step.update-toggle {
    opacity: 1;
    pointer-events: auto;
  }

  :global(.project-tab) { cursor: pointer; }
  :global(.project-tab.dragging) { opacity: 0.4; cursor: grabbing; }
  :global(.drop-indicator) {
    width: 2px;
    align-self: stretch;
    background: var(--accent, #6c8eff);
    border-radius: 1px;
    margin: 4px 1px;
    pointer-events: none;
  }
</style>
