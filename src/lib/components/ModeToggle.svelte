<script lang="ts" context="module">
  export interface ModeOption {
    value: string;
    label: string;
  }
</script>

<script lang="ts">
  /**
   * The two-way switch used wherever one view replaces another: the guide and
   * the diff of the review step, the ticket scopes of the home overview.
   * Dispatches `select` with the chosen value.
   */
  import { createEventDispatcher } from 'svelte';

  export let options: ModeOption[];
  export let value: string;
  export let ariaLabel = '';

  const dispatch = createEventDispatcher<{ select: string }>();
</script>

<div class="mode-toggle" role="group" aria-label={ariaLabel}>
  {#each options as option (option.value)}
    <button
      class="mode"
      class:active={value === option.value}
      aria-pressed={value === option.value}
      on:click={() => dispatch('select', option.value)}
    >
      {option.label}
    </button>
  {/each}
</div>

<style>
  .mode-toggle {
    display: inline-flex;
    background: var(--bg-3);
    border-radius: 5px;
    padding: 2px;
    flex-shrink: 0;
  }
  .mode {
    border: 0;
    background: transparent;
    color: var(--fg-2);
    font-size: 11.5px;
    padding: 2px 10px;
    border-radius: 4px;
    cursor: pointer;
    font-family: var(--font-ui);
  }
  .mode.active { background: var(--bg-0); color: var(--fg-0); }
</style>
