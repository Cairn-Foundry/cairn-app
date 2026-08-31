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
  import { createEventDispatcher, onDestroy, onMount, tick } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n';
  import { pickGreeting, pickTagline } from '$lib/utils/home/greeting';
  import { projects, unregisterProject, duplicateProjectInStore, openProjects, activeProjectId, lastOpenedProjectId } from '$lib/stores/project';
  import { projectFolders } from '$lib/stores/project-folders';
  import { revealInFileManager } from '$lib/services/project-service';
  import type { Project, ProjectFolder } from '$lib/types/project';
  import DeleteProjectModal from './DeleteProjectModal.svelte';
  import DeleteFolderModal from './DeleteFolderModal.svelte';
  import { matchesSearch } from '$lib/utils/files/files-search';
  import ProjectMenu from './ProjectMenu.svelte';
  import CreateFolderModal from './CreateFolderModal.svelte';
  import { computeTabInsertIndex } from '$lib/utils/files/files-tab-drag';
  import { reorderProjects } from '$lib/stores/project';
  import { inboxLabel, loadProjectInbox, projectInbox } from '$lib/stores/project-inbox';

  const dispatch = createEventDispatcher<{
    openProject: string;
    addProject: 'new' | 'open' | 'clone';
    editProject: Project;
    closeProject: string;
  }>();

  onMount(() => {
    for (const p of $projects) void loadProjectInbox(p.id);
  });

  let search = '';
  let searchInputEl: HTMLInputElement | null = null;
  let prevWasSearching = false;

  const greeting = pickGreeting();
  const tagline = pickTagline();

  $: {
    const isSearching = !!search.trim();
    if (isSearching && !prevWasSearching) tick().then(() => searchInputEl?.focus());
    prevWasSearching = isSearching;
  }

  let menuProjectId: string | null = null;
  let menuFolderId: string | null = null;
  let deletingProject: Project | null = null;
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

  /** Parent directory name of a project path, shown instead of the full path. */
  function parentFolderName(path: string): string {
    const segments = path.split(/[\\/]/).filter(Boolean);
    return segments.length > 1 ? segments[segments.length - 2] : '';
  }

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
  async function handleDuplicate(id: string) {
    closeMenu();
    await duplicateProjectInStore(id);
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
      projInsertIndex = computeGridInsertIndex(projDragBarEl, e.clientX, e.clientY, '.project-card');
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

<!-- hero + quick actions - hidden via CSS when searching to keep DOM stable -->
<div class="home-hero" class:hidden={!!search}>
  <h1>{greeting}<br/><em>{tagline}</em></h1>
</div>

<div class="home-actions" class:hidden={!!search}>
  <div class="home-action primary" role="button" tabindex="0"
       on:click={() => dispatch('addProject', 'new')}
       on:keydown={(e) => e.key === 'Enter' && dispatch('addProject', 'new')}>
    <div class="aci"><Icon name="plus" size={22}/></div>
    <div class="at">{t('home.projects.newProject')}</div>
    <div class="ad">{t('home.projects.newProjectDesc')}</div>
  </div>
  <div class="home-action" role="button" tabindex="0"
       on:click={() => dispatch('addProject', 'open')}
       on:keydown={(e) => e.key === 'Enter' && dispatch('addProject', 'open')}>
    <div class="aci"><Icon name="folder" size={22}/></div>
    <div class="at">{t('home.projects.openProject')}</div>
    <div class="ad">{t('home.projects.openProjectDesc')}</div>
  </div>
  <div class="home-action" role="button" tabindex="0"
       on:click={() => dispatch('addProject', 'clone')}
       on:keydown={(e) => e.key === 'Enter' && dispatch('addProject', 'clone')}>
    <div class="aci"><Icon name="download" size={22}/></div>
    <div class="at">{t('home.projects.cloneFromRemote')}</div>
    <div class="ad">{t('home.projects.cloneFromRemoteDesc')}</div>
  </div>
</div>

{#if $openProjects.length > 0}
  <div class="open-tabs" class:hidden={!!search}>
    <div class="home-section-title">
      <span class="section-label">
        <Icon name="folder-open" size={13}/>
        {(t('home.projects.openTabsCount') as (n: number) => string)($openProjects.length)}
      </span>
    </div>
    <div class="open-tabs-row">
      {#each $openProjects as p (p.id)}
        <div class="open-tab" class:active={p.id === $activeProjectId} class:last-opened={p.id === $lastOpenedProjectId} role="button" tabindex="0"
             on:click={() => dispatch('openProject', p.id)}
             on:keydown={(e) => e.key === 'Enter' && dispatch('openProject', p.id)}>
          <span class="open-tab-dot" style="background: {p.color}"></span>
          <span class="open-tab-name">{p.name}</span>
          <button class="open-tab-close" aria-label={t('common.close') as string}
                  on:click|stopPropagation={() => dispatch('closeProject', p.id)}>
            <Icon name="x" size={11}/>
          </button>
        </div>
      {/each}
    </div>
  </div>
{/if}

<!-- backdrop for menus -->
{#if menuProjectId || menuFolderId}
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="menu-backdrop" on:click={closeMenu} on:keydown={() => {}}></div>
{/if}

<!-- --- header bar (always rendered - keeps input in same DOM node) ------- -->
<div class="home-section-title">
  <span class="section-label">
    <Icon name={filteredProjects !== null ? 'search' : 'folder'} size={13}/>
    {(t('home.projects.projectsCount') as (n: number) => string)($projects.length)}
  </span>
  <div class="section-right">
    {#if filteredProjects === null}
      <button class="new-folder-btn" on:click={() => showCreateFolder = true}>
        <Icon name="plus" size={13}/>
        {t('home.projects.folders.newFolder')}
      </button>
    {/if}
    {#if $projects.length > 0}
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
    {/if}
  </div>
</div>

<!-- --- search mode --------------------------------------------------------- -->
{#if filteredProjects !== null}
  {#if filteredProjects.length === 0}
    <div class="empty-state">{(t('home.projects.emptyFiltered') as (q: string) => string)(search)}</div>
  {:else}
    <div class="projects-grid">
      {#each filteredProjects as p (p.id)}
        <div class="project-card" role="button" tabindex="0"
             on:click={() => dispatch('openProject', p.id)}
             on:keydown={(e) => e.key === 'Enter' && dispatch('openProject', p.id)}>
          <div class="pname"><span class="swatch" style="background: {p.color}"></span>{p.name}{#if $projectInbox[p.id]}<span class="inbox-pill" title={t('home.projects.inboxTitle') as string}>{inboxLabel($projectInbox[p.id])}</span>{/if}</div>
          {#if parentFolderName(p.path)}<div class="pfolder">{parentFolderName(p.path)}</div>{/if}
          <button class="card-more" aria-label={t('home.projects.projectOptions') as string} on:click={(e) => openMenu(e, p.id)}>
            <Icon name="more" size={15}/>
          </button>
          {#if menuProjectId === p.id}
            <ProjectMenu folders={$projectFolders} currentFolderId={null}
              on:edit={() => { closeMenu(); dispatch('editProject', p); }}
              on:duplicate={() => handleDuplicate(p.id)}
              on:copyPath={() => handleCopyPath(p.path)}
              on:reveal={() => handleReveal(p.path)}
              on:moveToFolder={(e) => moveToFolder(p.id, e.detail)}
              on:delete={() => { closeMenu(); deletingProject = p; }}
            />
          {/if}
        </div>
      {/each}
    </div>
  {/if}

{:else}
  <!-- --- normal mode ------------------------------------------------------- -->

  <!-- --- Dossiers section ------------------------------------------- -->
  {#if $projectFolders.length > 0}
    <div class="section-block">
      <div class="section-block-title">{t('home.projects.folders.sectionLabel')}</div>

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
                <div class="projects-grid folder-projects">
                  {#each fProjects as p, projIdx (p.id)}
                    <div
                      class="project-card"
                      class:proj-drag-src={projDragActive && projDragCtx?.type === 'folder' && projDragCtx.folderId === folder.id && projDragSrcIndex === projIdx}
                      class:proj-drop-before={projDragActive && !dragOverFolderId && projDragCtx?.type === 'folder' && projDragCtx.folderId === folder.id && projInsertIndex === projIdx && !(projInsertIndex === projDragSrcIndex || projInsertIndex === (projDragSrcIndex ?? -1) + 1)}
                      class:proj-drop-after={projDragActive && !dragOverFolderId && projDragCtx?.type === 'folder' && projDragCtx.folderId === folder.id && projIdx === fProjects.length - 1 && projInsertIndex === fProjects.length && projInsertIndex !== (projDragSrcIndex ?? -1) + 1}
                      role="button"
                      tabindex="0"
                      on:pointerdown={(e) => onProjCardPointerDown(e, projIdx, { type: 'folder', folderId: folder.id }, p.id)}
                      on:pointermove={onProjCardPointerMove}
                      on:pointerup={onProjCardPointerUp}
                      on:pointercancel={onProjCardPointerCancel}
                      on:contextmenu={(e) => onProjCardContextMenu(e, projIdx, { type: 'folder', folderId: folder.id }, p.id)}
                      on:click={(e) => handleCardClick(e, () => dispatch('openProject', p.id))}
                      on:keydown={(e) => e.key === 'Enter' && dispatch('openProject', p.id)}
                    >
                      <div class="pname"><span class="swatch" style="background: {p.color}"></span>{p.name}{#if $projectInbox[p.id]}<span class="inbox-pill" title={t('home.projects.inboxTitle') as string}>{inboxLabel($projectInbox[p.id])}</span>{/if}</div>
                      {#if parentFolderName(p.path)}<div class="pfolder">{parentFolderName(p.path)}</div>{/if}
                      <button class="card-more" aria-label={t('home.projects.projectOptions') as string} on:click={(e) => openMenu(e, p.id)}>
                        <Icon name="more" size={15}/>
                      </button>
                      {#if menuProjectId === p.id}
                        <ProjectMenu folders={$projectFolders} currentFolderId={folder.id}
                          on:edit={() => { closeMenu(); dispatch('editProject', p); }}
                          on:duplicate={() => handleDuplicate(p.id)}
                          on:copyPath={() => handleCopyPath(p.path)}
                          on:reveal={() => handleReveal(p.path)}
                          on:moveToFolder={(e) => moveToFolder(p.id, e.detail)}
                          on:removeFromFolder={() => removeFromFolder(p.id)}
                          on:delete={() => { closeMenu(); deletingProject = p; }}
                        />
                      {/if}
                    </div>
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
    </div>
  {/if}

  <!-- --- Projets section -------------------------------------------- -->
  {#if ungroupedProjects.length > 0 || $projects.length === 0 || projDragCtx?.type === 'folder'}
    <div
      class="section-block"
      class:section-drag-over={dragOverUngrouped}
      data-drop-ungrouped
    >
      {#if $projectFolders.length > 0}
        <div class="section-block-title">{t('home.projects.folders.ungrouped')}</div>
      {/if}

      {#if $projects.length === 0}
        <div class="empty-state">{t('home.projects.emptyProjects')}</div>
      {:else if ungroupedProjects.length === 0}
        <div class="ungrouped-drop-hint">{t('home.projects.folders.dropToUngrouped')}</div>
      {:else}
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div class="projects-grid">
          {#each ungroupedProjects as p, projIdx (p.id)}
            <div
              class="project-card"
              class:proj-drag-src={projDragActive && projDragCtx?.type === 'ungrouped' && projDragSrcIndex === projIdx}
              class:proj-drop-before={projDragActive && !dragOverFolderId && !dragOverUngrouped && projDragCtx?.type === 'ungrouped' && projInsertIndex === projIdx && !(projInsertIndex === projDragSrcIndex || projInsertIndex === (projDragSrcIndex ?? -1) + 1)}
              class:proj-drop-after={projDragActive && !dragOverFolderId && !dragOverUngrouped && projDragCtx?.type === 'ungrouped' && projIdx === ungroupedProjects.length - 1 && projInsertIndex === ungroupedProjects.length && projInsertIndex !== (projDragSrcIndex ?? -1) + 1}
              role="button"
              tabindex="0"
              on:pointerdown={(e) => onProjCardPointerDown(e, projIdx, { type: 'ungrouped' }, p.id)}
              on:pointermove={onProjCardPointerMove}
              on:pointerup={onProjCardPointerUp}
              on:pointercancel={onProjCardPointerCancel}
              on:contextmenu={(e) => onProjCardContextMenu(e, projIdx, { type: 'ungrouped' }, p.id)}
              on:click={(e) => handleCardClick(e, () => dispatch('openProject', p.id))}
              on:keydown={(e) => e.key === 'Enter' && dispatch('openProject', p.id)}
            >
              <div class="pname"><span class="swatch" style="background: {p.color}"></span>{p.name}{#if $projectInbox[p.id]}<span class="inbox-pill" title={t('home.projects.inboxTitle') as string}>{inboxLabel($projectInbox[p.id])}</span>{/if}</div>
              {#if parentFolderName(p.path)}<div class="pfolder">{parentFolderName(p.path)}</div>{/if}
              <button class="card-more" aria-label={t('home.projects.projectOptions') as string} on:click={(e) => openMenu(e, p.id)}>
                <Icon name="more" size={15}/>
              </button>
              {#if menuProjectId === p.id}
                <ProjectMenu folders={$projectFolders} currentFolderId={null}
                  on:edit={() => { closeMenu(); dispatch('editProject', p); }}
                  on:duplicate={() => handleDuplicate(p.id)}
                  on:copyPath={() => handleCopyPath(p.path)}
                  on:reveal={() => handleReveal(p.path)}
                  on:moveToFolder={(e) => moveToFolder(p.id, e.detail)}
                  on:delete={() => { closeMenu(); deletingProject = p; }}
                />
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
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

  /* -- open project tabs ------------------------------------------------- */
  .open-tabs { margin-bottom: 40px; }

  .open-tabs-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .open-tab {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px 6px 10px;
    font-size: 12.5px;
    color: var(--fg-1);
    background: var(--bg-2);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-sm);
    cursor: pointer;
    transition: color .12s, background .12s, border-color .12s;
  }
  .open-tab:hover { background: var(--bg-3); color: var(--fg-0); }
  .open-tab.active { border-color: var(--accent-line); color: var(--fg-0); }
  .open-tab.last-opened { border: 2px solid var(--accent); padding: 5px 7px 5px 9px; color: var(--fg-0); }

  .open-tab-dot {
    width: 6px; height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .open-tab-name { white-space: nowrap; }

  .open-tab-close {
    display: grid;
    place-items: center;
    width: 16px; height: 16px;
    padding: 0;
    border-radius: 3px;
    color: var(--fg-3);
  }
  .open-tab-close:hover { background: var(--bg-4); color: var(--fg-0); }

  /* -- backdrop ---------------------------------------------------------- */
  .menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
  }

  /* -- header bar -------------------------------------------------------- */
  .section-label {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .section-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .new-folder-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 5px 10px;
    border-radius: var(--r-sm);
    border: 1px solid var(--stroke-1);
    background: none;
    font-size: 12px;
    font-family: var(--font-ui);
    color: var(--fg-2);
    cursor: pointer;
    transition: background 0.1s, color 0.1s, border-color 0.1s;
  }
  .new-folder-btn:hover { background: var(--bg-3); color: var(--fg-0); border-color: var(--stroke-2); }

  /* -- search ------------------------------------------------------------ */
  .search-bar {
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
    width: 160px;
  }
  .search-input::placeholder { color: var(--fg-4); }
  .search-clear {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    color: var(--fg-3);
    display: flex;
    align-items: center;
  }
  .search-clear:hover { color: var(--fg-0); }

  /* -- section blocks ---------------------------------------------------- */
  .section-block {
    margin-bottom: 28px;
  }
  .section-block.section-drag-over {
    outline: 2px solid var(--accent-line);
    outline-offset: 6px;
    border-radius: var(--r-md);
  }
  .ungrouped-drop-hint {
    border: 2px dashed var(--stroke-1);
    border-radius: var(--r-md);
    padding: 20px;
    text-align: center;
    font-size: 12px;
    color: var(--fg-3);
  }

  .section-block-title {
    font-size: 11px;
    font-weight: 600;
    color: var(--fg-4);
    text-transform: uppercase;
    letter-spacing: 0.07em;
    margin-bottom: 10px;
    padding: 0 2px;
  }

  /* -- folders grid ------------------------------------------------------ */
  .folders-grid {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .folder-block {
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-md);
    background: var(--bg-1);
    overflow: visible;
    transition: border-color 0.1s, background 0.1s, box-shadow 0.1s;
  }


  /* -- folder header ----------------------------------------------------- */
  .folder-header {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 9px 10px 9px 6px;
    cursor: pointer;
    position: relative;
  }
  .folder-block.folder-dragging { opacity: 0.4; }
  .folder-block.folder-dragging .folder-header { cursor: grabbing; }
  .folder-block.folder-drag-over {
    border-color: var(--accent-line);
    box-shadow: 0 0 0 1px var(--accent-line);
  }

  .folder-drop-indicator {
    height: 2px;
    background: var(--accent);
    border-radius: 1px;
    margin: 1px 0;
    pointer-events: none;
  }

  .chevron-btn {
    background: none;
    border: none;
    padding: 2px;
    cursor: pointer;
    color: var(--fg-3);
    display: flex;
    align-items: center;
    border-radius: var(--r-sm);
    flex-shrink: 0;
    transition: color 0.1s, background 0.1s;
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
    font-size: 13px;
    font-weight: 500;
    color: var(--fg-1);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
    min-width: 0;
    max-width: 260px;
  }
  .folder-name:hover { color: var(--fg-0); }

  .folder-spacer { flex: 1; }

  .inbox-pill {
    margin-left: auto;
    margin-right: 22px;
    font-size: 11px;
    font-family: var(--font-mono);
    color: var(--fg-3);
    background: var(--bg-3);
    border-radius: 10px;
    padding: 1px 7px;
    line-height: 1.6;
    flex-shrink: 0;
  }

  .folder-count {
    font-size: 11px;
    color: var(--fg-4);
    background: var(--bg-3);
    border-radius: 10px;
    padding: 1px 7px;
    line-height: 1.6;
    flex-shrink: 0;
  }

  .folder-more-btn {
    background: none;
    border: none;
    padding: 4px;
    cursor: pointer;
    color: var(--fg-4);
    display: flex;
    align-items: center;
    border-radius: var(--r-sm);
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.1s, color 0.1s, background 0.1s;
  }
  .folder-header:hover .folder-more-btn { opacity: 1; }
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
    font-size: 13px;
    font-family: var(--font-ui);
    color: var(--fg-0);
    outline: none;
    min-width: 0;
  }

  /* -- folder expanded content ------------------------------------------- */
  .folder-empty {
    padding: 14px 12px;
    font-size: 12px;
    color: var(--fg-4);
    border-top: 1px solid var(--stroke-0);
  }

  .folder-projects {
    padding: 10px 10px 10px;
    border-top: 1px solid var(--stroke-0);
    margin-bottom: 0 !important;
  }

  /* -- project cards ----------------------------------------------------- */
  :global(.project-card) {
    position: relative;
    overflow: visible !important;
  }
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

  .card-more {
    position: absolute;
    top: 10px;
    right: 10px;
    width: 26px;
    height: 26px;
    border-radius: var(--r-sm);
    background: none;
    border: none;
    cursor: pointer;
    color: var(--fg-3);
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.1s, background 0.1s, color 0.1s;
    z-index: 10;
  }
  :global(.project-card:hover) .card-more,
  .card-more:focus-visible { opacity: 1; }
  .card-more:hover { background: var(--bg-4); color: var(--fg-0); }

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
    background: none;
    border: none;
    font-size: 13px;
    color: var(--fg-1);
    font-family: var(--font-ui);
    cursor: pointer;
    text-align: left;
    transition: background 0.08s, color 0.08s;
  }
  .card-menu-item:hover { background: var(--bg-4); color: var(--fg-0); }
  .card-menu-item.danger { color: var(--danger, oklch(0.75 0.18 15)); }
  .card-menu-item.danger:hover { background: var(--danger-weak, oklch(0.28 0.06 15)); }
  .card-menu-sep { height: 1px; background: var(--stroke-0); margin: 4px 0; }

  /* -- misc -------------------------------------------------------------- */
  .empty-state {
    padding: 32px 0;
    color: var(--fg-3);
    font-size: 13px;
  }
</style>
