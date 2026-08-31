<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * Single source of every icon in the app, drawn inline as SVG paths keyed by
   * name. Stroke width and size follow the surrounding text. The paths live in
   * icon-paths.ts: a map lookup, where a chain of branches used to run for each
   * of the hundreds of instances alive in the file tree.
   */
  import { ICON_FALLBACK, ICONS } from './icon-paths';

  export let name: string;
  export let size: number = 16;
  export let sw: number = 1.5;

  $: def = ICONS[name] ?? ICON_FALLBACK;
  $: cls = ['ic', `ic-${name}`, $$restProps.class].filter(Boolean).join(' ');
</script>

{#if def.solid}
  <svg {...$$restProps} class={cls} width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none">{@html def.body}</svg>
{:else}
  <svg {...$$restProps} class={cls} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={sw} stroke-linecap="round" stroke-linejoin="round">{@html def.body}</svg>
{/if}
