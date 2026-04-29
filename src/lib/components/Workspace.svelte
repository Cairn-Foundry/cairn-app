<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import { activeStep } from '$lib/stores/ui.js';
  import Icon from '$lib/components/Icon.svelte';
  import CairnLogo from '$lib/components/layout/CairnLogo.svelte';
  import { draggableRegion } from '$lib/utils/window-drag.js';
  import FilesView from '$lib/components/files/FilesView.svelte';
  import AgentView from '$lib/components/agent/AgentView.svelte';
  import ReviewView from '$lib/components/review/ReviewView.svelte';
  import TestsView from '$lib/components/tests/TestsView.svelte';
  import GitView from '$lib/components/git/GitView.svelte';
  import CiCdView from '$lib/components/cicd/CiCdView.svelte';
  import { computeTabInsertIndex } from '$lib/utils/files/files-tab-drag';
  import { clickOutside } from '$lib/utils/click-outside';

  import type { Instance } from '$lib/types/instance';
  import { instances } from '$lib/stores/instance';
  import { activateInstance } from '$lib/stores/project';
  import { settings } from '$lib/stores/settings';
  import ManageInstances from '$lib/components/ManageInstances.svelte';
  import ShortcutReference from '$lib/components/ShortcutReference.svelte';

  export let openProjects: { id: string; name: string; color: string }[];
  export let activeProjectId: string;
  export let activeInstance: Instance | null = null;

  let showInstanceMenu = false;
  let showManageModal = false;
  let showShortcuts = false;
  let filesView: FilesView;

  async function selectInstance(id: string) {
    showInstanceMenu = false;
    await activateInstance(activeProjectId, id);
  }

  const dispatch = createEventDispatcher<{
    projectChange: string;
    closeProject: string;
    addProject: void;
    goHome: void;
    goSettings: void;
    goShortcuts: void;
    createInstance: void;
    reorderTabs: string[];
  }>();

  let dragSrcIndex: number | null = null;
  let insertIndex: number | null = null;
  let didDrag = false;
  let tabsRowEl: HTMLElement | null = null;

  function tabPointerDown(e: PointerEvent, index: number) {
    if ((e.target as Element).closest('button')) return;
    e.preventDefault();
    dragSrcIndex = index;
    insertIndex = index;
    didDrag = false;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function tabPointerMove(e: PointerEvent) {
    if (dragSrcIndex === null) return;
    const next = computeTabInsertIndex(tabsRowEl, e.clientX, { selector: '.project-tab' });
    if (next !== insertIndex) didDrag = true;
    insertIndex = next;
  }

  function tabPointerUp() {
    if (dragSrcIndex === null || insertIndex === null) return;
    const isNoop = insertIndex === dragSrcIndex || insertIndex === dragSrcIndex + 1;
    if (!isNoop) {
      const reordered = openProjects.map((p) => p.id);
      const [moved] = reordered.splice(dragSrcIndex, 1);
      // After removal, positions after dragSrcIndex shift down by 1
      const adjustedInsert = insertIndex > dragSrcIndex ? insertIndex - 1 : insertIndex;
      reordered.splice(adjustedInsert, 0, moved);
      dispatch('reorderTabs', reordered);
    }
    dragSrcIndex = null;
    insertIndex = null;
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

  // padding-left: 76px clears macOS traffic lights; 0 when fullscreen or non-mac
  $: tabsPadding = isMac && !isFullscreen ? '76px' : '8px';
</script>

<div class="workspace">
  <!-- Project tabs — padding-left clears native macOS traffic lights -->
  <div class="tabs-row" style="padding-left: {tabsPadding};" bind:this={tabsRowEl}>
    <button class="brand-chip" on:click={() => dispatch('goHome')} title="Home">
      <CairnLogo size={18}/>
      <span>Cairn</span>
    </button>
    <div class="tab-divider"></div>
    {#each openProjects as p, i}
      {#if dragSrcIndex !== null && insertIndex === i && !(insertIndex === dragSrcIndex || insertIndex === dragSrcIndex + 1)}
        <div class="drop-indicator"></div>
      {/if}
      <div
        class="project-tab {p.id === activeProjectId ? 'active' : ''} {dragSrcIndex === i ? 'dragging' : ''}"
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
    {#if dragSrcIndex !== null && insertIndex === openProjects.length && insertIndex !== dragSrcIndex + 1}
      <div class="drop-indicator"></div>
    {/if}
    <button class="tab-add" on:click={() => dispatch('addProject')}>
      <Icon name="plus" size={12}/> Project
    </button>
    <div class="spacer" data-tauri-drag-region use:draggableRegion></div>
    <button class="icon-btn" aria-label="Search"><Icon name="search" size={14}/></button>
    <button class="icon-btn" aria-label="Command Palette" on:click={() => filesView?.openCommandPalette()}><Icon name="command" size={14}/></button>
    <button class="icon-btn" aria-label="Keyboard shortcuts" on:click={() => showShortcuts = true}><Icon name="help" size={14}/></button>
    <button class="icon-btn" aria-label="Settings" on:click={() => dispatch('goSettings')}><Icon name="settings" size={14}/></button>
  </div>

  <!-- Instance header -->
  <div class="instance-header">
    {#if activeInstance}
      <div class="instance-switcher-wrap" use:clickOutside={() => showInstanceMenu = false}>
        <button class="instance-switcher" on:click={() => showInstanceMenu = !showInstanceMenu}>
          <Icon name="ticket" size={12}/>
          <span class="mono">{activeInstance.ticket.id}</span>
          <Icon name="chev-d" size={11}/>
        </button>
        {#if showInstanceMenu}
          <div class="instance-menu">
            {#each $instances as inst}
              <button
                class="instance-menu-item {inst.id === activeInstance?.id ? 'active' : ''}"
                on:click={() => selectInstance(inst.id)}
              >
                <span class="mono">{inst.ticket.id}</span>
                <span class="instance-menu-title">{inst.ticket.title}</span>
              </button>
            {/each}
            <div class="instance-menu-divider"></div>
            <button class="instance-menu-item instance-menu-new" on:click={() => { showInstanceMenu = false; dispatch('createInstance'); }}>
              <Icon name="plus" size={11}/>
              <span>New instance</span>
            </button>
            <div class="instance-menu-divider"></div>
            <button class="instance-menu-item instance-menu-manage" on:click={() => { showInstanceMenu = false; showManageModal = true; }}>
              <Icon name="settings" size={11}/>
              <span>Manage instances</span>
            </button>
          </div>
        {/if}
      </div>

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
        <button class="btn"><Icon name="pause" size={13}/> Pause agent</button>
        <button class="btn primary"><Icon name="check" size={13}/> Finalize instance</button>
      </div>
    {:else}
      <button class="create-instance-btn" on:click={() => dispatch('createInstance')}>
        <Icon name="plus" size={13}/>
        Create an instance
      </button>
    {/if}
  </div>

  <!-- Content -->
  <div class="content-row">
    <aside class="sidebar">
      {#each STEPS as s}
        <button
          class="step {$activeStep === s.id ? 'active' : ''} {doneSteps.has(s.id) ? 'done' : ''}"
          on:click={() => activeStep.set(s.id as any)}
        >
          <span class="icon"><Icon name={s.icon} size={20}/></span>
          <span class="label">{s.label}</span>
          {#if doneSteps.has(s.id)}
            <span class="check"><Icon name="check" size={11}/></span>
          {/if}
        </button>
      {/each}
      <div class="divider"></div>
      <div class="spacer"></div>
      <button class="step" aria-label="Terminal">
        <span class="icon"><Icon name="terminal" size={18}/></span>
        <span class="label">Term</span>
      </button>
    </aside>

    <main class="main">
      <div class="step-view" class:step-hidden={$activeStep !== 'files'}><FilesView bind:this={filesView} onGoSettings={() => dispatch('goSettings')} /></div>
      <div class="step-view" class:step-hidden={$activeStep !== 'agent'}><AgentView/></div>
      <div class="step-view" class:step-hidden={$activeStep !== 'review'}><ReviewView/></div>
      <div class="step-view" class:step-hidden={$activeStep !== 'tests'}><TestsView/></div>
      <div class="step-view" class:step-hidden={$activeStep !== 'git'}><GitView/></div>
      <div class="step-view" class:step-hidden={$activeStep !== 'cicd'}><CiCdView/></div>
    </main>
  </div>
</div>

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

  :global(.project-tab) { cursor: grab; }
  :global(.project-tab:active) { cursor: grabbing; }
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
