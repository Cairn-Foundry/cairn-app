<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';
  import { settings } from '$lib/stores/settings';
  import type { WorkflowTabConfig } from '$lib/services/settings-service';
  import { DEFAULT_WF_TABS } from "$lib/utils/home/workflow-tabs";
  import { computeTabInsertIndex } from "$lib/utils/files/files-tab-drag";

  $: wfTabs = ($settings.workflowTabs ?? DEFAULT_WF_TABS).slice().sort((a, b) => a.order - b.order);

  let wfDragSrc: number | null = null;
  let wfInsert: number | null = null;
  let wfListEl: HTMLElement | null = null;

  function wfPointerDown(e: PointerEvent, i: number) {
    if ((e.target as Element).closest('label,input,button')) return;
    e.preventDefault();
    wfDragSrc = i;
    wfInsert = i;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function wfPointerMove(e: PointerEvent) {
    if (wfDragSrc === null) return;
    wfInsert = computeTabInsertIndex(wfListEl, e.clientY, { selector: '.wf-row', axis: 'y' });
  }

  function wfPointerUp() {
    if (wfDragSrc === null || wfInsert === null) { wfDragSrc = null; wfInsert = null; return; }
    const isNoop = wfInsert === wfDragSrc || wfInsert === wfDragSrc + 1;
    if (!isNoop) {
      const reordered = [...wfTabs];
      const [moved] = reordered.splice(wfDragSrc, 1);
      const adj = wfInsert > wfDragSrc ? wfInsert - 1 : wfInsert;
      reordered.splice(adj, 0, moved);
      settings.save({ workflowTabs: reordered.map((t, i) => ({ ...t, order: i })) });
    }
    wfDragSrc = null;
    wfInsert = null;
  }

  function wfToggleEnabled(key: WorkflowTabConfig['key']) {
    settings.save({
      workflowTabs: wfTabs.map(t => t.key === key ? { ...t, enabled: !t.enabled } : t),
    });
  }
</script>

<div class="settings-group">
  <div class="settings-group-title">Workflow tabs</div>
  <p class="wf-hint">Drag to reorder · toggle to show/hide</p>
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="wf-list" bind:this={wfListEl}>
    {#each wfTabs as tab, i (tab.key)}
      {#if wfDragSrc !== null && wfInsert === i && !(wfInsert === wfDragSrc || wfInsert === wfDragSrc + 1)}
        <div class="wf-drop-indicator"></div>
      {/if}
      <!-- svelte-ignore a11y-no-static-element-interactions -->
      <div
        class="wf-row settings-row {wfDragSrc === i ? 'wf-dragging' : ''} {!tab.enabled ? 'wf-disabled-row' : ''}"
        on:pointerdown={(e) => wfPointerDown(e, i)}
        on:pointermove={wfPointerMove}
        on:pointerup={wfPointerUp}
      >
        <span class="wf-drag-handle" aria-hidden="true">⠿</span>
        <div class="settings-row-info">
          <span class="settings-row-label">{tab.name}</span>
        </div>
        <label class="settings-toggle" aria-label="Show {tab.name} tab">
          <input
            type="checkbox"
            checked={tab.enabled}
            on:change={() => wfToggleEnabled(tab.key)}
          />
          <span class="settings-toggle-track"><span class="settings-toggle-thumb"></span></span>
        </label>
      </div>
    {/each}
    {#if wfDragSrc !== null && wfInsert === wfTabs.length && wfInsert !== wfDragSrc + 1}
      <div class="wf-drop-indicator"></div>
    {/if}
  </div>
  <div class="settings-section-reset">
    <button
      class="btn ghost"
      style="font-size: 12px;"
      on:click={() => settings.save({ workflowTabs: DEFAULT_WF_TABS })}
    >
      <Icon name="undo" size={12}/> Reset project
    </button>
  </div>
</div>

<style>
  .wf-hint {
    font-size: 11px;
    color: var(--fg-3);
    margin: 0 0 10px;
  }

  .wf-list {
    display: flex;
    flex-direction: column;
    gap: 0;
    user-select: none;
  }

  .wf-row {
    cursor: grab;
    margin-bottom: 6px;
  }
  .wf-row:active { cursor: grabbing; }

  .wf-dragging { opacity: 0.4; cursor: grabbing; }

  .wf-disabled-row { opacity: 0.55; }

  .wf-drag-handle {
    font-size: 16px;
    color: var(--fg-4);
    cursor: grab;
    flex-shrink: 0;
    line-height: 1;
  }

  .wf-drop-indicator {
    height: 2px;
    background: var(--accent);
    border-radius: 1px;
    margin: 2px 0 4px;
    pointer-events: none;
  }
</style>
