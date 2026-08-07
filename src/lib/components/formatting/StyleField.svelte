<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import Select from '$lib/components/Select.svelte';
  import { t } from '$lib/i18n';
  import type { StyleOptionInfo, StyleValue } from '$lib/services/formatting-service';

  export let option: StyleOptionInfo;
  /** The value set here, or undefined when it comes from the level above. */
  export let value: StyleValue | undefined = undefined;
  /** What applies when nothing is set here. */
  export let inherited: StyleValue | undefined = undefined;

  const dispatch = createEventDispatcher<{ change: StyleValue | undefined }>();

  /** Option and choice ids are data, so their keys are built rather than literal. */
  const key = (id: string) => id as Parameters<typeof t>[0];

  $: effective = value ?? inherited;
  $: label = t(key(`formatting.options.${option.id}`)) as string;

  function onNumber(e: Event) {
    const raw = (e.currentTarget as HTMLInputElement).value;
    dispatch('change', raw === '' ? undefined : Number(raw));
  }
</script>

<div class="settings-row">
  <div class="settings-row-info">
    <span class="settings-row-label">{label}</span>
  </div>

  <div class="settings-row-control">
    {#if option.kind === 'boolean'}
      <label class="settings-toggle" aria-label={label}>
        <input
          type="checkbox"
          checked={effective === true}
          on:change={(e) => dispatch('change', e.currentTarget.checked)}
        />
        <span class="settings-toggle-track"><span class="settings-toggle-thumb"></span></span>
      </label>
    {:else if option.kind === 'enum'}
      <div class="pick">
        <Select
          value={String(effective ?? '')}
          options={option.choices.map((choice) => ({
            value: choice,
            label: (t(key(`formatting.choices.${choice}`)) as string) ?? choice,
          }))}
          ariaLabel={label}
          on:change={(e) => dispatch('change', e.detail)}
        />
      </div>
    {:else}
      <input
        class="settings-number-input"
        type="number"
        min={option.min ?? undefined}
        max={option.max ?? undefined}
        value={effective ?? ''}
        aria-label={label}
        on:change={onNumber}
      />
    {/if}
  </div>
</div>

<style>
  /* The shared Select fills its container, so the row decides the width. */
  .pick { width: 132px; }
</style>
