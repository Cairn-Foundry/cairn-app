<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts" context="module">
  /**
   * Left navigation of the home screen: one entry per HomeSection.
   * Dispatches `select` with the section id.
   */
  export type HomeSection = 'projects' | 'tickets' | 'integrations' | 'activity' | 'providers' | 'features' | 'agents' | 'skills' | 'mcp' | 'ports' | 'changelog' | 'settings';
</script>

<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n';
  import CairnLogo from '$lib/components/layout/CairnLogo.svelte';
  import UpdateCard from '$lib/components/layout/UpdateCard.svelte';
  import { draggableRegion } from '$lib/utils/window-drag.js';
  import { aiEnabled } from '$lib/stores/settings';
  import { channel } from '$lib/stores/channel';
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { ISSUES_URL } from '$lib/utils/links';

  export let activeSection: HomeSection;

  const dispatch = createEventDispatcher<{ select: HomeSection }>();
</script>

<aside class="home-side" style="padding-top: 36px;" data-tauri-drag-region use:draggableRegion>
  <div class="home-logo">
    <CairnLogo size={26}/>
    <span class="name">Cairn Foundry<sup class="tm">TM</sup></span>
  </div>

  <div class="section">{t('home.sidebar.workspace')}</div>
  <button class="home-nav-item {activeSection === 'projects'    ? 'active' : ''}" on:click={() => dispatch('select', 'projects')}>
    <Icon name="folder" size={15}/> {t('home.sidebar.projects')}
  </button>
  <button class="home-nav-item {activeSection === 'tickets'     ? 'active' : ''}" on:click={() => dispatch('select', 'tickets')}>
    <Icon name="ticket" size={15}/> {t('home.sidebar.tickets')}
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
  <div class="version">
    v{__APP_VERSION__ ?? 'dev'}{#if $channel.label}<span class="channel">{$channel.label}</span>{/if}
  </div>
  <button class="report" on:click={() => openUrl(ISSUES_URL)}>
    <Icon name="github" size={13}/> {t('welcome.reportBug')}
  </button>
</aside>

<style>
  .version {
    padding: 0 8px 6px;
    font-size: 11px;
    color: var(--fg-3);
    font-family: var(--font-mono);
  }

  /* Two builds run side by side, and only this tells them apart on macOS,
     where the window title is hidden. */
  .channel {
    margin-left: 6px;
    padding: 1px 5px;
    border-radius: 3px;
    background: var(--bg-2);
    color: var(--fg-2);
    text-transform: uppercase;
    font-size: 9.5px;
    letter-spacing: 0.04em;
  }

  .report {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 7px 8px;
    background: none;
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-sm);
    cursor: pointer;
    font-size: 12px;
    color: var(--fg-2);
    font-family: var(--font-ui);
  }
  .report:hover { background: var(--bg-4); color: var(--fg-0); }

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
