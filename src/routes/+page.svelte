<script lang="ts">
  /**
   * Application root: switches between the home and workspace screens, restores the persisted UI
   * state on mount and debounces writing it back, and routes `cairn <file>` paths to the editor.
   */
  import { onMount, onDestroy, tick } from 'svelte';
  import { get } from 'svelte/store';
  import { activeStep, activeScreen, gitLeftTab, terminalActive, commandsActive, envActive, formattingActive, openAgentId, referencesPanelOpen, referencesQuery } from '$lib/stores/ui.js';
  import { activeProjectId, loadProjects, loadListing, projects, openProjects, openProject, closeProjectTab, openTabOrder, reorderTabs } from '$lib/stores/project';
  import { takePendingCliPaths } from '$lib/services/cli-service';
  import { loadInstances, activeInstance } from '$lib/stores/instance';
  import { initTerminals } from '$lib/stores/terminal';
  import { loadAgentActivity } from '$lib/stores/agent-activity';
  import { initLanguageServers, disposeLanguageServers, stopServersForWorktree } from '$lib/stores/language-server';
  import { listInstances } from '$lib/services/instance-service';
  import { settings } from '$lib/stores/settings';
  import { getUiState, saveUiState } from '$lib/services/ui-state-service';
  import { initViewStates, snapshotCurrentProject, applyProjectState, getAllProjectStates, viewStates } from '$lib/stores/view-state';
  import { installCopySelectionHandler } from '$lib/utils/clipboard/copy-selection';
  import Home from '$lib/components/Home.svelte';
  import Workspace from '$lib/components/Workspace.svelte';
  import CreateInstance from '$lib/components/CreateInstance.svelte';
  import UpdateModal from '$lib/components/layout/UpdateModal.svelte';
  import LoadingScreen from '$lib/components/layout/LoadingScreen.svelte';
  import { isUpdateModalOpen, startUpdateChecks } from '$lib/stores/update';
  import type { HomeSection } from '$lib/components/home/HomeSidebar.svelte';

  type Screen = 'home' | 'workspace';

  let screen: Screen = 'home';
  let homeOpenSection: HomeSection | null = null;
  let homeOpenSettingsTab: string | null = null;
  let homeSection: string = 'projects';
  let homeSettingsTab: string = 'general';
  let showCreate = false;
  let createFromBranch = '';
  let mounted = false;

  let workspaceView: Workspace | null = null;

  /** Survives closing the last tab, so `cairn <file>` knows where to go back to. */
  let lastProjectId: string | null = null;

  let removeCopyHandler: (() => void) | null = null;
  let stopUpdateChecks: (() => void) | null = null;
  let unlistenCliOpen: (() => void) | null = null;
  onDestroy(() => {
    for (const unsubscribe of persistSubscriptions) unsubscribe();
    if (saveTimer) clearTimeout(saveTimer);
    removeCopyHandler?.();
    stopUpdateChecks?.();
    unlistenCliOpen?.();
    disposeLanguageServers();
  });

  /** Closing a project takes its language servers down with it. */
  async function stopProjectLanguageServers(projectId: string) {
    const instances = await listInstances(projectId).catch(() => []);
    for (const instance of instances) {
      if (instance.worktreePath) await stopServersForWorktree(instance.worktreePath);
    }
  }

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  function persistUiState() {
    if (!mounted) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      snapshotCurrentProject();
      saveUiState({
        screen,
        activeProjectId: get(activeProjectId),
        openTabOrder: get(openTabOrder),
        homeSection,
        homeSettingsTab,
        projectStates: getAllProjectStates(),
      });
    }, 300);
  }

  onMount(async () => {
    removeCopyHandler = installCopySelectionHandler();

    initTerminals();
    initLanguageServers();
    void loadAgentActivity();
    await settings.load();
    stopUpdateChecks = startUpdateChecks();

    const saved = await getUiState();
    screen = saved.screen;
    homeSection = saved.homeSection;
    homeSettingsTab = saved.homeSettingsTab;
    initViewStates(saved.projectStates ?? {});

    await loadProjects();
    await loadListing();

    if (saved.openTabOrder.length > 0) reorderTabs(saved.openTabOrder);

    if (saved.activeProjectId) {
      openProject(saved.activeProjectId);
      await loadInstances(saved.activeProjectId);
      activeProjectId.set(saved.activeProjectId);
      applyProjectState(saved.activeProjectId);
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

    try {
      const { listen } = await import('@tauri-apps/api/event');
      unlistenCliOpen = await listen<{ paths: string[] }>('cli-open', (e) => {
        void handleCliPaths(e.payload.paths ?? []);
      });
      await handleCliPaths(await takePendingCliPaths());
    } catch {}
  });

  $: if (mounted) { activeScreen.set(screen); persistUiState(); }

  const persistSubscriptions = [
    activeStep,
    terminalActive,
    commandsActive,
    envActive,
    formattingActive,
    openAgentId,
    gitLeftTab,
    referencesPanelOpen,
    referencesQuery,
    openTabOrder,
    viewStates,
  ].map((store) => store.subscribe(() => persistUiState()));

  persistSubscriptions.push(
    activeProjectId.subscribe((id) => {
      if (id) lastProjectId = id;
      persistUiState();
    }),
  );

  /**
   * The instances of the target project are loaded before it becomes active, so
   * `activeInstance` moves straight from one worktree to the next. Switching
   * first would leave the derived store without the instance it is looking for,
   * and every view would reload once against the project root before reloading
   * again against the real worktree.
   */
  async function switchTo(id: string) {
    snapshotCurrentProject();
    await loadInstances(id);
    activeProjectId.set(id);
    applyProjectState(id);
  }

  async function handleProjectChange(newId: string) {
    await switchTo(newId);
  }

  async function handleOpenProject(id: string) {
    openProject(id);
    await switchTo(id);
    screen = 'workspace';
  }

  function handleCloseProject(id: string) {
    void stopProjectLanguageServers(id);
    closeProjectTab(id);
    const remaining = $openProjects.filter(p => p.id !== id);
    if (remaining.length === 0) {
      screen = 'home';
      activeProjectId.set(null);
    } else if ($activeProjectId === id) {
      void handleProjectChange(remaining[0].id);
    }
  }

  async function handleProjectCreated(id: string) {
    openProject(id);
    await switchTo(id);
    screen = 'workspace';
  }

  /**
   * `cairn <file>` has to land on the editor whatever the app was showing. From
   * the home screen no project is active, so the last one used is reopened
   * first - falling back to the most recent of the listing on a cold start
   * where nothing was restored.
   */
  async function handleCliPaths(paths: string[]) {
    if (paths.length === 0) return;
    if (!$activeProjectId) {
      const target = lastProjectId ?? $openProjects[0]?.id ?? $projects[0]?.id;
      if (!target) return;
      await handleOpenProject(target);
    }
    screen = 'workspace';
    await tick();
    await workspaceView?.openPathsFromCli(paths);
  }

  function handleSectionChange(e: CustomEvent<{ section: string; settingsTab: string }>) {
    homeSection = e.detail.section;
    homeSettingsTab = e.detail.settingsTab;
    persistUiState();
  }
</script>

{#if !mounted}
  <LoadingScreen/>
{/if}

<div class="os-window">
  <div class="screen-wrap" class:screen-hidden={screen !== 'home'}>
    <Home
      openSection={homeOpenSection}
      openSettingsTab={homeOpenSettingsTab}
      on:openProject={(e) => handleOpenProject(e.detail)}
      on:closeProject={(e) => handleCloseProject(e.detail)}
      on:projectCreated={(e) => handleProjectCreated(e.detail.id)}
      on:sectionShown={() => { homeOpenSection = null; homeOpenSettingsTab = null; }}
      on:sectionChange={handleSectionChange}
    />
  </div>
  <div class="screen-wrap" class:screen-hidden={screen !== 'workspace'}>
    <Workspace
      bind:this={workspaceView}
      openProjects={$openProjects}
      activeProjectId={$activeProjectId ?? ''}
      activeInstance={$activeInstance}
      on:projectChange={(e) => handleProjectChange(e.detail)}
      on:closeProject={(e) => handleCloseProject(e.detail)}
      on:reorderTabs={(e) => reorderTabs(e.detail)}
      on:addProject={() => { homeOpenSection = null; screen = 'home'; }}
      on:goHome={() => { homeOpenSection = null; screen = 'home'; }}
      on:goSettings={() => { homeOpenSection = 'settings'; screen = 'home'; }}
      on:goShortcuts={() => { homeOpenSection = 'settings'; homeOpenSettingsTab = 'shortcuts'; screen = 'home'; }}
      on:goLanguageServers={() => { homeOpenSection = 'settings'; homeOpenSettingsTab = 'languageServers'; screen = 'home'; }}
      on:goGitSettings={() => { homeOpenSection = 'settings'; homeOpenSettingsTab = 'git'; screen = 'home'; }}
      on:createInstance={(e) => { createFromBranch = e.detail?.branch ?? ''; showCreate = true; }}
    />
  </div>

  {#if $isUpdateModalOpen}
    <UpdateModal/>
  {/if}

  {#if showCreate}
    <CreateInstance
      initialBranch={createFromBranch}
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
