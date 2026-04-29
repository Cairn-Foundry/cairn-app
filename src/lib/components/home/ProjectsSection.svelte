<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { projects, unregisterProject, duplicateProjectInStore } from '$lib/stores/project';
  import { revealInFileManager } from '$lib/services/project-service';
  import type { Project } from '$lib/types/project';
  import DeleteProjectModal from './DeleteProjectModal.svelte';

  const dispatch = createEventDispatcher<{
    openProject: string;
    addProject: 'new' | 'open' | 'clone';
    editProject: Project;
  }>();

  let search = '';
  let menuProjectId: string | null = null;
  let deletingProject: Project | null = null;

  $: filteredProjects = search.trim()
    ? $projects.filter(p =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.path.toLowerCase().includes(search.toLowerCase())
      )
    : $projects;

  function openMenu(e: MouseEvent, id: string) {
    e.stopPropagation();
    menuProjectId = menuProjectId === id ? null : id;
  }

  function closeMenu() { menuProjectId = null; }

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
</script>

<div class="home-hero">
  <h1>Good morning, Benjamin.<br/><em>Which cairn are you following today?</em></h1>
</div>

<div class="home-actions">
  <div class="home-action primary" role="button" tabindex="0"
       on:click={() => dispatch('addProject', 'new')}
       on:keydown={(e) => e.key === 'Enter' && dispatch('addProject', 'new')}>
    <div class="aci"><Icon name="plus" size={22}/></div>
    <div class="at">New project</div>
    <div class="ad">Create a project from any local directory.</div>
  </div>
  <div class="home-action" role="button" tabindex="0"
       on:click={() => dispatch('addProject', 'open')}
       on:keydown={(e) => e.key === 'Enter' && dispatch('addProject', 'open')}>
    <div class="aci"><Icon name="folder" size={22}/></div>
    <div class="at">Open project</div>
    <div class="ad">Import an existing local folder as a project.</div>
  </div>
  <div class="home-action" role="button" tabindex="0"
       on:click={() => dispatch('addProject', 'clone')}
       on:keydown={(e) => e.key === 'Enter' && dispatch('addProject', 'clone')}>
    <div class="aci"><Icon name="download" size={22}/></div>
    <div class="at">Clone from remote</div>
    <div class="ad">GitHub, GitLab, or any Git URL.</div>
  </div>
</div>

<div class="home-section-title">
  <span class="section-label"><Icon name="folder" size={13}/> Projects <span class="count">— {$projects.length}</span></span>
  {#if $projects.length > 0}
    <div class="search-bar">
      <Icon name="search" size={13}/>
      <input
        class="search-input"
        bind:value={search}
        placeholder="Filter projects…"
        aria-label="Filter projects"
      />
      {#if search}
        <button class="search-clear" on:click={() => search = ''} aria-label="Clear search">
          <Icon name="x" size={11}/>
        </button>
      {/if}
    </div>
  {/if}
</div>
{#if $projects.length === 0}
  <div style="padding: 32px 0; color: var(--fg-3); font-size: 13px;">
    No projects yet — open a local folder or clone one to get started.
  </div>
{:else if filteredProjects.length === 0}
  <div style="padding: 32px 0; color: var(--fg-3); font-size: 13px;">
    No projects match "<strong style="color: var(--fg-1)">{search}</strong>".
  </div>
{:else}
  {#if menuProjectId}
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="menu-backdrop" on:click={closeMenu} on:keydown={() => {}}></div>
  {/if}

  <div class="projects-grid">
    {#each filteredProjects as p (p.id)}
      <div class="project-card" role="button" tabindex="0"
           on:click={() => dispatch('openProject', p.id)}
           on:keydown={(e) => e.key === 'Enter' && dispatch('openProject', p.id)}>

        <div class="pname">
          <span class="swatch" style="background: {p.color}"></span>
          {p.name}
        </div>
        <div class="ppath">{p.path}</div>

        <button
          class="card-more"
          aria-label="Project options"
          on:click={(e) => openMenu(e, p.id)}
        >
          <Icon name="more" size={15}/>
        </button>

        {#if menuProjectId === p.id}
          <div class="card-menu" role="menu">
            <button class="card-menu-item" role="menuitem"
              on:click={(e) => { e.stopPropagation(); closeMenu(); dispatch('editProject', p); }}>
              <Icon name="edit" size={13}/> Edit
            </button>
            <button class="card-menu-item" role="menuitem"
              on:click={(e) => { e.stopPropagation(); handleDuplicate(p.id); }}>
              <Icon name="copy" size={13}/> Duplicate
            </button>
            <button class="card-menu-item" role="menuitem"
              on:click={(e) => { e.stopPropagation(); handleCopyPath(p.path); }}>
              <Icon name="clipboard" size={13}/> Copy path
            </button>
            <button class="card-menu-item" role="menuitem"
              on:click={(e) => { e.stopPropagation(); handleReveal(p.path); }}>
              <Icon name="folder" size={13}/> Reveal in Finder
            </button>
            <div class="card-menu-sep"></div>
            <button class="card-menu-item danger" role="menuitem"
              on:click={(e) => { e.stopPropagation(); closeMenu(); deletingProject = p; }}>
              <Icon name="trash" size={13}/> Delete
            </button>
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/if}

{#if deletingProject}
  <DeleteProjectModal
    project={deletingProject}
    on:close={() => deletingProject = null}
    on:confirm={handleDelete}
  />
{/if}

<style>
  .menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
  }

  :global(.project-card) {
    position: relative;
    overflow: visible !important;
  }

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
  }
  :global(.project-card:hover) .card-more,
  .card-more:focus-visible { opacity: 1; }
  .card-more:hover { background: var(--bg-4); color: var(--fg-0); }

  .card-menu {
    position: absolute;
    top: 36px;
    right: 10px;
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

  .card-menu-sep {
    height: 1px;
    background: var(--stroke-0);
    margin: 4px 0;
  }

  .section-label {
    display: flex;
    align-items: center;
    gap: 10px;
  }

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
  .search-bar:focus-within {
    border-color: var(--accent-line);
    color: var(--fg-1);
  }
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
</style>
