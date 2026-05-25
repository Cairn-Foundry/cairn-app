<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import { t } from '$lib/i18n';
  import AddProject from '$lib/components/AddProject.svelte';
  import EditProject from '$lib/components/EditProject.svelte';
  import HomeSidebar, { type HomeSection } from '$lib/components/home/HomeSidebar.svelte';
  import ProjectsSection from '$lib/components/home/ProjectsSection.svelte';
  import SettingsPanel from '$lib/components/home/SettingsPanel.svelte';
  import type { Project } from '$lib/types/project';
  import AgentsSection from '$lib/components/home/AgentsSection.svelte';
  import type { SettingsTab } from '$lib/utils/home/settings-registry';

  const dispatch = createEventDispatcher<{
    openProject: string;
    projectCreated: { id: string };
    sectionShown: void;
    sectionChange: { section: string; settingsTab: string };
  }>();

  export let openSection: HomeSection | null = null;
  export let openSettingsTab: string | null = null;

  let activeSection: HomeSection = 'projects';
  let settingsTab: SettingsTab = 'general';
  let mounted = false;

  onMount(() => { mounted = true; });

  $: if (mounted) dispatch('sectionChange', { section: activeSection, settingsTab });

  $: if (openSection !== null) {
    activeSection = openSection;
    if (openSettingsTab !== null) settingsTab = openSettingsTab as SettingsTab;
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
        <h1 style="font-size: 22px">{t('home.sections.checkpoints')}</h1>
        <div class="sub">{t('home.sections.checkpointsDesc')}</div>
      </div>
      <div style="margin-top: 24px; color: var(--fg-3); font-size: 13px;">
        {t('home.sections.checkpointsEmpty')}
      </div>

    {:else if activeSection === 'activity'}
      <div class="home-hero" style="padding-bottom: 0">
        <h1 style="font-size: 22px">{t('home.sections.activity')}</h1>
        <div class="sub">{t('home.sections.activityDesc')}</div>
      </div>
      <div style="margin-top: 24px; color: var(--fg-3); font-size: 13px;">
        {t('home.sections.activityEmpty')}
      </div>

    {:else if activeSection === 'agents'}
      <div class="home-hero" style="padding-bottom: 0">
        <h1 style="font-size: 22px">{t('home.agents.title')}</h1>
        <div class="sub">{t('home.agents.desc')}</div>
      </div>
      <div style="margin-top: 24px;">
        <AgentsSection />
      </div>

    {:else if activeSection === 'account'}
      <div class="home-hero" style="padding-bottom: 0">
        <h1 style="font-size: 22px">{t('home.sections.account')}</h1>
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
          {t('home.sections.aiProvider')} · <span style="color: var(--fg-1)">{t('home.sections.aiProviderValue')}</span>
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
