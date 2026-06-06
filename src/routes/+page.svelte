<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { activeStep, activeScreen } from '$lib/stores/ui.js';
  import { activeProjectId, loadProjects, loadListing, openProjects, openProject, closeProjectTab, openTabOrder, reorderTabs } from '$lib/stores/project';
  import { loadInstances, activeInstance } from '$lib/stores/instance';
  import { settings } from '$lib/stores/settings';
  import { getUiState, saveUiState } from '$lib/services/ui-state-service';
  import Home from '$lib/components/Home.svelte';
  import Workspace from '$lib/components/Workspace.svelte';
  import CreateInstance from '$lib/components/CreateInstance.svelte';

  type Screen = 'home' | 'workspace';
  type HomeSection = 'projects' | 'checkpoints' | 'activity' | 'account' | 'settings';

  let screen: Screen = 'home';
  let homeOpenSection: HomeSection | null = null;
  let homeOpenSettingsTab: string | null = null;
  let homeSection: string = 'projects';
  let homeSettingsTab: string = 'general';
  let showCreate = false;
  let mounted = false;

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  function persistUiState() {
    if (!mounted) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveUiState({
        screen,
        activeProjectId: get(activeProjectId),
        openTabOrder: get(openTabOrder),
        activeStep: get(activeStep),
        homeSection,
        homeSettingsTab,
      });
    }, 300);
  }

  onMount(async () => {
    settings.load();

    const saved = await getUiState();
    screen = saved.screen;
    homeSection = saved.homeSection;
    homeSettingsTab = saved.homeSettingsTab;
    activeStep.set(saved.activeStep as any);

    await loadProjects();
    await loadListing();

    if (saved.openTabOrder.length > 0) reorderTabs(saved.openTabOrder);

    if (saved.activeProjectId) {
      openProject(saved.activeProjectId);
      activeProjectId.set(saved.activeProjectId);
      await loadInstances(saved.activeProjectId);
      if (saved.screen === 'workspace') {
        homeOpenSection = saved.homeSection as HomeSection;
        homeOpenSettingsTab = saved.homeSettingsTab;
      }
    }

    if (saved.screen === 'home') {
      homeOpenSection = saved.homeSection as HomeSection;
      homeOpenSettingsTab = saved.homeSettingsTab;
    }

    mounted = true;
  });

  $: if (mounted) { activeScreen.set(screen); persistUiState(); }
  activeStep.subscribe(() => persistUiState());
  openTabOrder.subscribe(() => persistUiState());
  activeProjectId.subscribe(async (id) => {
    if (id) await loadInstances(id);
    persistUiState();
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

  function handleSectionChange(e: CustomEvent<{ section: string; settingsTab: string }>) {
    homeSection = e.detail.section;
    homeSettingsTab = e.detail.settingsTab;
    persistUiState();
  }
</script>

<div class="os-window">
  <div class="screen-wrap" class:screen-hidden={screen !== 'home'}>
    <Home
      openSection={homeOpenSection}
      openSettingsTab={homeOpenSettingsTab}
      on:openProject={(e) => handleOpenProject(e.detail)}
      on:projectCreated={(e) => handleProjectCreated(e.detail.id)}
      on:sectionShown={() => { homeOpenSection = null; homeOpenSettingsTab = null; }}
      on:sectionChange={handleSectionChange}
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
      on:goShortcuts={() => { homeOpenSection = 'settings'; homeOpenSettingsTab = 'shortcuts'; screen = 'home'; }}
      on:goGitSettings={() => { homeOpenSection = 'settings'; homeOpenSettingsTab = 'git'; screen = 'home'; }}
      on:createInstance={() => showCreate = true}
    />
  </div>

  {#if showCreate}
    <CreateInstance
      on:close={() => showCreate = false}
      on:create={() => {
        showCreate = false;
        screen = 'workspace';
        const firstStep = get(settings).workflowTabs
          .filter(t => t.enabled)
          .sort((a, b) => a.order - b.order)[0]?.key ?? 'files';
        activeStep.set(firstStep as any);
      }}
    />
  {/if}
</div>
