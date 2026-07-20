<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy, tick } from 'svelte';
  import { activeStep, quickOpenVisible, commandPaletteVisible, terminalActive } from '$lib/stores/ui.js';
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
  import QuickOpen from '$lib/components/files/QuickOpen.svelte';
  import CommandPalette from '$lib/components/files/CommandPalette.svelte';
  import { shortcuts, SHORTCUT_DEFS } from '$lib/stores/shortcuts';
  import { computeTabInsertIndex } from '$lib/utils/files/files-tab-drag';
  import { clickOutside } from '$lib/utils/click-outside';
  import type { FileNode } from '$lib/services/file-service';
  import { matchesSearch } from '$lib/utils/files/files-search';

  import type { Instance } from '$lib/types/instance';
  import { instances, baseInstance, isBaseInstance, BASE_INSTANCE_ID } from '$lib/stores/instance';
  import { activateInstance, activeProject } from '$lib/stores/project';
  import { settings } from '$lib/stores/settings';
  import { gitFileCounts } from '$lib/stores/git';
  import ManageInstances from '$lib/components/ManageInstances.svelte';
  import ShortcutReference from '$lib/components/ShortcutReference.svelte';

  export let openProjects: { id: string; name: string; color: string }[];
  export let activeProjectId: string;
  export let activeInstance: Instance | null = null;

  let showInstanceMenu = false;
  let showManageModal = false;
  let showShortcuts = false;
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

  async function handleQuickOpenFile(path: string) {
    activeStep.set('files');
    terminalActive.set(false);
    quickOpenVisible.set(false);
    await tick();
    filesView?.openFileByPath(path);
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
    createInstance: void;
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

  onDestroy(() => unlistenFullscreen?.());

  $: tabsPadding = isMac && !isFullscreen ? '76px' : '8px';

  $: baseInst = $activeProject ? baseInstance($activeProject) : null;

  $: instanceGroups = (() => {
    const list = $instances;
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

<div class="workspace">
  <!-- Project tabs - padding-left clears native macOS traffic lights -->
  <div class="tabs-row" style="padding-left: {tabsPadding};" bind:this={tabsRowEl}>
    <button class="brand-chip" on:click={() => dispatch('goHome')} title={t('workspace.homeTitle') as string}>
      <CairnLogo size={18}/>
      <span>Cairn</span>
    </button>
    <div class="tab-divider"></div>
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
        <button class="instance-switcher {isBaseInstance(activeInstance.id) ? 'is-base' : ''}" on:click={openInstanceMenu}>
          {#if isBaseInstance(activeInstance.id)}
            <Icon name="folder" size={12}/>
            <span>{activeInstance.ticket.title}</span>
          {:else}
            <Icon name="ticket" size={12}/>
            <span class="mono">{activeInstance.ticket.id}</span>
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
                </button>
              {/each}
              <div class="instance-menu-divider"></div>
            {/if}
            <button class="instance-menu-item instance-menu-new" on:click={() => { showInstanceMenu = false; dispatch('createInstance'); }}>
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
          <span class="instance-dot"></span>
          <span class="ticket-name">{activeInstance.ticket.title}</span>
        </div>

        {#if activeInstance.branch}
          <div class="branch-info">
            <Icon name="branch" size={11}/>
            <span class="target">{activeInstance.branch}</span>
          </div>
        {/if}

        <div class="instance-actions">
          <button class="btn"><Icon name="pause" size={13}/> {t('workspace.pauseAgent')}</button>
          <button class="btn primary"><Icon name="check" size={13}/> {t('workspace.finalizeInstance')}</button>
        </div>
      {/if}
    {:else}
      {#if $instances.length > 0}
        <button class="create-instance-btn" on:click={() => showManageModal = true}>
          <Icon name="branch" size={13}/>
          {t('workspace.switchInstance')}
        </button>
      {/if}
      <button class="create-instance-btn" on:click={() => dispatch('createInstance')}>
        <Icon name="plus" size={13}/>
        {t('workspace.createInstance')}
      </button>
    {/if}
  </div>

  <!-- Content -->
  <div class="content-row">
    <aside class="sidebar" class:sidebar-empty={!activeInstance}>
      {#each STEPS as s}
        <button
          class="step {$activeStep === s.id && !$terminalActive ? 'active' : ''} {doneSteps.has(s.id) ? 'done' : ''}"
          disabled={!activeInstance}
          on:click={() => { activeStep.set(s.id as any); terminalActive.set(false); }}
        >
          <span class="icon"><Icon name={s.icon} size={20}/></span>
          <span class="label">{s.label}</span>
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
        class="step {$terminalActive ? 'active' : ''}"
        disabled={!activeInstance}
        aria-label={t('workspace.ariaTerminal') as string}
        on:click={() => terminalActive.set(true)}
      >
        <span class="icon"><Icon name="terminal" size={18}/></span>
        <span class="label">{t('workspace.termLabel')}</span>
      </button>
    </aside>

    <main class="main">
      <div class="step-view" class:step-hidden={$terminalActive || $activeStep !== 'files'}><FilesView bind:this={filesView} onGoSettings={() => dispatch('goSettings')} /></div>
      <div class="step-view" class:step-hidden={$terminalActive || $activeStep !== 'agent'}><AgentView/></div>
      <div class="step-view" class:step-hidden={$terminalActive || $activeStep !== 'review'}><ReviewView/></div>
      <div class="step-view" class:step-hidden={$terminalActive || $activeStep !== 'tests'}><TestsView/></div>
      <div class="step-view" class:step-hidden={$terminalActive || $activeStep !== 'git'}><GitView on:openFile={async (e) => { activeStep.set('files'); terminalActive.set(false); await tick(); filesView?.openFileByPath(e.detail); }} on:fileDiscarded={(e) => filesView?.reloadFileByPath(e.detail)} on:goGitSettings={() => dispatch('goGitSettings')}/></div>
      <div class="step-view" class:step-hidden={$terminalActive || $activeStep !== 'cicd'}><CiCdView/></div>
      <div class="step-view" class:step-hidden={!$terminalActive}><TerminalView/></div>
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
                <button class="btn no-instance-cta" on:click={() => dispatch('createInstance')}>
                  <Icon name="plus" size={14}/>
                  {t('workspace.noInstanceCta')}
                </button>
              </div>
            {:else}
              <h2 class="no-instance-headline">{t('workspace.noInstanceHeadline')}</h2>
              <p class="no-instance-sub">{t('workspace.noInstanceSub')}</p>
              <button class="btn primary no-instance-cta" on:click={() => dispatch('createInstance')}>
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
    onOpen={handleQuickOpenFile}
    onClose={() => quickOpenVisible.set(false)}
  />
{/if}

{#if $commandPaletteVisible}
  <CommandPalette
    shortcuts={$shortcuts}
    shortcutDefs={SHORTCUT_DEFS}
    onClose={() => commandPaletteVisible.set(false)}
    onAction={(id) => { commandPaletteVisible.set(false); filesView?.executeAction(id); }}
  />
{/if}

{#if showManageModal}
  <ManageInstances
    activeInstanceId={activeInstance?.id ?? null}
    on:close={() => showManageModal = false}
    on:newInstance={() => { showManageModal = false; dispatch('createInstance'); }}
  />
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


  .sidebar-empty .step {
    opacity: 0.3;
    pointer-events: none;
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
