<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * Application root: switches between the home and workspace screens, restores the persisted UI
   * state on mount and debounces writing it back, and routes `cairn <file>` paths to the editor.
   */
  import { onMount, onDestroy, tick } from 'svelte';
  import { get } from 'svelte/store';
  import { withViewTransition } from '$lib/utils/view-transition';
  import { activeStep, activeScreen, gitLeftTab, terminalActive, commandsActive, envActive, formattingActive, lastCli, referencesPanelOpen, referencesQuery, showWelcomeTour } from '$lib/stores/ui.js';
  import { activeProject, activeProjectId, lastOpenedProjectId, loadProjects, loadListing, projects, openProjects, openProject, closeProjectTab, openTabOrder, reorderTabs } from '$lib/stores/project';
  import { selectConversation } from '$lib/stores/conversation';
  import { openRequest } from '$lib/stores/agent-status';
  import { takePendingCliPaths } from '$lib/services/cli-service';
  import { loadInstances, hasInstances, activeInstance } from '$lib/stores/instance';
  import { collapsedTicketProjects } from '$lib/stores/tickets-overview';
  import { syncEnvFile } from '$lib/stores/env';
  import { git } from '$lib/stores/git';
  import { initTerminals } from '$lib/stores/terminal';
  import { initLanguageServers, disposeLanguageServers, stopServersForWorktree } from '$lib/stores/language-server';
  import { initTests, disposeTests } from '$lib/stores/tests';
  import { init as initIntegrations, dispose as disposeIntegrations, loadProjectIntegrations, bindingsByProject, watchInstance, unwatchInstance } from '$lib/stores/integrations';
  import { listInstances } from '$lib/services/instance-service';
  import { unwatchWorktree } from '$lib/services/fs-watch-service';
  import { settings } from '$lib/stores/settings';
  import { flushFileStates } from '$lib/services/file-state-service';
  import { getUiState, saveUiState, saveUiStateNow } from '$lib/services/ui-state-service';
  import { initViewStates, snapshotCurrentProject, applyProjectState, getAllProjectStates, viewStates } from '$lib/stores/view-state';
  import { installCopySelectionHandler } from '$lib/utils/clipboard/copy-selection';
  import { installFieldUndoHandler } from '$lib/utils/clipboard/field-undo';
  import Home from '$lib/components/Home.svelte';
  import WelcomeTour from '$lib/components/WelcomeTour.svelte';
  import type Workspace from '$lib/components/Workspace.svelte';
  import CreateInstance from '$lib/components/CreateInstance.svelte';
  import type { Ticket } from '$lib/types/integrations';
  import UpdateModal from '$lib/components/layout/UpdateModal.svelte';
  import LoadingScreen from '$lib/components/layout/LoadingScreen.svelte';
  import { isUpdateModalOpen, startUpdateChecks } from '$lib/stores/update';
  import type { HomeSection } from '$lib/components/home/HomeSidebar.svelte';
  import { t } from '$lib/i18n';
  import { activateInstance } from '$lib/stores/project';
  import { isBaseInstance } from '$lib/stores/instance';
  import { showTool } from '$lib/stores/ui.js';
  import { queueIncomingTabs } from '$lib/stores/editor-windows';
  import { closeAllEditorWindows, onTabsReceived, otherWindowsDirty, saveAllOtherWindows } from '$lib/services/editor-window-service';
  import { claimDroppedTabs } from '$lib/utils/files/tab-window-drag';
  import { onSettingsChangedElsewhere } from '$lib/services/settings-service';
  import type { TabPayload } from '$lib/utils/files/tab-transfer';

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
  let createFromTicket: Ticket | null = null;
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
  let removeFieldUndoHandler: (() => void) | null = null;
  let stopUpdateChecks: (() => void) | null = null;
  let unlistenCliOpen: (() => void) | null = null;
  let unlistenTabsReceived: (() => void) | null = null;
  let unlistenTabDrop: (() => void) | null = null;
  let unlistenSettings: (() => void) | null = null;
  let unlistenClose: (() => void) | null = null;
  let closeHookDisposed = false;
  onDestroy(() => {
    for (const unsubscribe of persistSubscriptions) unsubscribe();
    flushPersistedState();
    closeHookDisposed = true;
    unlistenClose?.();
    removeCopyHandler?.();
    removeFieldUndoHandler?.();
    stopUpdateChecks?.();
    unlistenCliOpen?.();
    unlistenTabsReceived?.();
    unlistenTabDrop?.();
    unlistenSettings?.();
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
  // The generated file is written for whichever instance is active. An edit to a
  // global or project variable is therefore picked up by the others when they are
  // switched to, without the edit having to walk every project on disk.
  $: if (mounted && screen === 'workspace' && $activeProject && $activeInstance) void syncEnvFile($activeProject, $activeInstance).catch(() => {});
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

  /**
   * Closing a project takes its language servers down with it, and its filesystem
   * watchers too. Closing a tab is the one moment the user says plainly that they
   * are done with a project - it leaves the tab bar, and coming back means
   * reopening it from the home screen - so there is nothing left for the watches
   * or the cached tree to serve. Without this they lived on until the tree cache
   * evicted them, which means every tab could be closed and eight repositories
   * still watched.
   */
  async function stopProjectLanguageServers(projectId: string) {
    const instances = await listInstances(projectId).catch(() => []);
    for (const instance of instances) {
      if (!instance.worktreePath) continue;
      await stopServersForWorktree(instance.worktreePath);
      // The backend is told unconditionally: a project visited earlier this
      // session keeps its watcher there even once the workspace is unmounted, so
      // closing it from the home screen would otherwise leak exactly what this is
      // meant to release. The view is told as well when it exists, so its tree
      // cache lets go of the same worktree - leaving one half of the pair behind
      // is how the two drift apart.
      await unwatchWorktree(instance.worktreePath).catch(() => {});
      workspaceView?.releaseWorktree?.(instance.worktreePath);
    }
  }

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let lastPersisted = '';
  /** The state to persist, and whether it differs from what was last written. */
  function pendingUiState() {
    snapshotCurrentProject();
    const state = {
      screen,
      activeProjectId: get(activeProjectId),
      openTabOrder: get(openTabOrder),
      homeSection,
      homeSettingsTab,
      projectStates: getAllProjectStates(),
      collapsedTicketProjects: get(collapsedTicketProjects),
    };
    const serialized = JSON.stringify(state);
    if (serialized === lastPersisted) return null;
    lastPersisted = serialized;
    return state;
  }

  /** Awaitable counterpart of `writeUiState`, for the window close. */
  async function writeUiStateNow() {
    const state = pendingUiState();
    if (state) await saveUiStateNow(state);
  }

  function writeUiState() {
    saveTimer = null;
    const state = pendingUiState();
    if (state) saveUiState(state);
  }

  function persistUiState() {
    if (!mounted) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(writeUiState, 300);
  }

  /**
   * Both debounced writes go to disk now. Dropping the pending timers instead
   * would lose whatever the last few hundred milliseconds changed - which, on a
   * window close, is exactly the state the app must reopen on.
   */
  function flushPersistedState() {
    if (saveTimer) clearTimeout(saveTimer);
    writeUiState();
    flushFileStates();
  }

  /**
   * The window close is held until both writes have landed. `beforeunload` cannot
   * do this: the writes are async IPC calls and the page is torn down without
   * waiting on them, so the state the flush exists to rescue is exactly the state
   * a real close would lose. `onCloseRequested` can defer, so it is the only hook
   * where this promise is worth anything.
   */
  async function flushBeforeClose() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    await Promise.allSettled([writeUiStateNow(), flushFileStates()]);
  }

  let longtaskObs: PerformanceObserver | null = null;
  onDestroy(() => longtaskObs?.disconnect());

  onMount(async () => {
    removeCopyHandler = installCopySelectionHandler();
    removeFieldUndoHandler = installFieldUndoHandler();
    import('@tauri-apps/api/window').then(({ getCurrentWindow }) =>
      getCurrentWindow().onCloseRequested(async (event) => {
        if (await confirmUnsavedBeforeClose()) {
          await flushBeforeClose();
          return;
        }
        event.preventDefault();
      }),
    ).then((off) => {
      if (closeHookDisposed) off();
      else unlistenClose = off;
    }).catch(() => {});

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
    // Small JSON files, read at once rather than one after the other.
    const [, saved] = await Promise.all([settings.load(), getUiState(), loadProjects()]);
    if (!get(settings).onboardingSeen) showWelcomeTour.set(true);
    stopUpdateChecks = startUpdateChecks();

    screen = saved.screen;
    // Usage & Stats is gone with the parsed runs it fed on; a state saved on it
    // reopens on the default section rather than on nothing.
    homeSection = saved.homeSection === 'usage' ? 'projects' : saved.homeSection;
    homeSettingsTab = saved.homeSettingsTab;
    collapsedTicketProjects.set(saved.collapsedTicketProjects ?? []);
    initViewStates(saved.projectStates ?? {});

    await loadListing();
    /* The other open tabs are read in the background so switching to one of
       them waits on nothing. */
    for (const p of get(openProjects)) {
      if (p.id !== saved?.activeProjectId && !hasInstances(p.id)) void loadInstances(p.id).catch(() => {});
    }

    if (saved.openTabOrder.length > 0) reorderTabs(saved.openTabOrder);

    if (saved.activeProjectId) {
      openProject(saved.activeProjectId);
      await loadInstances(saved.activeProjectId);
      activeProjectId.set(saved.activeProjectId);
      lastOpenedProjectId.set(saved.activeProjectId);
      applyProjectState(saved.activeProjectId);
      if (saved.screen === 'workspace') {
        homeOpenSection = homeSection as HomeSection;
        homeOpenSettingsTab = saved.homeSettingsTab;
      }
    }

    if (saved.screen === 'home') {
      homeOpenSection = homeSection as HomeSection;
      homeOpenSettingsTab = saved.homeSettingsTab;
    }

    mounted = true;

    try {
      unlistenTabsReceived = await onTabsReceived(({ tabs }) => { void receiveTabs(tabs); });
      unlistenSettings = await onSettingsChangedElsewhere(() => { void settings.load(); });
      const { getCurrentWebview } = await import('@tauri-apps/api/webview');
      unlistenTabDrop = await getCurrentWebview().onDragDropEvent(async ({ payload }) => {
        if (payload.type !== 'drop') return;
        const { tabs } = await claimDroppedTabs(payload.paths);
        await receiveTabs(tabs);
      });
    } catch {}

    try {
      const { listen } = await import('@tauri-apps/api/event');
      unlistenCliOpen = await listen<{ paths: string[]; openDir: string | null; cloneUrl: string | null }>('cli-open', (e) => {
        void handleCliRequest(e.payload);
      });
      await handleCliRequest(await takePendingCliPaths());
    } catch {}
  });

  $: if (mounted) { activeScreen.set(screen); persistUiState(); }

  $: if ($openRequest) {
    const request = $openRequest;
    openRequest.set(null);
    void handleOpenConversation(request);
  }

  const persistSubscriptions = [
    activeStep,
    terminalActive,
    commandsActive,
    envActive,
    formattingActive,
    lastCli,
    gitLeftTab,
    referencesPanelOpen,
    referencesQuery,
    openTabOrder,
    viewStates,
    collapsedTicketProjects,
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
    if (!hasInstances(id)) await loadInstances(id);
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

  /** Opens the ticket's project, then the creation modal on that ticket. */
  async function handleStartTicket(detail: { projectId: string; ticket: Ticket }) {
    await handleOpenProject(detail.projectId);
    createFromBranch = '';
    createFromTicket = detail.ticket;
    showCreate = true;
  }

  /** Lands on one conversation of the Agent step, from wherever the app was. */
  async function handleOpenConversation(detail: { projectId: string; instanceId: string; conversationId: string }) {
    await handleOpenProject(detail.projectId);
    if ($activeInstance?.id !== detail.instanceId) await activateInstance(detail.projectId, detail.instanceId);
    showTool(null);
    activeStep.set('agent');
    selectConversation(detail.projectId, detail.instanceId, detail.conversationId);
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

  /**
   * Tabs sent back from a detached window land in the editor of their own
   * project and instance, switched to first, with their unsaved edits. A file
   * from outside any project goes to whatever the editor shows.
   */
  async function receiveTabs(tabs: TabPayload[]) {
    if (tabs.length === 0) return;
    const scope = tabs.find((tab) => tab.scope)?.scope ?? null;
    if (scope) {
      if ($activeProjectId !== scope.projectId) {
        openProject(scope.projectId);
        await switchTo(scope.projectId);
      }
      if ($activeInstance?.id !== scope.instanceId) {
        await activateInstance(scope.projectId, isBaseInstance(scope.instanceId) ? null : scope.instanceId);
      }
    } else if (!$activeProjectId) {
      const fallback = lastProjectId ?? $openProjects[0]?.id ?? $projects[0]?.id;
      if (fallback) await handleOpenProject(fallback);
    }
    screen = 'workspace';
    showTool(null);
    activeStep.set('files');
    await loadWorkspace();
    await tick();
    queueIncomingTabs(tabs);
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    void getCurrentWindow().setFocus().catch(() => {});
  }

  /** How long closing waits on the detached windows to report their files saved. */
  const SAVE_ALL_TIMEOUT_MS = 3000;

  /** Saves every buffer of every window; false when one of them could not be written. */
  async function saveEverywhere(): Promise<boolean> {
    const isMainSaved = await (workspaceView?.saveAllDirty() ?? Promise.resolve(true));
    await saveAllOtherWindows().catch(() => {});
    const deadline = Date.now() + SAVE_ALL_TIMEOUT_MS;
    let remaining = await otherWindowsDirty().catch(() => []);
    while (remaining.length > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 150));
      remaining = await otherWindowsDirty().catch(() => []);
    }
    return isMainSaved && remaining.length === 0;
  }

  /**
   * Closing the app closes the detached windows with it, so their unsaved
   * buffers are asked about here, once, together with the editor's own. True
   * when the close can go ahead.
   */
  async function confirmUnsavedBeforeClose(): Promise<boolean> {
    const others = await otherWindowsDirty().catch(() => []);
    const dirty = [...new Set([...(workspaceView?.dirtyFiles() ?? []), ...others.map((f) => f.path)])];
    if (dirty.length === 0) return true;
    const { message } = await import('@tauri-apps/plugin-dialog');
    const labels = {
      yes: t('detachedWindows.saveAll') as string,
      no: t('detachedWindows.discard') as string,
      cancel: t('common.cancel') as string,
    };
    const answer = await message(
      (t('detachedWindows.unsavedMessage') as (files: string) => string)(dirty.join('\n')),
      { title: t('detachedWindows.unsavedTitle') as string, kind: 'warning', buttons: labels },
    );
    if (answer === 'Cancel' || answer === labels.cancel) return false;
    if ((answer === 'Yes' || answer === labels.yes) && !(await saveEverywhere())) {
      await message(t('detachedWindows.saveFailed') as string, { kind: 'warning' });
      return false;
    }
    await closeAllEditorWindows().catch(() => {});
    return true;
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

{#if $showWelcomeTour}
  <WelcomeTour on:close={() => { showWelcomeTour.set(false); void settings.save({ onboardingSeen: true }); }}/>
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
      on:startTicket={(e) => handleStartTicket(e.detail)}
      on:openConversation={(e) => handleOpenConversation(e.detail)}
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
      on:goProviders={() => { homeOpenSection = 'providers'; goScreen('home'); }}
      on:goShortcuts={() => { homeOpenSection = 'settings'; homeOpenSettingsTab = 'shortcuts'; goScreen('home'); }}
      on:goLanguageServers={() => { homeOpenSection = 'settings'; homeOpenSettingsTab = 'languageServers'; goScreen('home'); }}
      on:goGitSettings={() => { homeOpenSection = 'settings'; homeOpenSettingsTab = 'git'; goScreen('home'); }}
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
      initialTicket={createFromTicket}
      on:close={() => { showCreate = false; createFromTicket = null; }}
      on:create={() => {
        showCreate = false;
        createFromTicket = null;
        screen = 'workspace';
        const firstStep = get(settings).workflowTabs
          .filter(t => t.enabled)
          .sort((a, b) => a.order - b.order)[0]?.key ?? 'files';
        activeStep.set(firstStep as any);
      }}
    />
  {/if}
</div>
