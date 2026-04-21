<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import CairnLogo from '$lib/components/layout/CairnLogo.svelte';
  import { draggableRegion } from '$lib/utils/window-drag.js';
  import { projects } from '$lib/stores/project';

  const dispatch = createEventDispatcher<{
    openProject: string;
    addProject: string;
    createInstance: void;
  }>();

  type Section = 'projects' | 'checkpoints' | 'activity' | 'account' | 'settings';

  let activeSection: Section = 'projects';

  async function openProjectDialog() {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const path = await open({ directory: true, title: 'Select project folder' });
      if (path) dispatch('addProject', path as string);
    } catch {
      alert('File dialog not available in dev mode');
    }
  }

  let cloneUrl = '';
  let showCloneInput = false;
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
    <div style="padding: 10px 8px; font-size: 11px; color: var(--fg-3); font-family: var(--font-mono);">
      v0.1.0 · offline ready
    </div>
  </aside>

  <main class="home-main">

    <!-- ── PROJECTS ── -->
    {#if activeSection === 'projects'}
      <div class="home-hero">
        <h1>Good morning, Benjamin.<br/><em>Which cairn are you following today?</em></h1>
        <div class="sub">An instance = one ticket, one worktree, one agent session.</div>
      </div>

      <div class="home-actions">
        <div class="home-action primary" role="button" tabindex="0"
             on:click={() => dispatch('createInstance')}
             on:keydown={(e) => e.key === 'Enter' && dispatch('createInstance')}>
          <div class="aci"><Icon name="plus" size={22}/></div>
          <div class="at">New instance</div>
          <div class="ad">Pick a ticket, spin up a worktree, start the agent.</div>
        </div>
        <div class="home-action" role="button" tabindex="0"
             on:click={openProjectDialog}
             on:keydown={(e) => e.key === 'Enter' && openProjectDialog()}>
          <div class="aci"><Icon name="folder" size={22}/></div>
          <div class="at">Open project</div>
          <div class="ad">Import an existing repo as a new project tab.</div>
        </div>
        <div class="home-action" role="button" tabindex="0"
             on:click={() => showCloneInput = !showCloneInput}
             on:keydown={(e) => e.key === 'Enter' && (showCloneInput = !showCloneInput)}>
          <div class="aci"><Icon name="download" size={22}/></div>
          <div class="at">Clone from remote</div>
          <div class="ad">GitHub, GitLab, or any Git URL.</div>
        </div>
      </div>

      {#if showCloneInput}
        <div class="clone-bar">
          <Icon name="branch" size={14}/>
          <input bind:value={cloneUrl} placeholder="https://github.com/user/repo.git" />
          <button class="btn primary" on:click={() => { if (cloneUrl) alert(`Would clone: ${cloneUrl}`); }}>
            Clone
          </button>
          <button class="btn ghost" on:click={() => showCloneInput = false}>Cancel</button>
        </div>
      {/if}

      <div class="home-section-title">
        <Icon name="folder" size={13}/> Projects <span class="count">— {$projects.length}</span>
      </div>
      {#if $projects.length === 0}
        <div style="padding: 32px 0; color: var(--fg-3); font-size: 13px;">
          No projects yet — open a local repo or clone one to get started.
        </div>
      {:else}
        <div class="projects-grid">
          {#each $projects as p}
            <div class="project-card" role="button" tabindex="0"
                 on:click={() => dispatch('openProject', p.id)}
                 on:keydown={(e) => e.key === 'Enter' && dispatch('openProject', p.id)}>
              <div class="pname">
                <span class="swatch" style="background: {p.color}"></span>
                {p.name}
              </div>
              <div class="ppath">{p.path}</div>
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
      <div style="margin-top: 24px; display: flex; flex-direction: column; gap: 12px; max-width: 520px;">
        {#each [
          { label: 'AI provider',       value: 'Claude Code CLI',   desc: 'Agent Bridge driver' },
          { label: 'Default branch',    value: 'main',              desc: 'Base for new worktrees' },
          { label: 'Worktree location', value: '~/.cairn/worktrees',desc: 'Where git worktrees are created' },
          { label: 'Format on stage',   value: 'Prettier',          desc: 'Auto-format before staging' },
        ] as s}
          <div style="display: flex; align-items: center; padding: 12px 16px; background: var(--bg-2); border-radius: var(--r-md); border: 1px solid var(--stroke-0); gap: 16px;">
            <div style="flex: 1;">
              <div style="font-size: 13px; color: var(--fg-0);">{s.label}</div>
              <div style="font-size: 11px; color: var(--fg-3); margin-top: 2px;">{s.desc}</div>
            </div>
            <span style="font-family: var(--font-mono); font-size: 12px; color: var(--accent);">{s.value}</span>
          </div>
        {/each}
      </div>
    {/if}

  </main>
</div>

<style>
  .clone-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    background: var(--bg-2);
    border-radius: var(--r-md);
    border: 1px solid var(--stroke-1);
    margin-bottom: 20px;
  }
  .clone-bar input {
    flex: 1;
    background: var(--bg-3);
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-sm);
    padding: 6px 10px;
    color: var(--fg-0);
    font-family: var(--font-mono);
    font-size: 12px;
  }
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
</style>
