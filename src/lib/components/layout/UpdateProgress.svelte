<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * Download progress bar for an app update. Falls back to an indeterminate
   * bar when the server sends no content length.
   */
  export let downloaded: number = 0;
  export let total: number | null = null;
  export let thin: boolean = false;

  $: percent = total && total > 0
    ? Math.min(100, Math.round((downloaded / total) * 100))
    : null;
</script>

<div
  class="track"
  class:thin
  role="progressbar"
  aria-valuenow={percent ?? undefined}
  aria-valuemin={0}
  aria-valuemax={100}
>
  <div class="fill" class:indeterminate={percent === null} style={percent === null ? '' : `width: ${percent}%`}></div>
</div>

<style>
  .track {
    width: 100%;
    height: 6px;
    background: var(--bg-4);
    border-radius: 999px;
    overflow: hidden;
  }
  .track.thin { height: 3px; }
  .fill {
    height: 100%;
    background: var(--accent);
    border-radius: 999px;
    transition: width 0.2s ease-out;
  }
  .fill.indeterminate {
    width: 40%;
    animation: update-progress-slide 1.2s ease-in-out infinite;
  }
  @keyframes update-progress-slide {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(250%); }
  }
</style>
