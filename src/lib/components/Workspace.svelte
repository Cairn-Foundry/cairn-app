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

  import type { Instance } from '$lib/types/instance';
  import { instances } from '$lib/stores/instance';
  import { activateInstance } from '$lib/stores/project';

  export let openProjects: { id: string; name: string; color: string }[];
  export let activeProjectId: string;
  export let activeInstance: Instance | null = null;

  let showInstanceMenu = false;

  async function selectInstance(id: string) {
    showInstanceMenu = false;
    await activateInstance(activeProjectId, id);
  }

  const dispatch = createEventDispatcher<{
    projectChange: string;
    closeProject: string;
    addProject: void;
    goHome: void;
    createInstance: void;
  }>();

  const STEPS = [
    { id: 'files',  num: '00', label: 'Files',  icon: 'folder' },
    { id: 'agent',  num: '01', label: 'Agent',  icon: 'agent'  },
    { id: 'review', num: '02', label: 'Review', icon: 'review' },
    { id: 'tests',  num: '03', label: 'Tests',  icon: 'tests'  },
    { id: 'git',    num: '04', label: 'Git',    icon: 'git'    },
    { id: 'cicd',   num: '05', label: 'CI/CD',  icon: 'ci'     },
  ];

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
  <div class="tabs-row" style="padding-left: {tabsPadding};">
    <div class="brand-chip">
      <button class="icon-btn" on:click={() => dispatch('goHome')} title="Home"><CairnLogo size={18}/></button>
      <span>Cairn</span>
    </div>
    <div class="tab-divider"></div>
    {#each openProjects as p}
      <div
        class="project-tab {p.id === activeProjectId ? 'active' : ''}"
        on:click={() => dispatch('projectChange', p.id)}
        role="tab"
        tabindex="0"
        on:keydown={(e) => e.key === 'Enter' && dispatch('projectChange', p.id)}
      >
        <span class="dot" style={p.id === activeProjectId ? `background: ${p.color}` : ''}></span>
        <span>{p.name}</span>
        <button class="close" on:click|stopPropagation={() => dispatch('closeProject', p.id)}>
          <Icon name="x" size={11}/>
        </button>
      </div>
    {/each}
    <button class="tab-add" on:click={() => dispatch('addProject')}>
      <Icon name="plus" size={12}/> Project
    </button>
    <div class="spacer" data-tauri-drag-region use:draggableRegion></div>
    <button class="icon-btn" aria-label="Search"><Icon name="search" size={14}/></button>
    <button class="icon-btn" aria-label="Settings"><Icon name="settings" size={14}/></button>
  </div>

  <!-- Instance header -->
  <div class="instance-header">
    {#if activeInstance}
      <div class="instance-switcher-wrap">
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
          </div>
        {/if}
      </div>

      <div class="instance-title">
        <span class="instance-dot"></span>
        <span class="ticket-id">{activeInstance.ticket.id}</span>
        <span class="ticket-name">{activeInstance.ticket.title}</span>
      </div>

      <div class="branch-info">
        <Icon name="branch" size={11}/>
        <span class="target">{activeInstance.branch}</span>
      </div>

      <div class="instance-actions">
        <button class="btn ghost"><Icon name="bookmark" size={13}/> Checkpoint</button>
        <button class="btn"><Icon name="pause" size={13}/> Pause agent</button>
        <button class="btn primary"><Icon name="check" size={13}/> Finalize instance</button>
      </div>
    {:else}
      <div class="instance-title" style="color: var(--fg-3); font-size: 13px;">
        No active instance — <button class="btn ghost" style="font-size: 12px; padding: 2px 8px;" on:click={() => dispatch('createInstance')}>create one</button>
      </div>
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
          <span class="num">{s.num}</span>
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
      {#if $activeStep === 'files'}
        <FilesView/>
      {:else if $activeStep === 'agent'}
        <AgentView/>
      {:else if $activeStep === 'review'}
        <ReviewView/>
      {:else if $activeStep === 'tests'}
        <TestsView/>
      {:else if $activeStep === 'git'}
        <GitView/>
      {:else if $activeStep === 'cicd'}
        <CiCdView/>
      {/if}
    </main>
  </div>
</div>

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
</style>
