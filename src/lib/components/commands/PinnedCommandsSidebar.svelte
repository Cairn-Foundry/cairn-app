<script lang="ts">
  /**
   * Always-visible rail of pinned commands, on the right edge of the workspace
   * (mirrors the workflow steps sidebar on the left). Icon-only with a tooltip;
   * a right-click opens a context menu to stop a running command or unpin it.
   */
  import { tick } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n';
  import type { CommandScope, CustomCommand } from '$lib/services/custom-command-service';
  import { commandRunKey, commandRuns, requestCommandLaunch, stopCommand } from '$lib/stores/command-run';
  import { toggleCommandPinned } from '$lib/stores/custom-command';
  import { activeInstance } from '$lib/stores/instance';
  import { activeProject } from '$lib/stores/project';
  import { setActiveTerminal } from '$lib/stores/terminal';
  import { showTool } from '$lib/stores/ui';

  export let globalPinned: CustomCommand[] = [];
  export let projectPinned: CustomCommand[] = [];
  export let position: 'left' | 'right' = 'right';

  let hoveredName: string | null = null;
  let hoveredY = 0;

  function showTooltip(command: CustomCommand, e: MouseEvent) {
    hoveredName = command.name;
    hoveredY = (e.currentTarget as HTMLElement).getBoundingClientRect().top + (e.currentTarget as HTMLElement).offsetHeight / 2;
  }

  function hideTooltip() {
    hoveredName = null;
  }

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
  }

  interface CtxMenu { x: number; y: number; command: CustomCommand; scope: CommandScope }

  let ctxMenu: CtxMenu | null = null;
  let ctxMenuEl: HTMLDivElement | null = null;

  async function openContextMenu(e: MouseEvent, command: CustomCommand, scope: CommandScope) {
    e.preventDefault();
    e.stopPropagation();
    hideTooltip();
    ctxMenu = { x: e.clientX, y: e.clientY, command, scope };
    await tick();
    if (!ctxMenuEl || !ctxMenu) return;
    const { width, height } = ctxMenuEl.getBoundingClientRect();
    const x = Math.min(e.clientX, window.innerWidth - width - 4);
    const y = Math.min(e.clientY, window.innerHeight - height - 4);
    ctxMenu = { ...ctxMenu, x, y };
  }

  function closeContextMenu() {
    ctxMenu = null;
  }

  async function stopFromMenu() {
    if (!ctxMenu || !$activeProject || !$activeInstance) return;
    await stopCommand(commandRunKey($activeProject.id, $activeInstance.id, ctxMenu.command.id));
    closeContextMenu();
  }

  function unpinFromMenu() {
    if (!ctxMenu || !$activeProject) return;
    toggleCommandPinned(ctxMenu.scope, $activeProject.id, ctxMenu.command.id);
    closeContextMenu();
  }
</script>

{#if globalPinned.length > 0 || projectPinned.length > 0}
  <aside class="pinned-sidebar" class:pinned-sidebar-left={position === 'left'}>
    <div class="pinned-list">
      {#each globalPinned as command (command.id)}
        {@const run = runsByCommand[command.id]}
        <button
          class="pinned-item {run ? 'running' : ''}"
          disabled={!$activeInstance}
          aria-label={command.name}
          on:click={() => activate(command)}
          on:contextmenu={(e) => openContextMenu(e, command, 'global')}
          on:mouseenter={(e) => showTooltip(command, e)}
          on:mouseleave={hideTooltip}
        >
          <span class="icon" style={command.color ? `color: ${command.color}` : ''}>
            <Icon name={command.icon} size={18}/>
          </span>
          {#if run}
            <span class="running-dot" title={t('commands.statusRunning') as string}></span>
          {/if}
        </button>
      {/each}

      {#if globalPinned.length > 0 && projectPinned.length > 0}
        <div class="divider"></div>
      {/if}

      {#each projectPinned as command (command.id)}
        {@const run = runsByCommand[command.id]}
        <button
          class="pinned-item {run ? 'running' : ''}"
          disabled={!$activeInstance}
          aria-label={command.name}
          on:click={() => activate(command)}
          on:contextmenu={(e) => openContextMenu(e, command, 'project')}
          on:mouseenter={(e) => showTooltip(command, e)}
          on:mouseleave={hideTooltip}
        >
          <span class="icon" style={command.color ? `color: ${command.color}` : ''}>
            <Icon name={command.icon} size={18}/>
          </span>
          {#if run}
            <span class="running-dot" title={t('commands.statusRunning') as string}></span>
          {/if}
        </button>
      {/each}
    </div>
  </aside>

  {#if hoveredName && !ctxMenu}
    <div class="pinned-tooltip" class:pinned-tooltip-left={position === 'left'} style="top: {hoveredY}px">{hoveredName}</div>
  {/if}

  {#if ctxMenu}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="ctx-backdrop" on:mousedown={closeContextMenu}></div>
    <div class="ctx-menu" bind:this={ctxMenuEl} style="left: {ctxMenu.x}px; top: {ctxMenu.y}px">
      {#if runsByCommand[ctxMenu.command.id]}
        <button type="button" class="ctx-item" on:click={stopFromMenu}>
          <Icon name="stop" size={13}/> {t('commands.stop')}
        </button>
        <div class="ctx-sep"></div>
      {/if}
      <button type="button" class="ctx-item" on:click={unpinFromMenu}>
        <Icon name="x" size={13}/> {t('commands.unpin')}
      </button>
    </div>
  {/if}
{/if}

<style>
  .pinned-sidebar {
    width: 52px;
    flex-shrink: 0;
    background: var(--bg-1);
    border-left: 1px solid var(--stroke-0);
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .pinned-sidebar-left {
    border-left: none;
    border-right: 1px solid var(--stroke-0);
  }

  .pinned-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 8px 0;
  }

  .pinned-item {
    position: relative;
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    flex-shrink: 0;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: var(--r-md);
    color: var(--fg-2);
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .pinned-item:hover { background: var(--bg-2); color: var(--fg-0); }
  .pinned-item:disabled { opacity: 0.3; cursor: default; pointer-events: none; }
  .pinned-item.running { color: var(--fg-0); background: var(--bg-3); }

  .running-dot {
    position: absolute;
    top: 3px;
    right: 3px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 2px var(--bg-1);
    animation: pinned-sidebar-pulse 1.5s ease-in-out infinite;
  }
  @keyframes pinned-sidebar-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.35; }
  }

  .divider {
    width: 24px;
    height: 1px;
    background: var(--stroke-0);
    margin: 4px 0;
    flex-shrink: 0;
  }

  .pinned-tooltip {
    position: fixed;
    right: 60px;
    transform: translateY(-50%);
    background: var(--bg-3);
    border: 1px solid var(--stroke-1);
    color: var(--fg-1);
    font-family: var(--font-ui);
    font-size: 11px;
    white-space: nowrap;
    padding: 3px 7px;
    border-radius: 4px;
    pointer-events: none;
    z-index: 200;
  }
  .pinned-tooltip-left {
    right: auto;
    left: 60px;
  }

  .ctx-backdrop {
    position: fixed;
    inset: 0;
    z-index: 9998;
  }
  .ctx-menu {
    position: fixed;
    z-index: 9999;
    background: var(--bg-2);
    border: 1px solid var(--stroke-1);
    border-radius: 6px;
    padding: 4px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4);
    min-width: 148px;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .ctx-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 10px;
    border: none;
    background: none;
    border-radius: 4px;
    cursor: pointer;
    color: var(--fg-1);
    font-size: 12.5px;
    font-family: var(--font-ui);
    text-align: left;
    width: 100%;
  }
  .ctx-item:hover { background: var(--bg-4); color: var(--fg-0); }
  .ctx-sep { height: 1px; background: var(--stroke-0); margin: 3px 0; }
</style>
