<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts" module>
  const MIN_HEIGHT = 140;
  /** Kept for the session, so a drawer closed and reopened comes back at the size it was given. */
  let sessionHeight = 320;
</script>

<script lang="ts">
  /**
   * Bottom drawer of the Containers section: one tab per logs or shell
   * terminal, each a PTY running the docker CLI. It spans the home main area,
   * not the sidebar, and is resized from its top edge. Nothing here is
   * persisted - leaving the section closes them all.
   */
  import { onDestroy, onMount } from 'svelte';
  import Icon from '#lib/components/Icon.svelte';
  import { t } from '#lib/i18n';
  import type { Container } from '#lib/services/containers-service';
  import { closeTerminal, createTerminal } from '#lib/services/terminal-service';
  import { displayName, logsArgv, shellArgv } from '#lib/utils/home/containers';
  import * as manager from '#lib/utils/terminal/terminal-manager';

  type Kind = 'logs' | 'shell';
  interface Tab {
    id: string;
    kind: Kind;
    containerId: string;
    label: string;
    exited: boolean;
  }

  let tabs = $state<Tab[]>([]);
  let activeId = $state<string | null>(null);
  let slotEl = $state<HTMLDivElement>();
  let error = $state('');
  let seq = 0;
  let height = $state(sessionHeight);
  let bounds = $state({ left: 0, right: 0, bottom: 0, top: 0 });
  let resizing = $state(false);
  let resizeStartY = 0;
  let resizeStartHeight = 0;

  let active = $derived(tabs.find((tab) => tab.id === activeId) ?? null);

  /** Opens the logs or a shell of a container, or brings back the tab already showing it. */
  export async function open(c: Container, kind: Kind) {
    const existing = tabs.find((tab) => tab.containerId === c.id && tab.kind === kind && !tab.exited);
    if (existing) {
      activeId = existing.id;
      return;
    }
    const id = `container:${kind}:${c.id.slice(0, 12)}:${++seq}`;
    manager.create(id);
    const { cols, rows } = manager.size(id);
    try {
      await createTerminal(id, null, cols, rows, null, null, kind === 'logs' ? logsArgv(c) : shellArgv(c));
    } catch (e) {
      manager.dispose(id);
      error = String(e);
      return;
    }
    error = '';
    tabs = [...tabs, { id, kind, containerId: c.id, label: displayName(c), exited: false }];
    activeId = id;
  }

  function close(id: string) {
    const tab = tabs.find((x) => x.id === id);
    if (!tab) return;
    if (!tab.exited) void closeTerminal(id).catch(() => {});
    manager.dispose(id);
    const index = tabs.indexOf(tab);
    tabs = tabs.filter((x) => x.id !== id);
    if (activeId === id) activeId = (tabs[index] ?? tabs[index - 1])?.id ?? null;
  }

  function closeAll() {
    for (const tab of [...tabs]) close(tab.id);
  }

  const offExit = manager.onTerminalExit(({ id }) => {
    tabs = tabs.map((tab) => (tab.id === id ? { ...tab, exited: true } : tab));
  });

  /** The drawer is fixed to the viewport, so it follows the main area's box rather than the page flow. */
  function measure() {
    const main = document.querySelector('.home-main');
    if (!main) return;
    const r = main.getBoundingClientRect();
    bounds = {
      left: r.left,
      right: window.innerWidth - r.right,
      bottom: window.innerHeight - r.bottom,
      top: r.top,
    };
  }

  function maxHeight(): number {
    return Math.max(MIN_HEIGHT, window.innerHeight - bounds.top - bounds.bottom - 60);
  }

  function startResize(e: PointerEvent) {
    resizing = true;
    resizeStartY = e.clientY;
    resizeStartHeight = height;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    document.body.classList.add('resizing-rows');
    e.preventDefault();
  }

  function onResize(e: PointerEvent) {
    if (!resizing) return;
    height = Math.round(Math.min(maxHeight(), Math.max(MIN_HEIGHT, resizeStartHeight + resizeStartY - e.clientY)));
  }

  function endResize() {
    if (!resizing) return;
    resizing = false;
    sessionHeight = height;
    document.body.classList.remove('resizing-rows');
    if (activeId) manager.refit(activeId);
  }

  function resizeByKey(e: KeyboardEvent) {
    const step = e.shiftKey ? 80 : 20;
    if (e.key === 'ArrowUp') height = Math.min(maxHeight(), height + step);
    else if (e.key === 'ArrowDown') height = Math.max(MIN_HEIGHT, height - step);
    else return;
    e.preventDefault();
    sessionHeight = height;
    if (activeId) manager.refit(activeId);
  }

  onMount(() => {
    measure();
    const main = document.querySelector('.home-main');
    const observer = new ResizeObserver(measure);
    if (main) observer.observe(main);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  });

  $effect(() => {
    if (activeId && !resizing) {
      void height;
      manager.refit(activeId);
    }
  });

  $effect(() => {
    if (!slotEl || !activeId) return;
    const id = activeId;
    manager.attach(id, slotEl);
    return () => manager.detach(id);
  });

  onDestroy(() => {
    offExit();
    closeAll();
  });
</script>

{#if tabs.length > 0 || error}
  <div class="spacer-under" style:height="{height}px" aria-hidden="true"></div>
  <section
    class="drawer"
    class:resizing
    style:left="{bounds.left}px"
    style:right="{bounds.right}px"
    style:bottom="{bounds.bottom}px"
    style:height="{height}px"
    aria-label={t('home.containers.terminals.label') as string}
  >
    <!-- A focusable separator is the ARIA window splitter pattern; Svelte's rule does not know it. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div
      class="resize-handle"
      role="separator"
      aria-orientation="horizontal"
      aria-valuenow={height}
      aria-valuemin={MIN_HEIGHT}
      aria-label={t('home.containers.terminals.resize') as string}
      tabindex="0"
      onpointerdown={startResize}
      onpointermove={onResize}
      onpointerup={endResize}
      onpointercancel={endResize}
      onkeydown={resizeByKey}
    ></div>
    <div class="tabs" role="tablist">
      {#each tabs as tab (tab.id)}
        <div class="tab" class:active={tab.id === activeId} class:exited={tab.exited}>
          <button
            class="tab-main"
            role="tab"
            aria-selected={tab.id === activeId}
            onclick={() => (activeId = tab.id)}
          >
            <Icon name={tab.kind === 'logs' ? 'list' : 'terminal'} size={12} />
            <span class="tab-label">{tab.label}</span>
            <span class="tab-kind">{t(`home.containers.terminals.${tab.kind}`)}</span>
          </button>
          <button
            class="tab-close"
            onclick={() => close(tab.id)}
            title={t('home.containers.terminals.close') as string}
            aria-label={t('home.containers.terminals.close') as string}
          >
            <Icon name="x" size={11} />
          </button>
        </div>
      {/each}
      <div class="spacer"></div>
      {#if tabs.length > 1}
        <button class="close-all" onclick={closeAll}>{t('home.containers.terminals.closeAll')}</button>
      {/if}
    </div>
    {#if error}
      <p class="error selectable" role="alert">{error}</p>
    {/if}
    {#if active}
      <div class="slot" bind:this={slotEl}></div>
    {/if}
  </section>
{/if}

<style>
  .spacer-under { flex-shrink: 0; }
  .drawer {
    position: fixed;
    z-index: 50;
    display: flex;
    flex-direction: column;
    min-height: 140px;
    background: var(--bg-1);
    border-top: 1px solid var(--stroke-1);
  }
  .resize-handle {
    position: absolute;
    top: -4px;
    left: 0;
    right: 0;
    height: 8px;
    cursor: row-resize;
    z-index: 1;
  }
  .resize-handle::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 0;
    right: 0;
    height: 2px;
    background: transparent;
    transition: background 0.12s;
  }
  .resize-handle:hover::after,
  .resize-handle:focus-visible::after,
  .drawer.resizing .resize-handle::after { background: var(--accent); }
  .drawer.resizing { user-select: none; }
  :global(body.resizing-rows) { cursor: row-resize; }
  .tabs {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px 6px;
    border-bottom: 1px solid var(--stroke-0);
    overflow-x: auto;
    flex-shrink: 0;
  }
  .tab {
    display: flex;
    align-items: center;
    border-radius: var(--r-sm);
    color: var(--fg-2);
    flex-shrink: 0;
  }
  .tab.active { background: var(--bg-3); color: var(--fg-0); }
  .tab.exited .tab-label { text-decoration: line-through; color: var(--fg-3); }
  .tab-main {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 4px 4px 8px;
    background: none;
    border: none;
    color: inherit;
    font-size: 11.5px;
    cursor: pointer;
  }
  .tab-kind { font-size: 10px; color: var(--fg-3); }
  .tab-close {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    margin-right: 2px;
    padding: 0;
    background: none;
    border: none;
    border-radius: var(--r-sm);
    color: var(--fg-3);
    cursor: pointer;
  }
  .tab-close:hover { background: var(--bg-2); color: var(--fg-0); }
  .spacer { flex: 1; }
  .close-all {
    padding: 3px 8px;
    background: none;
    border: none;
    font-size: 11px;
    color: var(--fg-3);
    cursor: pointer;
  }
  .close-all:hover { color: var(--fg-0); }
  .error {
    margin: 6px 8px;
    font-size: 12px;
    color: var(--danger);
  }
  .slot {
    flex: 1;
    min-height: 0;
    padding: 4px 6px;
  }
  .slot :global(.terminal-host) { width: 100%; height: 100%; }
</style>
