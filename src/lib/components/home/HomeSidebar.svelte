<script lang="ts" context="module">
  export type HomeSection = 'projects' | 'checkpoints' | 'activity' | 'agents' | 'changelog' | 'account' | 'settings';
</script>

<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n';
  import CairnLogo from '$lib/components/layout/CairnLogo.svelte';
  import UpdateCard from '$lib/components/layout/UpdateCard.svelte';
  import { draggableRegion } from '$lib/utils/window-drag.js';

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
  <button class="home-nav-item {activeSection === 'checkpoints' ? 'active' : ''}" on:click={() => dispatch('select', 'checkpoints')}>
    <Icon name="bookmark" size={15}/> {t('home.sidebar.savedCheckpoints')}
  </button>
  <button class="home-nav-item {activeSection === 'activity'    ? 'active' : ''}" on:click={() => dispatch('select', 'activity')}>
    <Icon name="clock" size={15}/> {t('home.sidebar.activity')}
  </button>
  <button class="home-nav-item {activeSection === 'agents'     ? 'active' : ''}" on:click={() => dispatch('select', 'agents')}>
    <Icon name="agent" size={15}/> {t('home.sidebar.agents')}
  </button>

  <button class="home-nav-item {activeSection === 'changelog'  ? 'active' : ''}" on:click={() => dispatch('select', 'changelog')}>
    <Icon name="sparkles" size={15}/> {t('home.sidebar.changelog')}
  </button>

  <div class="section">{t('home.sections.account')}</div>
  <button class="home-nav-item {activeSection === 'account'     ? 'active' : ''}" on:click={() => dispatch('select', 'account')}>
    <Icon name="user" size={15}/> Benjamin
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
