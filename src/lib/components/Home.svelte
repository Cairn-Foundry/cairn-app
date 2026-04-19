<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import CairnLogo from '$lib/components/layout/CairnLogo.svelte';
  import { draggableRegion } from '$lib/utils/window-drag.js';

  const dispatch = createEventDispatcher<{
    openProject: string;
    createInstance: void;
  }>();

  type Section = 'projects' | 'tickets' | 'checkpoints' | 'activity' | 'account' | 'settings';

  let activeSection: Section = 'projects';

  const PROJECTS = [
    { id: 'fe',     name: 'Frontend', color: 'oklch(0.72 0.14 250)', path: '~/code/acme-web',    instances: 3, branches: 12, lastOpened: '2m ago' },
    { id: 'be',     name: 'Backend',  color: 'oklch(0.74 0.14 150)', path: '~/code/acme-api',    instances: 2, branches: 8,  lastOpened: '14m ago' },
    { id: 'infra',  name: 'Infra',    color: 'oklch(0.80 0.14 75)',  path: '~/code/acme-infra',  instances: 0, branches: 4,  lastOpened: 'yesterday' },
    { id: 'mobile', name: 'Mobile',   color: 'oklch(0.70 0.18 25)',  path: '~/code/acme-mobile', instances: 1, branches: 6,  lastOpened: '3d ago' },
  ];

  const RECENT_TICKETS = [
    { id: 'FEAT-43', title: 'Wire up OAuth provider switcher UI',           source: 'Jira',   labels: ['frontend', 'auth'] },
    { id: 'BUG-121', title: 'Invoice PDF missing footer on long orders',     source: 'Jira',   labels: ['bug', 'billing'] },
    { id: 'CHORE-08',title: 'Upgrade React to 18.3',                        source: 'GitHub', labels: ['deps'] },
    { id: 'FEAT-47', title: 'Dark mode for onboarding flow',                 source: 'Linear', labels: ['ui'] },
    { id: 'BUG-124', title: 'Session token not refreshed in background tab', source: 'GitHub', labels: ['bug', 'auth'] },
  ];

  const CHECKPOINTS = [
    { id: 'ck-3', label: 'Before db migration',     instance: 'FEAT-42', time: '09:37', branch: 'feat/totp-auth' },
    { id: 'ck-2', label: 'Before generating code',  instance: 'FEAT-42', time: '09:22', branch: 'feat/totp-auth' },
    { id: 'ck-1', label: 'Before refactor start',   instance: 'BUG-118', time: 'yesterday', branch: 'fix/dropdown-scroll' },
  ];

  const ACTIVITY = [
    { time: '09:45', label: 'Agent patching verifyTotp window',       instance: 'FEAT-42', kind: 'agent' },
    { time: '09:37', label: 'Checkpoint saved — Before db migration', instance: 'FEAT-42', kind: 'checkpoint' },
    { time: '09:34', label: 'Tests written (8 new)',                   instance: 'FEAT-42', kind: 'test' },
    { time: '09:26', label: 'Created src/auth/totp.ts',               instance: 'FEAT-42', kind: 'file' },
    { time: 'yesterday', label: 'Merged fix/dropdown-scroll → main',  instance: 'BUG-118', kind: 'git' },
  ];

  async function openProjectDialog() {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const path = await open({ directory: true, title: 'Select project folder' });
      if (path) alert(`Would open project at: ${path}`);
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
    <button class="home-nav-item {activeSection === 'tickets'     ? 'active' : ''}" on:click={() => activeSection = 'tickets'}>
      <Icon name="ticket" size={15}/> Recent tickets
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
        <Icon name="folder" size={13}/> Projects <span class="count">— {PROJECTS.length}</span>
      </div>
      <div class="projects-grid">
        {#each PROJECTS as p}
          <div class="project-card" role="button" tabindex="0"
               on:click={() => dispatch('openProject', p.id)}
               on:keydown={(e) => e.key === 'Enter' && dispatch('openProject', p.id)}>
            <div class="pname">
              <span class="swatch" style="background: {p.color}"></span>
              {p.name}
            </div>
            <div class="ppath">{p.path}</div>
            <div class="pstats">
              <div class="stat"><Icon name="ticket" size={12}/> <b>{p.instances}</b> instances</div>
              <div class="stat"><Icon name="branch" size={12}/> <b>{p.branches}</b> branches</div>
              <div class="stat dim"><Icon name="clock" size={12}/> {p.lastOpened}</div>
            </div>
          </div>
        {/each}
      </div>

    <!-- ── RECENT TICKETS ── -->
    {:else if activeSection === 'tickets'}
      <div class="home-hero" style="padding-bottom: 0">
        <h1 style="font-size: 22px">Recent tickets</h1>
        <div class="sub">Start a new instance from any ticket.</div>
      </div>
      <div class="recent-tickets" style="margin-top: 20px">
        {#each RECENT_TICKETS as t}
          <div class="ticket-row" role="button" tabindex="0"
               on:click={() => dispatch('createInstance')}
               on:keydown={(e) => e.key === 'Enter' && dispatch('createInstance')}>
            <span class="tid">{t.id}</span>
            <span class="tname">{t.title}</span>
            <span class="tsrc">{t.source}</span>
            <div style="display: flex; gap: 4px;">
              {#each t.labels as l}
                <span style="font-size: 10px; padding: 2px 6px; border-radius: var(--r-xs); background: var(--bg-4); color: var(--fg-2);">{l}</span>
              {/each}
            </div>
            <span class="tbtn">New instance</span>
          </div>
        {/each}
      </div>

    <!-- ── CHECKPOINTS ── -->
    {:else if activeSection === 'checkpoints'}
      <div class="home-hero" style="padding-bottom: 0">
        <h1 style="font-size: 22px">Saved checkpoints</h1>
        <div class="sub">Rewind any instance to a saved state.</div>
      </div>
      <div style="margin-top: 24px; display: flex; flex-direction: column; gap: 8px;">
        {#each CHECKPOINTS as ck}
          <div style="display: flex; align-items: center; gap: 12px; padding: 14px 16px; background: var(--bg-2); border-radius: var(--r-md); border: 1px solid var(--stroke-0);">
            <div style="width: 10px; height: 10px; border-radius: 2px; transform: rotate(45deg); background: var(--accent); flex-shrink: 0;"></div>
            <div style="flex: 1;">
              <div style="font-size: 13px; color: var(--fg-0);">{ck.label}</div>
              <div style="font-size: 11px; color: var(--fg-3); font-family: var(--font-mono); margin-top: 2px;">{ck.instance} · {ck.branch} · {ck.time}</div>
            </div>
            <button class="btn ghost" style="font-size: 12px;">← Rewind here</button>
          </div>
        {/each}
      </div>

    <!-- ── ACTIVITY ── -->
    {:else if activeSection === 'activity'}
      <div class="home-hero" style="padding-bottom: 0">
        <h1 style="font-size: 22px">Activity</h1>
        <div class="sub">Recent events across all instances.</div>
      </div>
      <div style="margin-top: 24px; display: flex; flex-direction: column; gap: 2px;">
        {#each ACTIVITY as ev}
          <div style="display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-radius: var(--r-sm);">
            <span style="font-size: 11px; font-family: var(--font-mono); color: var(--fg-3); width: 60px; flex-shrink: 0;">{ev.time}</span>
            <Icon name={ev.kind === 'agent' ? 'sparkles' : ev.kind === 'checkpoint' ? 'bookmark' : ev.kind === 'test' ? 'tests' : ev.kind === 'git' ? 'git' : 'file'} size={13}/>
            <span style="font-size: 13px; color: var(--fg-1); flex: 1;">{ev.label}</span>
            <span style="font-size: 11px; font-family: var(--font-mono); color: var(--fg-3);">{ev.instance}</span>
          </div>
        {/each}
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
