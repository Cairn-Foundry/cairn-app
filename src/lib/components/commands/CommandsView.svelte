<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';
  import CommandEditor from '$lib/components/commands/CommandEditor.svelte';
  import CommandImport from '$lib/components/commands/CommandImport.svelte';
  import { t } from '$lib/i18n';
  import type { CommandScope, CustomCommand } from '$lib/services/custom-command-service';
  import { activeInstance } from '$lib/stores/instance';
  import { activeProject } from '$lib/stores/project';
  import { commandRunKey, commandRuns, requestCommandLaunch, stopCommand } from '$lib/stores/command-run';
  import {
    addCommand,
    addCommands,
    duplicateCommand,
    globalCommands,
    loadCommands,
    newCommand,
    projectCommands,
    removeCommand,
    reorderCommand,
    toggleCommandPinned,
    updateCommand,
  } from '$lib/stores/custom-command';
  import { computeTabInsertIndex } from '$lib/utils/files/files-tab-drag';

  let editing: { scope: CommandScope; command: CustomCommand; isNew: boolean } | null = null;
  let importing = false;

  let bodyEls: Partial<Record<CommandScope, HTMLDivElement>> = {};
  let drag: { scope: CommandScope; index: number } | null = null;
  let dropAt: { scope: CommandScope; index: number } | null = null;
  let dragActive = false;
  let didDrag = false;
  let dragStartX = 0;
  let dragStartY = 0;

  const DRAG_THRESHOLD = 6;

  $: projectId = $activeProject?.id ?? null;
  $: ownCommands = projectId ? ($projectCommands[projectId] ?? []) : [];
  $: sections = [
    { scope: 'global' as CommandScope, label: t('commands.globalSection'), list: $globalCommands, empty: t('commands.globalEmpty') },
    { scope: 'project' as CommandScope, label: t('commands.projectSection'), list: ownCommands, empty: t('commands.projectEmpty') },
  ];

  $: if (projectId) void loadCommands(projectId);

  $: runsByCommand = Object.fromEntries(
    Object.values($commandRuns)
      .filter(r => r.projectId === projectId && r.instanceId === $activeInstance?.id)
      .map(r => [r.commandId, r]),
  );

  function startNew(scope: CommandScope) {
    editing = { scope, command: newCommand(''), isNew: true };
  }

  function startEdit(scope: CommandScope, command: CustomCommand) {
    editing = { scope, command, isNew: false };
  }

  function saveEdited(command: CustomCommand) {
    if (!editing || !projectId) return;
    if (editing.isNew) addCommand(editing.scope, projectId, command);
    else updateCommand(editing.scope, projectId, command);
    editing = null;
  }

  function importCommands(commands: CustomCommand[]) {
    if (projectId) addCommands('project', projectId, commands);
    importing = false;
  }

  async function launch(command: CustomCommand) {
    if (!$activeProject || !$activeInstance) return;
    await requestCommandLaunch(command, $activeProject, $activeInstance);
  }

  async function stop(command: CustomCommand) {
    if (!projectId || !$activeInstance) return;
    await stopCommand(commandRunKey(projectId, $activeInstance.id, command.id));
  }

  function dragPointerDown(e: PointerEvent, scope: CommandScope, index: number) {
    if ((e.target as Element).closest('button')) return;
    e.preventDefault();
    drag = { scope, index };
    dropAt = { scope, index };
    dragActive = false;
    didDrag = false;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function dragPointerMove(e: PointerEvent) {
    if (!drag) return;
    if (!dragActive) {
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
      dragActive = true;
      document.body.classList.add('dragging');
    }
    didDrag = true;
    dropAt = {
      scope: drag.scope,
      index: computeTabInsertIndex(bodyEls[drag.scope] ?? null, e.clientY, { selector: '.cmd-row', axis: 'y' }),
    };
  }

  function dragPointerUp() {
    if (drag && dropAt && dragActive && projectId) {
      reorderCommand(drag.scope, projectId, drag.index, dropAt.index);
    }
    drag = null;
    dropAt = null;
    dragActive = false;
    document.body.classList.remove('dragging');
  }

  $: dropIndicator =
    dragActive && drag && dropAt && dropAt.scope === drag.scope &&
    dropAt.index !== drag.index && dropAt.index !== drag.index + 1
      ? dropAt
      : null;
</script>

<div class="cmd-view">
  <div class="cmd-head">
    <div class="cmd-head-text">
      <span class="cmd-title">{t('commands.title')}</span>
      <span class="cmd-sub">{t('commands.subtitle')}</span>
    </div>
    <div class="cmd-head-actions">
      <button class="btn ghost" disabled={!$activeInstance} on:click={() => importing = true}>
        <Icon name="download" size={13}/> {t('commands.import')}
      </button>
      <button class="btn primary" disabled={!projectId} on:click={() => startNew('project')}>
        <Icon name="plus" size={13}/> {t('commands.new')}
      </button>
    </div>
  </div>

  <div class="cmd-body">
    {#each sections as section}
      <div class="cmd-section">
        <div class="cmd-section-head">
          <span>{section.label}</span>
          <button class="cmd-section-add" title={t('commands.new') as string} disabled={!projectId} on:click={() => startNew(section.scope)}>
            <Icon name="plus" size={13}/>
          </button>
        </div>
        <div class="cmd-list" bind:this={bodyEls[section.scope]}>
          {#each section.list as command, i (command.id)}
            {#if dropIndicator?.scope === section.scope && dropIndicator.index === i}<div class="cmd-drop"></div>{/if}
            {@const run = runsByCommand[command.id]}
            <div
              class="cmd-row {dragActive && drag?.scope === section.scope && drag.index === i ? 'dragging' : ''}"
              role="button"
              tabindex="0"
              on:pointerdown={(e) => dragPointerDown(e, section.scope, i)}
              on:pointermove={dragPointerMove}
              on:pointerup={dragPointerUp}
              on:click={() => { if (!didDrag) startEdit(section.scope, command); didDrag = false; }}
              on:keydown={(e) => { if (e.key === 'Enter') startEdit(section.scope, command); }}
            >
              <span class="cmd-icon" style={command.color ? `color: ${command.color}` : ''}>
                <Icon name={command.icon} size={16}/>
              </span>
              <span class="cmd-text">
                <span class="cmd-name">
                  {command.name}
                  {#if run}
                    <span class="cmd-dot running" title={t('commands.statusRunning') as string}></span>
                  {/if}
                  {#if command.pinned}
                    <Icon name="pin" size={11}/>
                  {/if}
                </span>
                <span class="cmd-steps mono selectable">{command.steps.join(' && ')}</span>
              </span>
              <span class="cmd-actions">
                {#if run}
                  <button class="cmd-action" title={t('commands.stop') as string} on:click|stopPropagation={() => stop(command)}>
                    <Icon name="stop" size={12}/>
                  </button>
                {:else}
                  <button class="cmd-action" title={t('commands.run') as string} disabled={!$activeInstance} on:click|stopPropagation={() => launch(command)}>
                    <Icon name="play" size={12}/>
                  </button>
                {/if}
                <button
                  class="cmd-action {command.pinned ? 'pinned' : ''}"
                  title={(command.pinned ? t('commands.unpin') : t('commands.pin')) as string}
                  on:click|stopPropagation={() => projectId && toggleCommandPinned(section.scope, projectId, command.id)}
                >
                  <Icon name={command.pinned ? 'pin-off' : 'pin'} size={12}/>
                </button>
                <button class="cmd-action" title={t('common.edit') as string} on:click|stopPropagation={() => startEdit(section.scope, command)}>
                  <Icon name="edit" size={12}/>
                </button>
                <button class="cmd-action" title={t('common.duplicate') as string} on:click|stopPropagation={() => projectId && duplicateCommand(section.scope, projectId, command.id, `${command.name} 2`)}>
                  <Icon name="copy" size={12}/>
                </button>
                <button class="cmd-action danger" title={t('common.delete') as string} on:click|stopPropagation={() => projectId && removeCommand(section.scope, projectId, command.id)}>
                  <Icon name="trash" size={12}/>
                </button>
              </span>
            </div>
          {/each}
          {#if dropIndicator?.scope === section.scope && dropIndicator.index === section.list.length}<div class="cmd-drop"></div>{/if}
          {#if section.list.length === 0}
            <p class="cmd-empty">{section.empty}</p>
          {/if}
        </div>
      </div>
    {/each}
  </div>
</div>

{#if editing}
  <CommandEditor
    command={editing.command}
    on:save={(e) => saveEdited(e.detail)}
    on:close={() => editing = null}
  />
{/if}

{#if importing && $activeInstance}
  <CommandImport
    dir={$activeInstance.worktreePath}
    on:import={(e) => importCommands(e.detail)}
    on:close={() => importing = false}
  />
{/if}

<style>
  .cmd-view {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    background: var(--bg-0);
  }

  .cmd-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--stroke-0);
  }

  .cmd-head-text { display: flex; flex-direction: column; gap: 3px; }
  .cmd-title { font-size: 13px; color: var(--fg-0); }
  .cmd-sub { font-size: 11.5px; color: var(--fg-4); line-height: 1.4; }
  .cmd-head-actions { display: flex; gap: 8px; flex-shrink: 0; }

  .cmd-body { flex: 1; overflow-y: auto; padding: 12px 16px 20px; }

  .cmd-section { margin-bottom: 18px; }

  .cmd-section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 0 8px;
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--fg-3);
  }

  .cmd-section-add {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    padding: 0;
    background: transparent;
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-sm);
    color: var(--fg-2);
    cursor: pointer;
  }
  .cmd-section-add:hover:not(:disabled) { background: var(--accent-weak); border-color: var(--accent); color: var(--fg-0); }
  .cmd-section-add:disabled { opacity: 0.4; cursor: default; }

  .cmd-list { display: flex; flex-direction: column; gap: 4px; }

  .cmd-drop {
    height: 2px;
    background: var(--accent, #6c8eff);
    border-radius: 1px;
    pointer-events: none;
  }

  .cmd-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 10px;
    background: var(--bg-1);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-sm);
    cursor: pointer;
    text-align: left;
  }
  .cmd-row:hover { background: var(--bg-2); border-color: var(--stroke-1); }
  .cmd-row.dragging { opacity: 0.4; cursor: grabbing; }

  .cmd-icon {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    flex-shrink: 0;
    border-radius: var(--r-sm);
    background: var(--bg-0);
    color: var(--fg-2);
  }

  .cmd-text { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0; }

  .cmd-name {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12.5px;
    color: var(--fg-0);
  }
  .cmd-name :global(svg) { color: var(--fg-4); }

  .cmd-steps {
    font-size: 11px;
    color: var(--fg-4);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cmd-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .cmd-dot.running { background: var(--accent); animation: cmd-pulse 1.5s ease-in-out infinite; }

  @keyframes cmd-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.35; }
  }

  .cmd-actions { display: flex; gap: 2px; flex-shrink: 0; opacity: 0; transition: opacity 0.12s; }
  .cmd-row:hover .cmd-actions { opacity: 1; }

  .cmd-action {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: var(--r-xs);
    color: var(--fg-3);
    cursor: pointer;
  }
  .cmd-action:hover:not(:disabled) { background: var(--bg-4); color: var(--fg-0); }
  .cmd-action.pinned { color: var(--accent); }
  .cmd-action.danger:hover { color: var(--danger, oklch(0.62 0.18 15)); }
  .cmd-action:disabled { opacity: 0.35; cursor: default; }

  .cmd-empty {
    margin: 0;
    padding: 2px 2px 6px;
    font-size: 11.5px;
    color: var(--fg-4);
    line-height: 1.5;
  }
</style>
