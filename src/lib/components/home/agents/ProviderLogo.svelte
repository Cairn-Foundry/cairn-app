<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * Brand mark of an AI provider, falling back to initials when none is known.
   *
   * Most marks are a single silhouette drawn in `currentColor`, so a tile keeps
   * its accent. A few brands are only themselves in their own colours and in
   * several pieces - those carry their own `viewBox` and fills, and are drawn as
   * given rather than recoloured.
   */
  import { PROVIDER_MARKS, type ProviderMark } from './provider-marks';

  export let id: string;
  export let size = 16;
  /** Initials, drawn when the provider has no brand mark of its own. */
  export let fallback = '';

  $: mark = (PROVIDER_MARKS[id] ?? null) as ProviderMark | null;
  // Narrowed into their own variables: a `typeof` check in the markup does not
  // reach the template's type checker, so each shape is resolved here.
  $: single = typeof mark === 'string' ? mark : null;
  $: colored = mark && typeof mark !== 'string' ? mark : null;
</script>

{#if single}
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="currentColor"
    aria-hidden="true"
    focusable="false"
  >
    <path d={single}/>
  </svg>
{:else if colored}
  <svg
    viewBox={colored.viewBox}
    width={size}
    height={size}
    fill="none"
    aria-hidden="true"
    focusable="false"
  >
    {#each colored.paths as path (path.d)}
      <path d={path.d} fill={path.fill} opacity={path.opacity}/>
    {/each}
  </svg>
{:else}
  {fallback}
{/if}
