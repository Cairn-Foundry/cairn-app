<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n';

  export let activeTool: string | null = null;

  const dispatch = createEventDispatcher<{ select: string; close: void }>();

  const TOOLS = [
    { id: 'terminal', icon: 'terminal', name: 'tools.terminalName', description: 'tools.terminalDescription' },
    { id: 'commands', icon: 'command', name: 'tools.commandsName', description: 'tools.commandsDescription' },
    { id: 'env', icon: 'key', name: 'tools.envName', description: 'tools.envDescription' },
  ] as const;
</script>

<aside class="tools-panel">
  <div class="tools-head">
    <div class="tools-title">
      <span>{t('tools.title')}</span>
      <span class="tools-sub">{t('tools.subtitle')}</span>
    </div>
    <button class="tools-close" aria-label={t('tools.close') as string} on:click={() => dispatch('close')}>
      <Icon name="x" size={12}/>
    </button>
  </div>

  <div class="tools-body">
    {#each TOOLS as tool}
      <button
        class="tool-card {activeTool === tool.id ? 'active' : ''}"
        on:click={() => dispatch('select', tool.id)}
      >
        <span class="tool-icon"><Icon name={tool.icon} size={18}/></span>
        <span class="tool-text">
          <span class="tool-name">{t(tool.name)}</span>
          <span class="tool-description">{t(tool.description)}</span>
        </span>
      </button>
    {/each}
  </div>
</aside>

<style>
  .tools-panel {
    display: flex;
    flex-direction: column;
    width: 240px;
    flex-shrink: 0;
    border-right: 1px solid var(--stroke-0);
    background: var(--bg-1);
    min-height: 0;
  }

  .tools-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
    padding: 12px 12px 10px;
    border-bottom: 1px solid var(--stroke-0);
  }

  .tools-title {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 12px;
    font-weight: 500;
    color: var(--fg-0);
  }

  .tools-sub {
    font-size: 11px;
    font-weight: 400;
    color: var(--fg-4);
    line-height: 1.3;
  }

  .tools-close {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    flex-shrink: 0;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: var(--r-xs);
    color: var(--fg-3);
    cursor: pointer;
  }
  .tools-close:hover { background: var(--bg-3); color: var(--fg-0); }

  .tools-body {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .tool-card {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    width: 100%;
    padding: 10px;
    background: var(--bg-2);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-sm);
    color: var(--fg-1);
    cursor: pointer;
    text-align: left;
    transition: background 0.12s, border-color 0.12s, color 0.12s;
  }
  .tool-card:hover { background: var(--bg-3); border-color: var(--stroke-1); color: var(--fg-0); }
  .tool-card.active { background: var(--accent-weak); border-color: var(--accent); color: var(--fg-0); }

  .tool-icon {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    flex-shrink: 0;
    border-radius: var(--r-sm);
    background: var(--bg-0);
    color: var(--fg-2);
  }
  .tool-card.active .tool-icon { color: var(--accent); }

  .tool-text {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .tool-name { font-size: 12.5px; }

  .tool-description {
    font-size: 11px;
    color: var(--fg-4);
    line-height: 1.4;
  }
</style>
