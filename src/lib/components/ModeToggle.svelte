<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts" context="module">
  export interface ModeOption {
    value: string;
    label: string;
    /** Draws the icon alone, the label moving to the tooltip and the accessible name. */
    icon?: string;
  }
</script>

<script lang="ts">
  /**
   * The two-way switch used wherever one view replaces another: the guide and
   * the diff of the review step, the ticket scopes of the home overview.
   * Dispatches `select` with the chosen value.
   */
  import { createEventDispatcher } from 'svelte';
  import Icon from '#lib/components/Icon.svelte';

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
      class:is-icon={!!option.icon}
      aria-pressed={value === option.value}
      aria-label={option.icon ? option.label : undefined}
      title={option.icon ? option.label : undefined}
      on:click={() => dispatch('select', option.value)}
    >
      {#if option.icon}<Icon name={option.icon} size={13}/>{:else}{option.label}{/if}
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
  .mode.is-icon { display: grid; place-items: center; padding: 3px 7px; }
  .mode.active { background: var(--bg-0); color: var(--fg-0); }
</style>
