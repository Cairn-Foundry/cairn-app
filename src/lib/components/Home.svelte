<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import AddProject from '$lib/components/AddProject.svelte';
  import EditProject from '$lib/components/EditProject.svelte';
  import HomeSidebar, { type HomeSection } from '$lib/components/home/HomeSidebar.svelte';
  import ProjectsSection from '$lib/components/home/ProjectsSection.svelte';
  import SettingsPanel from '$lib/components/home/SettingsPanel.svelte';
  import type { Project } from '$lib/types/project';
  import type { SettingsTab } from '$lib/utils/home/settings-registry';

  const dispatch = createEventDispatcher<{
    openProject: string;
    projectCreated: { id: string };
    sectionShown: void;
  }>();

  export let openSection: HomeSection | null = null;
  export let openSettingsTab: SettingsTab | null = null;

  let activeSection: HomeSection = 'projects';
  let settingsTab: SettingsTab = 'general';

  $: if (openSection !== null) {
    activeSection = openSection;
    if (openSettingsTab !== null) settingsTab = openSettingsTab;
    dispatch('sectionShown');
  }

  let addProjectMode: 'new' | 'open' | 'clone' | null = null;
  let editingProject: Project | null = null;
</script>

<div class="home">
  <HomeSidebar
    {activeSection}
    on:select={(e) => activeSection = e.detail}
  />

  <main class="home-main">
    {#if activeSection === 'projects'}
      <ProjectsSection
        on:openProject={(e) => dispatch('openProject', e.detail)}
        on:addProject={(e) => addProjectMode = e.detail}
        on:editProject={(e) => editingProject = e.detail}
      />

    {:else if activeSection === 'checkpoints'}
      <div class="home-hero" style="padding-bottom: 0">
        <h1 style="font-size: 22px">Saved checkpoints</h1>
        <div class="sub">Rewind any instance to a saved state.</div>
      </div>
      <div style="margin-top: 24px; color: var(--fg-3); font-size: 13px;">
        No checkpoints yet — they will appear here as instances run.
      </div>

    {:else if activeSection === 'activity'}
      <div class="home-hero" style="padding-bottom: 0">
        <h1 style="font-size: 22px">Activity</h1>
        <div class="sub">Recent events across all instances.</div>
      </div>
      <div style="margin-top: 24px; color: var(--fg-3); font-size: 13px;">
        No activity yet — events will appear here as instances run.
      </div>

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

    {:else if activeSection === 'settings'}
      <SettingsPanel bind:settingsTab/>
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
