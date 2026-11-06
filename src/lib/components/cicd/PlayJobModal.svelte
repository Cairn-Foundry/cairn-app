<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /** Confirmation before running a manual job: one click too many must not deploy. */
  import { createEventDispatcher } from 'svelte';
  import Icon from '#lib/components/Icon.svelte';
  import { t } from '#lib/i18n';
  import type { Pipeline, PipelineJob } from '#lib/types/integrations';

  export let pipeline: Pipeline;
  export let job: PipelineJob;

  const dispatch = createEventDispatcher<{ close: void; confirm: void }>();
</script>

<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
<div
  class="modal-backdrop"
  role="dialog"
  aria-modal="true"
  tabindex="-1"
  on:click={() => dispatch('close')}
  on:keydown={(e) => e.key === 'Escape' && dispatch('close')}
>
  <div class="modal play-modal" on:click|stopPropagation role="presentation">
    <div class="modal-head">
      <div>
        <div class="step-count">{t('cicd.playHeading')}</div>
        <h3>{(t('cicd.playTitle') as (job: string) => string)(job.name)}</h3>
      </div>
      <button class="icon-btn close" on:click={() => dispatch('close')} aria-label={t('common.close') as string}>
        <Icon name="x" size={16}/>
      </button>
    </div>
    <div class="modal-body">
      <p class="play-desc">{t('cicd.playDescription')}</p>
      <dl class="facts">
        <div>
          <dt>{t('cicd.playPipeline')}</dt>
          <dd class="mono selectable">{pipeline.number}</dd>
        </div>
        <div>
          <dt>{t('cicd.playRef')}</dt>
          <dd class="mono selectable">{pipeline.ref}</dd>
        </div>
        <div class="wide">
          <dt>{t('cicd.playCommit')}</dt>
          <dd class="selectable"><span class="mono">{pipeline.sha.slice(0, 7)}</span> {pipeline.title}</dd>
        </div>
      </dl>
    </div>
    <div class="modal-foot">
      <div class="spacer"></div>
      <button class="btn ghost" on:click={() => dispatch('close')}>{t('common.cancel')}</button>
      <button class="btn primary" on:click={() => dispatch('confirm')}>
        <Icon name="play" size={14}/> {t('cicd.play')}
      </button>
    </div>
  </div>
</div>

<style>
  .play-modal { width: min(480px, 92vw); }
  .play-desc {
    font-size: 13px;
    color: var(--fg-2);
    line-height: 1.6;
    margin: 0 0 14px;
  }
  .facts {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px 16px;
    margin: 0;
  }
  .facts .wide { grid-column: 1 / -1; }
  dt {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--fg-3);
    margin-bottom: 2px;
  }
  dd {
    margin: 0;
    font-size: 12px;
    color: var(--fg-1);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mono { font-family: var(--font-mono); }
</style>
