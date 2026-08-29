<script lang="ts">
  /**
   * Home screen shell: the sidebar plus whichever section is active. Section and
   * settings tab are echoed up through `sectionChange` so they can be persisted,
   * and forced back down through `openSection` / `openSettingsTab` on restore.
   */
  import { createEventDispatcher, onMount } from 'svelte';
  import { t } from '$lib/i18n';
  import { withViewTransition } from '$lib/utils/view-transition';
  import AddProject from '$lib/components/AddProject.svelte';
  import EditProject from '$lib/components/EditProject.svelte';
  import HomeSidebar, { type HomeSection } from '$lib/components/home/HomeSidebar.svelte';
  import ProjectsSection from '$lib/components/home/ProjectsSection.svelte';
  import SettingsPanel from '$lib/components/home/SettingsPanel.svelte';
  import type { Project } from '$lib/types/project';
  import AgentsSection from '$lib/components/home/agents/AgentsSection.svelte';
  import ProvidersTab from '$lib/components/home/agents/ProvidersTab.svelte';
  import FeaturesSection from '$lib/components/home/features/FeaturesSection.svelte';
  import ChangelogSection from '$lib/components/home/ChangelogSection.svelte';
  import UsageSection from '$lib/components/home/usage/UsageSection.svelte';
  import PortsSection from '$lib/components/home/PortsSection.svelte';
  import SkillsSection from '$lib/components/home/skills/SkillsSection.svelte';
  import McpSection from '$lib/components/home/mcp/McpSection.svelte';
  import IntegrationsSection from '$lib/components/home/IntegrationsSection.svelte';
  import type { SettingsTab } from '$lib/utils/home/settings-registry';

  const dispatch = createEventDispatcher<{
    openProject: string;
    closeProject: string;
    projectCreated: { id: string };
    sectionShown: void;
    addProjectShown: void;
    sectionChange: { section: string; settingsTab: string };
  }>();

  export let openSection: HomeSection | null = null;
  export let openSettingsTab: string | null = null;
  export let openAddProjectMode: 'new' | 'open' | 'clone' | null = null;
  export let openAddProjectPath = '';
  export let openAddProjectCloneUrl = '';

  let activeSection: HomeSection = 'projects';
  let settingsTab: SettingsTab = 'general';
  let mounted = false;

  onMount(() => { mounted = true; });

  function showSection(section: HomeSection) {
    withViewTransition(() => { activeSection = section; });
  }

  $: if (mounted) dispatch('sectionChange', { section: activeSection, settingsTab });

  $: if (openSection !== null) {
    activeSection = openSection;
    if (openSettingsTab !== null) settingsTab = openSettingsTab as SettingsTab;
    dispatch('sectionShown');
  }

  let addProjectMode: 'new' | 'open' | 'clone' | null = null;
  let addProjectPath = '';
  let addProjectCloneUrl = '';
  let editingProject: Project | null = null;

  $: if (openAddProjectMode !== null) {
    activeSection = 'projects';
    addProjectMode = openAddProjectMode;
    addProjectPath = openAddProjectPath;
    addProjectCloneUrl = openAddProjectCloneUrl;
    dispatch('addProjectShown');
  }
</script>

<div class="home">
  <HomeSidebar
    {activeSection}
    on:select={(e) => showSection(e.detail)}
  />

  <main class="home-main">
    {#if activeSection === 'projects'}
      <ProjectsSection
        on:openProject={(e) => dispatch('openProject', e.detail)}
        on:closeProject={(e) => dispatch('closeProject', e.detail)}
        on:addProject={(e) => { addProjectMode = e.detail; addProjectPath = ''; addProjectCloneUrl = ''; }}
        on:editProject={(e) => editingProject = e.detail}
      />

    {:else if activeSection === 'integrations'}
      <div class="home-hero" style="padding-bottom: 0">
        <h1 style="font-size: 22px">{t('integrations.title')}</h1>
        <div class="sub">{t('integrations.subtitle')}</div>
      </div>
      <div style="margin-top: 24px;">
        <IntegrationsSection />
      </div>

    {:else if activeSection === 'activity'}
      <div class="home-hero" style="padding-bottom: 0">
        <h1 style="font-size: 22px">{t('home.sections.activity')}</h1>
        <div class="sub">{t('home.sections.activityDesc')}</div>
      </div>
      <div style="margin-top: 24px; color: var(--fg-3); font-size: 13px;">
        {t('home.sections.activityEmpty')}
      </div>

    {:else if activeSection === 'providers'}
      <div class="home-hero" style="padding-bottom: 0">
        <h1 style="font-size: 22px">{t('home.providers.title')}</h1>
        <div class="sub">{t('home.providers.desc')}</div>
      </div>
      <div style="margin-top: 24px;">
        <ProvidersTab />
      </div>

    {:else if activeSection === 'features'}
      <div class="home-hero" style="padding-bottom: 0">
        <h1 style="font-size: 22px">{t('home.features.title')}</h1>
        <div class="sub">{t('home.features.desc')}</div>
      </div>
      <div style="margin-top: 24px;">
        <FeaturesSection />
      </div>

    {:else if activeSection === 'agents'}
      <div class="home-hero" style="padding-bottom: 0">
        <h1 style="font-size: 22px">{t('home.agents.title')}</h1>
        <div class="sub">{t('home.agents.desc')}</div>
      </div>
      <div style="margin-top: 24px;">
        <AgentsSection />
      </div>

    {:else if activeSection === 'skills'}
      <div class="home-hero" style="padding-bottom: 0">
        <h1 style="font-size: 22px">{t('skills.title')}</h1>
        <div class="sub">{t('skills.desc')}</div>
      </div>
      <div style="margin-top: 24px;">
        <SkillsSection />
      </div>

    {:else if activeSection === 'mcp'}
      <div class="home-hero" style="padding-bottom: 0">
        <h1 style="font-size: 22px">{t('mcp.title')}</h1>
        <div class="sub">{t('mcp.desc')}</div>
      </div>
      <div style="margin-top: 24px;">
        <McpSection />
      </div>

    {:else if activeSection === 'usage'}
      <div class="home-hero" style="padding-bottom: 0">
        <h1 style="font-size: 22px">{t('home.usage.title')}</h1>
        <div class="sub">{t('home.usage.desc')}</div>
      </div>
      <div style="margin-top: 24px;">
        <UsageSection />
      </div>

    {:else if activeSection === 'ports'}
      <div class="home-hero" style="padding-bottom: 0">
        <h1 style="font-size: 22px">{t('home.ports.title')}</h1>
        <div class="sub">{t('home.ports.desc')}</div>
      </div>
      <div style="margin-top: 24px;">
        <PortsSection />
      </div>

    {:else if activeSection === 'changelog'}
      <div class="home-hero" style="padding-bottom: 0">
        <h1 style="font-size: 22px">{t('home.changelog.title')}</h1>
      </div>
      <div style="margin-top: 24px;">
        <ChangelogSection />
      </div>

    {:else if activeSection === 'settings'}
      <SettingsPanel bind:settingsTab on:openSection={(e) => showSection(e.detail as HomeSection)}/>
    {/if}
  </main>
</div>

{#if addProjectMode}
  <AddProject
    mode={addProjectMode}
    initialPath={addProjectPath}
    initialCloneUrl={addProjectCloneUrl}
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
