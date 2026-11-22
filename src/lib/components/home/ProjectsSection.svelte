<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * Project list of the home screen: search, folder grouping, and pointer-driven reordering of
   * both folders and cards (a card dropped on a folder joins it). Dispatches `openProject`,
   * `addProject`, `editProject` and `closeProject`.
   */
  import { createEventDispatcher, onDestroy, tick } from 'svelte';
  import Icon from '#lib/components/Icon.svelte';
  import { t } from '#lib/i18n';
  import { projects, unregisterProject, openProjects, lastOpenedProjectId } from '#lib/stores/project';
  import { loadedInstances } from '#lib/stores/instance';
  import { activeInstancesOf, loadProjectOverview, summarizeWorktrees, worktreeStates } from '#lib/stores/project-overview';
  import { settings } from '#lib/stores/settings';
  import ModeToggle from '#lib/components/ModeToggle.svelte';
  import ProjectEntry from './ProjectEntry.svelte';
  import ProjectsEmpty from './ProjectsEmpty.svelte';
  import { projectFolders, toggleUngroupedCollapsed, ungroupedCollapsed } from '#lib/stores/project-folders';
  import { revealInFileManager } from '#lib/services/project-service';
  import type { Project, ProjectFolder } from '#lib/types/project';
  import DeleteProjectModal from './DeleteProjectModal.svelte';
  import DuplicateProjectModal from './DuplicateProjectModal.svelte';
  import DeleteFolderModal from './DeleteFolderModal.svelte';
  import { matchesSearch } from '#lib/utils/files/files-search';
  import ProjectMenu from './ProjectMenu.svelte';
  import CreateFolderModal from './CreateFolderModal.svelte';
  import { computeTabInsertIndex } from '#lib/utils/files/files-tab-drag';
  import { reorderProjects } from '#lib/stores/project';
  import { inboxLabel, loadProjectInbox, projectInbox } from '#lib/stores/project-inbox';

  const dispatch = createEventDispatcher<{
    openProject: string;
    addProject: 'new' | 'open' | 'clone';
    editProject: Project;
    closeProject: string;
  }>();

  const overviewRequested = new Set<string>();
  $: for (const p of $projects) {
    if (overviewRequested.has(p.id)) continue;
    overviewRequested.add(p.id);
    void loadProjectInbox(p.id);
    void loadProjectOverview(p);
  }

  let layout: 'list' | 'grid';
  $: layout = $settings.homeProjectsLayout === 'grid' ? 'grid' : 'list';
  $: containerClass = layout === 'list' ? 'projects-list' : 'projects-compact';
  $: entryLayout = (layout === 'list' ? 'list' : 'compact') as 'list' | 'compact';
  const layoutOptions = [
    { value: 'list', label: t('home.projects.layoutList') as string, icon: 'list' },
    { value: 'grid', label: t('home.projects.layoutGrid') as string, icon: 'grid' },
  ];

  function setLayout(value: string) {
    if (value !== 'list' && value !== 'grid') return;
    void settings.save({ homeProjectsLayout: value });
  }

  $: openIds = new Set($openProjects.map((p) => p.id));

  const NAME_COL_MAX_CH = 28;
  /** The list is monospace: the name column fits the longest name, so the branches line up close to it. */
  $: nameColumn = `calc(${Math.min(NAME_COL_MAX_CH, Math.max(0, ...$projects.map((p) => p.name.length)))}ch + 6ch)`;
  $: overview = Object.fromEntries($projects.map((p) => [p.id, {
    worktrees: summarizeWorktrees(p, activeInstancesOf($loadedInstances, p.id), $worktreeStates),
    tickets: hasInbox($projectInbox[p.id]) ? inboxLabel($projectInbox[p.id]) : '',
    isCurrent: openIds.has(p.id) && p.id === $lastOpenedProjectId,
  }]));

  /** The folder a project sits in, for the menu of the open projects drawn outside their group. */
  function folderIdOf(projectId: string): string | null {
    return $projectFolders.find((f) => f.projectIds.includes(projectId))?.id ?? null;
  }

  /** The menu of a project shown among the open ones is told apart from the one in its group. */
  const openMenuKey = (projectId: string) => `open:${projectId}`;

  /** A count of zero with nothing more to fetch says nothing worth a pill. */
  function hasInbox(count: { tickets: number; hasMore: boolean } | undefined): boolean {
    return !!count && (count.tickets > 0 || count.hasMore);
  }

  /** Enter on the row itself opens it; on one of its buttons it belongs to that button. */
  function onEntryKeydown(e: KeyboardEvent, id: string) {
    if (e.key === 'Enter' && e.target === e.currentTarget) dispatch('openProject', id);
  }

  let search = '';
  let searchInputEl: HTMLInputElement | null = null;
  let prevWasSearching = false;


  $: {
    const isSearching = !!search.trim();
    if (isSearching && !prevWasSearching) tick().then(() => searchInputEl?.focus());
    prevWasSearching = isSearching;
  }

  let menuProjectId: string | null = null;
  let menuFolderId: string | null = null;
  let deletingProject: Project | null = null;
  let duplicatingProject: Project | null = null;
  let deletingFolder: ProjectFolder | null = null;

  let editingFolderNameId: string | null = null;
  let editingFolderNameValue = '';
  let showCreateFolder = false;

  // -- folder reorder (insert-index, like file tabs) ------------------------
  let folderDragSrcIndex: number | null = null;
  let folderInsertIndex: number | null = null;
  let foldersDragBarEl: HTMLElement | null = null;
  let folderDragDidDrag = false;
  let folderPendingIdx: number | null = null;
  let folderDragTimer: ReturnType<typeof setTimeout> | null = null;
  const FOLDER_DRAG_DELAY = 150;

  // -- project card reorder + folder-assign drag ----------------------------
  type ProjDragCtx = { type: 'folder'; folderId: string } | { type: 'ungrouped' };

  let projDragSrcIndex: number | null = null;
  let projDragProjectId: string | null = null;
  let projInsertIndex: number | null = null;
  let projDragCtx: ProjDragCtx | null = null;
  let projDragBarEl: HTMLElement | null = null;
  let projDragDidDrag = false;
  let projDragActive = false;
  let projDragStartX = 0;
  let projDragStartY = 0;
  let projDragJustEnded = false;
  let dragOverFolderId: string | null = null;
  let dragOverUngrouped = false;

  const PROJ_DRAG_THRESHOLD = 6;

  /**
   * Right-clicking a card arms the reorder without holding the button down: the
   * card then follows the pointer and the next click drops it. Escape or another
   * right-click puts it back.
   */
  let isStickyDrag = false;

  function onProjCardContextMenu(e: MouseEvent, idx: number, ctx: ProjDragCtx, projectId: string) {
    e.preventDefault();
    if (isStickyDrag) { cancelStickyDrag(); return; }
    if ((e.target as HTMLElement).closest('button, input')) return;
    projDragSrcIndex   = idx;
    projDragProjectId  = projectId;
    projInsertIndex    = idx;
    projDragCtx        = ctx;
    projDragDidDrag    = false;
    projDragActive     = true;
    projDragStartX     = e.clientX;
    projDragStartY     = e.clientY;
    dragOverFolderId   = null;
    dragOverUngrouped  = false;
    projDragBarEl      = (e.currentTarget as HTMLElement).parentElement;
    isStickyDrag       = true;
    document.body.classList.add('dragging');
    window.addEventListener('pointermove', onStickyMove);
    window.addEventListener('click', onStickyClick, true);
    window.addEventListener('contextmenu', onStickyContextMenu, true);
    window.addEventListener('keydown', onStickyKeydown, true);
  }

  function stopStickyListeners() {
    isStickyDrag = false;
    window.removeEventListener('pointermove', onStickyMove);
    window.removeEventListener('click', onStickyClick, true);
    window.removeEventListener('contextmenu', onStickyContextMenu, true);
    window.removeEventListener('keydown', onStickyKeydown, true);
  }

  function onStickyMove(e: PointerEvent) {
    onProjCardPointerMove(e);
  }

  /** Swallows the drop click, which would otherwise open the project underneath. */
  function onStickyClick(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    stopStickyListeners();
    onProjCardPointerUp(e as unknown as PointerEvent);
    projDragJustEnded = false;
  }

  function onStickyContextMenu(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    cancelStickyDrag();
  }

  function onStickyKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    cancelStickyDrag();
  }

  function cancelStickyDrag() {
    stopStickyListeners();
    onProjCardPointerCancel();
  }

  onDestroy(() => { if (isStickyDrag) cancelStickyDrag(); });

  /** Insert position for a card in a wrapping grid: row first, then the midpoint of the cell. */
  function computeGridInsertIndex(
    containerEl: HTMLElement | null,
    px: number,
    py: number,
    selector: string,
  ): number {
    if (!containerEl) return 0;
    const items = Array.from(containerEl.querySelectorAll<HTMLElement>(selector));
    if (!items.length) return 0;
    for (let i = 0; i < items.length; i++) {
      const rect = items[i].getBoundingClientRect();
      if (py < rect.top) return i;
      if (py < rect.bottom && px < rect.left + rect.width / 2) return i;
    }
    return items.length;
  }

  // -- derived --------------------------------------------------------------
  $: allFolderProjectIds = new Set($projectFolders.flatMap((f) => f.projectIds));
  $: ungroupedProjects = $projects.filter((p) => !allFolderProjectIds.has(p.id));

  /** Projects of a folder, in the folder's own order, skipping ids that no longer resolve. */
  function folderProjects(folderId: string): Project[] {
    const folder = $projectFolders.find((f) => f.id === folderId);
    if (!folder) return [];
    return folder.projectIds.flatMap((id) => {
      const p = $projects.find((proj) => proj.id === id);
      return p ? [p] : [];
    });
  }

  $: filteredProjects = search.trim()
    ? $projects.filter((p) => matchesSearch(p.name, search) || matchesSearch(p.path, search))
    : null;

  // -- menus ----------------------------------------------------------------
  function openMenu(e: MouseEvent, id: string) {
    e.stopPropagation();
    menuFolderId = null;
    menuProjectId = menuProjectId === id ? null : id;
  }

  function openFolderMenu(e: MouseEvent, id: string) {
    e.stopPropagation();
    menuProjectId = null;
    menuFolderId = menuFolderId === id ? null : id;
  }

  function closeMenu() {
    menuProjectId = null;
    menuFolderId = null;
  }

  // -- project actions -------------------------------------------------------
  function handleDuplicate(project: Project) {
    closeMenu();
    duplicatingProject = project;
  }

  async function handleCopyPath(path: string) {
    closeMenu();
    await navigator.clipboard.writeText(path);
  }

  async function handleReveal(path: string) {
    closeMenu();
    await revealInFileManager(path);
  }

  async function handleDelete() {
    if (!deletingProject) return;
    await unregisterProject(deletingProject.id);
    deletingProject = null;
  }

  function moveToFolder(projectId: string, folderId: string) {
    closeMenu();
    projectFolders.addProjectToFolder(projectId, folderId);
  }

  function removeFromFolder(projectId: string) {
    closeMenu();
    projectFolders.removeProjectFromFolder(projectId);
  }

  // -- folder actions -------------------------------------------------------
  function startRenameFolder(id: string, current: string) {
    menuFolderId = null;
    editingFolderNameId = id;
    editingFolderNameValue = current;
  }

  function commitRenameFolder() {
    if (editingFolderNameId) {
      projectFolders.renameFolder(editingFolderNameId, editingFolderNameValue);
      editingFolderNameId = null;
    }
  }

  function cancelRenameFolder() {
    editingFolderNameId = null;
  }

  function handleFolderNameKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') commitRenameFolder();
    else if (e.key === 'Escape') cancelRenameFolder();
  }

  function deleteFolder(folder: ProjectFolder) {
    menuFolderId = null;
    deletingFolder = folder;
  }

  function confirmDeleteFolder() {
    if (!deletingFolder) return;
    projectFolders.deleteFolder(deletingFolder.id);
    deletingFolder = null;
  }

  // -- project card reorder handlers ----------------------------------------
  function onProjCardPointerDown(e: PointerEvent, idx: number, ctx: ProjDragCtx, projectId: string) {
    if (e.button !== 0 || isStickyDrag) return;
    if ((e.target as HTMLElement).closest('button, input')) return;
    e.preventDefault();
    projDragSrcIndex   = idx;
    projDragProjectId  = projectId;
    projInsertIndex    = idx;
    projDragCtx        = ctx;
    projDragDidDrag    = false;
    projDragActive     = false;
    projDragStartX     = e.clientX;
    projDragStartY     = e.clientY;
    dragOverFolderId   = null;
    dragOverUngrouped  = false;
    projDragBarEl      = (e.currentTarget as HTMLElement).parentElement;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onProjCardPointerMove(e: PointerEvent) {
    if (projDragSrcIndex === null || !projDragBarEl) return;

    if (!projDragActive) {
      const dx = e.clientX - projDragStartX;
      const dy = e.clientY - projDragStartY;
      if (dx * dx + dy * dy < PROJ_DRAG_THRESHOLD * PROJ_DRAG_THRESHOLD) return;
      projDragActive = true;
      document.body.classList.add('dragging');
    }

    projDragDidDrag = true;

    const el = document.elementFromPoint(e.clientX, e.clientY);

    // Ungrouped drop zone (only meaningful when source is inside a folder)
    if (projDragCtx?.type === 'folder' && el?.closest('[data-drop-ungrouped]')) {
      dragOverUngrouped = true;
      dragOverFolderId  = null;
      return;
    }
    dragOverUngrouped = false;

    // Folder drop zone - skip if it's the same folder the card comes from
    const folderBlockEl  = el?.closest<HTMLElement>('[data-folder-id]');
    const hoveredFolderId = folderBlockEl?.dataset.folderId ?? null;
    const isSameFolder   = projDragCtx?.type === 'folder' && projDragCtx.folderId === hoveredFolderId;
    dragOverFolderId     = hoveredFolderId && !isSameFolder ? hoveredFolderId : null;

    if (!dragOverFolderId) {
      projInsertIndex = layout === 'list'
        ? computeTabInsertIndex(projDragBarEl, e.clientY, { axis: 'y', selector: '.project-card' })
        : computeGridInsertIndex(projDragBarEl, e.clientX, e.clientY, '.project-card');
    }
  }

  /** Commits the gesture: a drop on a folder reassigns the project, otherwise the order is rewritten. */
  function onProjCardPointerUp(_e: PointerEvent) {
    const src        = projDragSrcIndex;
    const insertAt   = projInsertIndex;
    const ctx        = projDragCtx;
    const didDrag    = projDragDidDrag;
    const wasActive  = projDragActive;
    const projectId  = projDragProjectId;
    const overFolder    = dragOverFolderId;
    const overUngrouped = dragOverUngrouped;

    projDragSrcIndex  = null;
    projDragProjectId = null;
    projInsertIndex   = null;
    projDragCtx       = null;
    projDragBarEl     = null;
    projDragDidDrag   = false;
    projDragActive    = false;
    dragOverFolderId  = null;
    dragOverUngrouped = false;
    document.body.classList.remove('dragging');

    if (wasActive) projDragJustEnded = true;

    if (overUngrouped && projectId && ctx?.type === 'folder') {
      projectFolders.removeProjectFromFolder(projectId);
      return;
    }

    if (overFolder && projectId) {
      const alreadyInFolder = ctx?.type === 'folder' && ctx.folderId === overFolder;
      if (!alreadyInFolder) projectFolders.addProjectToFolder(projectId, overFolder);
      return;
    }

    if (!wasActive || !didDrag || src === null || insertAt === null || !ctx) return;
    if (insertAt === src || insertAt === src + 1) return;

    const adjustedInsert = insertAt > src ? insertAt - 1 : insertAt;

    if (ctx.type === 'folder') {
      const fps = folderProjects(ctx.folderId);
      const ids = fps.map((p) => p.id);
      const [moved] = ids.splice(src, 1);
      ids.splice(adjustedInsert, 0, moved);
      projectFolders.reorderProjectsInFolder(ctx.folderId, ids);
    } else {
      const ids = ungroupedProjects.map((p) => p.id);
      const [moved] = ids.splice(src, 1);
      ids.splice(adjustedInsert, 0, moved);
      reorderProjects(ids);
    }
  }

  function onProjCardPointerCancel() {
    projDragSrcIndex  = null;
    projDragProjectId = null;
    projInsertIndex   = null;
    projDragCtx       = null;
    projDragBarEl     = null;
    projDragDidDrag   = false;
    projDragActive    = false;
    dragOverFolderId  = null;
    dragOverUngrouped = false;
    document.body.classList.remove('dragging');
  }

  /** Swallows the click that closes a drag, so a reorder never doubles as an open. */
  function handleCardClick(e: MouseEvent, action: () => void) {
    if (projDragJustEnded) { projDragJustEnded = false; return; }
    action();
  }

  // -- folder reorder (insert-index, like file tabs) -------------------------
  /** A folder drag only arms after a short delay, so a plain press still collapses the folder. */
  function onFolderPointerDown(e: PointerEvent, idx: number) {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button, input')) return;
    e.preventDefault();
    folderPendingIdx = idx;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    folderDragTimer = setTimeout(() => {
      folderDragTimer    = null;
      folderDragSrcIndex = folderPendingIdx;
      folderInsertIndex  = folderPendingIdx;
      folderDragDidDrag  = false;
      folderPendingIdx   = null;
    }, FOLDER_DRAG_DELAY);
  }

  function onFolderPointerMove(e: PointerEvent) {
    if (folderDragSrcIndex === null) return;
    document.body.classList.add('dragging');
    const next = computeTabInsertIndex(foldersDragBarEl, e.clientY, { axis: 'y', selector: '.folder-block' });
    if (next !== folderInsertIndex) folderDragDidDrag = true;
    folderInsertIndex = next;
  }

  function onFolderPointerUp(_e: PointerEvent) {
    if (folderDragTimer !== null) {
      clearTimeout(folderDragTimer);
      folderDragTimer = null;
    }

    if (folderPendingIdx !== null) {
      const idx = folderPendingIdx;
      folderPendingIdx = null;
      projectFolders.toggleCollapse($projectFolders[idx].id);
      return;
    }

    const src      = folderDragSrcIndex;
    const insertAt = folderInsertIndex;
    const didDrag  = folderDragDidDrag;

    folderDragSrcIndex = null;
    folderInsertIndex  = null;
    folderDragDidDrag  = false;
    document.body.classList.remove('dragging');

    if (!didDrag || src === null || insertAt === null) return;
    if (insertAt === src || insertAt === src + 1) return;

    const ids = $projectFolders.map((f) => f.id);
    const [movedId] = ids.splice(src, 1);
    ids.splice(insertAt > src ? insertAt - 1 : insertAt, 0, movedId);
    projectFolders.reorderFolders(ids);
  }

  function onFolderPointerCancel() {
    if (folderDragTimer !== null) {
      clearTimeout(folderDragTimer);
      folderDragTimer = null;
    }
    folderPendingIdx   = null;
    folderDragSrcIndex = null;
    folderInsertIndex  = null;
    folderDragDidDrag  = false;
    document.body.classList.remove('dragging');
  }

</script>


<header class="projects-head">
  <div class="head-row">
    <h1>{t('home.projects.title')}{#if $projects.length > 0}<span class="head-count">{$projects.length}</span>{/if}</h1>
  </div>
</header>

{#if filteredProjects === null}
  <div class="home-actions">
    <button class="home-action primary" on:click={() => dispatch('addProject', 'new')}>
      <span class="aci"><Icon name="plus" size={22}/></span>
      <span class="at">{t('home.projects.newProject')}</span>
      <span class="ad">{t('home.projects.newProjectDesc')}</span>
    </button>
    <button class="home-action" on:click={() => dispatch('addProject', 'open')}>
      <span class="aci"><Icon name="folder" size={22}/></span>
      <span class="at">{t('home.projects.openProject')}</span>
      <span class="ad">{t('home.projects.openProjectDesc')}</span>
    </button>
    <button class="home-action" on:click={() => dispatch('addProject', 'clone')}>
      <span class="aci"><Icon name="download" size={22}/></span>
      <span class="at">{t('home.projects.cloneFromRemote')}</span>
      <span class="ad">{t('home.projects.cloneFromRemoteDesc')}</span>
    </button>
  </div>
{/if}

{#if $projects.length === 0}
  <ProjectsEmpty kind="none"/>
{/if}


<!-- backdrop for menus -->
{#if menuProjectId || menuFolderId}
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="menu-backdrop" on:click={closeMenu} on:keydown={() => {}}></div>
{/if}

{#if filteredProjects === null && $openProjects.length > 0}
  <section class="open-projects" aria-label={t('home.projects.openProjects') as string}>
    <h2 class="group-title open-title">
      <Icon name="folder-open" size={14} class="folder-icon"/>
      <span class="group-name">{t('home.projects.openProjects')}</span>
      <span class="folder-count">{$openProjects.length}</span>
    </h2>
    <div class="projects-compact">
      {#each $openProjects as p (p.id)}
        <ProjectEntry project={p} layout="compact" {...overview[p.id]} isCurrent={false} isClosable
          on:click={() => dispatch('openProject', p.id)}
          on:keydown={(e) => onEntryKeydown(e, p.id)}
          on:more={(e) => openMenu(e.detail, openMenuKey(p.id))}
          on:close={() => dispatch('closeProject', p.id)}
        >
          {#if menuProjectId === openMenuKey(p.id)}
            <ProjectMenu folders={$projectFolders} currentFolderId={folderIdOf(p.id)}
              on:edit={() => { closeMenu(); dispatch('editProject', p); }}
              on:duplicate={() => handleDuplicate(p)}
              on:copyPath={() => handleCopyPath(p.path)}
              on:reveal={() => handleReveal(p.path)}
              on:moveToFolder={(e) => moveToFolder(p.id, e.detail)}
              on:removeFromFolder={() => removeFromFolder(p.id)}
              on:delete={() => { closeMenu(); deletingProject = p; }}
            />
          {/if}
        </ProjectEntry>
      {/each}
    </div>
  </section>
{/if}

{#if $projects.length > 0}
  <div class="all-head">
    <h2 class="group-title open-title all-title">
      <Icon name="folder" size={14} class="folder-icon"/>
      <span class="group-name">{t('home.projects.allProjects')}</span>
      <span class="folder-count">{$projects.length}</span>
    </h2>
    <button class="btn ghost" on:click={() => showCreateFolder = true}>
      <Icon name="plus" size={13}/>{t('home.projects.folders.newFolderShort')}
    </button>
    <div class="search-bar">
      <Icon name="search" size={13}/>
      <input class="search-input" bind:value={search} bind:this={searchInputEl}
             placeholder={t('home.projects.filterPlaceholder') as string}
             aria-label={t('home.projects.filterAriaLabel') as string}/>
      {#if search}
        <button class="search-clear" on:click={() => search = ''} aria-label={t('home.projects.clearSearch') as string}>
          <Icon name="x" size={11}/>
        </button>
      {/if}
    </div>
    <ModeToggle
      options={layoutOptions}
      value={layout}
      ariaLabel={t('home.projects.layoutLabel') as string}
      on:select={(e) => setLayout(e.detail)}
    />
  </div>
{/if}

<div class="project-groups" class:is-table={layout === 'list' && filteredProjects?.length !== 0} class:hidden={$projects.length === 0} style="--name-col: {nameColumn}">


<!-- --- search mode --------------------------------------------------------- -->
{#if filteredProjects !== null}
  {#if filteredProjects.length === 0}
    <ProjectsEmpty kind="no-match" query={search.trim()} on:clear={() => { search = ''; searchInputEl?.focus(); }}/>
  {:else}
    <div class={containerClass}>
      {#each filteredProjects as p (p.id)}
        <ProjectEntry project={p} layout={entryLayout} {...overview[p.id]}
          on:click={() => dispatch('openProject', p.id)}
          on:keydown={(e) => onEntryKeydown(e, p.id)}
          on:more={(e) => openMenu(e.detail, p.id)}
              on:edit={() => dispatch('editProject', p)}
              on:reveal={() => handleReveal(p.path)}
          on:close={() => dispatch('closeProject', p.id)}
        >
          {#if menuProjectId === p.id}
            <ProjectMenu folders={$projectFolders} currentFolderId={null}
              on:edit={() => { closeMenu(); dispatch('editProject', p); }}
              on:duplicate={() => handleDuplicate(p)}
              on:copyPath={() => handleCopyPath(p.path)}
              on:reveal={() => handleReveal(p.path)}
              on:moveToFolder={(e) => moveToFolder(p.id, e.detail)}
              on:delete={() => { closeMenu(); deletingProject = p; }}
            />
          {/if}
        </ProjectEntry>
      {/each}
    </div>
  {/if}

{:else}
  <!-- --- normal mode ------------------------------------------------------- -->

  <!-- --- Dossiers section ------------------------------------------- -->
  {#if $projectFolders.length > 0}
      <div class="folders-grid" bind:this={foldersDragBarEl}>
        {#each $projectFolders as folder, folderIdx (folder.id)}
          {@const fProjects = folderProjects(folder.id)}
          {#if folderDragSrcIndex !== null && folderInsertIndex === folderIdx && !(folderInsertIndex === folderDragSrcIndex || folderInsertIndex === folderDragSrcIndex + 1)}
            <div class="folder-drop-indicator"></div>
          {/if}
          <div
            class="folder-block"
            class:folder-dragging={folderDragSrcIndex === folderIdx}
            class:folder-drag-over={dragOverFolderId === folder.id}
            data-folder-id={folder.id}
          >
            <!-- folder header row -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="folder-header"
              on:pointerdown={(e) => onFolderPointerDown(e, folderIdx)}
              on:pointermove={onFolderPointerMove}
              on:pointerup={onFolderPointerUp}
              on:pointercancel={onFolderPointerCancel}
            >
              <button
                class="chevron-btn"
                on:click|stopPropagation={() => projectFolders.toggleCollapse(folder.id)}
                aria-label={folder.collapsed ? 'Développer' : 'Réduire'}
              >
                <span class="chevron" class:collapsed={folder.collapsed}>
                  <Icon name="chev-d" size={13}/>
                </span>
              </button>

              <Icon name="folder" size={14} class="folder-icon"/>

              {#if editingFolderNameId === folder.id}
                <!-- svelte-ignore a11y_autofocus -->
                <input
                  class="inline-name-input"
                  bind:value={editingFolderNameValue}
                  on:blur={commitRenameFolder}
                  on:keydown={handleFolderNameKeydown}
                  autofocus
                  on:click|stopPropagation
                />
              {:else}
                <span
                  class="folder-name"
                  role="button"
                  tabindex="0"
                  on:keydown={(e) => e.key === 'Enter' && projectFolders.toggleCollapse(folder.id)}
                  on:dblclick|stopPropagation={() => startRenameFolder(folder.id, folder.name)}
                >{folder.name}</span>
              {/if}

              <span class="folder-count">{fProjects.length}</span>
              <div class="folder-spacer"></div>

              <button
                class="folder-more-btn"
                aria-label="Options du dossier"
                on:click={(e) => openFolderMenu(e, folder.id)}
              >
                <Icon name="more" size={14}/>
              </button>

              {#if menuFolderId === folder.id}
                <div class="folder-menu card-menu" role="menu">
                  <button class="card-menu-item" role="menuitem" on:click={() => startRenameFolder(folder.id, folder.name)}>
                    <Icon name="edit" size={13}/> {t('home.projects.folders.rename')}
                  </button>
                  <div class="card-menu-sep"></div>
                  <button class="card-menu-item danger" role="menuitem" on:click={() => deleteFolder(folder)}>
                    <Icon name="trash" size={13}/> {t('home.projects.folders.delete')}
                  </button>
                </div>
              {/if}
            </div>

            <!-- expanded content -->
            {#if !folder.collapsed}
              {#if fProjects.length === 0}
                <div class="folder-empty">{t('home.projects.folders.dropHere')}</div>
              {:else}
                <div class="{containerClass} folder-projects">
                  {#each fProjects as p, projIdx (p.id)}
                    <ProjectEntry project={p} layout={entryLayout} {...overview[p.id]}
                      isDragSource={projDragActive && projDragCtx?.type === 'folder' && projDragCtx.folderId === folder.id && projDragSrcIndex === projIdx}
                      isDropBefore={projDragActive && !dragOverFolderId && projDragCtx?.type === 'folder' && projDragCtx.folderId === folder.id && projInsertIndex === projIdx && !(projInsertIndex === projDragSrcIndex || projInsertIndex === (projDragSrcIndex ?? -1) + 1)}
                      isDropAfter={projDragActive && !dragOverFolderId && projDragCtx?.type === 'folder' && projDragCtx.folderId === folder.id && projIdx === fProjects.length - 1 && projInsertIndex === fProjects.length && projInsertIndex !== (projDragSrcIndex ?? -1) + 1}
                      on:pointerdown={(e) => onProjCardPointerDown(e, projIdx, { type: 'folder', folderId: folder.id }, p.id)}
                      on:pointermove={onProjCardPointerMove}
                      on:pointerup={onProjCardPointerUp}
                      on:pointercancel={onProjCardPointerCancel}
                      on:contextmenu={(e) => onProjCardContextMenu(e, projIdx, { type: 'folder', folderId: folder.id }, p.id)}
                      on:click={(e) => handleCardClick(e, () => dispatch('openProject', p.id))}
                      on:keydown={(e) => onEntryKeydown(e, p.id)}
                      on:more={(e) => openMenu(e.detail, p.id)}
              on:edit={() => dispatch('editProject', p)}
              on:reveal={() => handleReveal(p.path)}
                      on:close={() => dispatch('closeProject', p.id)}
                    >
                      {#if menuProjectId === p.id}
                        <ProjectMenu folders={$projectFolders} currentFolderId={folder.id}
                          on:edit={() => { closeMenu(); dispatch('editProject', p); }}
                          on:duplicate={() => handleDuplicate(p)}
                          on:copyPath={() => handleCopyPath(p.path)}
                          on:reveal={() => handleReveal(p.path)}
                          on:moveToFolder={(e) => moveToFolder(p.id, e.detail)}
                          on:removeFromFolder={() => removeFromFolder(p.id)}
                          on:delete={() => { closeMenu(); deletingProject = p; }}
                        />
                      {/if}
                    </ProjectEntry>
                  {/each}
                </div>
              {/if}
            {/if}
          </div>
        {/each}
        {#if folderDragSrcIndex !== null && folderInsertIndex === $projectFolders.length && folderInsertIndex !== folderDragSrcIndex + 1}
          <div class="folder-drop-indicator"></div>
        {/if}
      </div>
  {/if}

  <!-- --- Projets section -------------------------------------------- -->
  {#if ungroupedProjects.length > 0 || projDragCtx?.type === 'folder'}
    <div
      class="section-block"
      class:section-drag-over={dragOverUngrouped}
      data-drop-ungrouped
    >
      {#if $projectFolders.length > 0}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="group-title is-toggle" on:click={toggleUngroupedCollapsed}>
          <button
            class="chevron-btn"
            on:click|stopPropagation={toggleUngroupedCollapsed}
            aria-expanded={!$ungroupedCollapsed}
            aria-label={t('home.projects.folders.ungrouped') as string}
          >
            <span class="chevron" class:collapsed={$ungroupedCollapsed}>
              <Icon name="chev-d" size={13}/>
            </span>
          </button>
          <Icon name="folder-dashed" size={14} class="folder-icon"/>
          <span class="group-name">{t('home.projects.folders.ungrouped')}</span>
          <span class="folder-count">{ungroupedProjects.length}</span>
        </div>
      {/if}

      {#if $projectFolders.length > 0 && $ungroupedCollapsed && projDragCtx?.type !== 'folder'}
        <!-- folded: only the title stays, still a drop target -->
      {:else if ungroupedProjects.length === 0}
        <div class="ungrouped-drop-hint">{t('home.projects.folders.dropToUngrouped')}</div>
      {:else}
        <div class={containerClass}>
          {#each ungroupedProjects as p, projIdx (p.id)}
            <ProjectEntry project={p} layout={entryLayout} {...overview[p.id]}
              isDragSource={projDragActive && projDragCtx?.type === 'ungrouped' && projDragSrcIndex === projIdx}
              isDropBefore={projDragActive && !dragOverFolderId && !dragOverUngrouped && projDragCtx?.type === 'ungrouped' && projInsertIndex === projIdx && !(projInsertIndex === projDragSrcIndex || projInsertIndex === (projDragSrcIndex ?? -1) + 1)}
              isDropAfter={projDragActive && !dragOverFolderId && !dragOverUngrouped && projDragCtx?.type === 'ungrouped' && projIdx === ungroupedProjects.length - 1 && projInsertIndex === ungroupedProjects.length && projInsertIndex !== (projDragSrcIndex ?? -1) + 1}
              on:pointerdown={(e) => onProjCardPointerDown(e, projIdx, { type: 'ungrouped' }, p.id)}
              on:pointermove={onProjCardPointerMove}
              on:pointerup={onProjCardPointerUp}
              on:pointercancel={onProjCardPointerCancel}
              on:contextmenu={(e) => onProjCardContextMenu(e, projIdx, { type: 'ungrouped' }, p.id)}
              on:click={(e) => handleCardClick(e, () => dispatch('openProject', p.id))}
              on:keydown={(e) => onEntryKeydown(e, p.id)}
              on:more={(e) => openMenu(e.detail, p.id)}
              on:edit={() => dispatch('editProject', p)}
              on:reveal={() => handleReveal(p.path)}
              on:close={() => dispatch('closeProject', p.id)}
            >
              {#if menuProjectId === p.id}
                <ProjectMenu folders={$projectFolders} currentFolderId={null}
                  on:edit={() => { closeMenu(); dispatch('editProject', p); }}
                  on:duplicate={() => handleDuplicate(p)}
                  on:copyPath={() => handleCopyPath(p.path)}
                  on:reveal={() => handleReveal(p.path)}
                  on:moveToFolder={(e) => moveToFolder(p.id, e.detail)}
                  on:delete={() => { closeMenu(); deletingProject = p; }}
                />
              {/if}
            </ProjectEntry>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
{/if}

</div>

{#if duplicatingProject}
  <DuplicateProjectModal
    project={duplicatingProject}
    on:close={() => duplicatingProject = null}
  />
{/if}

{#if deletingProject}
  <DeleteProjectModal
    project={deletingProject}
    on:close={() => deletingProject = null}
    on:confirm={handleDelete}
  />
{/if}

{#if deletingFolder}
  <DeleteFolderModal
    folder={deletingFolder}
    on:close={() => deletingFolder = null}
    on:confirm={confirmDeleteFolder}
  />
{/if}

{#if showCreateFolder}
  <CreateFolderModal
    on:close={() => showCreateFolder = false}
    on:confirm={(e) => { projectFolders.createFolder(e.detail); showCreateFolder = false; }}
  />
{/if}

<style>
  .hidden { display: none; }

  /* -- head -------------------------------------------------------------- */
  .projects-head {
    display: flex;
    flex-direction: column;
    gap: 14px;
    margin-bottom: 32px;
  }
  .head-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .projects-head h1 {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0;
    font-family: var(--font-ui);
    font-size: 18px;
    font-weight: 600;
    color: var(--fg-0);
  }
  .head-count {
    padding: 1px 8px;
    font-size: 11.5px;
    font-weight: 400;
    line-height: 1.6;
    color: var(--fg-2);
    background: var(--bg-3);
    border-radius: 10px;
  }

  /* -- first launch ------------------------------------------------------- */
  .home-action {
    align-items: flex-start;
    text-align: left;
    font-family: var(--font-ui);
  }
  .home-actions { margin-bottom: 28px; }

  .menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
  }

  /* -- search ------------------------------------------------------------ */
  .search-bar {
    flex: 0 1 260px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    background: var(--bg-0);
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-sm);
    color: var(--fg-3);
    transition: border-color 0.15s;
  }
  .search-bar:focus-within { border-color: var(--accent-line); color: var(--fg-1); }
  .search-input {
    background: transparent;
    border: none;
    outline: none;
    font-size: 12px;
    font-family: var(--font-ui);
    color: var(--fg-0);
    width: 100%;
  }
  .search-input::placeholder { color: var(--fg-4); }
  .search-clear {
    padding: 0;
    color: var(--fg-3);
    display: flex;
    align-items: center;
  }
  .search-clear:hover { color: var(--fg-0); }

  /* -- groups ------------------------------------------------------------ */
  .project-groups.is-table {
    border: 1px solid color-mix(in oklch, var(--stroke-0) 60%, var(--stroke-1));
    border-radius: var(--r-md);
    background: var(--bg-1);
  }
  .project-groups.is-table > :first-child .folder-block:first-child .folder-header,
  .project-groups.is-table > .section-block:first-child .group-title {
    border-top: 0;
  }

  .project-groups.is-table > .projects-list:first-child > :global(.entry:first-child) { border-top: 0; }

  .open-projects { margin-bottom: 28px; }
  .group-title.open-title { margin: 0 0 8px; padding-left: 0; font: inherit; }
  .all-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }
  .all-head .group-title.open-title { margin: 0; flex: 1 1 auto; min-width: 0; }
  .all-head .btn,
  .all-head .search-bar,
  .all-head :global(.mode-toggle) { height: 28px; box-sizing: border-box; }
  .project-groups.is-table > :first-child .folder-block:first-child .folder-header,
  .project-groups.is-table > .section-block:first-child .group-title {
    border-top-left-radius: calc(var(--r-md) - 1px);
    border-top-right-radius: calc(var(--r-md) - 1px);
  }
  /* A folded group closing the table ends on its title band, which must follow the corners. */
  .project-groups.is-table > .section-block:last-child .group-title:last-child,
  .project-groups.is-table > .folders-grid:last-child .folder-block:last-child .folder-header:last-child {
    border-bottom-left-radius: calc(var(--r-md) - 1px);
    border-bottom-right-radius: calc(var(--r-md) - 1px);
  }
  .projects-compact {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
    gap: 8px;
  }

  .section-block { margin-bottom: 0; }
  .project-groups:not(.is-table) .section-block,
  .project-groups:not(.is-table) .folder-block { margin-bottom: 24px; }
  .section-block.section-drag-over {
    outline: 2px solid var(--accent-line);
    outline-offset: -2px;
    border-radius: var(--r-md);
  }
  .ungrouped-drop-hint,
  .folder-empty {
    padding: 14px;
    font-size: 12px;
    color: var(--fg-3);
  }



  .group-title,
  .folder-header {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 38px;
    box-sizing: border-box;
    padding: 0 10px 0 8px;
    position: relative;
  }
  .group-title { padding-left: 8px; }
  .is-table .group-title,
  .is-table .folder-header,
  .is-table .ungrouped-drop-hint,
  .is-table .folder-empty {
    background: var(--bg-0);
    border-top: 1px solid var(--stroke-0);
  }
  .is-table .ungrouped-drop-hint,
  .is-table .folder-empty { background: transparent; }
  .project-groups:not(.is-table) .group-title,
  .project-groups:not(.is-table) .folder-header { padding-left: 0; margin-bottom: 8px; }
  .project-groups:not(.is-table) .group-title { padding-left: 0; }

  .group-name,
  .folder-name {
    font-size: 12px;
    font-weight: 600;
    color: var(--fg-1);
  }

  /* -- folders ----------------------------------------------------------- */
  .folders-grid {
    display: flex;
    flex-direction: column;
  }
  .folder-block { position: relative; }
  .folder-block.folder-dragging { opacity: 0.4; }
  .folder-block.folder-dragging .folder-header { cursor: grabbing; }
  .folder-block.folder-drag-over { box-shadow: inset 0 0 0 2px var(--accent-line); border-radius: var(--r-sm); }
  .folder-header,
  .group-title.is-toggle { cursor: pointer; }

  .folder-drop-indicator {
    height: 2px;
    background: var(--accent);
    border-radius: 1px;
    pointer-events: none;
  }

  .chevron-btn {
    padding: 2px;
    color: var(--fg-3);
    display: flex;
    align-items: center;
    border-radius: var(--r-sm);
    flex-shrink: 0;
  }
  .chevron-btn:hover { color: var(--fg-0); background: var(--bg-3); }
  .chevron {
    display: inline-flex;
    transition: transform 0.15s;
  }
  .chevron.collapsed { transform: rotate(-90deg); }

  :global(.folder-icon) {
    color: var(--fg-3);
    flex-shrink: 0;
  }

  .folder-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
    max-width: 260px;
  }
  .folder-name:hover { color: var(--fg-0); }
  .folder-spacer { flex: 1; }

  .folder-count {
    font-size: 11px;
    color: var(--fg-3);
    flex-shrink: 0;
  }

  .folder-more-btn {
    padding: 4px;
    color: var(--fg-3);
    display: flex;
    align-items: center;
    border-radius: var(--r-sm);
    flex-shrink: 0;
  }
  .folder-more-btn:hover { color: var(--fg-0); background: var(--bg-4); }

  .folder-menu {
    top: 34px;
    right: 4px;
  }

  .inline-name-input {
    flex: 1;
    background: var(--bg-0);
    border: 1px solid var(--accent-line);
    border-radius: var(--r-sm);
    padding: 3px 7px;
    font-size: 12px;
    font-family: var(--font-ui);
    color: var(--fg-0);
    outline: none;
    min-width: 0;
  }

  /* -- drag -------------------------------------------------------------- */
  :global(.project-card.proj-drag-src) { opacity: 0.4; cursor: grabbing; }

  :global(.project-card.proj-drop-before)::before,
  :global(.project-card.proj-drop-after)::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--accent);
    border-radius: 1px;
    pointer-events: none;
  }
  :global(.project-card.proj-drop-before)::before { left: -7px; }
  :global(.project-card.proj-drop-after)::after  { right: -7px; }
  .projects-list :global(.project-card.proj-drop-before)::before,
  .projects-list :global(.project-card.proj-drop-after)::after {
    left: 0;
    right: 0;
    width: auto;
    height: 2px;
  }
  .projects-list :global(.project-card.proj-drop-before)::before { top: -1px; bottom: auto; }
  .projects-list :global(.project-card.proj-drop-after)::after { top: auto; bottom: -1px; }

  /* -- context menus ----------------------------------------------------- */
  .card-menu {
    position: absolute;
    z-index: 100;
    background: var(--bg-3);
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-md);
    padding: 4px;
    min-width: 170px;
    box-shadow: 0 8px 24px oklch(0 0 0 / 0.4);
    animation: menu-pop 0.12s cubic-bezier(0.2, 1, 0.4, 1);
  }
  @keyframes menu-pop {
    from { opacity: 0; transform: scale(0.95) translateY(-4px); }
    to   { opacity: 1; transform: none; }
  }

  .card-menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 7px 10px;
    border-radius: var(--r-sm);
    font-size: 13px;
    color: var(--fg-1);
    font-family: var(--font-ui);
    text-align: left;
  }
  .card-menu-item:hover { background: var(--bg-4); color: var(--fg-0); }
  .card-menu-item.danger { color: var(--danger); }
  .card-menu-item.danger:hover { background: var(--danger-weak); }
  .card-menu-sep { height: 1px; background: var(--stroke-0); margin: 4px 0; }

</style>
