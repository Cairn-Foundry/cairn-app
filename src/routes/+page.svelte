<script lang="ts">
  import { onMount } from 'svelte';
  import { activeStep } from '$lib/stores/ui.js';
  import { projects, activeProjectId, loadProjects, registerProject } from '$lib/stores/project';
  import { loadInstances, activeInstance } from '$lib/stores/instance';
  import { validateGitRepo } from '$lib/services/project-service';
  import Home from '$lib/components/Home.svelte';
  import Workspace from '$lib/components/Workspace.svelte';
  import CreateInstance from '$lib/components/CreateInstance.svelte';
  import type { Project } from '$lib/types/project';

  type Screen = 'home' | 'workspace';

  let screen: Screen = 'home';
  let showCreate = false;

  onMount(async () => {
    try {
      const savedScreen = localStorage.getItem('cairn.screen') as Screen | null;
      if (savedScreen) screen = savedScreen;
      const savedStep = localStorage.getItem('cairn.step');
      if (savedStep) activeStep.set(savedStep as any);
    } catch {}

    await loadProjects();

    const savedActiveId = localStorage.getItem('cairn.activeProjectId');
    if (savedActiveId) {
      activeProjectId.set(savedActiveId);
      await loadInstances(savedActiveId);
    }
  });

  // Persist screen + step + activeProjectId
  $: try { localStorage.setItem('cairn.screen', screen); } catch {}
  activeStep.subscribe(step => { try { localStorage.setItem('cairn.step', step); } catch {} });
  activeProjectId.subscribe(async (id) => {
    try { if (id) localStorage.setItem('cairn.activeProjectId', id); } catch {}
    if (id) await loadInstances(id);
  });

  async function handleOpenProject(id: string) {
    activeProjectId.set(id);
    screen = 'workspace';
  }

  function handleCloseProject(id: string) {
    const remaining = $projects.filter(p => p.id !== id);
    if (remaining.length === 0 || $activeProjectId === id) {
      screen = 'home';
      activeProjectId.set(remaining[0]?.id ?? null);
    }
  }

  async function handleAddProject(path: string) {
    try {
      const resolvedPath = await validateGitRepo(path);
      const name = resolvedPath.split('/').at(-1) ?? resolvedPath;
      const id = crypto.randomUUID();
      const hue = Math.abs(name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)) % 360;
      const color = `oklch(0.72 0.14 ${hue})`;
      const project: Project = { id, name, path: resolvedPath, color, activeInstanceId: null };
      await registerProject(project);
      activeProjectId.set(id);
      screen = 'workspace';
    } catch (err) {
      alert(String(err));
    }
  }
</script>

<div class="os-window">
  {#if screen === 'home'}
    <Home
      on:openProject={(e) => handleOpenProject(e.detail)}
      on:addProject={(e) => handleAddProject(e.detail)}
      on:createInstance={() => showCreate = true}
    />
  {:else}
    <Workspace
      openProjects={$projects}
      activeProjectId={$activeProjectId ?? ''}
      activeInstance={$activeInstance}
      on:projectChange={(e) => activeProjectId.set(e.detail)}
      on:closeProject={(e) => handleCloseProject(e.detail)}
      on:addProject={() => screen = 'home'}
      on:goHome={() => screen = 'home'}
      on:createInstance={() => showCreate = true}
    />
  {/if}

  {#if showCreate}
    <CreateInstance
      on:close={() => showCreate = false}
      on:create={() => { showCreate = false; screen = 'workspace'; activeStep.set('agent'); }}
    />
  {/if}
</div>
