<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /** Stands in for the rendered turn: prints the text blocks it was given. */
  export let blocks: { kind?: string; text?: string }[] = [];
</script>

<div data-turn-blocks>
  {#each blocks as block}
    <span class="stub-block">{block.text ?? ''}</span>
  {/each}
</div>
