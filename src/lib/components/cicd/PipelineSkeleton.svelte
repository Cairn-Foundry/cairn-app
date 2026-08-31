<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * Placeholder for the pipeline list. It borrows `.pipeline`, `.pipeline-head`
   * and `.stages` from the CI styles so it occupies the geometry of the rows it
   * stands in for, and the list does not jump when the real pipelines land.
   */
  import Skeleton from '$lib/components/Skeleton.svelte';

  export let cards: number = 3;
</script>

<div class="pipeline-list" aria-busy="true">
  {#each Array(cards) as _, card (card)}
    <div class="pipeline skeleton-card">
      <div class="pipeline-head">
        <Skeleton lines={1} height={18} width="42px" radius="var(--r-xs)"/>
        <Skeleton lines={1} height={13} width={card === 0 ? '46%' : '32%'}/>
        <div class="spacer"></div>
        <Skeleton lines={1} height={18} width="74px" radius="99px"/>
      </div>
      <div class="stages">
        {#each Array(3) as _, stage (stage)}
          <div class="stage-card">
            <Skeleton lines={1} height={9} width="52%"/>
            <div class="skeleton-jobs">
              {#each Array(stage === 1 ? 3 : 2) as _, job (job)}
                <div class="skeleton-job">
                  <Skeleton lines={1} height={8} width="8px" radius="50%"/>
                  <Skeleton lines={1} height={11} width={job === 0 ? '68%' : '54%'}/>
                </div>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/each}
</div>

<style>
  /* Mirrors the real list in CiCdView, whose rule is scoped to that component. */
  .pipeline-list { overflow-y: auto; flex: 1; min-height: 0; }
  .skeleton-card { pointer-events: none; }
  .skeleton-card:nth-child(2) { opacity: 0.7; }
  .skeleton-card:nth-child(3) { opacity: 0.4; }
  .skeleton-jobs { display: flex; flex-direction: column; gap: 10px; margin-top: 8px; }
  .skeleton-job { display: flex; align-items: center; gap: 8px; }
</style>
