<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n';
  import type { CustomCommand } from '$lib/services/custom-command-service';
  import { commandRunKey, commandRuns, requestCommandLaunch, stopCommand } from '$lib/stores/command-run';
  import { activeInstance } from '$lib/stores/instance';
  import { activeProject } from '$lib/stores/project';
  import { setActiveTerminal } from '$lib/stores/terminal';
  import { showTool } from '$lib/stores/ui';

  export let commands: CustomCommand[] = [];

  const dispatch = createEventDispatcher<{ close: void; manage: void }>();

  $: runsByCommand = Object.fromEntries(
    Object.values($commandRuns)
      .filter(r => r.projectId === $activeProject?.id && r.instanceId === $activeInstance?.id)
      .map(r => [r.commandId, r]),
  );

  async function activate(command: CustomCommand) {
    if (!$activeProject || !$activeInstance) return;
    const run = runsByCommand[command.id];
    if (run) {
      setActiveTerminal($activeProject.id, $activeInstance.id, run.terminalId);
      showTool('terminal');
    } else {
      await requestCommandLaunch(command, $activeProject, $activeInstance);
    }
    dispatch('close');
  }

  async function stop(command: CustomCommand) {
    if (!$activeProject || !$activeInstance) return;
    await stopCommand(commandRunKey($activeProject.id, $activeInstance.id, command.id));
  }
</script>

<aside class="pinned-panel">
  <div class="pinned-head">
    <div class="pinned-title">
      <span>{t('commands.pinnedTitle')}</span>
      <span class="pinned-sub">{t('commands.pinnedSubtitle')}</span>
    </div>
    <button class="pinned-close" aria-label={t('common.close') as string} on:click={() => dispatch('close')}>
      <Icon name="x" size={12}/>
    </button>
  </div>

  <div class="pinned-body">
    {#each commands as command (command.id)}
      {@const run = runsByCommand[command.id]}
      {@const port = run?.ports[0]?.port}
      <div class="pinned-card" class:running={!!run}>
        <button class="pinned-launch" disabled={!$activeInstance} on:click={() => activate(command)}>
          <span class="pinned-icon" style={command.color ? `color: ${command.color}` : ''}>
            <Icon name={command.icon} size={16}/>
          </span>
          <span class="pinned-text">
            <span class="pinned-name">
              {command.name}
              {#if run}
                <span class="pinned-dot running" title={t('commands.statusRunning') as string}></span>
              {/if}
            </span>
            <span class="pinned-meta mono">{port ? `:${port}` : command.steps.join(' && ')}</span>
          </span>
        </button>
        {#if run}
          <button class="pinned-stop" title={t('commands.stop') as string} on:click={() => stop(command)}>
            <Icon name="stop" size={11}/>
          </button>
        {/if}
      </div>
    {/each}

    {#if commands.length === 0}
      <p class="pinned-empty">{t('commands.pinnedEmpty')}</p>
    {/if}
  </div>

  <button class="pinned-manage" on:click={() => dispatch('manage')}>
    <Icon name="settings" size={12}/> {t('commands.manage')}
  </button>
</aside>

<style>
  .pinned-panel {
    display: flex;
    flex-direction: column;
    width: 240px;
    flex-shrink: 0;
    border-right: 1px solid var(--stroke-0);
    background: var(--bg-1);
    min-height: 0;
  }

  .pinned-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
    padding: 12px 12px 10px;
    border-bottom: 1px solid var(--stroke-0);
  }

  .pinned-title {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 12px;
    font-weight: 500;
    color: var(--fg-0);
  }

  .pinned-sub {
    font-size: 11px;
    font-weight: 400;
    color: var(--fg-4);
    line-height: 1.3;
  }

  .pinned-close {
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
  .pinned-close:hover { background: var(--bg-3); color: var(--fg-0); }

  .pinned-body {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .pinned-card {
    display: flex;
    align-items: stretch;
    gap: 2px;
    background: var(--bg-2);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-sm);
    overflow: hidden;
    transition: background 0.12s, border-color 0.12s;
  }
  .pinned-card:hover { background: var(--bg-3); border-color: var(--stroke-1); }
  .pinned-card.running { border-color: var(--accent); }

  .pinned-launch {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
    min-width: 0;
    padding: 9px 10px;
    background: transparent;
    border: none;
    color: var(--fg-1);
    cursor: pointer;
    text-align: left;
  }
  .pinned-launch:disabled { opacity: 0.4; cursor: default; }

  .pinned-icon {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    flex-shrink: 0;
    border-radius: var(--r-sm);
    background: var(--bg-0);
    color: var(--fg-2);
  }

  .pinned-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }

  .pinned-name {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12.5px;
    color: var(--fg-0);
  }

  .pinned-meta {
    font-size: 11px;
    color: var(--fg-4);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pinned-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .pinned-dot.running { background: var(--accent); animation: pinned-pulse 1.5s ease-in-out infinite; }

  @keyframes pinned-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.35; }
  }

  .pinned-stop {
    display: grid;
    place-items: center;
    width: 28px;
    flex-shrink: 0;
    padding: 0;
    background: transparent;
    border: none;
    border-left: 1px solid var(--stroke-0);
    color: var(--fg-3);
    cursor: pointer;
  }
  .pinned-stop:hover { background: var(--bg-4); color: var(--fg-0); }

  .pinned-empty {
    margin: 0;
    padding: 4px 4px 8px;
    font-size: 11.5px;
    color: var(--fg-4);
    line-height: 1.5;
  }

  .pinned-manage {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 10px 12px;
    background: transparent;
    border: none;
    border-top: 1px solid var(--stroke-0);
    color: var(--fg-3);
    font-size: 12px;
    font-family: var(--font-ui);
    text-align: left;
    cursor: pointer;
  }
  .pinned-manage:hover { color: var(--fg-0); background: var(--bg-2); }
</style>
