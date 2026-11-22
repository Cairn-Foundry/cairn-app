<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * Where one worktree of a project stands: its branch and, in a tag, the lines
   * added and removed in it. `isBase` marks the repository itself rather than
   * an instance.
   */
  import Icon from '#lib/components/Icon.svelte';
  import { t } from '#lib/i18n';
  import type { WorktreeState } from '#lib/stores/project-overview';

  export let branch: string;
  export let state: WorktreeState | null = null;
  export let isBase = false;
  export let title = '';
</script>

<span class="worktree" {title}>
  <Icon name={isBase ? 'git' : 'layers'} size={12}/>
  <span class="branch">{branch || '-'}</span>
  {#if state && (state.added > 0 || state.removed > 0)}
    <span class="lines" title={(t('home.projects.linesTitle') as (a: number, r: number) => string)(state.added, state.removed)}>
      <span class="added">+{state.added}</span>
      <span class="removed">-{state.removed}</span>
    </span>
  {/if}
</span>

<style>
  .worktree {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
    overflow: hidden;
    font-size: 12px;
    white-space: nowrap;
    color: var(--fg-3);
  }
  .worktree :global(.ic) { flex-shrink: 0; color: var(--fg-4); }
  .branch {
    color: var(--fg-1);
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .lines {
    display: inline-flex;
    gap: 6px;
    flex-shrink: 0;
    padding: 1px 7px;
    font-size: 11px;
    line-height: 1.6;
    font-variant-numeric: tabular-nums;
    background: var(--bg-3);
    border-radius: 10px;
  }
  .added { color: var(--success); }
  .removed { color: var(--danger); }
</style>
