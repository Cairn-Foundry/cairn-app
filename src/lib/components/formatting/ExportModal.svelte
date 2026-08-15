<script lang="ts">
  /**
   * Modal choosing which config file the current style is written to, and warning
   * about the options the chosen format cannot express.
   */
  import { createEventDispatcher } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Select from '$lib/components/Select.svelte';
  import { t } from '$lib/i18n';
  import type { FormatterStatus, StyleSet } from '$lib/services/formatting-service';
  import { languageLabel } from '$lib/utils/formatting/languages';

  /** The style being written out, already resolved for `languageId`. */
  export let style: StyleSet;
  export let languageId: string;
  export let formatters: FormatterStatus[] = [];

  const dispatch = createEventDispatcher<{ close: void; confirm: { target: string } }>();

  /** Option ids are data, so their i18n keys are built rather than literal. */
  const key = (id: string) => id as Parameters<typeof t>[0];

  const UNIVERSAL = [
    'indentStyle', 'indentSize', 'lineWidth', 'lineEnding', 'finalNewline',
    'trimTrailingWhitespace',
  ];

  const TARGETS = [
    { value: 'cairn', file: '.cairnformat' },
    { value: 'prettier', file: '.prettierrc' },
    { value: 'biome', file: 'biome.json' },
    { value: 'rustfmt', file: 'rustfmt.toml' },
    { value: 'ruff', file: 'ruff.toml' },
    { value: 'black', file: 'pyproject.toml' },
    { value: 'clang-format', file: '.clang-format' },
    { value: 'editorconfig', file: '.editorconfig' },
  ];

  let target = 'cairn';

  const options = TARGETS.map((entry) => ({ value: entry.value, label: entry.file }));
  $: file = TARGETS.find((entry) => entry.value === target)?.file ?? '';

  /**
   * What the chosen format cannot express, worked out before the write rather
   * than reported after it: choosing a target is the moment the answer matters.
   */
  $: kept =
    target === 'cairn'
      ? Object.keys(style)
      : target === 'editorconfig'
        ? UNIVERSAL
        : (formatters.find((f) => f.id === target)?.supported ?? []);
  $: dropped =
    target === 'cairn' ? [] : Object.keys(style).filter((id) => !kept.includes(id));
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
        <div class="step-count">{t('formatting.export')}</div>
        <h3>
          {(t('formatting.exportTitle') as (language: string) => string)(
            languageLabel(languageId),
          )}
        </h3>
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
      <Select
        value={target}
        {options}
        ariaLabel={t('formatting.exportTarget') as string}
        on:change={(e) => (target = e.detail)}
      />

      {#if dropped.length > 0}
        <p class="exp-warn">
          <Icon name="alert" size={13}/>
          <span>
            {t('formatting.exportDroppedTitle')}
            {#each dropped as id, i}{i > 0 ? ', ' : ''}{t(key(`formatting.options.${id}`))}{/each}
          </span>
        </p>
      {/if}
    </div>

    <div class="modal-foot">
      <div class="spacer"></div>
      <button class="btn ghost" on:click={() => dispatch('close')}>
        {t('formatting.cancel')}
      </button>
      <button class="btn primary" on:click={() => dispatch('confirm', { target })}>
        {(t('formatting.exportAs') as (file: string) => string)(file)}
      </button>
    </div>
  </div>
</div>

<style>
  .fmt-modal { width: min(420px, 92vw); }

  .exp-warn {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 14px 0 0;
    font-size: 11.5px;
    color: var(--fg-2);
    line-height: 1.55;
  }
  .exp-warn :global(svg) { flex-shrink: 0; margin-top: 1px; color: var(--warning, #f5a524); }
</style>
