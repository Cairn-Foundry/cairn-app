<script lang="ts" context="module">
  /**
   * Left navigation of the home screen: one entry per HomeSection.
   * Dispatches `select` with the section id.
   */
  export type HomeSection = 'projects' | 'integrations' | 'activity' | 'providers' | 'features' | 'agents' | 'skills' | 'mcp' | 'ports' | 'changelog' | 'settings';
</script>

<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n';
  import CairnLogo from '$lib/components/layout/CairnLogo.svelte';
  import UpdateCard from '$lib/components/layout/UpdateCard.svelte';
  import { draggableRegion } from '$lib/utils/window-drag.js';
  import { aiEnabled } from '$lib/stores/settings';

  export let activeSection: HomeSection;

  const dispatch = createEventDispatcher<{ select: HomeSection }>();
</script>

<aside class="home-side" style="padding-top: 36px;" data-tauri-drag-region use:draggableRegion>
  <div class="home-logo">
    <CairnLogo size={26}/>
    <span class="name">Cairn</span>
  </div>

  <div class="section">{t('home.sidebar.workspace')}</div>
  <button class="home-nav-item {activeSection === 'projects'    ? 'active' : ''}" on:click={() => dispatch('select', 'projects')}>
    <Icon name="folder" size={15}/> {t('home.sidebar.projects')}
  </button>
  <button class="home-nav-item {activeSection === 'integrations' ? 'active' : ''}" on:click={() => dispatch('select', 'integrations')}>
    <Icon name="link" size={15}/> {t('home.sidebar.integrations')}
  </button>
  <button class="home-nav-item {activeSection === 'activity'    ? 'active' : ''}" on:click={() => dispatch('select', 'activity')}>
    <Icon name="clock" size={15}/> {t('home.sidebar.activity')}
  </button>

  {#if $aiEnabled}
  <div class="section">{t('home.sidebar.ai')}</div>
  <button class="home-nav-item {activeSection === 'providers'  ? 'active' : ''}" on:click={() => dispatch('select', 'providers')}>
    <Icon name="cloud" size={15}/> {t('home.sidebar.providers')}
  </button>
  <button class="home-nav-item {activeSection === 'features'   ? 'active' : ''}" on:click={() => dispatch('select', 'features')}>
    <Icon name="wand" size={15}/> {t('home.sidebar.features')}
  </button>
  <button class="home-nav-item {activeSection === 'agents'     ? 'active' : ''}" on:click={() => dispatch('select', 'agents')}>
    <Icon name="agent" size={15}/> {t('home.sidebar.agents')}
  </button>
  <button class="home-nav-item {activeSection === 'skills'     ? 'active' : ''}" on:click={() => dispatch('select', 'skills')}>
    <Icon name="book" size={15}/> {t('home.sidebar.skills')}
  </button>
  <button class="home-nav-item {activeSection === 'mcp'        ? 'active' : ''}" on:click={() => dispatch('select', 'mcp')}>
    <Icon name="link" size={15}/> {t('home.sidebar.mcp')}
  </button>
  {/if}
  <div class="section">{t('home.sidebar.system')}</div>
  <button class="home-nav-item {activeSection === 'ports'      ? 'active' : ''}" on:click={() => dispatch('select', 'ports')}>
    <Icon name="server" size={15}/> {t('home.sidebar.ports')}
  </button>

  <div class="section">{t('home.sidebar.app')}</div>
  <button class="home-nav-item {activeSection === 'changelog'  ? 'active' : ''}" on:click={() => dispatch('select', 'changelog')}>
    <Icon name="sparkles" size={15}/> {t('home.sidebar.changelog')}
  </button>
  <button class="home-nav-item {activeSection === 'settings'    ? 'active' : ''}" on:click={() => dispatch('select', 'settings')}>
    <Icon name="settings" size={15}/> {t('home.sidebar.settings')}
  </button>

  <div style="flex: 1"></div>
  <UpdateCard/>
  <div style="padding: 0 8px; font-size: 11px; color: var(--fg-3); font-family: var(--font-mono);">
    v{__APP_VERSION__ ?? 'dev'}
  </div>
</aside>

<style>
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
