<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * What the project list shows before the first project: a pixel cairn in the
   * stone tokens of the theme, and what a project brings.
   */
  import { t } from '#lib/i18n';
  import Icon from '#lib/components/Icon.svelte';
  import cairnSvg from '#lib/assets/illustrations/empty-cairn.svg?raw';
</script>

<section class="projects-empty">
  <!-- Inlined, not an <img>: the strokes take their colours from the theme. -->
  <div class="cairn">{@html cairnSvg}</div>
  <h2>{t('home.projects.emptyTitle')}</h2>
  <p>{t('home.projects.emptyLead')}</p>
  <ul class="points">
    <li><Icon name="terminal" size={14}/><strong>{t('home.projects.emptyTools')}</strong>{t('home.projects.emptyToolsDesc')}</li>
    <li><Icon name="sparkles" size={14}/><strong>{t('home.projects.emptyAgents')}</strong>{t('home.projects.emptyAgentsDesc')}</li>
    <li><Icon name="layers" size={14}/><strong>{t('home.projects.emptyInstances')}</strong>{t('home.projects.emptyInstancesDesc')}</li>
  </ul>
</section>

<style>
  /* The drawing sits in the middle of what is left under the cards: the
     scrolling main area becomes a column the block can grow in. */
  :global(.home-main:has(> .projects-empty)) {
    display: flex;
    flex-direction: column;
  }
  .projects-empty {
    display: flex;
    flex: 1 0 auto;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding-block: 32px;
    text-align: center;
  }
  .cairn { display: flex; margin-bottom: 32px; }
  .cairn :global(.outline) { fill: var(--fg-2); }
  .cairn :global(.fill) { fill: var(--bg-2); }
  .cairn :global(.crack) { fill: var(--fg-3); }
  .cairn :global(.highlight) { fill: var(--stone-3); }
  .cairn :global(.ground) { fill: var(--stroke-1); }

  h2 {
    margin: 0 0 12px;
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
    gap: 14px;
    margin: 28px 0 0;
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
</style>
