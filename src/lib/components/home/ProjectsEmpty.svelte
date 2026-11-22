<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * What the project list shows when it has nothing to show: no project yet, or
   * a search that matched none. The drawing is a cairn, in the stone tokens of
   * the theme, drawn in pixels when there is no project; a lens over bare
   * ground when the search found nothing.
   */
  import { createEventDispatcher } from 'svelte';
  import { t } from '#lib/i18n';
  import Icon from '#lib/components/Icon.svelte';
  import cairnSvg from '#lib/assets/illustrations/empty-cairn.svg?raw';

  export let kind: 'none' | 'no-match';
  export let query = '';

  const dispatch = createEventDispatcher<{ clear: void }>();
</script>

<section class="projects-empty" class:is-none={kind === 'none'} aria-live="polite">
  {#if kind === 'none'}
    <!-- Inlined, not an <img>: the strokes take their colours from the theme. -->
    <div class="drawing cairn">{@html cairnSvg}</div>
    <h2>{t('home.projects.emptyTitle')}</h2>
    <p>{t('home.projects.emptyLead')}</p>
    <ul class="points">
      <li><Icon name="terminal" size={14}/><strong>{t('home.projects.emptyTools')}</strong>{t('home.projects.emptyToolsDesc')}</li>
      <li><Icon name="sparkles" size={14}/><strong>{t('home.projects.emptyAgents')}</strong>{t('home.projects.emptyAgentsDesc')}</li>
      <li><Icon name="layers" size={14}/><strong>{t('home.projects.emptyInstances')}</strong>{t('home.projects.emptyInstancesDesc')}</li>
    </ul>
  {:else}
    <svg class="drawing" width="220" height="140" viewBox="0 0 220 140" aria-hidden="true">
      <line class="ground" x1="24" y1="122" x2="196" y2="122"/>
      <path class="stone s0" d="M40 117c1-6 9-9 18-9s16 3 16 8-6 6-17 6-18-2-17-5z"/>
      <path class="stone s2" d="M150 118c1-4 6-7 12-7s10 3 10 6-4 5-11 5-12-1-11-4z"/>
      <path class="stone s1" d="M176 119c0-3 3-5 7-5s7 2 7 4-3 4-7 4-7-1-7-3z"/>
      <circle class="lens" cx="104" cy="62" r="27"/>
      <line class="handle" x1="124" y1="82" x2="142" y2="100"/>
    </svg>
    <h2>{t('home.projects.noMatchTitle')}</h2>
    <p>{(t('home.projects.noMatchText') as (q: string) => string)(query)}</p>
    <button class="btn" on:click={() => dispatch('clear')}>{t('home.projects.clearSearch')}</button>
  {/if}
</section>

<style>
  .projects-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding-block: 48px 40px;
    text-align: center;
  }
  /* With no project the drawing sits in the middle of what is left under the
     cards: the scrolling main area becomes a column the block can grow in. */
  :global(.home-main:has(> .projects-empty.is-none)) {
    display: flex;
    flex-direction: column;
  }
  .projects-empty.is-none {
    flex: 1 0 auto;
    justify-content: center;
    padding-block: 32px;
  }
  .drawing { margin-bottom: 20px; overflow: visible; }
  .ground { stroke: var(--stroke-1); stroke-width: 1.5; stroke-linecap: round; }
  .stone { stroke: none; }
  .s0 { fill: var(--stone-0); }
  .s1 { fill: var(--stone-1); }
  .s2 { fill: var(--stone-2); }
  .cairn { display: flex; }
  .cairn :global(.outline) { fill: var(--fg-2); }
  .cairn :global(.fill) { fill: var(--bg-2); }
  .cairn :global(.crack) { fill: var(--fg-3); }
  .cairn :global(.highlight) { fill: var(--stone-3); }
  .cairn :global(.ground) { fill: var(--stroke-1); }
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
  .points {
    display: flex;
    flex-direction: column;
    gap: 9px;
    margin: 16px 0 0;
    padding: 0;
    list-style: none;
    text-align: left;
  }
  .points li {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 12.5px;
    color: var(--fg-2);
  }
  .points strong {
    margin-right: -2px;
    font-weight: 600;
    color: var(--fg-0);
  }
  .points strong::after { content: ' -'; font-weight: 400; color: var(--fg-3); }
  .points li :global(.ic) { flex: none; color: var(--fg-3); }
  .btn { margin-top: 16px; }
  .is-none .drawing { margin-bottom: 32px; }
  .is-none h2 { margin-bottom: 12px; }
  .is-none .points { margin-top: 28px; gap: 14px; }
</style>
