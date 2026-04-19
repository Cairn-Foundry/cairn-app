<script lang="ts">
  import { onMount } from 'svelte';
  import { activeStep } from '$lib/stores/ui.js';
  import Home from '$lib/components/Home.svelte';
  import Workspace from '$lib/components/Workspace.svelte';
  import CreateInstance from '$lib/components/CreateInstance.svelte';

  type Screen = 'home' | 'workspace';

  const PROJECTS = [
    { id: 'fe',     name: 'Frontend', color: 'oklch(0.72 0.14 250)', path: '~/code/acme-web',    instances: 3, branches: 12, lastOpened: '2m ago' },
    { id: 'be',     name: 'Backend',  color: 'oklch(0.74 0.14 150)', path: '~/code/acme-api',    instances: 2, branches: 8,  lastOpened: '14m ago' },
    { id: 'infra',  name: 'Infra',    color: 'oklch(0.80 0.14 75)',  path: '~/code/acme-infra',  instances: 0, branches: 4,  lastOpened: 'yesterday' },
    { id: 'mobile', name: 'Mobile',   color: 'oklch(0.70 0.18 25)',  path: '~/code/acme-mobile', instances: 1, branches: 6,  lastOpened: '3d ago' },
  ];

  let screen: Screen = 'home';
  let openProjects = [PROJECTS[0], PROJECTS[1]];
  let activeProjectId = 'fe';
  let showCreate = false;

  onMount(() => {
    try {
      const savedScreen = localStorage.getItem('cairn.screen') as Screen | null;
      if (savedScreen) screen = savedScreen;
      const savedStep = localStorage.getItem('cairn.step');
      if (savedStep) activeStep.set(savedStep as any);
    } catch {}
  });

  $: try { localStorage.setItem('cairn.screen', screen); } catch {}
  activeStep.subscribe(step => { try { localStorage.setItem('cairn.step', step); } catch {} });

  function handleOpenProject(id: string) {
    if (!openProjects.find(p => p.id === id)) {
      const proj = PROJECTS.find(p => p.id === id);
      if (proj) openProjects = [...openProjects, proj];
    }
    activeProjectId = id;
    screen = 'workspace';
  }

  function handleCloseProject(id: string) {
    openProjects = openProjects.filter(p => p.id !== id);
    if (openProjects.length === 0) screen = 'home';
  }
</script>

<div class="os-window">
  {#if screen === 'home'}
    <Home
      on:openProject={(e) => handleOpenProject(e.detail)}
      on:createInstance={() => showCreate = true}
    />
  {:else}
    <Workspace
      {openProjects}
      {activeProjectId}
      on:projectChange={(e) => activeProjectId = e.detail}
      on:closeProject={(e) => handleCloseProject(e.detail)}
      on:addProject={() => screen = 'home'}
      on:goHome={() => screen = 'home'}
      on:createInstance={() => showCreate = true}
    />
  {/if}

  {#if showCreate}
    <CreateInstance
      on:close={() => showCreate = false}
      on:create={() => { showCreate = false; screen = 'workspace'; activeStep.set('files'); }}
    />
  {/if}
</div>
