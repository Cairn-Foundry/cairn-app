<script lang="ts">
  /**
   * Asks where a formatting config should be imported from: one of the files
   * detected at the root of the worktree, or a file picked by hand.
   */
  import { createEventDispatcher } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n';
  import type { DetectedConfig, FormatterStatus } from '$lib/services/formatting-service';

  /** Config files found at the root of the worktree, if any. */
  export let detected: DetectedConfig[] = [];
  export let formatters: FormatterStatus[] = [];
  export let scanning = false;

  const dispatch = createEventDispatcher<{
    close: void;
    pick: { file: string };
    browse: void;
  }>();

  /** `editorconfig` is not a formatter of the catalogue, but it is a source. */
  /**
   * Reactive by consistency with the other components of this shape, not out of
   * necessity: the call sits inside an `{#each detected}` block that re-renders
   * whenever any prop changes, so a plain function keeps up here. Written this
   * way so the pattern reads the same everywhere.
   */
  $: sourceName = (formatterId: string): string => {
    if (formatterId === 'editorconfig') return 'EditorConfig';
    return formatters.find((f) => f.id === formatterId)?.name ?? formatterId;
  };
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
  <div class="modal fmt-modal" on:click|stopPropagation role="presentation">
    <div class="modal-head">
      <div>
        <div class="step-count">{t('formatting.import')}</div>
        <h3>{t('formatting.importTitle')}</h3>
      </div>
      <button
        class="icon-btn close"
        on:click={() => dispatch('close')}
        aria-label={t('common.close') as string}
      >
        <Icon name="x" size={16}/>
      </button>
    </div>

    <div class="modal-body">
      <div class="src-title">{t('formatting.importDetectedTitle')}</div>

      {#if scanning}
        <p class="src-empty">{t('formatting.importScanning')}</p>
      {:else if detected.length === 0}
        <p class="src-empty">{t('formatting.importNothingDetected')}</p>
      {:else}
        <div class="src-list">
          {#each detected as item (item.file)}
            <button class="src-row" on:click={() => dispatch('pick', { file: item.file })}>
              <Icon name="file-code" size={14}/>
              <span class="src-row-text">
                <span class="src-file">{item.file}</span>
                <span class="src-source">{sourceName(item.formatterId)}</span>
              </span>
              <Icon name="chev-r" size={12}/>
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <div class="modal-foot">
      <div class="spacer"></div>
      <button class="btn ghost" on:click={() => dispatch('close')}>
        {t('formatting.cancel')}
      </button>
      <button class="btn" on:click={() => dispatch('browse')}>
        <Icon name="folder-open" size={13}/>
        {t('formatting.importBrowse')}
      </button>
    </div>
  </div>
</div>

<style>
  .fmt-modal { width: min(460px, 92vw); }

  .src-title {
    font-size: 10.5px;
    font-family: var(--font-mono);
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fg-3);
    margin-bottom: 10px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--stroke-0);
  }

  .src-empty { margin: 0; font-size: 12px; color: var(--fg-3); line-height: 1.5; }

  .src-list { display: flex; flex-direction: column; gap: 6px; }

  .src-row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 10px 12px;
    background: var(--bg-2);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-md);
    color: inherit;
    text-align: left;
    cursor: pointer;
    transition: border-color .12s, background .12s;
  }
  .src-row:hover { background: var(--bg-3); border-color: var(--stroke-1); }
  .src-row :global(svg) { color: var(--fg-3); flex-shrink: 0; }

  .src-row-text { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .src-file { font-family: var(--font-mono); font-size: 12px; color: var(--fg-0); }
  .src-source { font-size: 11px; color: var(--fg-3); }
</style>
