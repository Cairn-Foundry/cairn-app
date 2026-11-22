<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * The framed master-detail panel of the home screens: a darker list column on
   * the left (`list` slot), the selected item on the right (default slot). It
   * takes the height the page has left, and each side scrolls on its own.
   */
  export let listWidth = 248;
</script>

<div class="split-panel" style="--split-list: {listWidth}px">
  <aside class="split-list"><slot name="list"/></aside>
  <section class="split-detail"><slot/></section>
</div>

<style>
  /* The scrolling main area becomes a column the panel can grow in. */
  :global(.home-main:has(> .split-panel)) {
    display: flex;
    flex-direction: column;
  }
  .split-panel {
    display: grid;
    flex: 1 1 0;
    grid-template-columns: var(--split-list) minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
    min-height: 420px;
    border: 1px solid color-mix(in oklch, var(--stroke-0) 60%, var(--stroke-1));
    border-radius: var(--r-md);
    background: var(--bg-1);
    overflow: hidden;
  }
  .split-list {
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--bg-0);
    border-right: 1px solid var(--stroke-0);
  }
  .split-detail { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
</style>
