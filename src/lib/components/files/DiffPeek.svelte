<script lang="ts">
  import DiffEditor from '$lib/components/review/DiffEditor.svelte';
  import { t } from '$lib/i18n';
  import { hunkToSplit } from '$lib/utils/files/files-diff';
  import type { DiffHunk, BlameEntry } from '$lib/services/file-service';

  type BlamePopup = {
    entry: BlameEntry;
    loadingDiff: boolean;
    error: string | null;
    oldContent: string | null;
    newContent: string | null;
  };

  export let hunk: DiffHunk | null;
  export let revertPending: boolean;
  export let reverting: boolean;
  export let activeLang: any;
  export let onRevertConfirm: (hunk: DiffHunk) => void;
  export let onRevertRequest: () => void;
  export let onRevertCancel: () => void;
  export let onDismiss: () => void;
  export let blame: BlamePopup | null = null;
</script>

{#if blame}
  <div class="diff-peek diff-peek-split {hunk ? 'diff-peek-combined' : ''}">
    <div class="diff-peek-header">
      <span class="diff-peek-title blame-peek-title">
        <span class="blame-peek-hash">{blame.entry.hash}</span>
        <span class="blame-peek-author">{blame.entry.author}</span>
        <span class="blame-peek-date">{blame.entry.date}</span>
        <span class="blame-peek-summary">{blame.entry.summary}</span>
      </span>
      <button class="diff-peek-close" on:click={onDismiss} aria-label={t('diffPeek.closeBlame') as string}>✕</button>
    </div>
    {#if hunk}
      <div class="diff-peek-section-label">
        <span>{(t('diffPeek.currentChangesLines') as (s: number, e: number) => string)(hunk.newStart, hunk.newEnd)}</span>
        <div class="diff-peek-actions">
          {#if revertPending}
            <button class="diff-peek-action diff-peek-action-danger" disabled={reverting} on:click={() => onRevertConfirm(hunk)}>{reverting ? t('common.reverting') : t('diffPeek.confirmRevert')}</button>
            <button class="diff-peek-action" disabled={reverting} on:click={onRevertCancel}>{t('common.cancel')}</button>
          {:else}
            <button class="diff-peek-action" on:click={onRevertRequest} title={t('diffPeek.revertHunkTitle') as string}>{t('diffPeek.revertHunk')}</button>
          {/if}
        </div>
      </div>
      <div class="diff-peek-section">
        {#key hunk}
          <DiffEditor
            oldContent={hunkToSplit(hunk).old}
            newContent={hunkToSplit(hunk).new}
            language={activeLang}
          />
        {/key}
      </div>
      <div class="diff-peek-section-label">{(t('diffPeek.introducedIn') as (hash: string) => string)(blame.entry.hash)}</div>
    {/if}
    <div class="{hunk ? 'diff-peek-section' : 'diff-peek-body diff-peek-body-split'}">
      {#if blame.loadingDiff}
        <div class="blame-peek-loading">{t('diffPeek.blameLoading')}</div>
      {:else if blame.error}
        <div class="blame-peek-loading">{blame.error}</div>
      {:else}
        {#key blame}
          <DiffEditor
            oldContent={blame.oldContent ?? ''}
            newContent={blame.newContent ?? ''}
            language={activeLang}
          />
        {/key}
      {/if}
    </div>
  </div>
{:else if hunk}
  <div class="diff-peek diff-peek-split">
    <div class="diff-peek-header">
      <span class="diff-peek-title">{(t('diffPeek.changesLines') as (s: number, e: number) => string)(hunk.newStart, hunk.newEnd)}</span>
      <div class="diff-peek-actions">
        {#if revertPending}
          <button class="diff-peek-action diff-peek-action-danger" disabled={reverting} on:click={() => onRevertConfirm(hunk)}>{reverting ? t('common.reverting') : t('diffPeek.confirmRevert')}</button>
          <button class="diff-peek-action" disabled={reverting} on:click={onRevertCancel}>{t('common.cancel')}</button>
        {:else}
          <button class="diff-peek-action" on:click={onRevertRequest} title={t('diffPeek.revertHunkTitle') as string}>{t('diffPeek.revertHunk')}</button>
        {/if}
      </div>
      <button class="diff-peek-close" on:click={onDismiss} aria-label={t('diffPeek.closeDiff') as string}>✕</button>
    </div>
    <div class="diff-peek-body diff-peek-body-split">
      {#key hunk}
        <DiffEditor
          oldContent={hunkToSplit(hunk).old}
          newContent={hunkToSplit(hunk).new}
          language={activeLang}
        />
      {/key}
    </div>
  </div>
{/if}

<style>
  .diff-peek {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    max-height: 220px;
    border-top: 1px solid var(--stroke-1);
    background: var(--bg-0);
  }

  .diff-peek-split {
    height: 320px;
    max-height: 320px;
  }

  .diff-peek-combined {
    height: 600px;
    max-height: 600px;
  }

  .diff-peek-section-label {
    flex-shrink: 0;
    padding: 3px 14px;
    font-size: 10px;
    font-family: var(--font-ui);
    color: var(--fg-3);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    background: var(--bg-1);
    border-top: 1px solid var(--stroke-0);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .diff-peek-section-label > span { flex: 1; }
  .diff-peek-section-label .diff-peek-actions {
    margin-left: 8px;
    margin-right: 0;
  }

  .diff-peek-section {
    flex: 1;
    position: relative;
    overflow: hidden;
    min-height: 0;
  }

  .diff-peek-body-split {
    flex: 1;
    position: relative;
    overflow: hidden;
  }

  .diff-peek-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 5px 14px;
    border-bottom: 1px solid var(--stroke-0);
    flex-shrink: 0;
  }

  .diff-peek-title {
    font-family: var(--font-ui);
    font-size: 11px;
    color: var(--fg-3);
    letter-spacing: 0.02em;
  }

  .diff-peek-close {
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
  .diff-peek-close:hover { background: var(--bg-4); color: var(--fg-0); }

  .diff-peek-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-left: auto;
    margin-right: 8px;
  }

  .diff-peek-action {
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
  .diff-peek-action:hover:not(:disabled) {
    background: var(--bg-4);
    color: var(--fg-0);
    border-color: var(--stroke-2);
  }
  .diff-peek-action:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .diff-peek-action-danger {
    color: oklch(0.72 0.18 25);
    border-color: oklch(0.72 0.18 25 / 0.45);
  }
  .diff-peek-action-danger:hover:not(:disabled) {
    background: oklch(0.72 0.18 25 / 0.15);
    color: oklch(0.82 0.18 25);
    border-color: oklch(0.72 0.18 25 / 0.7);
  }

  .diff-peek-body {
    overflow-y: auto;
    overflow-x: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--stroke-1) transparent;
    padding: 4px 0;
  }

  .blame-peek-title {
    display: flex;
    align-items: center;
    gap: 8px;
    overflow: hidden;
  }

  .blame-peek-hash {
    font-family: var(--font-mono);
    font-size: 11px;
    color: oklch(0.72 0.14 250);
    font-weight: 600;
    flex-shrink: 0;
  }

  .blame-peek-author {
    font-size: 11px;
    color: var(--fg-2);
    flex-shrink: 0;
  }

  .blame-peek-date {
    font-size: 11px;
    color: var(--fg-4);
    flex-shrink: 0;
  }

  .blame-peek-summary {
    font-size: 11px;
    color: var(--fg-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .blame-peek-loading {
    padding: 8px 14px;
    font-size: 12px;
    color: var(--fg-3);
    font-family: var(--font-ui);
  }
</style>
