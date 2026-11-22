<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * The master-detail screens of the home: the whole main area, edge to edge,
   * with the page title and its count at the top of a darker list column
   * (`list` slot) and the selected item beside it (default slot). Each side
   * scrolls on its own. `actions` goes at the right end of the title row.
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
      {#if $$slots.actions}<span class="split-actions"><slot name="actions"/></span>{/if}
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
    white-space: nowrap;
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
  .split-actions { display: flex; align-items: center; gap: 2px; margin-left: auto; }
  .split-detail { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  /* -- the list and the form of every master-detail screen --
     One place for the pieces Agents, Skills and MCP servers share, so a
     change of rhythm lands on the three at once. */
  /* -- list -- */
  .split-panel :global(.list-tools) { display: flex; flex-direction: column; gap: 8px; padding: 12px 12px 4px; }
  .split-panel :global(.list-tools .ag-search) { height: 28px; box-sizing: border-box; margin: 0; }
  .split-panel :global(.filters) { display: flex; flex-wrap: wrap; gap: 4px; }
  .split-panel :global(.chip) {
    display: flex;
    align-items: center;
    gap: 5px;
    height: 22px;
    padding: 0 8px;
    border: 1px solid var(--stroke-0);
    border-radius: 11px;
    font-size: 11.5px;
    color: var(--fg-2);
  }
  .split-panel :global(.chip:hover) { color: var(--fg-0); }
  .split-panel :global(.chip.active) { background: var(--bg-3); border-color: var(--stroke-1); color: var(--fg-0); }
  .split-panel :global(.chip-count) { font-size: 11px; color: var(--fg-3); }
  .split-panel :global(.list-items) {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-height: 0;
    padding: 4px 12px 12px;
    overflow-y: auto;
  }
  .split-panel :global(.group-label) { margin: 12px 10px 6px; font-size: 11.5px; font-weight: 500; color: var(--fg-3); }
  .split-panel :global(.ag-item) {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-width: 0;
    flex-shrink: 0;
    padding: 7px 10px;
    border-radius: var(--r-sm);
    text-align: left;
    color: var(--fg-1);
  }
  .split-panel :global(.ag-item:hover) { background: var(--bg-2); }
  .split-panel :global(.ag-item.is-active) { background: var(--bg-2); color: var(--fg-0); }
  .split-panel :global(.ag-item-text) { display: flex; flex: 1; flex-direction: column; min-width: 0; }
  .split-panel :global(.ag-item-name), .split-panel :global(.ag-item-sub) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .split-panel :global(.ag-item-name) { font-size: 13px; font-weight: 500; }
  .split-panel :global(.ag-item-sub) { font-size: 11.5px; color: var(--fg-3); }
  /* -- detail -- */
  .split-panel :global(.detail-none) {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 32px;
    text-align: center;
    color: var(--fg-3);
  }
  .split-panel :global(.detail-none h2) { margin: 0; font-size: 14px; font-weight: 600; color: var(--fg-0); }
  .split-panel :global(.detail-none p) { max-width: 42ch; margin: 0 0 8px; font-size: 12.5px; line-height: 1.55; }
  .split-panel :global(.detail-head) {
    display: flex;
    flex: none;
    align-items: center;
    gap: 12px;
    padding: 16px 24px;
    border-bottom: 1px solid var(--stroke-0);
  }
  .split-panel :global(.detail-title) { flex: 1; min-width: 0; }
  .split-panel :global(.title-row) { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .split-panel :global(.title-row h2) {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: var(--fg-0);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .split-panel :global(.detail-title p) { margin: 3px 0 0; font-size: 12px; color: var(--fg-3); }
  .split-panel :global(.invoke) {
    flex: none;
    padding: 0 6px;
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 18px;
    color: var(--fg-2);
    border: 1px solid var(--stroke-1);
    border-radius: 4px;
  }
  .split-panel :global(.head-actions) { display: flex; flex: none; align-items: center; gap: 2px; }
  .split-panel :global(.icon-only) { width: 28px; height: 28px; padding: 0; justify-content: center; }
  .split-panel :global(.icon-only.delete:hover) { background: var(--danger-weak); color: var(--danger); }
  .split-panel :global(.detail-body) { flex: 1; min-height: 0; overflow-y: auto; padding-bottom: 12px; }
  .split-panel :global(.section) { padding: 20px 24px 6px; }
  .split-panel :global(.section + .section) { border-top: 1px solid var(--stroke-0); }
  .split-panel :global(.section h3) { margin: 0 0 16px; font-size: 13px; font-weight: 600; color: var(--fg-0); }
  .split-panel :global(.section-head) { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
  .split-panel :global(.section-head h3) { margin: 0; }
  .split-panel :global(.section-note) { margin: 0 0 14px; }
  .split-panel :global(.spacer) { flex: 1; }
  .split-panel :global(.field) {
    display: grid;
    grid-template-columns: 172px minmax(0, 1fr);
    align-items: start;
    column-gap: 12px;
    margin-bottom: 14px;
  }
  .split-panel :global(.field.is-stacked) { grid-template-columns: minmax(0, 1fr); row-gap: 10px; }
  .split-panel :global(.label) { padding-top: 7px; font-size: 12.5px; color: var(--fg-2); }
  .split-panel :global(.field.is-stacked .label) { padding-top: 0; }
  .split-panel :global(.control) { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .split-panel :global(.control-foot) { display: flex; align-items: baseline; gap: 12px; }
  .split-panel :global(.control-foot .hint) { flex: 1; }
  .split-panel :global(.input) {
    width: 100%;
    box-sizing: border-box;
    height: 32px;
    padding: 0 10px;
    background: var(--bg-0);
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-sm);
    font-family: var(--font-ui);
    font-size: 13px;
    color: var(--fg-0);
    outline: none;
  }
  .split-panel :global(.input:focus) { border-color: var(--accent-line); }
  .split-panel :global(.input::placeholder) { color: var(--fg-4); opacity: 1; }
  .split-panel :global(.textarea) { height: auto; padding: 8px 10px; line-height: 1.5; resize: vertical; }
  .split-panel :global(.body-input) {
    min-height: 260px;
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.6;
    resize: vertical;
  }
  .split-panel :global(.mono) { font-family: var(--font-mono); font-size: 12px; }
  .split-panel :global(.hint) { font-size: 12px; line-height: 1.5; color: var(--fg-3); }
  .split-panel :global(.hint.warn) { color: var(--warning); }
  .split-panel :global(.hint.bad) { color: var(--danger); }
  .split-panel :global(.counter) { font-size: 11.5px; color: var(--fg-3); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .split-panel :global(.counter.bad) { color: var(--danger); }
  .split-panel :global(.tool-chips) { display: flex; flex-wrap: wrap; gap: 5px; }
  .split-panel :global(.tool-chip) {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 24px;
    padding: 0 4px 0 8px;
    background: var(--bg-2);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-sm);
  }
  .split-panel :global(.tool-chip code) { font-family: var(--font-mono); font-size: 11.5px; color: var(--fg-1); }
  .split-panel :global(.tool-chip button) {
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
    padding: 0;
    border-radius: 3px;
    color: var(--fg-3);
  }
  .split-panel :global(.tool-chip button:hover) { background: var(--danger-weak); color: var(--danger); }
  .split-panel :global(.inline-row) { display: flex; align-items: center; gap: 8px; }
  .split-panel :global(.inline-row .input) { flex: 1; min-width: 0; }
  .split-panel :global(.inline-row .btn) { flex: none; height: 32px; }
  .split-panel :global(.locations) { display: flex; flex-direction: column; gap: 2px; }
  .split-panel :global(.location) { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 4px 0; }
  .split-panel :global(.location code) {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--fg-2);
  }
  .split-panel :global(.advanced) {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0;
    margin-bottom: 14px;
    font-size: 13px;
    font-weight: 600;
    color: var(--fg-1);
  }
  .split-panel :global(.advanced:hover) { color: var(--fg-0); }
  .split-panel :global(.notices) { display: flex; flex: none; flex-direction: column; gap: 8px; padding: 0 24px 16px; }
  .split-panel :global(.banner) {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 12px;
    border-radius: var(--r-sm);
    font-size: 12px;
  }
  .split-panel :global(.banner.bad) { background: var(--danger-weak); color: var(--danger); }
  .split-panel :global(.banner.warn) { background: var(--warning-weak); color: var(--warning); }
  .split-panel :global(.banner.floating) { position: fixed; right: 24px; bottom: 24px; z-index: 20; max-width: 420px; }
  .split-panel :global(.save-bar) {
    display: flex;
    flex: none;
    align-items: center;
    gap: 8px;
    padding: 12px 24px;
    border-top: 1px solid var(--stroke-0);
    background: var(--bg-0);
  }
  .split-panel :global(.save-note) { flex: 1; min-width: 0; }
  .split-panel :global(.tile) {
    display: grid;
    flex: none;
    place-items: center;
    width: 28px;
    height: 28px;
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-sm);
    background: var(--bg-2);
    color: var(--fg-2);
  }
  .split-panel :global(.tile.is-large) { width: 40px; height: 40px; border-radius: var(--r-md); color: var(--fg-1); }
  .split-panel :global(.tile.is-dashed) { border-style: dashed; border-color: var(--stroke-1); background: transparent; color: var(--fg-3); }
  .split-panel :global(.none-tiles) { display: flex; gap: 8px; margin-bottom: 12px; }
  .split-panel :global(.ag-item.new-skill) { color: var(--fg-2); }
  .split-panel :global(.ag-item.new-skill:hover) { color: var(--fg-0); }
  .split-panel :global(.toggle-row) { display: flex; align-items: center; gap: 12px; padding-top: 4px; }
  .split-panel :global(.value) { padding-top: 7px; font-size: 13px; color: var(--fg-1); }
  .split-panel :global(.add-files) { height: 28px; }
  .split-panel :global(.resources) { display: flex; flex-direction: column; gap: 2px; }
  .split-panel :global(.resource) { display: flex; align-items: center; gap: 10px; min-height: 32px; color: var(--fg-3); }
  .split-panel :global(.resource-name) { flex: 1; min-width: 0; font-family: var(--font-mono); font-size: 12px; color: var(--fg-1); }
  .split-panel :global(.resource-size) { font-size: 11.5px; color: var(--fg-3); font-variant-numeric: tabular-nums; }
</style>
