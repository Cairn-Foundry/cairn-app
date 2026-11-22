<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * What a filtered list shows when the search matched nothing: a lens over
   * bare ground, in the stone tokens of the theme, the words of the caller and
   * a button that clears the search (dispatches `clear`).
   */
  import { createEventDispatcher } from 'svelte';

  export let title: string;
  export let text: string;
  export let clearLabel: string;

  const dispatch = createEventDispatcher<{ clear: void }>();
</script>

<section class="search-empty" aria-live="polite">
  <svg class="drawing" width="220" height="140" viewBox="0 0 220 140" aria-hidden="true">
    <line class="ground" x1="24" y1="122" x2="196" y2="122"/>
    <path class="stone s0" d="M40 117c1-6 9-9 18-9s16 3 16 8-6 6-17 6-18-2-17-5z"/>
    <path class="stone s2" d="M150 118c1-4 6-7 12-7s10 3 10 6-4 5-11 5-12-1-11-4z"/>
    <path class="stone s1" d="M176 119c0-3 3-5 7-5s7 2 7 4-3 4-7 4-7-1-7-3z"/>
    <circle class="lens" cx="104" cy="62" r="27"/>
    <line class="handle" x1="124" y1="82" x2="142" y2="100"/>
  </svg>
  <h2>{title}</h2>
  <p>{text}</p>
  <button class="btn" on:click={() => dispatch('clear')}>{clearLabel}</button>
</section>

<style>
  .search-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding-block: 48px 40px;
    text-align: center;
  }
  .drawing { margin-bottom: 20px; overflow: visible; }
  .ground { stroke: var(--stroke-1); stroke-width: 1.5; stroke-linecap: round; }
  .stone { stroke: none; }
  .s0 { fill: var(--stone-0); }
  .s1 { fill: var(--stone-1); }
  .s2 { fill: var(--stone-2); }
  .lens { fill: var(--bg-1); stroke: var(--fg-3); stroke-width: 3; }
  .handle { stroke: var(--fg-3); stroke-width: 5; stroke-linecap: round; }
  h2 {
    margin: 0 0 6px;
    font-family: var(--font-ui);
    font-size: 15px;
    font-weight: 600;
    color: var(--fg-0);
  }
  p {
    max-width: 58ch;
    margin: 0;
    font-size: 13px;
    line-height: 1.55;
    color: var(--fg-2);
    text-wrap: balance;
  }
  .btn { margin-top: 16px; }
</style>
