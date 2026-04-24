<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import CairnLogo from '$lib/components/layout/CairnLogo.svelte';
  import AddProject from '$lib/components/AddProject.svelte';
  import EditProject from '$lib/components/EditProject.svelte';
  import { draggableRegion } from '$lib/utils/window-drag.js';
  import { projects, unregisterProject, duplicateProjectInStore } from '$lib/stores/project';
  import { revealInFileManager } from '$lib/services/project-service';
  import { settings } from '$lib/stores/settings';
  import type { Project } from '$lib/types/project';

  type HomeSection = 'projects' | 'checkpoints' | 'activity' | 'account' | 'settings';

  const dispatch = createEventDispatcher<{
    openProject: string;
    projectCreated: { id: string };
    sectionShown: void;
  }>();

  export let openSection: HomeSection | null = null;

  let activeSection: HomeSection = 'projects';

  $: if (openSection !== null) {
    activeSection = openSection;
    dispatch('sectionShown');
  }

  let addProjectMode: 'new' | 'open' | 'clone' | null = null;
  let search = '';

  $: filteredProjects = search.trim()
    ? $projects.filter(p =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.path.toLowerCase().includes(search.toLowerCase())
      )
    : $projects;

  // ── Project card menu ─────────────────────────────────────────────────────
  let menuProjectId: string | null = null;
  let editingProject: Project | null = null;
  let deletingProject: Project | null = null;

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

<div class="home">
  <!-- Left sidebar — padding-top clears native macOS traffic lights -->
  <aside class="home-side" style="padding-top: 36px;" data-tauri-drag-region use:draggableRegion>
    <div class="home-logo">
      <CairnLogo size={26}/>
      <span class="name">Cairn</span>
    </div>

    <div class="section">Workspace</div>
    <button class="home-nav-item {activeSection === 'projects'    ? 'active' : ''}" on:click={() => activeSection = 'projects'}>
      <Icon name="folder" size={15}/> Projects
    </button>
    <button class="home-nav-item {activeSection === 'checkpoints' ? 'active' : ''}" on:click={() => activeSection = 'checkpoints'}>
      <Icon name="bookmark" size={15}/> Saved checkpoints
    </button>
    <button class="home-nav-item {activeSection === 'activity'    ? 'active' : ''}" on:click={() => activeSection = 'activity'}>
      <Icon name="clock" size={15}/> Activity
    </button>

    <div class="section">Account</div>
    <button class="home-nav-item {activeSection === 'account'     ? 'active' : ''}" on:click={() => activeSection = 'account'}>
      <Icon name="user" size={15}/> Benjamin
    </button>
    <button class="home-nav-item {activeSection === 'settings'    ? 'active' : ''}" on:click={() => activeSection = 'settings'}>
      <Icon name="settings" size={15}/> Settings
    </button>

    <div style="flex: 1"></div>
    <div style="padding: 0 8px; font-size: 11px; color: var(--fg-3); font-family: var(--font-mono);">
      v{__APP_VERSION__ ?? 'dev'}
    </div>
  </aside>

  <main class="home-main">

    <!-- ── PROJECTS ── -->
    {#if activeSection === 'projects'}
      <div class="home-hero">
        <h1>Good morning, Benjamin.<br/><em>Which cairn are you following today?</em></h1>
      </div>

      <div class="home-actions">
        <div class="home-action primary" role="button" tabindex="0"
             on:click={() => addProjectMode = 'new'}
             on:keydown={(e) => e.key === 'Enter' && (addProjectMode = 'new')}>
          <div class="aci"><Icon name="plus" size={22}/></div>
          <div class="at">New project</div>
          <div class="ad">Create a project from any local directory.</div>
        </div>
        <div class="home-action" role="button" tabindex="0"
             on:click={() => addProjectMode = 'open'}
             on:keydown={(e) => e.key === 'Enter' && (addProjectMode = 'open')}>
          <div class="aci"><Icon name="folder" size={22}/></div>
          <div class="at">Open project</div>
          <div class="ad">Import an existing local folder as a project.</div>
        </div>
        <div class="home-action" role="button" tabindex="0"
             on:click={() => addProjectMode = 'clone'}
             on:keydown={(e) => e.key === 'Enter' && (addProjectMode = 'clone')}>
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
        <!-- Click outside any open menu to close it -->
        {#if menuProjectId}
          <!-- svelte-ignore a11y-no-static-element-interactions -->
          <div class="menu-backdrop" on:click={closeMenu} on:keydown={() => {}}></div>
        {/if}

        <div class="projects-grid">
          {#each filteredProjects as p (p.id)}
            <div class="project-card" role="button" tabindex="0"
                 on:click={() => dispatch('openProject', p.id)}
                 on:keydown={(e) => e.key === 'Enter' && dispatch('openProject', p.id)}>

              <!-- Card content -->
              <div class="pname">
                <span class="swatch" style="background: {p.color}"></span>
                {p.name}
              </div>
              <div class="ppath">{p.path}</div>

              <!-- ⋯ menu button (visible on hover) -->
              <button
                class="card-more"
                aria-label="Project options"
                on:click={(e) => openMenu(e, p.id)}
              >
                <Icon name="more" size={15}/>
              </button>

              <!-- Dropdown -->
              {#if menuProjectId === p.id}
                <div class="card-menu" role="menu">
                  <button class="card-menu-item" role="menuitem"
                    on:click={(e) => { e.stopPropagation(); closeMenu(); editingProject = p; }}>
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

    <!-- ── CHECKPOINTS ── -->
    {:else if activeSection === 'checkpoints'}
      <div class="home-hero" style="padding-bottom: 0">
        <h1 style="font-size: 22px">Saved checkpoints</h1>
        <div class="sub">Rewind any instance to a saved state.</div>
      </div>
      <div style="margin-top: 24px; color: var(--fg-3); font-size: 13px;">
        No checkpoints yet — they will appear here as instances run.
      </div>

    <!-- ── ACTIVITY ── -->
    {:else if activeSection === 'activity'}
      <div class="home-hero" style="padding-bottom: 0">
        <h1 style="font-size: 22px">Activity</h1>
        <div class="sub">Recent events across all instances.</div>
      </div>
      <div style="margin-top: 24px; color: var(--fg-3); font-size: 13px;">
        No activity yet — events will appear here as instances run.
      </div>

    <!-- ── ACCOUNT ── -->
    {:else if activeSection === 'account'}
      <div class="home-hero" style="padding-bottom: 0">
        <h1 style="font-size: 22px">Account</h1>
      </div>
      <div style="margin-top: 24px; display: flex; flex-direction: column; gap: 16px; max-width: 480px;">
        <div style="display: flex; align-items: center; gap: 16px; padding: 20px; background: var(--bg-2); border-radius: var(--r-lg); border: 1px solid var(--stroke-0);">
          <div style="width: 48px; height: 48px; border-radius: 50%; background: var(--accent-weak); border: 2px solid var(--accent-line); display: flex; align-items: center; justify-content: center; font-size: 20px; color: var(--accent);">B</div>
          <div>
            <div style="font-size: 15px; font-weight: 600; color: var(--fg-0);">Benjamin</div>
            <div style="font-size: 12px; color: var(--fg-3); margin-top: 2px;">benjamin_bonneton@icloud.com</div>
          </div>
        </div>
        <div style="padding: 14px 16px; background: var(--bg-2); border-radius: var(--r-md); border: 1px solid var(--stroke-0); font-size: 12px; color: var(--fg-3);">
          AI provider · <span style="color: var(--fg-1)">Claude Code CLI</span>
        </div>
      </div>

    <!-- ── SETTINGS ── -->
    {:else if activeSection === 'settings'}
      <div class="home-hero" style="padding-bottom: 0">
        <h1 style="font-size: 22px">Settings</h1>
      </div>

      <div class="settings-group">
        <div class="settings-group-title">General</div>
        {#each [
          { label: 'AI provider',       value: 'Claude Code CLI',    desc: 'Agent Bridge driver' },
          { label: 'Default branch',    value: 'main',               desc: 'Base for new worktrees' },
          { label: 'Worktree location', value: '~/.cairn/worktrees', desc: 'Where git worktrees are created' },
          { label: 'Format on stage',   value: 'Prettier',           desc: 'Auto-format before staging' },
        ] as s}
          <div class="settings-row">
            <div class="settings-row-info">
              <span class="settings-row-label">{s.label}</span>
              <span class="settings-row-desc">{s.desc}</span>
            </div>
            <span class="settings-row-value">{s.value}</span>
          </div>
        {/each}
      </div>

      <div class="settings-group">
        <div class="settings-group-title">Customization</div>
        <div class="settings-row">
          <div class="settings-row-info">
            <span class="settings-row-label">File tree panel width</span>
            <span class="settings-row-desc">Width of the file explorer sidebar in the Files view.</span>
          </div>
          <div class="settings-row-control">
            <input
              class="settings-number-input"
              type="number"
              min="140"
              max="480"
              value={$settings.treePanelWidth}
              on:change={(e) => {
                const v = parseInt((e.target as HTMLInputElement).value, 10);
                if (!isNaN(v)) settings.save({ treePanelWidth: Math.max(140, Math.min(480, v)) });
              }}
            />
            <span class="settings-row-unit">px</span>
            <button
              class="settings-reset-btn"
              title="Reset to default (220 px)"
              on:click={() => settings.save({ treePanelWidth: 220 })}
            >
              <Icon name="undo" size={12}/>
            </button>
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-row-info">
            <span class="settings-row-label">Show minimap</span>
            <span class="settings-row-desc">Scrollbar overview panel on the right side of the code editor.</span>
          </div>
          <label class="settings-toggle" aria-label="Toggle minimap">
            <input
              type="checkbox"
              checked={$settings.showMinimap}
              on:change={(e) => settings.save({ showMinimap: (e.target as HTMLInputElement).checked })}
            />
            <span class="settings-toggle-track"><span class="settings-toggle-thumb"></span></span>
          </label>
        </div>
      </div>
    {/if}

  </main>
</div>

{#if addProjectMode}
  <AddProject
    mode={addProjectMode}
    on:close={() => addProjectMode = null}
    on:created={(e) => { addProjectMode = null; dispatch('projectCreated', e.detail); }}
  />
{/if}

{#if editingProject}
  <EditProject
    project={editingProject}
    on:close={() => editingProject = null}
  />
{/if}

{#if deletingProject}
  <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
  <div
    class="modal-backdrop"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    on:click={() => deletingProject = null}
    on:keydown={(e) => e.key === 'Escape' && (deletingProject = null)}
  >
    <div class="modal del-modal" on:click|stopPropagation role="presentation">
      <div class="modal-head">
        <div>
          <div class="step-count">Confirm deletion</div>
          <h3>Remove "{deletingProject.name}"?</h3>
        </div>
        <button class="icon-btn close" on:click={() => deletingProject = null} aria-label="Close">
          <Icon name="x" size={16}/>
        </button>
      </div>
      <div class="modal-body">
        <p class="del-desc">
          This removes the project from Cairn and deletes all its instances and worktrees.
          <strong>Your files at <code>{deletingProject.path}</code> will not be touched.</strong>
        </p>
      </div>
      <div class="modal-foot">
        <div class="spacer"></div>
        <button class="btn ghost" on:click={() => deletingProject = null}>Cancel</button>
        <button class="btn danger" on:click={handleDelete}>
          <Icon name="trash" size={14}/> Delete project
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  /* ── Card menu ── */
  .menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
  }

  /* Card needs relative positioning for the absolute menu button + dropdown */
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

  /* ── Delete modal ── */
  .del-modal { width: min(460px, 92vw); }
  .del-desc {
    font-size: 13px;
    color: var(--fg-2);
    line-height: 1.6;
    margin: 0;
  }
  .del-desc code {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-1);
    background: var(--bg-0);
    padding: 1px 5px;
    border-radius: 3px;
    word-break: break-all;
  }

  .section-label {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  /* ── Search bar ── */
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

  .home-nav-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 7px 8px;
    background: none;
    border: none;
    border-radius: var(--r-sm);
    text-align: left;
    cursor: pointer;
    font-size: 13px;
    color: var(--fg-2);
    font-family: var(--font-ui);
  }
  .home-nav-item:hover { background: var(--bg-4); color: var(--fg-0); }
  .home-nav-item.active { background: var(--accent-weak); color: var(--fg-0); }

  /* ── Settings ──────────────────────────────────────────────────── */

  .settings-group {
    margin-top: 28px;
    max-width: 560px;
  }

  .settings-group-title {
    font-size: 10.5px;
    font-family: var(--font-mono);
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fg-3);
    margin-bottom: 10px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--stroke-0);
  }

  .settings-row {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 11px 14px;
    background: var(--bg-2);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-md);
    margin-bottom: 6px;
  }

  .settings-row-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .settings-row-label { font-size: 13px; color: var(--fg-0); }
  .settings-row-desc  { font-size: 11px; color: var(--fg-3); }
  .settings-row-value { font-family: var(--font-mono); font-size: 12px; color: var(--accent); white-space: nowrap; }

  .settings-row-control { display: flex; align-items: center; gap: 6px; }

  .settings-number-input {
    width: 64px;
    background: var(--bg-1);
    border: 1px solid var(--stroke-0);
    border-radius: 4px;
    color: var(--fg-0);
    font-size: 12px;
    font-family: var(--font-mono);
    padding: 4px 8px;
    outline: none;
    text-align: right;
  }
  .settings-number-input:focus { border-color: var(--accent); }
  .settings-number-input::-webkit-inner-spin-button,
  .settings-number-input::-webkit-outer-spin-button { -webkit-appearance: none; }

  .settings-row-unit { font-size: 11px; color: var(--fg-3); font-family: var(--font-mono); }

  .settings-reset-btn {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    background: none;
    border: 1px solid var(--stroke-0);
    border-radius: 4px;
    color: var(--fg-3);
    cursor: pointer;
    padding: 0;
    transition: color .12s, border-color .12s;
  }
  .settings-reset-btn:hover { color: var(--fg-0); border-color: var(--fg-2); }

  .settings-toggle { display: flex; align-items: center; cursor: pointer; flex-shrink: 0; }
  .settings-toggle input { position: absolute; opacity: 0; width: 0; height: 0; }
  .settings-toggle-track {
    position: relative;
    width: 32px;
    height: 18px;
    background: var(--bg-3);
    border: 1px solid var(--stroke-0);
    border-radius: 9px;
    transition: background .15s, border-color .15s;
  }
  .settings-toggle input:checked + .settings-toggle-track {
    background: var(--accent);
    border-color: var(--accent);
  }
  .settings-toggle-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 12px;
    height: 12px;
    background: var(--fg-3);
    border-radius: 50%;
    transition: transform .15s, background .15s;
  }
  .settings-toggle input:checked + .settings-toggle-track .settings-toggle-thumb {
    transform: translateX(14px);
    background: #fff;
  }
</style>
