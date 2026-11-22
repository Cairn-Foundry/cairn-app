<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * One project of the home list. `list` draws one row: the name, then as many
   * of its worktrees as the row has room for, the rest counted; `compact` keeps
   * the name alone, for the overview of the cards view. The pointer, click and key events are forwarded untouched so the
   * list keeps driving the drag from the element that carries the click. The
   * project menu goes in the default slot. Dispatches `more`, `close`, and in
   * the list `edit` and `reveal`.
   */
  import { createEventDispatcher, onDestroy, tick } from 'svelte';
  import Icon from '#lib/components/Icon.svelte';
  import { t } from '#lib/i18n';
  import { countFittingItems } from '#lib/utils/fit-in-row';
  import type { WorktreeSummary } from '#lib/stores/project-overview';
  import type { Project } from '#lib/types/project';
  import WorktreeStat from './WorktreeStat.svelte';

  export let project: Project;
  export let layout: 'list' | 'compact';
  export let worktrees: WorktreeSummary = { isGitRepo: null, lines: [], hiddenBranches: [] };
  export let tickets = '';
  /** Draws a close button instead of the edit and reveal ones, where every project shown is open. */
  export let isClosable = false;
  export let isCurrent = false;
  export let isDragSource = false;
  export let isDropBefore = false;
  export let isDropAfter = false;

  const dispatch = createEventDispatcher<{ more: MouseEvent; close: void; edit: void; reveal: void }>();

  /** Room kept after the last shown worktree for the "+N more" label. */
  const OTHERS_RESERVE_PX = 96;
  const ITEM_GAP_PX = 14;


  let worktreesEl: HTMLElement | null = null;
  let fitCount = Number.POSITIVE_INFINITY;
  let othersLeft = 0;

  $: shownCount = Math.min(fitCount, worktrees.lines.length);
  $: hiddenBranches = [
    ...worktrees.lines.slice(shownCount).map((line) => line.branch),
    ...worktrees.hiddenBranches,
  ];

  /**
   * Every worktree is laid out at its natural width and the ones past the edge
   * are only made invisible, so the offsets measured here do not move when the
   * count changes.
   */
  function measure() {
    if (!worktreesEl) return;
    const items = Array.from(worktreesEl.querySelectorAll<HTMLElement>(':scope > .wt-item'));
    if (items.length === 0) return;
    const rightEdges = items.map((item) => item.offsetLeft + item.offsetWidth);
    const fit = countFittingItems(rightEdges, worktreesEl.clientWidth, OTHERS_RESERVE_PX, worktrees.hiddenBranches.length > 0);
    fitCount = fit;
    othersLeft = rightEdges[fit - 1] + ITEM_GAP_PX;
  }

  const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measure());
  $: if (worktreesEl) resizeObserver?.observe(worktreesEl);
  $: if (worktreesEl && worktrees) void tick().then(measure);
  onDestroy(() => resizeObserver?.disconnect());
</script>

<div
  class="project-card entry"
  class:is-list={layout === 'list'}
  class:is-current={isCurrent}
  class:proj-drag-src={isDragSource}
  class:proj-drop-before={isDropBefore}
  class:proj-drop-after={isDropAfter}
  role="button"
  tabindex="0"
  on:pointerdown
  on:pointermove
  on:pointerup
  on:pointercancel
  on:contextmenu
  on:click
  on:keydown
>
  <div class="ident">
    <span class="swatch" style="background: {project.color}"></span>
    <span class="pname" title={project.path}>{project.name}</span>
    {#if tickets}
      <span class="tickets" title={t('home.projects.inboxTitle') as string}><Icon name="ticket" size={11}/>{tickets}</span>
    {/if}
  </div>

  {#if layout === 'list'}
    <div class="worktrees" bind:this={worktreesEl}>
      {#if worktrees.isGitRepo === false}
        <span class="no-git">{t('home.projects.noGitFolder')}</span>
      {/if}
      {#each worktrees.lines as line, index (line.key)}
        <span class="wt-item" class:is-first-instance={index === 1} class:is-clipped={index >= shownCount}
              aria-hidden={index >= shownCount}>
          <WorktreeStat branch={line.branch} state={line.state} isBase={line.isBase} title={line.title}/>
        </span>
      {/each}
      {#if hiddenBranches.length > 0}
        <span class="others" style="left: {othersLeft}px" title={hiddenBranches.join('\n')}>
          {(t('home.projects.otherInstances') as (n: number) => string)(hiddenBranches.length)}
        </span>
      {/if}
    </div>
  {/if}

  <div class="end">
    {#if isClosable}
      <button class="row-action" aria-label={t('home.projects.closeProject') as string}
              title={t('home.projects.closeProject') as string}
              on:click|stopPropagation={() => dispatch('close')}>
        <Icon name="x" size={14}/>
      </button>
    {:else}
      <button class="row-action" aria-label={t('common.edit') as string} title={t('common.edit') as string}
              on:click|stopPropagation={() => dispatch('edit')}>
        <Icon name="edit" size={14}/>
      </button>
      <button class="row-action" aria-label={t('common.reveal') as string} title={t('common.reveal') as string}
              on:click|stopPropagation={() => dispatch('reveal')}>
        <Icon name="folder" size={14}/>
      </button>
    {/if}
    <button class="card-more" aria-label={t('home.projects.projectOptions') as string}
            on:click|stopPropagation={(e) => dispatch('more', e)}>
      <Icon name="more" size={15}/>
    </button>
  </div>

  <slot/>
</div>

<style>
  .entry {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 16px;
    min-width: 0;
    min-height: 40px;
    padding: 0 8px 0 12px;
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-md);
    background: var(--bg-1);
    cursor: pointer;
  }
  .entry:hover { background: var(--bg-2); border-color: var(--stroke-1); }
  .entry.is-current:not(.is-list) { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }

  .entry.is-list {
    grid-template-columns: var(--name-col, 15rem) minmax(0, 1fr) auto;
    gap: 24px;
    min-height: 44px;
    padding: 0 10px 0 16px;
    /* Widths only: `border: 0` would reset the colour to currentColor, and the
       switch to the cards would fade the borders in from the text colour. */
    border-width: 1px 0 0;
    border-radius: 0;
    background: transparent;
  }
  .entry.is-list:hover { background: var(--bg-2); }
  .entry.is-list.is-current { box-shadow: inset 2px 0 0 var(--accent); }

  .ident {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .swatch {
    width: 8px;
    height: 8px;
    border-radius: 2px;
    flex-shrink: 0;
  }
  .pname {
    font-size: 13px;
    font-weight: 600;
    color: var(--fg-0);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .entry:not(.is-list) .pname { font-weight: 500; }
  .tickets {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 7px;
    font-size: 11px;
    line-height: 1.6;
    color: var(--fg-2);
    background: var(--bg-3);
    border-radius: 10px;
    flex-shrink: 0;
  }

  .worktrees {
    position: relative;
    display: flex;
    align-items: center;
    gap: 14px;
    min-width: 0;
    overflow: hidden;
  }
  .wt-item {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
  }
  .wt-item:first-child { max-width: 100%; }
  .wt-item.is-first-instance {
    gap: 12px;
  }
  .wt-item.is-first-instance::before {
    content: '';
    width: 1px;
    height: 14px;
    background: var(--stroke-1);
  }
  .wt-item.is-clipped { visibility: hidden; }
  .others {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
  }
  .no-git,
  .others {
    font-size: 11.5px;
    color: var(--fg-3);
    white-space: nowrap;
    flex-shrink: 0;
  }
  .no-git { color: var(--fg-4); }

  .end {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
    flex-shrink: 0;
  }
  .row-action,
  .card-more {
    display: grid;
    padding: 0;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: var(--r-sm);
    color: var(--fg-3);
  }
  .row-action:hover,
  .card-more:hover { background: var(--bg-4); color: var(--fg-0); }
</style>
