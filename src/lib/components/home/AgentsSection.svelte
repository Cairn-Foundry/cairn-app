<script lang="ts">
  import { t } from '$lib/i18n';
  import ProvidersTab from './agents/ProvidersTab.svelte';
  import AgentsTab from './agents/AgentsTab.svelte';

  type AgentsPageTab = 'providers' | 'agents';
  let activeTab: AgentsPageTab = 'providers';
</script>

<div class="agents-page">
  <nav class="agents-tabs" aria-label="Agents page tabs">
    <button
      class="tab-btn {activeTab === 'providers' ? 'active' : ''}"
      on:click={() => activeTab = 'providers'}
    >
      {t('home.agents.tabs.providers')}
    </button>
    <button
      class="tab-btn {activeTab === 'agents' ? 'active' : ''}"
      on:click={() => activeTab = 'agents'}
    >
      {t('home.agents.tabs.agents')}
    </button>
  </nav>

  <div class="agents-tab-content">
    {#if activeTab === 'providers'}
      <ProvidersTab />
    {:else}
      <AgentsTab />
    {/if}
  </div>
</div>

<style>
  .agents-page {
    display: flex;
    flex-direction: column;
    gap: 0;
    width: 100%;
  }

  .agents-tabs {
    display: flex;
    gap: 0;
    border-bottom: 1px solid var(--stroke-0);
    margin-bottom: 24px;
  }

  .tab-btn {
    padding: 8px 16px;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    font-size: 13px;
    font-family: var(--font-ui);
    color: var(--fg-3);
    cursor: pointer;
    transition: color .12s, border-color .12s;
    margin-bottom: -1px;
  }
  .tab-btn:hover { color: var(--fg-1); }
  .tab-btn.active {
    color: var(--fg-0);
    border-bottom-color: var(--accent);
    font-weight: 500;
  }

  .agents-tab-content {
    width: 100%;
  }
</style>
