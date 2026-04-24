<script lang="ts">
  import { onMount } from 'svelte';
  import { activeStep } from '$lib/stores/ui.js';
  import { activeProjectId, loadProjects, openProjects, openProject, closeProjectTab, openTabOrder, reorderTabs } from '$lib/stores/project';
  import { loadInstances, activeInstance } from '$lib/stores/instance';
  import { settings } from '$lib/stores/settings';
  import Home from '$lib/components/Home.svelte';
  import Workspace from '$lib/components/Workspace.svelte';
  import CreateInstance from '$lib/components/CreateInstance.svelte';

  type Screen = 'home' | 'workspace';
  type HomeSection = 'projects' | 'checkpoints' | 'activity' | 'account' | 'settings';

  let screen: Screen = 'home';
  let homeOpenSection: HomeSection | null = null;
  let showCreate = false;
  let mounted = false;

  onMount(async () => {
    settings.load();

    try {
      const savedScreen = localStorage.getItem('cairn.screen') as Screen | null;
      if (savedScreen) screen = savedScreen;
      const savedStep = localStorage.getItem('cairn.step');
      if (savedStep) activeStep.set(savedStep as any);
    } catch {}

    await loadProjects();

    try {
      const savedOrder = localStorage.getItem('cairn.openTabOrder');
      if (savedOrder) reorderTabs(JSON.parse(savedOrder));
    } catch {}

    const savedActiveId = localStorage.getItem('cairn.activeProjectId');
    if (savedActiveId) {
      openProject(savedActiveId);
      activeProjectId.set(savedActiveId);
      await loadInstances(savedActiveId);
      screen = 'workspace';
    }

    mounted = true;
  });

  $: if (mounted) try { localStorage.setItem('cairn.screen', screen); } catch {}
  activeStep.subscribe(step => { if (!mounted) return; try { localStorage.setItem('cairn.step', step); } catch {} });
  openTabOrder.subscribe(order => { if (!mounted) return; try { localStorage.setItem('cairn.openTabOrder', JSON.stringify(order)); } catch {} });
  activeProjectId.subscribe(async (id) => {
    if (!mounted) return;
    try { if (id) localStorage.setItem('cairn.activeProjectId', id); } catch {}
    if (id) await loadInstances(id);
  });

  async function handleOpenProject(id: string) {
    openProject(id);
    activeProjectId.set(id);
    screen = 'workspace';
  }

  function handleCloseProject(id: string) {
    closeProjectTab(id);
    const remaining = $openProjects.filter(p => p.id !== id);
    if (remaining.length === 0) {
      screen = 'home';
      activeProjectId.set(null);
    } else if ($activeProjectId === id) {
      activeProjectId.set(remaining[0].id);
    }
  }

  function handleProjectCreated(id: string) {
    openProject(id);
    activeProjectId.set(id);
    screen = 'workspace';
  }
</script>

<div class="os-window">
  <div class="screen-wrap" class:screen-hidden={screen !== 'home'}>
    <Home
      openSection={homeOpenSection}
      on:openProject={(e) => handleOpenProject(e.detail)}
      on:projectCreated={(e) => handleProjectCreated(e.detail.id)}
      on:sectionShown={() => { homeOpenSection = null; }}
    />
  </div>
  <div class="screen-wrap" class:screen-hidden={screen !== 'workspace'}>
    <Workspace
      openProjects={$openProjects}
      activeProjectId={$activeProjectId ?? ''}
      activeInstance={$activeInstance}
      on:projectChange={(e) => activeProjectId.set(e.detail)}
      on:closeProject={(e) => handleCloseProject(e.detail)}
      on:reorderTabs={(e) => reorderTabs(e.detail)}
      on:addProject={() => { homeOpenSection = null; screen = 'home'; }}
      on:goHome={() => { homeOpenSection = null; screen = 'home'; }}
      on:goSettings={() => { homeOpenSection = 'settings'; screen = 'home'; }}
      on:createInstance={() => showCreate = true}
    />
  </div>

  {#if showCreate}
    <CreateInstance
      on:close={() => showCreate = false}
      on:create={() => { showCreate = false; screen = 'workspace'; activeStep.set('agent'); }}
    />
  {/if}
</div>
