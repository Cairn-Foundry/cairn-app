<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * Full-area viewer for one mermaid diagram: zoom, fit, pan, an overview of the
   * whole graph with the visible window on it, the source copied or the svg saved.
   * It fills its positioned parent, so the same component serves a `.mmd` tab and
   * a diagram opened full screen from a markdown file.
   */
  import { onDestroy, onMount } from 'svelte';
  import CopyButton from '#lib/components/CopyButton.svelte';
  import Icon from '#lib/components/Icon.svelte';
  import { t } from '#lib/i18n';
  import { writeFile } from '#lib/services/file-service';
  import { pinSvgToViewBox, renderMermaid } from '#lib/utils/editor/mermaid';
  import {
    attachMermaidZoom,
    MERMAID_ZOOM_LIMITS,
    type MermaidZoom,
    type MermaidZoomView,
  } from '#lib/utils/editor/mermaid-zoom';

  export let source: string;
  /** Present when the viewer sits over something it can hand back to. */
  export let onClose: (() => void) | undefined = undefined;
  export let onShowSource: (() => void) | undefined = undefined;

  const FIT_MARGIN = 32;
  const OVERVIEW_WIDTH_RANGE = { min: 240, max: 440, share: 0.3 };
  const OVERVIEW_HEIGHT_RANGE = { min: 160, max: 320, share: 0.32 };

  function overviewLimit(range: { min: number; max: number; share: number }, surfaceSize: number): number {
    return Math.min(range.max, Math.max(range.min, surfaceSize * range.share));
  }

  let root: HTMLElement;
  let surface: HTMLElement;
  let stage: HTMLElement;
  let zoom: MermaidZoom | null = null;
  let resizeObserver: ResizeObserver | null = null;

  let view: MermaidZoomView = { scale: 1, x: 0, y: 0 };
  let surfaceWidth = 0;
  let surfaceHeight = 0;
  let diagramWidth = 0;
  let diagramHeight = 0;
  let isFailed = false;
  let isFitPending = true;
  let svgMarkup = '';
  let overviewUrl: string | null = null;
  let renderToken = 0;
  let isDraggingOverview = false;

  $: percent = Math.round(view.scale * 100);
  $: overviewScale =
    diagramWidth && diagramHeight
      ? Math.min(
          overviewLimit(OVERVIEW_WIDTH_RANGE, surfaceWidth) / diagramWidth,
          overviewLimit(OVERVIEW_HEIGHT_RANGE, surfaceHeight) / diagramHeight,
        )
      : 0;
  $: overviewBox = {
    width: diagramWidth * overviewScale,
    height: diagramHeight * overviewScale,
  };
  $: overviewWindow = {
    left: (-view.x / view.scale) * overviewScale,
    top: (-view.y / view.scale) * overviewScale,
    width: (surfaceWidth / view.scale) * overviewScale,
    height: (surfaceHeight / view.scale) * overviewScale,
  };

  $: if (stage) void render(source);

  async function render(markup: string): Promise<void> {
    const token = ++renderToken;
    await renderMermaid(stage, markup);
    if (token !== renderToken) return;

    isFailed = stage.classList.contains('cm-md-mermaid-error');
    if (isFailed) {
      zoom?.reset();
      isFitPending = true;
      diagramWidth = 0;
      diagramHeight = 0;
      setOverview('');
      return;
    }

    pinSvgToViewBox(stage);
    diagramWidth = stage.offsetWidth;
    diagramHeight = stage.offsetHeight;
    const svg = stage.querySelector('svg');
    setOverview(svg ? new XMLSerializer().serializeToString(svg) : '');

    if (!zoom) {
      zoom = attachMermaidZoom(surface, stage, {
        wheelPans: true,
        onChange: (next) => {
          view = next;
        },
      });
    }
    if (isFitPending) fitWhenSized();
  }

  function setOverview(markup: string): void {
    svgMarkup = markup;
    if (overviewUrl) URL.revokeObjectURL(overviewUrl);
    overviewUrl = markup
      ? URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }))
      : null;
  }

  function fitWhenSized(): void {
    if (!zoom || !surface.clientWidth || !surface.clientHeight) return;
    zoom.fit(FIT_MARGIN);
    isFitPending = false;
  }

  function onOverviewPointer(event: PointerEvent): void {
    if (!zoom || !overviewScale) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const targetX = (event.clientX - rect.left) / overviewScale;
    const targetY = (event.clientY - rect.top) / overviewScale;
    zoom.panTo(
      surfaceWidth / 2 - targetX * view.scale,
      surfaceHeight / 2 - targetY * view.scale,
    );
  }

  function onOverviewDown(event: PointerEvent): void {
    isDraggingOverview = true;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
    onOverviewPointer(event);
  }

  function onOverviewMove(event: PointerEvent): void {
    if (isDraggingOverview) onOverviewPointer(event);
  }

  function onOverviewUp(event: PointerEvent): void {
    isDraggingOverview = false;
    (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    switch (event.key) {
      case 'Escape':
        if (!onClose) return;
        onClose();
        break;
      case '+':
      case '=':
        zoom?.zoomBy(MERMAID_ZOOM_LIMITS.ZOOM_STEP);
        break;
      case '-':
        zoom?.zoomBy(1 / MERMAID_ZOOM_LIMITS.ZOOM_STEP);
        break;
      case 'f':
        zoom?.fit(FIT_MARGIN);
        break;
      case '1':
        zoom?.actualSize();
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  async function saveSvg(): Promise<void> {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({
      defaultPath: 'diagram.svg',
      filters: [{ name: 'SVG', extensions: ['svg'] }],
    });
    if (!path) return;
    await writeFile(path, svgMarkup, null);
  }

  onMount(() => {
    root.focus({ preventScroll: true });
    resizeObserver = new ResizeObserver(() => {
      surfaceWidth = surface.clientWidth;
      surfaceHeight = surface.clientHeight;
      if (isFitPending && !isFailed) fitWhenSized();
    });
    resizeObserver.observe(surface);
  });

  onDestroy(() => {
    renderToken += 1;
    resizeObserver?.disconnect();
    zoom?.destroy();
    if (overviewUrl) URL.revokeObjectURL(overviewUrl);
  });
</script>

<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
<div
  bind:this={root}
  class="mv"
  role="application"
  aria-label={t('files.mermaid.navigator') as string}
  tabindex="-1"
  on:keydown={onKeydown}
>
  <div class="mv-toolbar" role="toolbar" aria-label={t('files.mermaid.hint') as string}>
    <div class="mv-group">
      <button
        type="button"
        class="mv-btn"
        disabled={isFailed}
        title={t('files.mermaid.zoomOut') as string}
        aria-label={t('files.mermaid.zoomOut') as string}
        on:click={() => zoom?.zoomBy(1 / MERMAID_ZOOM_LIMITS.ZOOM_STEP)}
      >
        <Icon name="minus" size={13}/>
      </button>
      <span class="mv-scale">{isFailed ? '' : `${percent}%`}</span>
      <button
        type="button"
        class="mv-btn"
        disabled={isFailed}
        title={t('files.mermaid.zoomIn') as string}
        aria-label={t('files.mermaid.zoomIn') as string}
        on:click={() => zoom?.zoomBy(MERMAID_ZOOM_LIMITS.ZOOM_STEP)}
      >
        <Icon name="plus" size={13}/>
      </button>
    </div>
    <div class="mv-group">
      <button
        type="button"
        class="mv-btn"
        disabled={isFailed}
        title={t('files.mermaid.fit') as string}
        aria-label={t('files.mermaid.fit') as string}
        on:click={() => zoom?.fit(FIT_MARGIN)}
      >
        <Icon name="fit" size={13}/>
      </button>
      <button
        type="button"
        class="mv-btn mv-btn-text"
        disabled={isFailed}
        title={t('files.mermaid.actualSize') as string}
        aria-label={t('files.mermaid.actualSize') as string}
        on:click={() => zoom?.actualSize()}
      >
        1:1
      </button>
    </div>
    <div class="mv-group">
      <span class="mv-copy" title={t('files.mermaid.copySource') as string}>
        <CopyButton value={source} size={13}/>
      </span>
      <button
        type="button"
        class="mv-btn"
        disabled={isFailed}
        title={t('files.mermaid.saveSvg') as string}
        aria-label={t('files.mermaid.saveSvg') as string}
        on:click={saveSvg}
      >
        <Icon name="download" size={13}/>
      </button>
    </div>
    <span class="mv-spacer"></span>
    {#if onShowSource}
      <button
        type="button"
        class="mv-btn"
        title={t('files.mermaid.showSource') as string}
        aria-label={t('files.mermaid.showSource') as string}
        on:click={onShowSource}
      >
        <Icon name="file-code" size={13}/>
      </button>
    {/if}
    {#if onClose}
      <button
        type="button"
        class="mv-btn"
        title={t('common.close') as string}
        aria-label={t('common.close') as string}
        on:click={onClose}
      >
        <Icon name="x" size={13}/>
      </button>
    {/if}
  </div>

  <div bind:this={surface} class="mv-surface" class:mv-failed={isFailed}>
    <div bind:this={stage} class="mv-stage" class:selectable={isFailed}></div>
  </div>

  {#if overviewUrl}
    <div
      class="mv-overview"
      style="width:{overviewBox.width}px;height:{overviewBox.height}px"
      role="presentation"
      title={t('files.mermaid.navigator') as string}
      on:pointerdown={onOverviewDown}
      on:pointermove={onOverviewMove}
      on:pointerup={onOverviewUp}
      on:pointercancel={onOverviewUp}
    >
      <img src={overviewUrl} alt="" draggable="false"/>
      <div
        class="mv-window"
        style="left:{overviewWindow.left}px;top:{overviewWindow.top}px;width:{overviewWindow.width}px;height:{overviewWindow.height}px"
      ></div>
    </div>
  {/if}
</div>

<style>
  .mv {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg-1);
    outline: none;
  }

  .mv-toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 8px;
    background: var(--bg-2);
    border-bottom: 1px solid var(--stroke-0);
    flex-shrink: 0;
  }
  .mv-group { display: flex; align-items: center; gap: 2px; }
  .mv-group + .mv-group { padding-left: 10px; border-left: 1px solid var(--stroke-0); }
  .mv-spacer { flex: 1; }

  .mv-btn,
  .mv-copy :global(.copy-btn) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 24px;
    height: 24px;
    padding: 0 5px;
    background: none;
    border: none;
    border-radius: 4px;
    color: var(--fg-2);
    font: inherit;
    cursor: pointer;
    transition: background 80ms, color 80ms;
  }
  .mv-btn-text { font-size: 11px; letter-spacing: 0.02em; }
  .mv-btn:hover:not(:disabled),
  .mv-copy :global(.copy-btn:hover) { background: var(--bg-4); color: var(--fg-0); }
  .mv-btn:disabled { color: var(--fg-4); cursor: default; }
  .mv-btn:focus-visible { outline: 2px solid var(--accent, currentColor); outline-offset: -2px; }

  .mv-scale {
    min-width: 40px;
    text-align: center;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: var(--fg-2);
  }

  .mv-surface {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    cursor: grab;
    touch-action: none;
  }
  .mv-surface:global(.cm-md-mermaid-panning) { cursor: grabbing; }
  .mv-surface.mv-failed { cursor: default; }

  .mv-stage {
    position: absolute;
    top: 0;
    left: 0;
    width: max-content;
    transform-origin: 0 0;
  }
  .mv-stage:global(.cm-md-mermaid-error) {
    position: static;
    width: auto;
    padding: 16px;
    white-space: pre-wrap;
    font-family: monospace;
    font-size: 12px;
    color: var(--fg-1);
  }

  .mv-overview {
    position: absolute;
    right: 16px;
    bottom: 16px;
    overflow: hidden;
    background: var(--bg-2);
    border: 1px solid var(--stroke-1);
    border-radius: 6px;
    box-shadow: 0 4px 16px oklch(0 0 0 / 0.3);
    cursor: pointer;
    touch-action: none;
  }
  .mv-overview img {
    display: block;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
  .mv-window {
    position: absolute;
    box-sizing: border-box;
    border: 1px solid var(--accent, currentColor);
    background: color-mix(in oklab, var(--accent, currentColor) 14%, transparent);
    pointer-events: none;
  }
</style>
