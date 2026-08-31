<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * Peek panel under the editor showing the before/after diff of one gutter hunk.
   * `chunk` carries the hunk text and its line range; reverting and closing are
   * delegated to the caller through `onRevert` / `onDismiss`.
   */
  import DiffEditor from '$lib/components/review/DiffEditor.svelte';
  import { t } from '$lib/i18n';
  import type { GutterChunk } from '$lib/utils/editor/editor-diff-gutter';

  export let chunk: GutterChunk;
  export let activeLang: any;
  export let onRevert: () => void;
  export let onDismiss: () => void;
</script>

<div class="hunk-panel">
  <div class="hunk-panel-header">
    <span class="hunk-panel-title">
      {(t('diffPeek.changesLines') as (s: number, e: number) => string)(chunk.lineStart, chunk.lineEnd)}
    </span>
    <div class="hunk-panel-actions">
      <button class="hunk-panel-action" on:click={onRevert} title={t('diffPeek.revertHunkTitle') as string}>
        {t('diffPeek.revertHunk')}
      </button>
    </div>
    <button class="hunk-panel-close" on:click={onDismiss} aria-label={t('diffPeek.closeDiff') as string}>✕</button>
  </div>
  <div class="hunk-panel-body">
    {#key chunk}
      <DiffEditor oldContent={chunk.before} newContent={chunk.after} language={activeLang} />
    {/key}
  </div>
</div>

<style>
  .hunk-panel {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    height: 320px;
    max-height: 320px;
    border-top: 1px solid var(--stroke-1);
    background: var(--bg-0);
  }

  .hunk-panel-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 14px;
    border-bottom: 1px solid var(--stroke-0);
    flex-shrink: 0;
  }

  .hunk-panel-title {
    font-family: var(--font-ui);
    font-size: 11px;
    color: var(--fg-3);
    letter-spacing: 0.02em;
  }

  .hunk-panel-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-left: auto;
    margin-right: 8px;
  }

  .hunk-panel-action {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border: 1px solid var(--stroke-1);
    border-radius: 4px;
    background: none;
    color: var(--fg-2);
    font-family: var(--font-ui);
    font-size: 11px;
    cursor: pointer;
    transition: background 80ms, color 80ms, border-color 80ms;
    white-space: nowrap;
  }
  .hunk-panel-action:hover {
    background: var(--bg-4);
    color: var(--fg-0);
    border-color: var(--stroke-2);
  }

  .hunk-panel-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border: none;
    background: none;
    border-radius: 3px;
    cursor: pointer;
    color: var(--fg-3);
    padding: 0;
  }
  .hunk-panel-close:hover { background: var(--bg-4); color: var(--fg-0); }

  .hunk-panel-body {
    flex: 1;
    position: relative;
    overflow: hidden;
    min-height: 0;
  }
</style>
