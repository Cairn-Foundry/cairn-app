<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * Holds its content back for `delay` ms. Most reads answer in well under
   * that, so a spinner or a skeleton never gets shown for a wait nobody
   * perceives - which is what made the interface look like it blinked.
   */
  import { onDestroy } from 'svelte';

  export let delay: number = 150;
  /** While false the timer is held at zero, so the state resets between waits. */
  export let when: boolean = true;

  let shown = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  $: {
    clearTimeout(timer);
    if (when) timer = setTimeout(() => (shown = true), delay);
    else shown = false;
  }

  onDestroy(() => clearTimeout(timer));
</script>

{#if shown}
  <slot />
{/if}
