<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * Horizontal slider laid over the bottom border of a scrolling strip, so it
   * takes no room from the content. The strip must contain that border.
   */
  import { type ScrollMetrics, scrollForThumb, sliderThumb } from '#lib/utils/scroll-slider';

  interface Props {
    metrics: ScrollMetrics;
    controls: string;
    label: string;
    onScroll: (scrollLeft: number) => void;
  }

  const { metrics, controls, label, onScroll }: Props = $props();

  let thumb = $derived(sliderThumb(metrics));
  let dragging = $state(false);
  let grabOffset = 0;

  function onPointerDown(e: PointerEvent) {
    if (!thumb || e.button !== 0) return;
    const track = e.currentTarget as HTMLElement;
    const x = e.clientX - track.getBoundingClientRect().left;
    const onThumb = x >= thumb.left && x <= thumb.left + thumb.width;
    grabOffset = onThumb ? x - thumb.left : thumb.width / 2;
    if (!onThumb) onScroll(scrollForThumb(x - grabOffset, metrics));
    track.setPointerCapture(e.pointerId);
    dragging = true;
    document.body.classList.add('dragging');
    e.preventDefault();
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging) return;
    const x = e.clientX - (e.currentTarget as HTMLElement).getBoundingClientRect().left;
    onScroll(scrollForThumb(x - grabOffset, metrics));
  }

  function stop() {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('dragging');
  }
</script>

{#if thumb}
  <div
    class="scroll-slider"
    class:dragging
    data-tauri-drag-region="false"
    role="scrollbar"
    aria-label={label}
    aria-controls={controls}
    aria-orientation="horizontal"
    aria-valuemin={0}
    aria-valuemax={Math.round(metrics.scrollWidth - metrics.clientWidth)}
    aria-valuenow={Math.round(metrics.scrollLeft)}
    tabindex="-1"
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={stop}
    onpointercancel={stop}
  >
    <div class="thumb" style="left: {thumb.left}px; width: {thumb.width}px;"></div>
  </div>
{/if}

<style>
  .scroll-slider {
    position: absolute;
    left: 0;
    right: 0;
    top: calc(100% - 5px);
    height: 9px;
    z-index: 2;
    cursor: pointer;
  }
  .thumb {
    position: absolute;
    bottom: 4px;
    height: 2px;
    border-radius: 3px;
    background: var(--stroke-2);
    transition: height .12s, bottom .12s, background .12s;
  }
  .scroll-slider:hover .thumb,
  .scroll-slider.dragging .thumb {
    bottom: 2px;
    height: 5px;
    background: var(--fg-3);
  }
  .scroll-slider.dragging .thumb { background: var(--accent); }
</style>
