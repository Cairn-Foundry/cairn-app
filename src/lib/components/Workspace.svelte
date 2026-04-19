<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { activeStep } from '$lib/stores/ui.js';
  import Icon from '$lib/components/Icon.svelte';
  import CairnLogo from '$lib/components/layout/CairnLogo.svelte';
  import Timeline from '$lib/components/layout/Timeline.svelte';
  import FilesView from '$lib/components/files/FilesView.svelte';
  import AgentView from '$lib/components/agent/AgentView.svelte';
  import ReviewView from '$lib/components/review/ReviewView.svelte';
  import TestsView from '$lib/components/tests/TestsView.svelte';
  import GitView from '$lib/components/git/GitView.svelte';
  import CiCdView from '$lib/components/cicd/CiCdView.svelte';

  export let openProjects: { id: string; name: string; color: string }[];
  export let activeProjectId: string;

  const dispatch = createEventDispatcher<{
    projectChange: string;
    closeProject: string;
    addProject: void;
    goHome: void;
    createInstance: void;
  }>();

  const STEPS = [
    { id: 'files',  num: '00', label: 'Files',  icon: 'folder' },
    { id: 'agent',  num: '01', label: 'Agent',  icon: 'agent'  },
    { id: 'review', num: '02', label: 'Review', icon: 'review' },
    { id: 'tests',  num: '03', label: 'Tests',  icon: 'tests'  },
    { id: 'git',    num: '04', label: 'Git',    icon: 'git'    },
    { id: 'cicd',   num: '05', label: 'CI/CD',  icon: 'ci'     },
  ];

  const instance = {
    ticketId: 'FEAT-42',
    title: 'Add TOTP authentication',
    branch: 'feat/totp-auth',
    baseBranch: 'main',
    files: 3,
  };

  const doneSteps = new Set<string>();
</script>

<div class="workspace">
  <!-- Project tabs -->
  <div class="tabs-row">
    <div class="brand-chip">
      <button class="icon-btn" on:click={() => dispatch('goHome')} title="Home"><CairnLogo size={18}/></button>
      <span>Cairn</span>
    </div>
    <div class="tab-divider"></div>
    {#each openProjects as p}
      <div
        class="project-tab {p.id === activeProjectId ? 'active' : ''}"
        on:click={() => dispatch('projectChange', p.id)}
        role="tab"
        tabindex="0"
        on:keydown={(e) => e.key === 'Enter' && dispatch('projectChange', p.id)}
      >
        <span class="dot" style={p.id === activeProjectId ? `background: ${p.color}` : ''}></span>
        <span>{p.name}</span>
        <button class="close" on:click|stopPropagation={() => dispatch('closeProject', p.id)}>
          <Icon name="x" size={11}/>
        </button>
      </div>
    {/each}
    <button class="tab-add" on:click={() => dispatch('addProject')}>
      <Icon name="plus" size={12}/> Project
    </button>
    <div class="spacer"></div>
    <button class="icon-btn" aria-label="Search"><Icon name="search" size={14}/></button>
    <button class="icon-btn" aria-label="Settings"><Icon name="settings" size={14}/></button>
  </div>

  <!-- Instance header -->
  <div class="instance-header">
    <button class="instance-switcher">
      <Icon name="ticket" size={12}/>
      <span class="mono">{instance.ticketId}</span>
      <span class="count">· 1/3</span>
      <Icon name="chev-d" size={11}/>
    </button>

    <div class="instance-title">
      <span class="instance-dot"></span>
      <span class="ticket-id">{instance.ticketId}</span>
      <span class="ticket-name">{instance.title}</span>
    </div>

    <div class="branch-info">
      <Icon name="branch" size={11}/>
      <span>{instance.baseBranch}</span>
      <span class="arrow">→</span>
      <span class="target">{instance.branch}</span>
      <span class="mod">{instance.files} files modified</span>
    </div>

    <div class="instance-actions">
      <button class="btn ghost"><Icon name="bookmark" size={13}/> Checkpoint</button>
      <button class="btn"><Icon name="pause" size={13}/> Pause agent</button>
      <button class="btn primary"><Icon name="check" size={13}/> Finalize instance</button>
    </div>
  </div>

  <!-- Content -->
  <div class="content-row">
    <aside class="sidebar">
      {#each STEPS as s}
        <button
          class="step {$activeStep === s.id ? 'active' : ''} {doneSteps.has(s.id) ? 'done' : ''}"
          on:click={() => activeStep.set(s.id as any)}
        >
          <span class="num">{s.num}</span>
          <span class="icon"><Icon name={s.icon} size={20}/></span>
          <span class="label">{s.label}</span>
          {#if doneSteps.has(s.id)}
            <span class="check"><Icon name="check" size={11}/></span>
          {/if}
        </button>
      {/each}
      <div class="divider"></div>
      <div class="spacer"></div>
      <button class="step" aria-label="Terminal">
        <span class="icon"><Icon name="terminal" size={18}/></span>
        <span class="label">Term</span>
      </button>
    </aside>

    <main class="main">
      {#if $activeStep === 'files'}
        <FilesView/>
      {:else if $activeStep === 'agent'}
        <AgentView/>
      {:else if $activeStep === 'review'}
        <ReviewView/>
      {:else if $activeStep === 'tests'}
        <TestsView/>
      {:else if $activeStep === 'git'}
        <GitView/>
      {:else if $activeStep === 'cicd'}
        <CiCdView/>
      {/if}

      <Timeline/>
    </main>
  </div>
</div>
