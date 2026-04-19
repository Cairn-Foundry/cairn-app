<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import CairnLogo from '$lib/components/layout/CairnLogo.svelte';

  const dispatch = createEventDispatcher<{
    openProject: string;
    createInstance: void;
  }>();

  const PROJECTS = [
    { id: 'fe', name: 'Frontend', color: 'oklch(0.72 0.14 250)', path: '~/code/acme-web', instances: 3, branches: 12, lastOpened: '2m ago' },
    { id: 'be', name: 'Backend', color: 'oklch(0.74 0.14 150)', path: '~/code/acme-api', instances: 2, branches: 8, lastOpened: '14m ago' },
    { id: 'infra', name: 'Infra', color: 'oklch(0.80 0.14 75)', path: '~/code/acme-infra', instances: 0, branches: 4, lastOpened: 'yesterday' },
    { id: 'mobile', name: 'Mobile', color: 'oklch(0.70 0.18 25)', path: '~/code/acme-mobile', instances: 1, branches: 6, lastOpened: '3d ago' },
  ];

  const RECENT_TICKETS = [
    { id: 'FEAT-43', title: 'Wire up OAuth provider switcher UI', source: 'Jira', labels: ['frontend', 'auth'] },
    { id: 'BUG-121', title: 'Invoice PDF missing footer on long orders', source: 'Jira', labels: ['bug', 'billing'] },
    { id: 'CHORE-08', title: 'Upgrade React to 18.3', source: 'GitHub', labels: ['deps'] },
    { id: 'FEAT-47', title: 'Dark mode for onboarding flow', source: 'Linear', labels: ['ui'] },
    { id: 'BUG-124', title: 'Session token not refreshed in background tab', source: 'GitHub', labels: ['bug', 'auth'] },
  ];
</script>

<div class="home">
  <aside class="home-side">
    <div class="home-logo">
      <CairnLogo size={26}/>
      <span class="name">Cairn</span>
    </div>
    <div class="section">Workspace</div>
    <div class="home-nav-item active"><Icon name="folder" size={15}/> Projects</div>
    <div class="home-nav-item"><Icon name="ticket" size={15}/> Recent tickets</div>
    <div class="home-nav-item"><Icon name="bookmark" size={15}/> Saved checkpoints</div>
    <div class="home-nav-item"><Icon name="clock" size={15}/> Activity</div>
    <div class="section">Account</div>
    <div class="home-nav-item"><Icon name="user" size={15}/> Benjamin</div>
    <div class="home-nav-item"><Icon name="settings" size={15}/> Settings</div>
    <div style="flex: 1"/>
    <div style="padding: 10px 8px; font-size: 11px; color: var(--fg-3); font-family: var(--font-mono);">
      v0.3.2 · offline ready
    </div>
  </aside>

  <main class="home-main">
    <div class="home-hero">
      <h1>Good morning, Benjamin.<br/><em>Which cairn are you following today?</em></h1>
      <div class="sub">
        An instance = one ticket, one worktree, one agent session.<br/>
        Pick up where you left off or start a new trail.
      </div>
    </div>

    <div class="home-actions">
      <div class="home-action primary" on:click={() => dispatch('createInstance')} role="button" tabindex="0" on:keydown={(e) => e.key === 'Enter' && dispatch('createInstance')}>
        <div class="aci"><Icon name="plus" size={22}/></div>
        <div class="at">New instance</div>
        <div class="ad">Pick a ticket, spin up a worktree, start the agent.</div>
      </div>
      <div class="home-action">
        <div class="aci"><Icon name="folder" size={22}/></div>
        <div class="at">Open project</div>
        <div class="ad">Import an existing repo as a new project tab.</div>
      </div>
      <div class="home-action">
        <div class="aci"><Icon name="download" size={22}/></div>
        <div class="at">Clone from remote</div>
        <div class="ad">GitHub, GitLab, or any Git URL.</div>
      </div>
    </div>

    <div class="home-section-title">
      <Icon name="folder" size={13}/> Projects <span class="count">— {PROJECTS.length}</span>
    </div>
    <div class="projects-grid">
      {#each PROJECTS as p}
        <div class="project-card" on:click={() => dispatch('openProject', p.id)} role="button" tabindex="0" on:keydown={(e) => e.key === 'Enter' && dispatch('openProject', p.id)}>
          <div class="pname">
            <span class="swatch" style="background: {p.color}"/>
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

    <div class="home-section-title">
      <Icon name="ticket" size={13}/> Recent tickets <span class="count">— jump in</span>
    </div>
    <div class="recent-tickets">
      {#each RECENT_TICKETS as t}
        <div class="ticket-row" on:click={() => dispatch('createInstance')} role="button" tabindex="0" on:keydown={(e) => e.key === 'Enter' && dispatch('createInstance')}>
          <span class="tid">{t.id}</span>
          <span class="tname">{t.title}</span>
          <span class="tsrc">{t.source}</span>
          <span class="tbtn">New instance</span>
        </div>
      {/each}
    </div>
  </main>
</div>
