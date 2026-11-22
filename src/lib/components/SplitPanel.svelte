<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * The master-detail screens of the home: the whole main area, edge to edge,
   * with the page title and its count at the top of a darker list column
   * (`list` slot) and the selected item beside it (default slot). Each side
   * scrolls on its own.
   */
  export let title: string;
  /** Shown beside the title; nothing is drawn for null. */
  export let count: number | null = null;
  export let listWidth = 264;
</script>

<div class="split-panel" style="--split-list: {listWidth}px">
  <aside class="split-list">
    <header class="split-head">
      <h1>{title}</h1>
      {#if count !== null}<span class="split-count">{count}</span>{/if}
    </header>
    <slot name="list"/>
  </aside>
  <section class="split-detail"><slot/></section>
</div>

<style>
  /* The panel is the screen: the main area drops its padding and becomes a
     column the panel fills. */
  :global(.home-main:has(> .split-panel)) {
    display: flex;
    flex-direction: column;
    padding: 0;
  }
  .split-panel {
    display: grid;
    flex: 1 1 0;
    grid-template-columns: var(--split-list) minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
    min-height: 0;
    background: var(--bg-1);
  }
  .split-list {
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--bg-0);
    border-right: 1px solid var(--stroke-0);
  }
  .split-head {
    display: flex;
    flex: none;
    align-items: center;
    gap: 10px;
    padding: 24px 22px 8px;
  }
  .split-head h1 {
    margin: 0;
    font-family: var(--font-ui);
    font-size: 18px;
    font-weight: 600;
    color: var(--fg-0);
  }
  .split-count {
    padding: 1px 8px;
    font-size: 11.5px;
    line-height: 1.6;
    color: var(--fg-2);
    background: var(--bg-3);
    border-radius: 10px;
  }
  .split-detail { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
</style>
