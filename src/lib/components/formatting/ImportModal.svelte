<script lang="ts">
  /**
   * Recap of what an imported config file resolved to, shown before it is applied.
   */
  import { createEventDispatcher } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n';
  import type { ImportReport, StyleValue } from '$lib/services/formatting-service';

  export let report: ImportReport;

  const dispatch = createEventDispatcher<{ close: void; confirm: void }>();

  /** Option ids are data, so their i18n keys are built rather than literal. */
  const key = (id: string) => id as Parameters<typeof t>[0];

  function display(value: StyleValue | undefined): string {
    if (value === undefined) return '';
    if (typeof value === 'boolean') return t(value ? 'formatting.valueOn' : 'formatting.valueOff') as string;
    if (typeof value === 'number') return String(value);
    const label = t(key(`formatting.choices.${value}`)) as string;
    return label.startsWith('formatting.') ? value : label;
  }
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
        <h3>{(t('formatting.importedFrom') as (s: string) => string)(report.source)}</h3>
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
      <div class="imp-group">
        <div class="imp-title">
          {(t('formatting.importMapped') as (n: number) => string)(report.mapped.length)}
        </div>
        {#each report.mapped as [native, cairn]}
          <div class="imp-row">
            <code class="selectable">{native}</code>
            <Icon name="chev-r" size={11}/>
            <span class="imp-opt">{t(key(`formatting.options.${cairn}`))}</span>
            <span class="imp-value selectable">{display(report.style[cairn])}</span>
          </div>
        {/each}
      </div>

      {#if report.unsupported.length > 0}
        <div class="imp-group">
          <div class="imp-title">{t('formatting.importUnsupported')}</div>
          <p class="imp-keys">
            {#each report.unsupported as k, i}{i > 0 ? ', ' : ''}<code class="selectable">{k}</code>{/each}
          </p>
        </div>
      {/if}

      {#if report.unknown.length > 0}
        <div class="imp-group">
          <div class="imp-title">{t('formatting.importUnknown')}</div>
          <p class="imp-keys">
            {#each report.unknown as k, i}{i > 0 ? ', ' : ''}<code class="selectable">{k}</code>{/each}
          </p>
        </div>
      {/if}
    </div>

    <div class="modal-foot">
      <div class="spacer"></div>
      <button class="btn ghost" on:click={() => dispatch('close')}>
        {t('formatting.cancel')}
      </button>
      <button class="btn primary" on:click={() => dispatch('confirm')}>
        {t('formatting.applyImport')}
      </button>
    </div>
  </div>
</div>

<style>
  .fmt-modal { width: min(560px, 92vw); }

  .imp-group { margin-bottom: 18px; }
  .imp-group:last-child { margin-bottom: 0; }

  .imp-title {
    font-size: 10.5px;
    font-family: var(--font-mono);
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fg-3);
    margin-bottom: 8px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--stroke-0);
  }

  .imp-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 0;
    font-size: 12px;
    color: var(--fg-1);
  }
  .imp-row :global(svg) { color: var(--fg-3); flex-shrink: 0; }
  .imp-opt { flex: 1; min-width: 0; }
  .imp-value {
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--fg-0);
    background: var(--bg-2);
    border: 1px solid var(--stroke-0);
    border-radius: 4px;
    padding: 1px 6px;
    flex-shrink: 0;
  }

  .imp-keys { margin: 0; font-size: 12px; color: var(--fg-3); line-height: 1.8; }

  code { font-family: var(--font-mono); font-size: 11.5px; color: var(--fg-2); }
</style>
