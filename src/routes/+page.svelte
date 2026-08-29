<script lang="ts">
  /**
   * Application root: switches between the home and workspace screens, restores the persisted UI
   * state on mount and debounces writing it back, and routes `cairn <file>` paths to the editor.
   */
  import { onMount, onDestroy, tick } from 'svelte';
  import { get } from 'svelte/store';
  import { withViewTransition } from '$lib/utils/view-transition';
  import { activeStep, activeScreen, gitLeftTab, terminalActive, commandsActive, envActive, formattingActive, openAgentId, referencesPanelOpen, referencesQuery } from '$lib/stores/ui.js';
  import { activeProjectId, lastOpenedProjectId, loadProjects, loadListing, projects, openProjects, openProject, closeProjectTab, openTabOrder, reorderTabs } from '$lib/stores/project';
  import { takePendingCliPaths } from '$lib/services/cli-service';
  import { loadInstances, activeInstance } from '$lib/stores/instance';
  import { git } from '$lib/stores/git';
  import { initTerminals } from '$lib/stores/terminal';
  import { loadAgentActivity } from '$lib/stores/agent-activity';
  import { initLanguageServers, disposeLanguageServers, stopServersForWorktree } from '$lib/stores/language-server';
  import { initTests, disposeTests } from '$lib/stores/tests';
  import { init as initIntegrations, dispose as disposeIntegrations, loadProjectIntegrations, bindingsByProject, watchInstance, unwatchInstance } from '$lib/stores/integrations';
  import { listInstances } from '$lib/services/instance-service';
  import { settings } from '$lib/stores/settings';
  import { getUiState, saveUiState } from '$lib/services/ui-state-service';
  import { initViewStates, snapshotCurrentProject, applyProjectState, getAllProjectStates, viewStates } from '$lib/stores/view-state';
  import { installCopySelectionHandler } from '$lib/utils/clipboard/copy-selection';
  import Home from '$lib/components/Home.svelte';
  import type Workspace from '$lib/components/Workspace.svelte';
  import CreateInstance from '$lib/components/CreateInstance.svelte';
  import UpdateModal from '$lib/components/layout/UpdateModal.svelte';
  import LoadingScreen from '$lib/components/layout/LoadingScreen.svelte';
  import { isUpdateModalOpen, startUpdateChecks } from '$lib/stores/update';
  import type { HomeSection } from '$lib/components/home/HomeSidebar.svelte';

  type Screen = 'home' | 'workspace';

  let screen: Screen = 'home';
  let homeOpenSection: HomeSection | null = null;
  let homeOpenSettingsTab: string | null = null;
  let homeOpenAddProjectMode: 'new' | 'open' | 'clone' | null = null;
  let homeOpenAddProjectPath = '';
  let homeOpenAddProjectCloneUrl = '';
  let homeSection: string = 'projects';
  let homeSettingsTab: string = 'general';
  let showCreate = false;
  let createFromBranch = '';
  let mounted = false;

  let workspaceView: Workspace | null = null;

  /**
   * The workspace pulls in the editor, the terminal and the markdown renderer,
   * none of which the home screen shows. It is loaded the first time a project
   * is opened rather than at startup, and never dropped afterwards: it stays
   * mounted behind the home screen so terminals and open files survive going
   * back and forth.
   */
  let WorkspaceComponent: typeof Workspace | null = null;
  let workspaceLoading: Promise<void> | null = null;

  function loadWorkspace(): Promise<void> {
    workspaceLoading ??= import('$lib/components/Workspace.svelte').then((m) => {
      WorkspaceComponent = m.default;
    });
    return workspaceLoading;
  }

  // Every way into the workspace goes through `screen`, including restoring a
  // session that was left there, so the load is asked for here rather than at
  // each of the callers.
  $: if (screen === 'workspace') void loadWorkspace();

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
    disposeTests();
    disposeIntegrations();
    void syncWatchedInstance(null);
  });

  let watched: { projectId: string; instanceId: string; branch: string } | null = null;
  /** One watched instance at a time: the one on screen in the workspace, none from home. */
  async function syncWatchedInstance(target: { projectId: string; instanceId: string; branch: string } | null) {
    const hasChanged =
      !target || watched?.projectId !== target.projectId || watched?.instanceId !== target.instanceId || watched?.branch !== target.branch;
    if (watched && hasChanged) {
      const previous = watched;
      watched = null;
      await unwatchInstance(previous.projectId, previous.instanceId).catch(() => {});
    }
    if (target && !watched) {
      watched = { ...target };
      await watchInstance(target.projectId, target.instanceId, target.branch).catch(() => {});
    }
  }

  $: if (mounted && $activeProjectId && !($activeProjectId in $bindingsByProject)) void loadProjectIntegrations($activeProjectId).catch(() => {});
  /**
   * The base instance carries no branch of its own, so the checked out branch is
   * what it is watched on - same fallback as the CI/CD step. Watching on an empty
   * ref makes the provider answer for the whole project, and its newest pipeline
   * lands in the list as one of the branch's own.
   */
  $: watchedBranch = $activeInstance?.branch || $git.currentBranch;
  $: if (mounted) void syncWatchedInstance(
    screen === 'workspace' && $activeInstance && watchedBranch
      ? { projectId: $activeInstance.projectId, instanceId: $activeInstance.id, branch: watchedBranch }
      : null,
  );

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

  let longtaskObs: PerformanceObserver | null = null;
  onDestroy(() => longtaskObs?.disconnect());

  onMount(async () => {
    removeCopyHandler = installCopySelectionHandler();

    /* In dev only: names the frames that blew the budget, so a slow switch has
       a number attached to it instead of a feeling. */
    if (import.meta.env.DEV && 'PerformanceObserver' in window) {
      try {
        const obs = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            console.warn(`[longtask] ${Math.round(e.duration)}ms`, e);
          }
        });
        obs.observe({ entryTypes: ['longtask'] });
        longtaskObs = obs;
      } catch {}
    }

    initTerminals();
    initLanguageServers();
    initTests();
    initIntegrations();
    void loadAgentActivity();
    // Small JSON files, read at once rather than one after the other.
    const [, saved] = await Promise.all([settings.load(), getUiState(), loadProjects()]);
    stopUpdateChecks = startUpdateChecks();

    screen = saved.screen;
    homeSection = saved.homeSection;
    homeSettingsTab = saved.homeSettingsTab;
    initViewStates(saved.projectStates ?? {});

    await loadListing();

    if (saved.openTabOrder.length > 0) reorderTabs(saved.openTabOrder);

    if (saved.activeProjectId) {
      openProject(saved.activeProjectId);
      await loadInstances(saved.activeProjectId);
      activeProjectId.set(saved.activeProjectId);
      lastOpenedProjectId.set(saved.activeProjectId);
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
      unlistenCliOpen = await listen<{ paths: string[]; openDir: string | null; cloneUrl: string | null }>('cli-open', (e) => {
        void handleCliRequest(e.payload);
      });
      await handleCliRequest(await takePendingCliPaths());
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
    lastOpenedProjectId.set(id);
    applyProjectState(id);
  }

  async function handleProjectChange(newId: string) {
    await switchTo(newId);
  }

  /** Screen changes go through the cross-fade so no intermediate frame shows. */
  function goScreen(next: 'home' | 'workspace') {
    withViewTransition(() => { screen = next; });
  }

  async function handleOpenProject(id: string) {
    openProject(id);
    await switchTo(id);
    goScreen('workspace');
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
    goScreen('workspace');
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
    // The workspace is fetched on demand, so waiting a tick is not enough: the
    // component has to exist before the paths can be handed to it, or opening
    // `cairn <file>` on a cold start would silently do nothing.
    await loadWorkspace();
    await tick();
    await workspaceView?.openPathsFromCli(paths);
  }

  /**
   * `cairn .` and `cairn clone <git>` do not name a file to open: a directory
   * already registered as a project is opened directly, an unknown one - or a
   * clone URL - goes to the home screen with the import modal preloaded.
   */
  async function handleCliRequest(request: { paths: string[]; openDir: string | null; cloneUrl: string | null }) {
    if (request.cloneUrl) {
      screen = 'home';
      homeOpenAddProjectMode = 'clone';
      homeOpenAddProjectPath = '';
      homeOpenAddProjectCloneUrl = request.cloneUrl;
      return;
    }
    if (request.openDir) {
      const existing = $projects.find(p => p.path === request.openDir);
      if (existing) {
        await handleOpenProject(existing.id);
        return;
      }
      screen = 'home';
      homeOpenAddProjectMode = 'open';
      homeOpenAddProjectPath = request.openDir;
      homeOpenAddProjectCloneUrl = '';
      return;
    }
    await handleCliPaths(request.paths);
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
      openAddProjectMode={homeOpenAddProjectMode}
      openAddProjectPath={homeOpenAddProjectPath}
      openAddProjectCloneUrl={homeOpenAddProjectCloneUrl}
      on:openProject={(e) => handleOpenProject(e.detail)}
      on:closeProject={(e) => handleCloseProject(e.detail)}
      on:projectCreated={(e) => handleProjectCreated(e.detail.id)}
      on:sectionShown={() => { homeOpenSection = null; homeOpenSettingsTab = null; }}
      on:addProjectShown={() => { homeOpenAddProjectMode = null; }}
      on:sectionChange={handleSectionChange}
    />
  </div>
  <div class="screen-wrap" class:screen-hidden={screen !== 'workspace'}>
    {#if WorkspaceComponent}
    <svelte:component this={WorkspaceComponent}
      bind:this={workspaceView}
      openProjects={$openProjects}
      activeProjectId={$activeProjectId ?? ''}
      activeInstance={$activeInstance}
      on:projectChange={(e) => handleProjectChange(e.detail)}
      on:closeProject={(e) => handleCloseProject(e.detail)}
      on:reorderTabs={(e) => reorderTabs(e.detail)}
      on:addProject={() => { homeOpenSection = null; goScreen('home'); }}
      on:goHome={() => { homeOpenSection = null; goScreen('home'); }}
      on:goSettings={() => { homeOpenSection = 'settings'; goScreen('home'); }}
      on:goShortcuts={() => { homeOpenSection = 'settings'; homeOpenSettingsTab = 'shortcuts'; goScreen('home'); }}
      on:goLanguageServers={() => { homeOpenSection = 'settings'; homeOpenSettingsTab = 'languageServers'; goScreen('home'); }}
      on:goGitSettings={() => { homeOpenSection = 'settings'; homeOpenSettingsTab = 'git'; goScreen('home'); }}
      on:goIntegrations={() => { homeOpenSection = 'integrations'; goScreen('home'); }}
      on:createInstance={(e) => { createFromBranch = e.detail?.branch ?? ''; showCreate = true; }}
    />
    {/if}
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
